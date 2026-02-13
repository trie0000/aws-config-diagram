# CLAUDE.md - aws-config-diagram 開発規約

## プロジェクト概要

AWS Config Snapshot JSONからAWSネットワーク構成図を自動生成するCLIツール。
Excel (.xlsx) / PowerPoint (.pptx) で出力。外部監査・社内レビュー用途を想定。

将来は差分比較・課金対応を予定。詳細は `docs/PRODUCT_VISION.md` を参照。

## ファイル構成

```
/Users/a21/mytools/aws-config-diagram/
├── aws_config_parser.py   # 入力層: Config JSON パーサー（共通）
├── diagram_excel.py       # 出力層: Excel (.xlsx) 図生成
├── diagram_pptx.py        # 出力層: PowerPoint (.pptx) 図生成
├── debug_diagram.py       # デバッグ: パース結果サマリー表示
├── debug_raw_subnet.py    # デバッグ: サブネット生データダンプ
├── icons/                 # AWS サービスアイコン (PNG)
├── docs/
│   ├── PRODUCT_VISION.md  # プロダクト方針・コンセプト・フェーズ計画
│   ├── ROADMAP.md         # 開発ロードマップ
│   ├── design/
│   │   └── ARCHITECTURE.md # 技術設計
│   └── HANDOFF.md         # セッション引き継ぎ
├── CLAUDE.md              # このファイル（開発規約）
├── README.md              # ユーザー向け使い方
├── requirements.txt       # Python 依存パッケージ
├── .gitignore
└── venv/                  # Python 仮想環境（git管理外）
```

## 実行環境

- Python 3.11+
- 依存: `openpyxl`, `lxml`, `python-pptx`
- venv: `venv/` に作成済み
- 実行: `source venv/bin/activate && python diagram_excel.py <config.json>`
- リポジトリ: `/Users/a21/mytools/aws-config-diagram/`（Mac ローカル管理）

## アーキテクチャ

### 責務分離

- **AWSConfigParser** (`aws_config_parser.py`): JSON→構造化データ。描画に関与しない
- **DiagramExcel** (`diagram_excel.py`): 構造化データ→Excel。パース方法に依存しない
- **DiagramV2** (`diagram_pptx.py`): 構造化データ→PPTX。同上

### 設計原則

1. **パーサーと描画の分離**: 入力形式・出力形式の追加が容易
2. **Config JSONのみで完結**: 追加のAWS API呼び出し不要
3. **コンテンツ駆動レイアウト**: リソース数に応じて枠サイズが自動調整
4. **JSONに根拠がある情報のみ表示**: 推測ベースの矢印は引かない

詳細設計: `docs/design/ARCHITECTURE.md`

## ドキュメントルール

| ファイル | 内容 | 更新タイミング |
|---------|------|--------------|
| `CLAUDE.md` | 開発規約（このファイル） | ルール変更時 |
| `docs/PRODUCT_VISION.md` | プロダクト方針・フェーズ計画 | 方針変更時 |
| `docs/ROADMAP.md` | 開発ロードマップ | タスク完了・追加時 |
| `docs/design/ARCHITECTURE.md` | 技術設計 | アーキテクチャ変更時 |
| `docs/HANDOFF.md` | セッション引き継ぎ | **20ターンごと** + 作業区切り時 |
| `README.md` | ユーザー向け使い方 | 機能追加時 |

### HANDOFF.md 更新ルール（必須）

- **20ターンごとに必ず更新する**
- 大きな変更をコミットした直後に更新する
- /compact 実行時は直前に更新する
- 新セッション開始時はまず HANDOFF.md を読む

### HANDOFF.md 記載内容

- 現在の作業状態（何をやっていたか）
- 完了済みタスク
- 未完了・次のアクション
- 変更したファイル一覧
- 未解決の問題・判断待ち事項

### ドキュメント作成方針

- 設計ドキュメントはコードの「なぜそうなっているか」を記録する
- 仕様変更時は ARCHITECTURE.md を先に更新してからコードを変更する

## コーディング規約

### スタイル

- クラスベース設計（DiagramExcel, DiagramV2, AWSConfigParser）
- Excel版の座標は EMU 単位（`Inches()` ヘルパーで変換）
- PPTX版の座標は `pptx.util.Inches()` で管理
- 色定数はクラス `C` にまとめる
- メソッド名: `_build`, `_draw_arrows`, `_ibox` 等のプレフィックス規則を維持

### テスト

- テスト用JSON: `tabelog_aws_config.json`（メイン）、`realistic_aws_config.json`、`sample_aws_config_snapshot.json`、`real_config_snapshot.json`
- 出力確認は生成されたExcel/PPTXを目視確認
- 将来: pytest による自動テスト

## git運用

- ブランチ: `main`（現状）。Phase 2以降は feature ブランチ運用を検討
- コミットメッセージ: 日本語OK、prefix使用（feat/fix/docs/chore）
- .gitignore: venv, xlsx, pptx, __pycache__, zip, icons_tmp を除外
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
