# CLAUDE.md - aws-config-diagram 開発規約

## プロジェクト概要

AWS Config Snapshot JSONからAWSネットワーク構成図（PPTX）を自動生成するCLIツール。
外部監査・社内レビュー用途を想定。

## アーキテクチャ

- `generate_diagram.py` — v1パーサー（`AWSConfigParser`）+ v1図生成（矩形ベース、3スライド）
- `generate_diagram_v2.py` — v2図生成（AWS公式アイコン、1スライド構成図）。v1のパーサーを共用
- **v2が現在のメイン開発対象**。v1はパーサーのみ利用

詳細設計: `docs/design/ARCHITECTURE.md`

## 実行環境

- Python 3.11+
- 依存: `python-pptx`, `lxml`
- venvは `venv/` に作成済み
- 実行: `python generate_diagram_v2.py <config.json>`

## ドキュメントルール

### 作成するドキュメント
| ファイル | 内容 | 更新タイミング |
|---------|------|--------------|
| `CLAUDE.md` | 開発規約・ルール（このファイル） | ルール変更時 |
| `docs/design/ARCHITECTURE.md` | 設計ドキュメント（構造・データフロー・レイアウト設計） | アーキテクチャ変更時 |
| `docs/HANDOFF.md` | セッション引き継ぎ（現在の状態・次のアクション） | **20ターンごと** + 作業区切り時 |

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
- READMEはユーザーから明示的に依頼があった場合のみ作成する
- 設計ドキュメントはコードの「なぜそうなっているか」を記録する
- 仕様変更時は ARCHITECTURE.md を先に更新してからコードを変更する

## コーディング規約

### ファイル構成
- v2のコードは `generate_diagram_v2.py` に集約（現状は1ファイル）
- パーサー（`AWSConfigParser`）は `generate_diagram.py` から import
- アイコンは `icons/` に PNG で配置

### スタイル
- クラスベース設計（DiagramV2, AWSConfigParser）
- 座標は `pptx.util.Inches()` で管理
- 色定数はクラス `C` にまとめる
- メソッド名: `_build`, `_draw_arrows`, `_ibox` 等のプレフィックス規則を維持

### テスト
- テスト用JSONは4種: `tabelog_aws_config.json`（メイン）、`realistic_aws_config.json`、`sample_aws_config_snapshot.json`、`real_config_snapshot.json`
- 出力確認は生成されたPPTXを目視確認

## git運用

- ブランチ: `main` のみ（現状）
- コミットメッセージ: 日本語OK、変更内容を簡潔に
- .gitignore: venv, pptx, __pycache__, zip, icons_tmp を除外

## 対応AWSサービス一覧（v2）

### VPC内リソース
EC2, ALB, RDS, NAT Gateway, IGW, ECS, EKS, Lambda(VPC-attached), ElastiCache, Redshift

### エッジサービス（VPC外左側）
Route53, CloudFront, API Gateway

### VPC外部サービス（Cloud内下部）
ACM, WAF, VPC Endpoint, KMS, CloudTrail, CloudWatch

### サーバーレスサービス（Cloud内最下部）
Lambda(serverless), DynamoDB, SQS, SNS, S3
