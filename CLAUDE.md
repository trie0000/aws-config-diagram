# CLAUDE.md - aws-config-diagram 開発規約

## プロジェクト概要

AWS Config Snapshot JSONからAWSネットワーク構成図を自動生成するツール。
ローカルサーバー + ブラウザUIで構成図の表示・編集。Excel/PPTXエクスポート。
**外部サーバーへのデータ送信は一切行わない**（プロダクトの肝）。

詳細は `docs/PRODUCT_VISION.md` を参照。

## ファイル構成

```
/Users/a21/mytools/aws-config-diagram/
├── aws_config_parser.py   # 入力層: Config JSON パーサー（既存・変更なし）
├── diagram_state.py       # 状態層: パーサー出力 → 編集可能な DiagramState
├── layout_engine.py       # レイアウト層: DiagramState → 座標計算（共通）
├── diagram_excel.py       # 出力層: Excel (.xlsx) 図生成（既存・変更なし）
├── diagram_pptx.py        # 出力層: PowerPoint (.pptx) 図生成（既存・変更なし）
├── web/                   # バックエンド
│   ├── app.py             # FastAPI アプリケーション (localhost専用)
│   └── routes/            # APIルート（規模拡大時に分割）
├── frontend/              # フロントエンド
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── src/
│       ├── App.tsx
│       ├── types/         # DiagramState 型定義
│       ├── components/    # React コンポーネント (canvas/, panels/, toolbar/)
│       ├── hooks/         # カスタムhooks (状態管理, ドラッグ, Undo/Redo)
│       ├── services/      # API クライアント
│       └── lib/           # 定数, ユーティリティ
├── tests/                 # pytest テスト（バックエンド）
├── debug_diagram.py       # デバッグ: パース結果サマリー表示
├── debug_raw_subnet.py    # デバッグ: サブネット生データダンプ
├── icons/                 # AWS サービスアイコン (PNG: Excel/PPTX用)
├── docs/
│   ├── PRODUCT_VISION.md  # プロダクト方針
│   ├── ROADMAP.md         # 開発ロードマップ
│   ├── COMPETITIVE_ANALYSIS.md  # 競合分析
│   ├── design/
│   │   ├── ARCHITECTURE.md        # 技術設計
│   │   ├── WEB_EDITOR_SPEC.md     # Web エディタ機能要件仕様書
│   │   ├── CODING_STANDARDS.md    # コード開発基準
│   │   └── CONFIG_JSON_ANALYSIS.md  # Config JSON 実データ分析
│   └── HANDOFF.md         # セッション引き継ぎ
├── test/                  # AWS CLI テストスクリプト + スナップショット
├── CLAUDE.md              # このファイル（開発規約）
├── README.md              # ユーザー向け使い方
├── requirements.txt       # Python 依存パッケージ
├── .gitignore
└── venv/                  # Python 仮想環境（git管理外）
```

## 実行環境

- **フロントエンド**: TypeScript 5.x + React 19 + Vite 6.x + shadcn/ui + Tailwind CSS
- **バックエンド**: Python 3.11+ + FastAPI + uvicorn
- **Python依存**: openpyxl, lxml, python-pptx, fastapi, uvicorn, pydantic
- **Node.js**: 20 LTS+
- venv: `venv/` に作成済み
- リポジトリ: `/Users/a21/mytools/aws-config-diagram/`（Mac ローカル管理）

### 起動

```bash
# 開発時（ターミナル2つ）
# T1: バックエンド
source venv/bin/activate && uvicorn web.app:app --reload --port 8000

# T2: フロントエンド
cd frontend && npm run dev   # → http://localhost:5173

# 将来（ワンコマンド）
python -m aws_config_diagram serve   # → http://localhost:8080
```

## アーキテクチャ

### 通信ルール（最重要）

**外部サーバーへのデータ送信は一切行わない。通信は全て localhost 内で完結。**

```
┌──────────────────────────┐  localhost  ┌──────────────────────────┐
│  React Frontend (ブラウザ) │ ◄────────► │  FastAPI Backend (Python) │
│  - SVG Canvas 描画・編集   │  REST API  │  - JSON パース            │
│  - ドラッグ&ドロップ       │   (JSON)   │  - レイアウト計算          │
│  - 状態管理 / Undo/Redo   │            │  - Excel/PPTX エクスポート │
└──────────────────────────┘            └──────────────────────────┘
```

### 責務分離

- **AWSConfigParser** (`aws_config_parser.py`): JSON→構造化データ。既存・変更なし
- **DiagramState** (`diagram_state.py`): 構造化データ→編集可能な中間状態
- **LayoutEngine** (`layout_engine.py`): DiagramState→座標計算。ピクセル座標で統一
- **DiagramExcel** (`diagram_excel.py`): 構造化データ→Excel。既存・変更なし
- **DiagramV2** (`diagram_pptx.py`): 構造化データ→PPTX。既存・変更なし
- **FastAPI** (`web/app.py`): localhost専用 REST API
- **React** (`frontend/`): ブラウザ上の構成図表示・編集 UI

### データフロー

```
Config JSON → [FastAPI] AWSConfigParser → DiagramState → LayoutEngine
                                                              │
                                          ┌──── localhost ────┤
                                          ▼                   ▼
                                    [React] SVG Canvas   [FastAPI] Excel/PPTX
                                    (表示・編集)          (エクスポート)
```

### 設計原則

1. **パーサーと描画の分離**: 入力形式・出力形式の追加が容易
2. **Config JSONのみで完結**: 追加のAWS API呼び出し不要
3. **コンテンツ駆動レイアウト**: リソース数に応じて枠サイズが自動調整
4. **JSONに根拠がある情報のみ表示**: 推測ベースの矢印は引かない
5. **localhost完結**: 外部サーバーへのデータ送信を一切行わない
6. **source区別の厳守**: AWS Config由来 (`aws-config`) とユーザー手動 (`user-manual`) を明確に分離
7. **既存コード不変**: 新機能は新ファイルで実装。既存 Excel/PPTX エンジンは変更しない

詳細設計: `docs/design/ARCHITECTURE.md`
コード開発基準: `docs/design/CODING_STANDARDS.md`

## ドキュメントルール

| ファイル | 内容 | 更新タイミング |
|---------|------|--------------|
| `CLAUDE.md` | 開発規約（このファイル） | ルール変更時 |
| `docs/PRODUCT_VISION.md` | プロダクト方針・フェーズ計画 | 方針変更時 |
| `docs/ROADMAP.md` | 開発ロードマップ | タスク完了・追加時 |
| `docs/design/ARCHITECTURE.md` | 技術設計 | アーキテクチャ変更時 |
| `docs/design/CODING_STANDARDS.md` | コード開発基準 | コーディングルール変更時 |
| `docs/design/WEB_EDITOR_SPEC.md` | Web エディタ機能要件 | 仕様変更時 |
| `docs/HANDOFF.md` | セッション引き継ぎ | **20ターンごと** + 作業区切り時 |
| `README.md` | ユーザー向け使い方 | 機能追加時 |

### HANDOFF.md 更新ルール（必須・最重要）

セッション上限に達しても次のセッションで確実に作業を継続できるよう、HANDOFF.md を常に最新に保つ。

**更新タイミング:**
- **20ターンごとに必ず更新する**（セッション上限対策）
- 大きな変更をコミットした直後に更新する
- /compact 実行時は直前に更新する
- 長時間タスク開始前に初回更新する
- **セッション終了の兆候があれば即座に更新する**

**新セッション開始時:**
- まず HANDOFF.md を読む
- 不明点があれば関連ドキュメントを参照する
- HANDOFF.md の内容を確認してから作業を再開する

### HANDOFF.md 記載内容

- 現在の作業状態（何をやっていたか）
- 完了済みタスク
- 未完了・次のアクション（**具体的に何をどのファイルで行うか**）
- 変更したファイル一覧
- 未解決の問題・判断待ち事項
- **技術的な意思決定の経緯**（なぜその選択をしたか）

### ドキュメント作成方針

- 設計ドキュメントはコードの「なぜそうなっているか」を記録する
- 仕様変更時は ARCHITECTURE.md を先に更新してからコードを変更する

## コーディング規約

### TypeScript / React

- 関数コンポーネント + hooks
- 型定義は `interface` 優先
- 状態管理は `useReducer` + `useContext`
- SVG 描画は `data-node-id` / `data-edge-id` 属性で要素を識別
- スタイリングは Tailwind CSS (shadcn/ui 統合)

### Python

- クラスベース設計
- 新規コードは型ヒント必須
- docstring は Google スタイル
- 色定数はクラスにまとめる

### Web API

- REST 準拠のエンドポイント設計（`/api/parse`, `/api/export/xlsx` 等）
- Pydantic モデルでリクエスト/レスポンスの型を定義
- CORS は `localhost` のみ許可

詳細: `docs/design/CODING_STANDARDS.md`

### テスト

- テスト用JSON: `tabelog_aws_config.json`（メイン）、`realistic_aws_config.json`、`sample_aws_config_snapshot.json`、`real_config_snapshot.json`
- テストデータ (実環境): `test/snapshots/snapshot.json` (259リソース, 80タイプ)
- バックエンド: pytest (`tests/`)
- フロントエンド: Vitest (`frontend/src/__tests__/`)
- 既存の出力確認は生成されたExcel/PPTXを目視確認

## git運用

- ブランチ: feature ブランチ方式 (`feature/xxx`, `fix/xxx`)
- main へのマージは PR 経由
- コミットメッセージ: 日本語OK、prefix使用（feat/fix/docs/refactor/test/chore/style）
- .gitignore: venv, node_modules, dist, xlsx, pptx, __pycache__, .env を除外
- リモート: GitHub (`trie0000/aws-config-diagram`)

## 対応AWSサービス一覧

### VPC内リソース
EC2, ALB, RDS, NAT Gateway, IGW, ECS, EKS, Lambda(VPC), ElastiCache, Redshift

### エッジサービス（VPC外左側）
Route53, CloudFront, API Gateway

### サポートサービス（ゾーン右上バッジ表示）
KMS, CloudTrail, CloudWatch, VPC Endpoint

### データパスサービス（VPC下部）
Lambda(serverless), DynamoDB, SQS, SNS, S3

### その他
WAF, ACM, Auto Scaling, Elastic Beanstalk, VPC Peering
