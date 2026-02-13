# プロダクトビジョン - AWS Config Diagram Generator

## コンセプト

**「AWS Config JSONだけで、人が読める構成図を、ローカルで安全に生成する」**

### 解決する課題

1. **セキュリティ制約**: SaaS（Hava.io, Cloudcraft等）にIAMクレデンシャルを渡せない環境でも構成図が必要
2. **手作業の限界**: 手動でdraw.io/PowerPointに構成図を描く→変更のたびに更新が追いつかない
3. **既存ツールの不在**: AWS Config JSONを入力にして見やすい構成図を生成するツールが市場に存在しない

### ターゲットユーザー

| ユーザー | ニーズ |
|---------|-------|
| SIer / 運用チーム | 顧客環境の構成図を定期レポートで提出 |
| セキュリティ監査 | Config JSONのオフライン分析、監査証跡 |
| 社内インフラチーム | 変更管理、構成の可視化、引き継ぎ資料 |
| コンサルタント | 現状分析、改善提案の根拠資料 |

### 競合との差別化

| 観点 | 既存SaaS (Hava等) | 本ツール |
|------|-------------------|---------|
| 入力 | AWSアカウント接続 | Config JSONファイル |
| セキュリティ | クレデンシャル外部送信 | ローカル完結 |
| 出力 | Web UI / PNG | Excel/PPTX（編集可能） |
| ネットワーク | 必須 | 不要 |
| コスト | $29〜49+/月 | 無料（OSS） → 将来有料版あり |
| 差分比較 | なし | 対応予定 |
| VPCEフロー | なし | 対応予定 |

---

## 機能一覧

### Phase 1: 基本構成図（現在 ✅ 完了）

- [x] AWS Config JSON パース（30+リソースタイプ対応）
- [x] VPC/Subnet/AZ の階層レイアウト自動計算
- [x] Public/Private/Isolated のSubnet自動分類
- [x] SGベースの通信フロー矢印
- [x] コンテンツ駆動の動的サイズ調整
- [x] Excel (.xlsx) 出力
- [x] PowerPoint (.pptx) 出力
- [x] AWS公式アイコン対応
- [x] VPC Endpoint 検出・表示
- [x] サポートサービスのバッジ表示（KMS, CloudTrail等）

### Phase 2: データフロー強化（次期開発）

- [ ] VPC Endpoint経由のデータフロー矢印
  - Gateway型: routeTableIds → Subnet逆引き → 接続元特定
  - Interface型: subnetIds → 配置Subnet内リソースから接続
  - VPCE → 外部サービス（S3, DynamoDB等）への矢印
- [ ] SG ルール要約表（別シート）
  - 送信元→送信先×ポートのマトリクス表
  - 図の矢印では読めない詳細情報を補完

### Phase 3: 差分比較（差別化の核）

- [ ] 2つのConfig JSONを入力 → 差分を色分けハイライト
  - 緑: 追加されたリソース
  - 赤: 削除されたリソース
  - 黄: 設定変更（SG ルール変更、CIDR変更等）
- [ ] 差分サマリーテキスト（別シート or ヘッダー）
- [ ] 期間指定での変更追跡（S3に蓄積されたスナップショットを複数入力）

### Phase 4: 課金対応・拡張

- [ ] Web UI（ブラウザでドラッグ&ドロップでJSON投入 → 図をダウンロード）
- [ ] マルチリージョン / マルチアカウント対応
- [ ] Transit Gateway / Direct Connect 対応
- [ ] PDF出力
- [ ] カスタムレイアウト設定（YAML/JSON）
- [ ] 課金モデル（SaaS版 or ライセンス版）

---

## アーキテクチャ方針

### 設計原則

1. **パーサーと描画の分離**: `AWSConfigParser` はJSON→構造化データ、描画エンジンは構造化データ→出力。入力形式や出力形式の追加が容易
2. **Config JSONのみで完結**: 追加のAWS API呼び出し不要。将来IAM JSONを追加入力にする場合もオプショナル
3. **コンテンツ駆動レイアウト**: リソース数に応じて枠サイズが自動調整。固定サイズではない
4. **JSONに根拠がある情報のみ表示**: 推測ベースの矢印は引かない。根拠がないサービス間接続はハードコードしない

### モジュール構成

```
aws-config-diagram/
├── aws_config_parser.py    # 入力層: Config JSON → 構造化データ
├── diagram_excel.py        # 出力層: 構造化データ → Excel
├── diagram_pptx.py         # 出力層: 構造化データ → PPTX
├── (将来) diagram_web.py   # 出力層: 構造化データ → Web UI
├── (将来) diff_engine.py   # 差分層: 2つの構造化データ → 差分
├── icons/                  # AWSサービスアイコン
├── docs/
│   ├── PRODUCT_VISION.md   # このファイル（プロダクト方針）
│   ├── design/
│   │   └── ARCHITECTURE.md # 技術設計
│   ├── ROADMAP.md          # 開発ロードマップ
│   └── HANDOFF.md          # セッション引き継ぎ
├── tests/                  # (将来) 自動テスト
├── CLAUDE.md               # Claude Code 開発規約
├── README.md               # ユーザー向け使い方
└── requirements.txt        # Python依存パッケージ
```

### 技術スタック

| レイヤー | 技術 | 理由 |
|---------|------|------|
| 言語 | Python 3.11+ | データ処理・ライブラリ豊富 |
| Excel出力 | openpyxl + DrawingML(lxml) | サイズ制限なし、編集可能 |
| PPTX出力 | python-pptx + lxml | プレゼン用途 |
| Web UI (将来) | FastAPI + HTMX or Streamlit | 軽量、デプロイ容易 |
| テスト (将来) | pytest | 標準 |
| 配布 (将来) | PyPI or Docker | CLI配布 or SaaS化 |

---

## 課金モデル（将来構想）

### 段階的マネタイズ

| フェーズ | モデル | 内容 |
|---------|-------|------|
| 現在 | 無料（OSS） | GitHub公開、基本機能 |
| Phase 3後 | Freemium | 基本図=無料、差分比較=有料 |
| Phase 4 | SaaS | Web UI、チーム共有、API |

### 有料機能の候補

- 差分比較（時系列変更追跡）
- SGルール要約表
- マルチアカウント統合図
- カスタムブランディング（ロゴ・色設定）
- API（CI/CDパイプラインから図を自動生成）

---

## 成功指標

| 指標 | Phase 1 (現在) | Phase 3 | Phase 4 |
|------|---------------|---------|---------|
| 対応リソースタイプ | 30+ | 30+ | 50+ |
| 出力形式 | Excel, PPTX | + 差分図 | + Web, PDF |
| 自動テスト | なし | パーサー | E2E |
| ユーザー数 | 自分 | 社内展開 | 外部公開 |
