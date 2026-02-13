"""
web/app.py: FastAPI アプリケーション (localhost専用)

AWS Config Diagram Generator の Web バックエンド。
全通信は localhost 内で完結。外部サーバーへのデータ送信は一切行わない。

起動:
    source venv/bin/activate && uvicorn web.app:app --reload --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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


# --- 以下、Phase 1.5 で実装予定 ---

# POST /api/parse        - Config JSON パース → DiagramState
# POST /api/layout       - DiagramState → レイアウト計算済み DiagramState
# POST /api/export/xlsx  - DiagramState → Excel ダウンロード
# POST /api/export/pptx  - DiagramState → PowerPoint ダウンロード
