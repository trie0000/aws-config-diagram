# 設計ドキュメント - aws-config-diagram

## 1. 全体構成

```
AWS Config Snapshot JSON
        │
        ▼
┌─────────────────────┐
│  AWSConfigParser     │  ← generate_diagram.py 内
│  (JSON → 構造化データ) │
└─────────┬───────────┘
          │  get_vpcs(), get_subnets_for_vpc(), ...
          ▼
┌─────────────────────┐
│  DiagramV2           │  ← generate_diagram_v2.py
│  (構造化データ → PPTX) │
└─────────┬───────────┘
          │
          ▼
    network_diagram_v2.pptx
```

### 責務分離
- **AWSConfigParser**: JSONパース + リソース抽出。図の描画には一切関与しない
- **DiagramV2**: レイアウト計算 + PPTX図形描画。JSONの構造には依存しない

## 2. 入力: AWS Config Snapshot JSON

AWS Config の `configurationItems` 配列を入力とする。各itemは以下の構造:

```json
{
  "resourceType": "AWS::EC2::Instance",
  "resourceId": "i-xxxxx",
  "configuration": { ... },
  "tags": { "Name": "..." },
  "awsRegion": "ap-northeast-1"
}
```

### 対応リソースタイプ（30種）

`AWSConfigParser.AUDIT_RESOURCE_TYPES` に定義。カテゴリ別:

| カテゴリ | リソースタイプ |
|---------|-------------|
| ネットワーク | VPC, Subnet, IGW, NatGateway, SecurityGroup, RouteTable, VPCPeering, ALB, CloudFront, API Gateway(v1/v2), Route53 |
| コンピュート | EC2, Lambda, ECS(Cluster/Service/TaskDef), EKS, AutoScaling |
| DB/ストレージ | RDS, DynamoDB, ElastiCache, Redshift, S3 |
| メッセージング | SQS, SNS |
| セキュリティ/監視 | WAFv2, KMS, CloudTrail, CloudWatch |
| その他 | ElasticBeanstalk |

## 3. AWSConfigParser のデータフロー

```
JSON → by_type (resourceType → [items])
     → by_id   (resourceId → item)
```

### 主要メソッド

| メソッド | 戻り値 | 用途 |
|---------|-------|------|
| `get_vpcs()` | VPC一覧 (id, name, cidr, region) | VPCボックス描画 |
| `get_subnets_for_vpc(vpc_id)` | Subnet一覧 (tier=Public/Private/Isolated) | AZ行×Subnet列 |
| `get_instances_for_subnet(sub_id)` | EC2一覧 (name, ip, sg_ids) | サブネット内EC2配置 |
| `get_sg_connections()` | SG間接続 (from_sg → to_sg, port) | 矢印描画 |
| `build_sg_to_resources_map()` | SG ID → リソース一覧マッピング | SG接続をリソース間矢印に変換 |
| `get_service_connections()` | 非SG接続 (CloudFront→ALB等) | エッジサービスの矢印 |

### Subnet Tier判定ロジック
1. `tags.Tier` があればそれを使用
2. `mapPublicIpOnLaunch=true` なら "Public"
3. それ以外は "Private"
4. "Isolated" は tags で明示指定

## 4. DiagramV2 レイアウト設計

### スライド構成（16:9, 16×9インチ）

```
┌──────────────────────────────────────────────┐
│ Title                                         │
│                                               │
│  Edge Svcs   ┌─ AWS Cloud ──────────────────┐ │
│  (Route53)   │  Region label                 │ │
│  (CloudFront)│  ┌─ VPC ────────────────────┐ │ │
│  (API GW)    │  │  AZ-A: [Pub] [Priv] [Iso]│ │ │
│              │  │  AZ-C: [Pub] [Priv] [Iso]│ │ │
│  Internet ─→ │  └──────────────────────────┘ │ │
│  End User    │  [ACM] [WAF] [VPC EP] [KMS]..│ │
│              │  [Lambda] [DynamoDB] [SQS]... │ │
│  Legend      └───────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### レイアウト定数（主要）

| 要素 | 位置/サイズ | 条件 |
|------|-----------|------|
| AWS Cloud | left_margin=2.5in (edge有), 1.5in (edge無) | エッジサービスの有無 |
| VPC | Cloud内 +0.2in マージン | |
| AZ行 | 2行固定（AZ-A上, AZ-C下）、gap=0.25in | |
| サブネット列 | Public(3.8in), Private(4.0in), Isolated(残り) | VPC幅に依存 |
| アイコン | 0.48×0.48in、下にラベル(7pt) | |
| VPC外部行 | VPC下部、Cloud内 | infra/serverlessの2行 |

### リソース配置ルール

**VPC内（AZ行×Subnet列に配置）**:
- Public: NAT Gateway(AZ-A上のみ) + EC2
- Private: EC2 + ECS + Lambda(VPC) + EKS（x_cursorで横並び）
- Isolated: RDS(Primary/Standby) + ElastiCache + Redshift

**VPC外左側（エッジサービス）**:
- Route53 → CloudFront → API Gateway（上から順に、0.85in間隔）
- Internet, End User（AZ行の中央高さに配置）
- IGW（Cloud左端内側）
- ALB（VPC内左寄り、AZ行間中央）

**VPC外下部（Cloud内）**:
- Row 1: ACM, WAF, VPC Endpoint, KMS, CloudTrail, CloudWatch
- Row 2: Lambda(serverless), DynamoDB, SQS, SNS, S3

## 5. 矢印（接続）の設計

### 接続の種類

| 種類 | ソース | 色 | 決定方法 |
|------|-------|---|---------|
| Internet traffic | Edge→IGW→ALB | 青 `#0073BB` | エッジサービスチェーン |
| AWS internal | ALB→EC2, EC2→RDS等 | オレンジ `#ED7D1C` | SecurityGroup ingress |
| Service connection | CloudTrail→S3等 | グレー `#888888` | `get_service_connections()` |

### 矢印描画のロジック（`_draw_arrows`）

1. **エッジサービスチェーン**: Route53→CloudFront→ALB/IGW, API GW→Lambda/ALB
2. **Internet/User→IGW→ALB**: 常に描画
3. **SG-based接続**:
   - `get_sg_connections()` でSG間参照を取得
   - `build_sg_to_resources_map()` でSG→リソースに変換
   - **Same-AZ優先**: `_group_by_az()` でAZごとにグループ化し、同一AZ内の接続を優先
   - Cross-AZ接続は同AZペアがない場合のみ描画
4. **固定接続**: VPC Endpoint→S3, ACM→ALB, WAF→ALB
5. **サーバーレス接続**: Lambda→DynamoDB/SQS/SNS

### AZグルーピング（`_group_by_az`）
リソース名からAZサフィックス（例: "1a", "1c"）を抽出。見つからない場合は `_global` グループ（ALB, RDS等のマルチAZリソース）。

## 6. 描画プリミティブ

| メソッド | 用途 |
|---------|------|
| `_box()` | 角丸矩形（サブネット・Cloud・VPC枠） |
| `_txt()` | テキストボックス |
| `_ilabel()` | アイコン+インラインテキスト（ボックスヘッダー用） |
| `_ibox()` | アイコン+ラベル（リソースノード）。`self.pos[key]` に中心座標を登録 |
| `_arr()` | 矢印コネクタ（XML直接操作でarrowhead追加） |
| `_legend()` | 凡例ボックス |

### 座標管理
`self.pos: dict[str, tuple[int,int]]` にリソースキー→中心座標(EMU)を保持。
矢印描画時にこのマップを参照してfrom/toの座標を解決する。

キー命名規則: `{prefix}_{id}` （例: `ec2_i-xxxxx`, `alb_arn-xxxxx`, `rds_db-xxxxx_0`）

## 7. 既知の制約・課題

- AZ数は2固定（3AZ以上は未対応）
- VPCは1つのみ描画（複数VPCはスキップ）
- Private Subnet内のリソースが多いと横に溢れる可能性（x_cursor制御のみ）
- v1のパーサーに依存しているため、パーサー変更時はv1側を編集する必要がある
- テストはPPTX目視確認のみ（自動テストなし）
