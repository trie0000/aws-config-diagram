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
| ネットワーク | 必須 | 不要（localhost完結） |
| コスト | $29〜49+/月 | 無料（OSS） → 将来有料版あり |
| Web編集 | Web UI のみ | Web + Excel/PPTX エクスポート |
| データ保護 | クラウド送信あり | **ローカル完結（データ外部送信なし）** |
| 差分比較 | なし | 対応予定 |
| VPCEフロー | なし | 対応予定 |

> 詳細な競合分析・差別化戦略は [COMPETITIVE_ANALYSIS.md](./COMPETITIVE_ANALYSIS.md) を参照。

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

### Phase 1.5: Web エディタ（最優先・次期開発）

ブラウザ上でAWS構成図をインタラクティブに表示・編集できるWebアプリケーション。

- [ ] Config JSON アップロード → ブラウザ上で構成図を自動表示
- [ ] ドラッグ&ドロップでリソース位置の調整
- [ ] リソースクリックで詳細情報パネル表示
- [ ] AWS外システムの手動追加（オンプレ、SaaS等）
- [ ] コメント/注釈の追加（ノードへのアンカー付き）
- [ ] ユーザー修正の維持（`isUserModified` フラグ、JSON再インポート時のマージ）
- [ ] Excel/PPTX ダウンロード（既存エンジン流用）
- [ ] 位置ロック / 折りたたみ / レイヤー管理
- [ ] Undo/Redo

> 詳細仕様は [WEB_EDITOR_SPEC.md](./design/WEB_EDITOR_SPEC.md) を参照。

### Phase 2: データフロー強化

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

### Phase 4: SaaS化・課金対応

- [ ] リアルタイム共同編集（CRDT/WebSocket）
- [ ] チーム共有・権限管理（viewer/commenter/editor/admin）
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
├── aws_config_parser.py    # 入力層: Config JSON → 構造化データ（既存）
├── diagram_state.py        # 状態層: 構造化データ → 編集可能な DiagramState
├── layout_engine.py        # レイアウト層: DiagramState → 座標計算（共通）
├── diagram_excel.py        # 出力層: → Excel（既存）
├── diagram_pptx.py         # 出力層: → PPTX（既存）
├── web/                    # バックエンド（FastAPI, localhost専用）
│   └── app.py
├── frontend/               # フロントエンド（React + TypeScript + Vite）
│   └── src/
│       ├── components/     # Canvas, Panels, Toolbar
│       ├── hooks/          # 状態管理, ドラッグ, Undo/Redo
│       ├── types/          # DiagramState 型定義
│       └── services/       # API クライアント
├── (将来) diff_engine.py   # 差分層: 2つの DiagramState → 差分
├── icons/                  # AWSサービスアイコン (PNG)
├── docs/
│   ├── design/
│   │   ├── ARCHITECTURE.md
│   │   ├── WEB_EDITOR_SPEC.md
│   │   ├── CODING_STANDARDS.md
│   │   └── CONFIG_JSON_ANALYSIS.md
│   ├── PRODUCT_VISION.md   # このファイル
│   ├── COMPETITIVE_ANALYSIS.md
│   ├── ROADMAP.md
│   └── HANDOFF.md
├── tests/                  # pytest（バックエンド）
├── test/                   # AWS CLI テストスクリプト + スナップショット
├── CLAUDE.md
├── README.md
└── requirements.txt
```

### 技術スタック

| レイヤー | 技術 | 理由 |
|---------|------|------|
| フロントエンド | React 19 + TypeScript + Vite | 高品質UI、型安全、コンポーネント設計 |
| UIライブラリ | shadcn/ui + Tailwind CSS | 洗練されたデザイン、カスタマイズ容易 |
| バックエンド | Python 3.11+ + FastAPI | 既存パーサー・エクスポートエンジン流用 |
| Excel出力 | openpyxl + DrawingML(lxml) | サイズ制限なし、編集可能 |
| PPTX出力 | python-pptx + lxml | プレゼン用途 |
| State管理 | DiagramState (TypeScript型 ↔ Python dict) | フロント↔バックエンド間のブリッジ |
| 通信 | REST API (localhost のみ) | **外部サーバー通信なし** |
| テスト | pytest (BE) + Vitest (FE) | 各レイヤーの自動テスト |
| 配布 (将来) | PyPI (`pip install`) → `serve` コマンド | ワンコマンド起動 |

---

## 課金モデル（将来構想）

### 段階的マネタイズ

| フェーズ | モデル | 内容 |
|---------|-------|------|
| 現在 | 無料（OSS） | GitHub公開、基本機能 + CLI |
| Phase 1.5後 | 無料（OSS） | Web エディタ公開（差別化の基盤） |
| Phase 3後 | Freemium | 基本図=無料、差分比較=有料 |
| Phase 4 | SaaS | チーム共有、権限管理、API |

### 有料機能の候補

- 差分比較（時系列変更追跡）
- SGルール要約表
- マルチアカウント統合図
- カスタムブランディング（ロゴ・色設定）
- API（CI/CDパイプラインから図を自動生成）

---

## 成功指標

| 指標 | Phase 1 (現在) | Phase 1.5 | Phase 3 | Phase 4 |
|------|---------------|-----------|---------|---------|
| 対応リソースタイプ | 30+ | 30+ | 30+ | 50+ |
| 出力形式 | Excel, PPTX | + Web UI | + 差分図 | + PDF |
| インタラクション | なし（CLI） | ドラッグ&ドロップ、コメント | + 差分ハイライト | + 共同編集 |
| 自動テスト | なし | パーサー | + Diff | E2E |
| ユーザー数 | 自分 | 社内展開 | + 外部β | 外部公開 |
