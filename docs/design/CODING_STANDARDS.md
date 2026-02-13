# コード開発基準 - AWS Config Diagram Generator

> 作成日: 2026-02-13
> 最終更新: 2026-02-13
> 対象: Phase 1.5 Web エディタ開発 + 既存コード保守

---

## 1. 全般ルール

### 1.1 言語・バージョン

| 項目 | 基準 |
|------|------|
| フロントエンド | TypeScript 5.x + React 19 |
| バックエンド | Python 3.11+ |
| ビルドツール | Vite 6.x |
| パッケージ管理 | npm (フロントエンド) / pip + venv (バックエンド) |
| Node.js | 20 LTS+ |

### 1.2 ライセンス

全ライブラリは **MIT or BSD** ライセンス。商用利用に制約なし。

| ライブラリ | ライセンス | 用途 |
|-----------|----------|------|
| React | MIT | UI フレームワーク |
| TypeScript | Apache-2.0 | 型安全 |
| Vite | MIT | ビルド・開発サーバー |
| shadcn/ui | MIT相当 | UI コンポーネント |
| FastAPI | MIT | Python バックエンド |
| uvicorn | BSD-3 | ASGI サーバー |
| Pydantic | MIT | リクエスト/レスポンス型定義 |
| openpyxl | MIT | Excel 出力 |
| python-pptx | MIT | PPTX 出力 |
| lxml | BSD-3 | DrawingML XML 操作 |

### 1.3 ファイルヘッダー

**Python:**
```python
"""
filename.py: 簡潔な説明（1行）

Version: X.Y.Z
Last Updated: YYYY-MM-DD
"""
```

**TypeScript:**
```typescript
/**
 * filename.tsx: 簡潔な説明（1行）
 *
 * @version X.Y.Z
 * @lastUpdated YYYY-MM-DD
 */
```

### 1.4 コメント言語

- コード内コメント: **英語**
- ドキュメント (*.md): **日本語**
- UI テキスト: **日本語**（将来 i18n 対応）
- JSON キー名 / TypeScript 型名: **英語** (camelCase)

---

## 2. アーキテクチャ原則

### 2.1 通信ルール（最重要）

```
┌─────────────────┐    localhost のみ    ┌─────────────────┐
│  React Frontend  │ ◄──────────────────► │  FastAPI Backend │
│  (ブラウザ)       │    REST API          │  (ローカルサーバー) │
└─────────────────┘                      └─────────────────┘
```

- **外部サーバーへのデータ送信は一切行わない**（プロダクトの肝）
- 通信は全て `localhost` 内で完結
- Config JSON データはユーザーのマシン外に出ない
- フロントエンド↔バックエンド間は REST API (JSON)

### 2.2 責務分離

| レイヤー | 技術 | 責務 |
|---------|------|------|
| **フロントエンド** | React + TypeScript | UI表示、操作、状態管理 |
| **バックエンド** | Python + FastAPI | JSONパース、レイアウト計算、Excel/PPTX生成 |

**フロントエンドの責務:**
- SVG キャンバスでの構成図描画
- ドラッグ&ドロップ、ズーム、パン
- リソース詳細パネル表示
- Undo/Redo（クライアント状態管理）
- DiagramState の UI 上での編集

**バックエンドの責務:**
- Config JSON → DiagramState 変換（既存パーサー流用）
- DiagramState → レイアウト座標計算（既存ロジック流用）
- DiagramState → Excel (.xlsx) 生成（既存エンジン流用）
- DiagramState → PPTX (.pptx) 生成（既存エンジン流用）

---

## 3. TypeScript / React コーディング規約

### 3.1 スタイル

| ルール | 基準 |
|-------|------|
| インデント | 2スペース |
| セミコロン | なし（Prettier デフォルト） |
| 文字列 | シングルクォート `'...'` |
| 型定義 | `interface` 優先（`type` は union/intersection 時のみ） |
| コンポーネント | 関数コンポーネント + hooks |
| 状態管理 | React hooks（useState, useReducer, useContext） |
| スタイリング | Tailwind CSS (shadcn/ui 統合) |

### 3.2 命名規則

| 対象 | 規則 | 例 |
|------|------|---|
| コンポーネント | PascalCase | `Canvas.tsx`, `DetailPanel.tsx` |
| hooks | camelCase + `use` prefix | `useDragNode.ts`, `useUndoRedo.ts` |
| ユーティリティ | camelCase | `apiClient.ts`, `svgHelpers.ts` |
| 型定義ファイル | camelCase | `diagram.ts`, `api.ts` |
| 定数 | UPPER_SNAKE_CASE | `GRID_SIZE`, `MIN_ZOOM` |
| CSS クラス | Tailwind ユーティリティ | `className="flex items-center gap-2"` |
| data属性 | kebab-case | `data-node-id`, `data-layer-id` |

### 3.3 ディレクトリ構成

```
frontend/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
└── src/
    ├── App.tsx                    # ルートコンポーネント
    ├── main.tsx                   # エントリーポイント
    ├── types/
    │   ├── diagram.ts             # DiagramState, Node, Edge 型定義
    │   └── api.ts                 # API リクエスト/レスポンス型
    ├── components/
    │   ├── canvas/
    │   │   ├── Canvas.tsx         # SVG キャンバス（メイン）
    │   │   ├── NodeRenderer.tsx   # ノード描画（VPC/Subnet/リソース）
    │   │   ├── EdgeRenderer.tsx   # エッジ描画（矢印/コネクター）
    │   │   └── GridOverlay.tsx    # グリッド表示
    │   ├── panels/
    │   │   ├── DetailPanel.tsx    # リソース詳細（右パネル）
    │   │   ├── LayerPanel.tsx     # レイヤー管理
    │   │   └── CommentPanel.tsx   # コメント一覧
    │   ├── toolbar/
    │   │   ├── Toolbar.tsx        # メインツールバー
    │   │   ├── ExportButton.tsx   # Excel/PPTXエクスポート
    │   │   └── UploadButton.tsx   # Config JSONアップロード
    │   └── ui/                    # shadcn/ui コンポーネント
    ├── hooks/
    │   ├── useDiagramState.ts     # DiagramState 管理
    │   ├── useDragNode.ts         # ドラッグ&ドロップ
    │   ├── useCanvasZoom.ts       # ズーム・パン制御
    │   ├── useUndoRedo.ts         # Undo/Redo スタック
    │   └── useApi.ts              # FastAPI 通信
    ├── services/
    │   └── api.ts                 # API クライアント（fetch ラッパー）
    ├── lib/
    │   ├── constants.ts           # 共通定数
    │   ├── colors.ts              # AWS リソース色定義
    │   └── utils.ts               # ユーティリティ関数
    └── styles/
        └── globals.css            # Tailwind ベーススタイル
```

### 3.4 コンポーネント設計

```tsx
// Good: Props に interface、状態は hooks に分離
interface NodeRendererProps {
  node: DiagramNode
  isSelected: boolean
  onSelect: (nodeId: string) => void
  onDragStart: (nodeId: string, e: React.MouseEvent) => void
}

export function NodeRenderer({ node, isSelected, onSelect, onDragStart }: NodeRendererProps) {
  return (
    <g
      data-node-id={node.id}
      transform={`translate(${node.position.x}, ${node.position.y})`}
      onClick={() => onSelect(node.id)}
      onMouseDown={(e) => onDragStart(node.id, e)}
    >
      <rect ... />
      <text ...>{node.label}</text>
    </g>
  )
}
```

### 3.5 SVG 描画ルール

```tsx
// SVG の階層構造でAWS構成図の親子関係を表現
<svg viewBox="0 0 3000 2000">
  <g className="layer-infrastructure">
    <g data-node-id="node-vpc-001">          {/* VPC枠 */}
      <rect ... />
      <g data-node-id="node-az-001">         {/* AZ枠 */}
        <g data-node-id="node-subnet-001">   {/* Subnet枠 */}
          <g data-node-id="node-ec2-001">    {/* EC2アイコン */}
            <image ... />
            <text ...>Web Server</text>
          </g>
        </g>
      </g>
    </g>
  </g>
  <g className="layer-edges">               {/* 矢印レイヤー */}
    <path data-edge-id="edge-001" ... />
  </g>
</svg>
```

### 3.6 状態管理パターン

```tsx
// useReducer で DiagramState を管理
type DiagramAction =
  | { type: 'MOVE_NODE'; nodeId: string; position: Position }
  | { type: 'SELECT_NODE'; nodeId: string }
  | { type: 'ADD_COMMENT'; comment: Comment }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'LOAD_STATE'; state: DiagramState }

function diagramReducer(state: DiagramState, action: DiagramAction): DiagramState {
  switch (action.type) {
    case 'MOVE_NODE':
      return {
        ...state,
        nodes: {
          ...state.nodes,
          [action.nodeId]: {
            ...state.nodes[action.nodeId],
            position: action.position,
            isUserModified: true,
          }
        }
      }
    ...
  }
}
```

---

## 4. Python バックエンド規約

### 4.1 スタイル

| ルール | 基準 |
|-------|------|
| インデント | 4スペース（PEP 8） |
| 最大行長 | 120文字 |
| 文字列 | ダブルクォート `"..."` |
| 型ヒント | 新規コードは必須 |
| docstring | Google スタイル |

### 4.2 命名規則

| 対象 | 規則 | 例 |
|------|------|---|
| モジュール | snake_case | `diagram_state.py`, `layout_engine.py` |
| クラス | PascalCase | `DiagramState`, `LayoutEngine` |
| メソッド (public) | snake_case | `get_nodes()`, `calculate_layout()` |
| メソッド (private) | `_` prefix | `_calc_col_widths()` |
| 定数 | UPPER_SNAKE_CASE | `EMU_PER_INCH` |

### 4.3 FastAPI エンドポイント

| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/parse` | Config JSON → DiagramState 変換 |
| POST | `/api/layout` | DiagramState → 座標計算 |
| POST | `/api/export/xlsx` | DiagramState → Excel ダウンロード |
| POST | `/api/export/pptx` | DiagramState → PPTX ダウンロード |

```python
@app.post("/api/parse")
async def parse_config(file: UploadFile) -> DiagramStateResponse:
    """Config JSON をパースして DiagramState を返す"""
    content = await file.read()
    data = json.loads(content)
    parser = AWSConfigParser(data)
    state = DiagramState.from_parser(parser)
    return state.to_response()
```

**注意**: 全ての通信は `localhost` 内で完結する。CORS は `localhost` のみ許可。

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 4.4 既存コードとの共存ルール

| ファイル | 方針 |
|---------|------|
| `aws_config_parser.py` | **変更最小限**。新メソッド追加はOK、既存シグネチャ変更は禁止 |
| `diagram_excel.py` | **変更なし**。エクスポート時にそのまま呼び出す |
| `diagram_pptx.py` | **変更なし**。同上 |

パーサーへの新メソッド追加時:
```python
class AWSConfigParser:
    # ... 既存メソッド ...

    # --- Web Editor support (Phase 1.5) ---
    def get_all_resources_flat(self) -> list[dict]:
        """Return all resources as a flat list for DiagramState."""
        ...
```

---

## 5. DiagramState 型定義（TypeScript ↔ Python 共通）

### 5.1 TypeScript 型定義

```typescript
// types/diagram.ts

interface DiagramState {
  meta: DiagramMeta
  nodes: Record<string, DiagramNode>
  edges: Record<string, DiagramEdge>
  comments: Record<string, DiagramComment>
  layers: DiagramLayer[]
  canvas: CanvasSettings
}

interface DiagramNode {
  id: string
  source: 'aws-config' | 'user-manual'
  resourceType: string
  label: string
  position: Position
  size: Size
  style: NodeStyle
  parentId: string | null
  childrenIds: string[]
  layerId: string
  isLocked: boolean
  isHidden: boolean
  isUserModified: boolean
  // AWS Config 由来の場合のみ
  awsResourceId?: string
  awsResourceType?: string
  configData?: Record<string, unknown>
}
```

### 5.2 ID 生成規則

| 要素 | プレフィックス | 例 |
|------|-------------|---|
| ノード (AWS) | `node-{type}-` | `node-vpc-001`, `node-ec2-003` |
| ノード (手動) | `node-ext-` | `node-ext-001` |
| エッジ (SG由来) | `edge-sg-` | `edge-sg-001` |
| エッジ (手動) | `edge-usr-` | `edge-usr-001` |
| コメント | `comment-` | `comment-001` |

### 5.3 `source` フィールドの厳守

| source 値 | 意味 | JSON再インポート時 |
|-----------|------|-------------------|
| `aws-config` | Config JSON 由来 | `isUserModified=false` なら上書き |
| `user-manual` | ユーザー手動追加 | 絶対に削除しない |

---

## 6. テスト規約

### 6.1 構成

```
# バックエンド
tests/
├── conftest.py
├── test_config_parser.py
├── test_diagram_state.py
├── test_api.py
└── fixtures/
    ├── minimal_config.json
    └── expected_state.json

# フロントエンド
frontend/src/__tests__/
├── components/
│   └── Canvas.test.tsx
├── hooks/
│   └── useDiagramState.test.ts
└── services/
    └── api.test.ts
```

### 6.2 テスト実行

```bash
# バックエンド
source venv/bin/activate && pytest tests/ -v

# フロントエンド
cd frontend && npm test
```

---

## 7. git 運用規約

### 7.1 ブランチ戦略

```
main                              # リリース可能
├── feature/web-editor-state      # DiagramState 実装
├── feature/web-editor-canvas     # React Canvas
├── feature/web-editor-export     # エクスポート連携
└── fix/parser-xxx                # バグ修正
```

### 7.2 コミットメッセージ

```
<prefix>: 変更の要約（日本語OK）

# prefix:
# feat / fix / refactor / docs / test / chore / style
```

### 7.3 .gitignore

```gitignore
# Python
__pycache__/
*.py[cod]
venv/
.env

# Frontend
frontend/node_modules/
frontend/dist/

# Generated outputs
*.pptx
*.xlsx
~$*
uploads/

# IDE / OS
.vscode/
.idea/
.DS_Store

# Existing
icons_tmp/
*.zip
```

---

## 8. セキュリティ規約

### 8.1 データ保護（最重要）

- **Config JSON データは外部に送信しない**
- CORS は `localhost` のみ許可
- 外部CDN からのスクリプト読み込みは禁止（全てバンドル）
- アップロードされた Config JSON はメモリ上で処理（ディスク永続化は IndexedDB のみ）

### 8.2 入力バリデーション

- アップロードファイルサイズ上限: 50MB
- JSON 形式チェック必須
- `eval()`, `exec()` 使用禁止
- Config JSON 内の値を HTML にエスケープなしで出力しない（React の JSX は自動エスケープ）

---

## 9. パフォーマンス基準

| 操作 | 目標 |
|------|------|
| Config JSON パース + レイアウト | < 2秒 (500リソース) |
| SVG 初回描画 | < 1秒 (100ノード) |
| ノードドラッグ | 60fps |
| ズーム/パン | 60fps |
| Excel/PPTX エクスポート | < 5秒 |

---

## 10. 起動方法

### 開発時

```bash
# ターミナル1: バックエンド
cd /Users/a21/mytools/aws-config-diagram
source venv/bin/activate
uvicorn web.app:app --reload --port 8000

# ターミナル2: フロントエンド
cd /Users/a21/mytools/aws-config-diagram/frontend
npm run dev
# → http://localhost:5173 でブラウザが開く
```

### 将来（ワンコマンド起動）

```bash
# Python から FastAPI + Vite ビルド済みフロントエンドを配信
python -m aws_config_diagram serve
# → http://localhost:8080 でブラウザが開く
```

---

## 11. ドキュメント相互参照

| ドキュメント | パス |
|------------|------|
| 開発規約（全般） | `/CLAUDE.md` |
| コード開発基準（このファイル） | `/docs/design/CODING_STANDARDS.md` |
| Web エディタ機能要件 | `/docs/design/WEB_EDITOR_SPEC.md` |
| 技術設計 | `/docs/design/ARCHITECTURE.md` |
| プロダクト方針 | `/docs/PRODUCT_VISION.md` |
| ロードマップ | `/docs/ROADMAP.md` |
