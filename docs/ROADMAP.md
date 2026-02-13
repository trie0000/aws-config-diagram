# 開発ロードマップ - AWS Config Diagram Generator

## Phase 1: 基本構成図 ✅ 完了

基本的なネットワーク構成図の自動生成。

| タスク | 状態 |
|-------|------|
| AWS Config JSON パーサー（30+リソースタイプ） | ✅ 完了 |
| VPC/Subnet/AZ 階層レイアウト | ✅ 完了 |
| Public/Private/Isolated 自動分類 | ✅ 完了 |
| SG ベース通信フロー矢印 | ✅ 完了 |
| コンテンツ駆動の動的サイズ調整 | ✅ 完了 |
| Excel (.xlsx) 出力 | ✅ 完了 |
| PowerPoint (.pptx) 出力 | ✅ 完了 |
| AWS 公式アイコン対応 | ✅ 完了 |
| VPC Endpoint 検出・バッジ表示 | ✅ 完了 |
| サポートサービスのゾーン右上バッジ | ✅ 完了 |
| README / requirements.txt | ✅ 完了 |

---

## Phase 1.5: Web エディタ MVP ⚡ 最優先

ブラウザ上で構成図をインタラクティブに表示・編集する Web アプリケーション。

> 詳細仕様: [WEB_EDITOR_SPEC.md](./design/WEB_EDITOR_SPEC.md)
> コード開発基準: [CODING_STANDARDS.md](./design/CODING_STANDARDS.md)

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React 19 + TypeScript + Vite + shadcn/ui + Tailwind CSS |
| バックエンド | Python 3.11+ + FastAPI + uvicorn |
| 通信 | REST API (**localhost のみ、外部通信なし**) |
| Excel/PPTX | 既存 Python エンジンそのまま流用 |

### タスク

| タスク | 優先度 | 見積もり | 状態 |
|-------|--------|---------|------|
| `diagram_state.py`: DiagramState データモデル設計・実装 | 高 | 1日 | 未着手 |
| `layout_engine.py`: レイアウト計算の抽出・共通化 | 高 | 1日 | 未着手 |
| `web/app.py`: FastAPI バックエンド (localhost専用) | 高 | 1日 | 未着手 |
| `frontend/`: Vite + React + TypeScript プロジェクトセットアップ | 高 | 0.5日 | 未着手 |
| SVG Canvas コンポーネント（VPC/Subnet/AZ 階層 + アイコン） | 高 | 2日 | 未着手 |
| ドラッグ&ドロップ（リソース移動、位置保存） | 高 | 1日 | 未着手 |
| リソース詳細パネル（クリックで情報表示） | 中 | 0.5日 | 未着手 |
| Excel/PPTX ダウンロード（既存エンジン流用） | 高 | 0.5日 | 未着手 |
| 外部システム追加（手動ノード追加 UI） | 中 | 1日 | 未着手 |
| コメント機能（ノードへの注釈追加） | 中 | 1日 | 未着手 |
| `isUserModified` + JSON再インポートマージ | 中 | 1日 | 未着手 |

### アーキテクチャ

```
┌──────────────────────────────────────────────────┐
│  React Frontend (ブラウザ)                        │
│  - SVG Canvas: ズーム / パン / ドラッグ          │
│  - 詳細パネル: リソース情報表示                   │
│  - ツールバー: 追加 / コメント / エクスポート     │
│  - 状態管理: useReducer + useContext             │
│  - Undo/Redo: クライアント側で完結               │
└───────────────────┬──────────────────────────────┘
                    │ REST API (localhost:8000)
                    ▼
┌──────────────────────────────────────────────────┐
│  FastAPI Backend (web/app.py) ← localhost専用    │
│  - POST /api/parse        → Config JSON パース   │
│  - POST /api/layout       → レイアウト座標計算   │
│  - POST /api/export/xlsx  → Excel ダウンロード   │
│  - POST /api/export/pptx  → PPTX ダウンロード    │
└───────────────────┬──────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
  AWSConfigParser  layout_   diagram_excel.py
  (既存・変更なし)  engine.py  diagram_pptx.py
                  (新規)     (既存・変更なし)
```

### DiagramState データモデル（TypeScript型）

```typescript
interface DiagramState {
  meta: DiagramMeta
  nodes: Record<string, DiagramNode>    // Figma方式フラットマップ
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
  position: { x: number; y: number }
  size: { width: number; height: number }
  parentId: string | null
  isUserModified: boolean
  // ...
}
```

---

## Phase 2: データフロー強化

VPC Endpointを通じたデータフローの可視化と、SG情報の詳細出力。

| タスク | 優先度 | 見積もり | 状態 |
|-------|--------|---------|------|
| VPCE Gateway型: routeTableIds → Subnet逆引き | 高 | 0.5日 | 未着手 |
| VPCE Interface型: subnetIds → 配置Subnet紐付け | 高 | 0.5日 | 未着手 |
| VPCE → 外部サービス（S3, DynamoDB等）矢印描画 | 高 | 1日 | 未着手 |
| SG ルール要約表（別シート） | 中 | 1日 | 未着手 |
| Subnet CIDR 取得の改善（ResourceNotRecorded対応） | 低 | 済み（フォールバック実装済み） | ✅ 完了 |

### 技術メモ

**VPCE データフロー矢印の実装方針:**

```
Gateway型 (S3, DynamoDB):
  VPCE.routeTableIds → Route Table → 紐付きSubnet一覧
  → そのSubnet内リソース全てが利用可能
  → 矢印: Subnet → VPCE → 外部サービス

Interface型 (SQS, SNS, KMS等):
  VPCE.subnetIds → 配置先Subnet
  → SGで制御（VPCE自体にSGが付与される）
  → 矢印: Subnet内リソース → VPCE → 外部サービス
```

**SG ルール要約表:**
- 送信元(SG/CIDR) × 送信先(SG/CIDR) × ポート のマトリクス
- Excelの別シートに出力
- 図の矢印では読みにくい詳細ポート情報を補完

---

## Phase 3: 差分比較（差別化の核）

2つのConfig JSONを比較し、変更をハイライト表示する。

| タスク | 優先度 | 見積もり | 状態 |
|-------|--------|---------|------|
| diff_engine.py: 2つのパース結果を比較 | 高 | 2日 | 未着手 |
| リソース追加（緑）/ 削除（赤）/ 変更（黄）の色分け | 高 | 2日 | 未着手 |
| 差分サマリーテキスト（別シート or ヘッダー） | 中 | 1日 | 未着手 |
| CLI: `--diff old.json new.json` オプション | 高 | 0.5日 | 未着手 |
| 差分対象: リソース増減 + SG ルール変更 + CIDR変更 | 中 | 1日 | 未着手 |

### 技術メモ

**差分比較のアプローチ:**

```python
# diff_engine.py（構想）
class ConfigDiff:
    def __init__(self, old_parser: AWSConfigParser, new_parser: AWSConfigParser):
        ...

    def diff_resources(self) -> dict:
        """resourceId ベースで追加/削除/変更を検出"""
        old_ids = set(old.by_id.keys())
        new_ids = set(new.by_id.keys())
        return {
            "added": new_ids - old_ids,
            "removed": old_ids - new_ids,
            "changed": {id for id in old_ids & new_ids
                        if old.by_id[id] != new.by_id[id]}
        }
```

**描画への反映:**
- DiagramExcel に `diff_result` を渡す
- `_box()`, `_ibox()` で色を差分ステータスに応じて変更
- 変更なしのリソースは通常色、追加=緑枠、削除=赤枠、変更=黄枠

---

## Phase 4: SaaS化・課金対応

| タスク | 優先度 | 見積もり | 状態 |
|-------|--------|---------|------|
| リアルタイム共同編集（CRDT/WebSocket） | 中 | 5日 | 未着手 |
| チーム共有・権限管理 | 中 | 3日 | 未着手 |
| pytest による自動テスト（E2E） | 中 | 3日 | 未着手 |
| PDF 出力 | 低 | 1日 | 未着手 |
| マルチリージョン / マルチアカウント | 低 | 5日 | 未着手 |
| Transit Gateway / Direct Connect | 低 | 3日 | 未着手 |
| カスタムレイアウト設定（YAML） | 低 | 3日 | 未着手 |
| 課金モデル設計・実装 | - | - | 未着手 |

---

## 優先順位の考え方

1. **Phase 1.5 Web エディタ** → ユーザー体験の飛躍的向上。差別化の基盤。CLIからWebへ
2. **Phase 2 VPCE矢印** → Web エディタ上で矢印を追加表示。実装コスト低い
3. **Phase 3 差分比較** → Web上で差分をインタラクティブ表示。課金の核
4. **Phase 4 SaaS化** → ユーザー数が増えてから
