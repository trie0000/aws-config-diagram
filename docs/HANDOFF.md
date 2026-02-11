# HANDOFF.md - セッション引き継ぎ

> 最終更新: 2026-02-11 セッション4 (境界配置 + ハードコード矢印整理)

## 現在の状態

**v4.2 境界配置完了**。ネットワーク境界サービス（IGW, NAT, Peering）を境界線上に配置。ハードコード矢印を整理し、JSON根拠のない矢印を全て削除。

## 完了済み

- [x] v1: AWSConfigParser + 矩形ベース3スライド図生成（generate_diagram.py）
- [x] v2: AWS公式アイコンベース1スライド図生成（generate_diagram_v2.py）
  - 30+サービス対応のパーサー
  - AZ行×Subnet列レイアウト
  - SG-based + エッジサービスチェーン + サービス接続の3種矢印
  - エッジサービス（Route53, CloudFront, API GW）対応
  - VPC外部/サーバーレスサービス行
- [x] AutoScaling Group / ElasticBeanstalk / VPC Peering 対応
- [x] GitHubリポジトリ: https://github.com/trie0000/aws-config-diagram
- [x] 開発ドキュメント体制（CLAUDE.md, ARCHITECTURE.md, HANDOFF.md）
- [x] **v4.0 Gateway Columnレイアウト** — 根本的リデザイン
- [x] **v4.1 サービス配置最適化** — セッション4前半
  - WAFをGateway Columnに移動（ALBの近くに配置）
  - NAT GatewayをPublic Subnet上端境界にまたがる小アイコンとして配置
  - VPC PeeringをVPC右端境界にまたがるように配置
  - ElasticBeanstalkを付帯サービスとして小アイコン表示（`_place_aux_badges`）
- [x] **v4.2 境界配置 + ハードコード矢印整理** — セッション4後半
  - IGWをVPC左端境界にまたがる小アイコン(0.30in)として配置（Gateway Columnから移動）
  - ACM/VPC Endpointの常時表示を削除（JSONに存在しないリソースは描画しない原則）
  - ハードコード矢印の監査・削除:
    - ~~ALB→VPC Peering~~: JSON根拠なし（ルートテーブルベース）
    - ~~VPC Endpoint→S3~~: JSON根拠なし
    - ~~ACM→ALB~~: JSON根拠なし
    - ~~Lambda→DynamoDB/SQS/SNS~~: JSON根拠なし
  - WAF→ALBのみ残留（WAFのrelationshipsにALBとの関連が明記）
  - 矢印原則をARCHITECTURE.mdに明記
  - Gateway Column: WAF + ALB のみ（IGW→境界、ACM/VPCE→削除）
- [x] 4つのJSON（tabelog, realistic, sample, real）で動作確認済み

## v2 サービス配置マップ

| 配置場所 | サービス | 配置方法 |
|---------|---------|---------|
| Gateway Column | IGW, WAF, ALB, ACM, VPC Endpoint | 上から順に縦配置 |
| Public Subnet上端境界 | NAT Gateway | 小アイコン(0.30in)、境界またがり |
| Public Subnet内 | EC2 | 通常アイコン |
| Private Subnet内 | EC2, Lambda(VPC), ECS, EKS | 通常アイコン |
| Private Subnet右上 | ElasticBeanstalk | 小アイコン(0.28in)バッジ |
| Isolated Subnet内 | RDS, ElastiCache, Redshift | 通常アイコン |
| VPC右端境界 | VPC Peering | 境界またがり |
| VPC外左側 | Route53, CloudFront, API GW, Internet, User | エッジサービス |
| Cloud内下部 infra行 | KMS, CloudTrail, CloudWatch | 通常アイコン |
| Cloud内下部 serverless行 | Lambda, DynamoDB, SQS, SNS, S3 | 通常アイコン |

## 矢印フロー（v4.1改善後）

```
Internet/User → IGW → WAF → ALB → EC2（上→下の自然な流れ）
                                    ↑ ACM (TLS、短距離)
CloudFront → ALB（左→右の自然な流れ）
VPC Endpoint → S3（VPC内→外部サービス）
ALB → VPC Peering（VPC内→境界）
```

## 未完了・次のアクション

（ユーザーの指示待ち。以下は改善候補）

- [ ] 3AZ以上の対応
- [ ] 複数VPC描画対応
- [ ] v1パーサーとv2図生成のファイル分離リファクタ
- [ ] 自動テスト導入

## 変更したファイル（セッション4）

| ファイル | 変更内容 |
|---------|---------|
| `generate_diagram_v2.py` | ACM/WAF/VPC Endpoint→GW Column移動、NAT境界配置、Peering境界配置、aux badge小アイコン化 |
| `docs/design/ARCHITECTURE.md` | レイアウト設計をv4.1に更新 |
| `docs/HANDOFF.md` | 更新 |

## v4.0→v4.1 配置変更の経緯

### 問題（v4.0）
1. ACM/WAF/VPC Endpointが下部infra行（Y=8.25"）にあり、ALB（Y=2.5"）への矢印が6"以上の長距離U字型になっていた
2. NAT Gatewayが通常アイコンとしてSubnet内に配置されていたが、ルートテーブルベースのネットワークコンポーネントなので不適切
3. VPC PeeringがCloud box外に配置されていたが、VPCの境界に属するリソース
4. ElasticBeanstalkが通常サイズでデータパスサービスと同列だったが、管理サービスなので区別すべき

### 解決（v4.1）
1. **ACM/WAF→Gateway Column**: ALBの近くに配置、矢印距離を0.85in以内に短縮
2. **VPC Endpoint→Gateway Column**: VPC内リソースとして正しい位置に
3. **NAT Gateway→Subnet境界**: 上端にまたがる小アイコン（ルートテーブルベースを視覚的に表現）
4. **VPC Peering→VPC境界**: 右端にまたがるアイコン（2VPC間の接続点を表現）
5. **ElasticBeanstalk→小バッジ**: `_place_aux_badges()`で0.28inアイコンとして右上に配置

## 未解決の問題

なし
