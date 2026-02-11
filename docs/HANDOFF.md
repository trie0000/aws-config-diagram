# HANDOFF.md - セッション引き継ぎ

> 最終更新: 2026-02-11 セッション2 (ターン15)

## 現在の状態

**v2の全AWSサービス対応が完了**。パーサーが対応する全サービスがv2で描画可能になった。

## 完了済み

- [x] v1: AWSConfigParser + 矩形ベース3スライド図生成（generate_diagram.py）
- [x] v2: AWS公式アイコンベース1スライド図生成（generate_diagram_v2.py）
  - 30+サービス対応のパーサー
  - AZ行×Subnet列レイアウト
  - SG-based + エッジサービスチェーン + サービス接続の3種矢印
  - エッジサービス（Route53, CloudFront, API GW）対応
  - VPC外部/サーバーレスサービス行
- [x] **AutoScaling Group 対応** — Public/Private Subnet内にアイコン配置、EC2への矢印
- [x] **ElasticBeanstalk 対応** — AZ-AのPrivate Subnet内に配置
- [x] **VPC Peering 対応** — Cloud Box右端にPeer VPCラベル、ALBからのteal色矢印
- [x] GitHubリポジトリ: https://github.com/trie0000/aws-config-diagram
- [x] 開発ドキュメント体制（CLAUDE.md, ARCHITECTURE.md, HANDOFF.md）
- [x] tabelog_aws_config.json にASG/EB/Peeringテストデータ追加
- [x] 3つのJSON（tabelog, realistic, sample）で動作確認済み

## v2 サービス対応状況（全対応済み）

| カテゴリ | サービス | 描画 | 矢印 |
|---------|---------|------|------|
| VPC内 | EC2, ALB, RDS, NAT, IGW, ECS, EKS, Lambda(VPC), ElastiCache, Redshift, **ASG**, **EB** | OK | OK |
| エッジ | Route53, CloudFront, API Gateway | OK | OK |
| VPC外部 | ACM, WAF, VPC Endpoint, KMS, CloudTrail, CloudWatch | OK | OK |
| サーバーレス | Lambda, DynamoDB, SQS, SNS, S3 | OK | OK |
| 接続 | SG-based, エッジチェーン, サービス接続, **VPC Peering** | OK | OK |

## 未完了・次のアクション

（ユーザーの指示待ち。以下は改善候補）

- [ ] レイアウト改善（リソースが多い場合の横溢れ対策）
- [ ] 3AZ以上の対応
- [ ] 複数VPC描画対応
- [ ] v1パーサーとv2図生成のファイル分離リファクタ
- [ ] 自動テスト導入

## 変更したファイル（このセッション）

| ファイル | 変更内容 |
|---------|---------|
| `generate_diagram_v2.py` | ASG/EB/Peering描画追加、Legend拡張、色定数追加 |
| `tabelog_aws_config.json` | ASG×2, EB×1, VPC Peering×1 テストデータ追加 |
| `CLAUDE.md` | 新規作成 |
| `docs/design/ARCHITECTURE.md` | 新規作成 |
| `docs/HANDOFF.md` | 新規作成→更新 |

## 未解決の問題

なし
