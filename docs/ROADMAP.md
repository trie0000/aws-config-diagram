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

## Phase 2: データフロー強化（次期開発）

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

## Phase 4: プロダクト化・課金対応

| タスク | 優先度 | 見積もり | 状態 |
|-------|--------|---------|------|
| Web UI（JSON投入 → 図ダウンロード） | 中 | 5日 | 未着手 |
| pytest による自動テスト | 中 | 3日 | 未着手 |
| PDF 出力 | 低 | 1日 | 未着手 |
| マルチリージョン / マルチアカウント | 低 | 5日 | 未着手 |
| Transit Gateway / Direct Connect | 低 | 3日 | 未着手 |
| カスタムレイアウト設定（YAML） | 低 | 3日 | 未着手 |
| 課金モデル設計・実装 | - | - | 未着手 |

---

## 優先順位の考え方

1. **Phase 2 VPCE矢印** → 既存機能の自然な拡張。実装コスト低い
2. **Phase 3 差分比較** → 最大の差別化ポイント。ここが課金の核
3. **Phase 2 SG要約表** → Phase 3 の差分比較と組み合わせると価値倍増
4. **Phase 4** → ユーザー数が増えてから
