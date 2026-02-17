"""
desktop/main.py: AWS Config Diagram Generator - Desktop Entry Point

PyInstaller exe / 開発時スクリプト兼用のエントリポイント。
ダブルクリックで起動 → ブラウザが開く → 使う → コンソール閉じて終了。

- ポート自動選択 (8000-8100)
- ブラウザ自動起動
- レジストリ不使用・管理者権限不要
"""

import os
import sys
import socket
import threading
import time
import webbrowser


def find_free_port(start: int = 8000, end: int = 8100) -> int:
    """bind できるポートを探す。"""
    for port in range(start, end + 1):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    raise RuntimeError(f"No free port found in range {start}-{end}")


def setup_paths() -> str:
    """PyInstaller frozen mode / 開発モード に応じてパスを設定し、BASE_DIR を返す。"""
    if getattr(sys, "frozen", False):
        # PyInstaller --onedir: sys._MEIPASS = _internal/ フォルダ
        base_dir = sys._MEIPASS  # type: ignore[attr-defined]
    else:
        # 開発モード: desktop/main.py → プロジェクトルート
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # プロジェクトルートを sys.path に追加（web.app, aws_config_parser 等のインポート用）
    if base_dir not in sys.path:
        sys.path.insert(0, base_dir)

    return base_dir


def open_browser(port: int, delay: float = 1.5) -> None:
    """uvicorn 起動を待ってからブラウザを開く。"""
    time.sleep(delay)
    url = f"http://127.0.0.1:{port}"
    print(f"  ブラウザを開きます: {url}")
    webbrowser.open(url)


def main() -> None:
    base_dir = setup_paths()
    port = find_free_port()

    print("=" * 50)
    print("  AWS Config Diagram Generator")
    print("=" * 50)
    print(f"  ポート: {port}")
    print(f"  ベースディレクトリ: {base_dir}")
    print()
    print("  起動中...")
    print("  終了するにはこのウィンドウを閉じてください。")
    print("=" * 50)

    # ブラウザを別スレッドで開く
    t = threading.Thread(target=open_browser, args=(port,), daemon=True)
    t.start()

    # uvicorn でサーバー起動（メインスレッド、ブロッキング）
    import uvicorn

    uvicorn.run(
        "web.app:app",
        host="127.0.0.1",
        port=port,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
