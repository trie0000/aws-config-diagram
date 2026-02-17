"""
web/app.py: FastAPI アプリケーション (localhost専用)

AWS Config Diagram Generator の Web バックエンド。
全通信は localhost 内で完結。外部サーバーへのデータ送信は一切行わない。

起動:
    source venv/bin/activate && uvicorn web.app:app --reload --port 8000
"""

import json
import os
import sys
import tempfile

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# プロジェクトルートを Python パスに追加（aws_config_parser 等のインポート用）
if getattr(sys, "frozen", False):
    # PyInstaller frozen mode: sys._MEIPASS = _internal/ フォルダ
    PROJECT_ROOT = sys._MEIPASS  # type: ignore[attr-defined]
else:
    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from aws_config_parser import AWSConfigParser
from diagram_state import DiagramStateConverter
from layout_engine import LayoutEngine

app = FastAPI(
    title="AWS Config Diagram Generator",
    description="localhost専用 - Config JSON → 構成図生成 API",
    version="0.1.0",
)

# CORS: localhost のみ許可（フロントエンド開発サーバー）
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """ヘルスチェック"""
    return {"status": "ok", "version": "0.1.0"}


@app.post("/api/parse")
async def parse_config(file: UploadFile = File(...)):
    """Config JSON をパースして DiagramState（レイアウト計算済み）を返す。

    1. JSON ファイルを受け取り
    2. AWSConfigParser でパース
    3. DiagramStateConverter で DiagramState に変換
    4. LayoutEngine で座標計算
    5. TypeScript 互換の camelCase JSON を返す
    """
    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="JSON ファイルを指定してください")

    # 一時ファイルに保存（AWSConfigParser がファイルパスを要求するため）
    try:
        content = await file.read()
        # JSON として有効か検証
        json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="無効な JSON ファイルです")

    with tempfile.NamedTemporaryFile(
        mode="wb", suffix=".json", delete=False,
    ) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # パース → DiagramState 変換 → レイアウト計算
        parser = AWSConfigParser(tmp_path)
        converter = DiagramStateConverter(parser)
        title = os.path.splitext(file.filename)[0]
        state = converter.convert(title=title)

        engine = LayoutEngine()
        state = engine.calculate(state)

        return state.to_json()

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"パース処理エラー: {str(e)}")

    finally:
        os.unlink(tmp_path)


@app.post("/api/export/xlsx")
async def export_xlsx(file: UploadFile = File(...)):
    """Config JSON → Excel (.xlsx) ファイルを生成してダウンロード"""
    return await _export_file(file, "xlsx")


@app.post("/api/export/pptx")
async def export_pptx(file: UploadFile = File(...)):
    """Config JSON → PowerPoint (.pptx) ファイルを生成してダウンロード"""
    return await _export_file(file, "pptx")


async def _export_file(file: UploadFile, format: str) -> FileResponse:
    """共通エクスポート処理"""
    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="JSON ファイルを指定してください")

    try:
        content = await file.read()
        json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="無効な JSON ファイルです")

    with tempfile.NamedTemporaryFile(
        mode="wb", suffix=".json", delete=False,
    ) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        parser = AWSConfigParser(tmp_path)
        base_name = os.path.splitext(file.filename)[0]

        if format == "xlsx":
            from diagram_excel import DiagramExcel
            output_path = os.path.join(
                tempfile.gettempdir(), f"{base_name}.xlsx")
            diagram = DiagramExcel(parser)
            diagram.generate(output_path)
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif format == "pptx":
            from diagram_pptx import DiagramV2
            output_path = os.path.join(
                tempfile.gettempdir(), f"{base_name}.pptx")
            diagram = DiagramV2(parser)
            diagram.generate(output_path)
            media_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        else:
            raise HTTPException(status_code=400, detail=f"未対応の形式: {format}")

        return FileResponse(
            path=output_path,
            filename=f"{base_name}.{format}",
            media_type=media_type,
        )

    except ImportError as e:
        raise HTTPException(
            status_code=500,
            detail=f"エクスポートエンジンの読み込みに失敗: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"エクスポートエラー: {str(e)}",
        )
    finally:
        os.unlink(tmp_path)


# ============================================================
# 静的ファイル配信（exe モード / python desktop/main.py 時）
# ============================================================
# フロントエンドビルド済みファイルが存在する場合のみマウント。
# html=True で SPA ルーティング対応（存在しないパスは index.html にフォールバック）。
# 開発時（npm run dev + uvicorn --reload）は frontend/dist が無くても問題ない。
_frontend_dist = os.path.join(PROJECT_ROOT, "frontend_dist")
if not os.path.isdir(_frontend_dist):
    # 開発モードでは frontend/dist を試す
    _frontend_dist = os.path.join(PROJECT_ROOT, "frontend", "dist")

if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
