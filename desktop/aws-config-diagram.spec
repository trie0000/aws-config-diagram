# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for AWS Config Diagram Generator.

Usage (Windows):
    pyinstaller desktop/aws-config-diagram.spec

Output:
    dist/aws-config-diagram/
        aws-config-diagram.exe
        frontend_dist/
        icons/
        (依存ファイル群)
"""

import os

block_cipher = None

# プロジェクトルート（spec ファイルの親の親）
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(SPEC)))

a = Analysis(
    [os.path.join(PROJECT_ROOT, 'desktop', 'main.py')],
    pathex=[PROJECT_ROOT],
    binaries=[],
    datas=[
        # Python モジュール群
        (os.path.join(PROJECT_ROOT, 'aws_config_parser.py'), '.'),
        (os.path.join(PROJECT_ROOT, 'diagram_state.py'), '.'),
        (os.path.join(PROJECT_ROOT, 'layout_engine.py'), '.'),
        (os.path.join(PROJECT_ROOT, 'diagram_excel.py'), '.'),
        (os.path.join(PROJECT_ROOT, 'diagram_pptx.py'), '.'),
        # Web アプリ（FastAPI）
        (os.path.join(PROJECT_ROOT, 'web'), 'web'),
        # フロントエンド ビルド済みファイル
        (os.path.join(PROJECT_ROOT, 'frontend', 'dist'), 'frontend_dist'),
        # AWS アイコン
        (os.path.join(PROJECT_ROOT, 'icons'), 'icons'),
    ],
    hiddenimports=[
        # uvicorn
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        # FastAPI / Starlette
        'fastapi',
        'starlette',
        'starlette.staticfiles',
        'starlette.responses',
        # Pydantic
        'pydantic',
        'pydantic_core',
        # multipart (ファイルアップロード)
        'multipart',
        'python_multipart',
        # lxml
        'lxml',
        'lxml.etree',
        'lxml._elementpath',
        # openpyxl
        'openpyxl',
        # python-pptx
        'pptx',
        # 標準ライブラリ
        'email.mime.multipart',
        'email.mime.text',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='aws-config-diagram',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # コンソール表示（ログ確認 + Ctrl+C 終了）
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='aws-config-diagram',
)
