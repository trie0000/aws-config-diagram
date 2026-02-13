# 技術設計ドキュメント - aws-config-diagram

## 1. 全体構成

```
AWS Config Snapshot JSON
        │
        ▼
┌─────────────────────┐
│  AWSConfigParser     │  ← aws_config_parser.py
│  (JSON → 構造化データ) │
└─────────┬───────────┘
          │  get_vpcs(), get_subnets_for_vpc(), ...
          ├──────────────────────┐
          ▼                      ▼
┌──────────────────┐   ┌──────────────────┐
│  DiagramExcel     │   │  DiagramV2        │
│  (→ .xlsx)        │   │  (→ .pptx)        │
│  diagram_excel.py │   │  diagram_pptx.py  │
└──────────────────┘   └──────────────────┘
```

### 責務分離

- **AWSConfigParser**: JSONパース + リソース抽出。図の描画には一切関与しない
- **DiagramExcel**: DrawingML XML直接操作でExcel内に図形を描画
- **DiagramV2**: python-pptxでPPTXスライドに図形を描画

両描画エンジンはパーサーの同じメソッド群を呼び出すため、パーサー変更は1箇所で完了する。

## 2. 入力: AWS Config Snapshot JSON

AWS Config の `configurationItems` 配列を入力とする。各itemは以下の構造:

```json
{
  "resourceType": "AWS::EC2::Instance",
  "resourceId": "i-xxxxx",
  "resourceName": "my-instance",
  "configuration": { ... },
  "supplementaryConfiguration": { ... },
  "configurationItemStatus": "OK",
  "tags": [{"key": "Name", "value": "..."}],
  "awsRegion": "ap-northeast-1"
}
```

### 対応リソースタイプ（30+種）

`AWSConfigParser.AUDIT_RESOURCE_TYPES` に定義。

| カテゴリ | リソースタイプ |
|---------|-------------|
| ネットワーク | VPC, Subnet, IGW, NatGateway, SecurityGroup, RouteTable, VPCEndpoint, VPCPeering, NetworkInterface, ALB, CloudFront, API Gateway(v1/v2), Route53 |
| コンピュート | EC2, Lambda, ECS(Cluster/Service/TaskDef), EKS, AutoScaling |
| DB/ストレージ | RDS, DynamoDB, ElastiCache, Redshift, S3 |
| メッセージング | SQS, SNS |
| セキュリティ/監視 | WAFv2, KMS, CloudTrail, CloudWatch |
| その他 | ElasticBeanstalk |

### configurationItemStatus: ResourceNotRecorded への対応

一部リソース（特にSubnet）は `configurationItemStatus: ResourceNotRecorded` で `configuration` が空になることがある。この場合のフォールバック:

1. `supplementaryConfiguration` の `cidrBlock` / `cidrBlockAssociationSet`
2. `resourceName` にCIDR表記（例: `10.0.1.0/24`）が含まれる場合
3. NetworkInterface のIPから `/24` を推定

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
| `get_vpc_endpoints_for_vpc(vpc_id)` | VPCE一覧 (service, type, subnet_ids) | VPCEバッジ・矢印 |

### Subnet Tier判定ロジック

Route Table のルートを解析して分類:

1. `0.0.0.0/0 → igw-xxx` があれば **Public**
2. `0.0.0.0/0 → nat-xxx` があれば **Private**
3. いずれもなければ **Isolated**
4. `tags.Tier` が明示されている場合はそちらを優先

## 4. レイアウト設計

### Excel版（DiagramExcel）— メイン

サイズ制限なし。コンテンツ駆動でVPC/Cloud枠が自動拡縮。

```
┌──────────────────────────────────────────────────────────┐
│ Title                                                     │
│                                                           │
│ Edge Svcs  ┌─ AWS Cloud ────────────── [CT] [CW] ────┐  │
│ (Route53)  │  Region label                            │  │
│ (CloudFront│                                          │  │
│ (API GW)   │ ┌─ VPC ──────────────── [KMS] [VPCE] ┐  │  │
│            │ │ GW列  │ Public  │ Private │ Isolated │  │  │
│ Internet   │ │       │ ┌NAT┐  │         │          │  │  │
│ User       │ │ WAF   │ EC2    │ EC2  ┌EB┐│ RDS      │ AZ│ │
│            │ │ ALB   ├────────┼─────────┼──────────┤  │  │
│            │ │       │ EC2    │ EC2     │ RDS      │ AZ│ │
│ Legend     │ └───────┴────────┴─────────┴──────────┘  │  │
│ ASG Info   │ [Lambda] [DynamoDB] [SQS] [SNS] [S3]     │  │
│            └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**コンテンツ駆動レイアウトの計算フロー (`_calc_layout()`):**

1. `_calc_col_widths()` でアイコン数に応じたSubnet列幅を計算
2. VPC幅 = vpc_pad + gw_w + col_gap + subnet_area_w + vpc_pad
3. Cloud幅 = cloud_pad + vpc_w + db_col_w（orphan DB用）
4. AZ高さ = max(アイコン行数から算出, ゲートウェイ列の高さから算出)
5. VPC高さ / Cloud高さは全て上記から連鎖計算
6. 存在しないtier（例: Isolatedなし）は幅0 → 枠が縮小

### PPTX版（DiagramV2）

スライドサイズ上限 56×56インチ。基本的にExcel版と同じレイアウトロジック。

### レイアウト定数（主要 / Excel版）

| 要素 | サイズ | 備考 |
|------|-------|------|
| AZ header → Subnet間 | 0.30in | |
| Subnet header下余白 | 0.30in | |
| アイコン行の高さ | 0.95in | |
| Subnet下部余白 | 0.30in | |
| 通常アイコン | 0.42×0.42in | データパスサービス |
| 小アイコンバッジ | 0.28×0.28in | 管理サービス |
| Gateway Column幅 | 1.30in | 固定 |
| Subnet列最小幅 | 1.80in | |
| アイコン間隔 | 1.10in | |
| AZ間ギャップ | 0.15in | |

### リソース配置ルール

**Gateway Column（VPC内左端、AZ横断）:**
- WAF（ALBの上）→ ALB

**VPC境界:**
- IGW: VPC左端境界
- NAT Gateway: Public Subnet上端、AZ-A右寄せ

**VPC内（AZ行×Subnet列）:**
- Public: EC2
- Private: EC2 + ECS + Lambda(VPC) + EKS + ElasticBeanstalk（バッジ）
- Isolated: RDS(Primary/Standby) + ElastiCache + Redshift

**サポートサービス（ゾーン右上バッジ）:**
- AWS Cloud右上: CloudTrail, CloudWatch
- VPC右上: KMS, VPC Endpoint

**データパスサービス（VPC下部1行）:**
- Lambda, DynamoDB, SQS, SNS, S3

**Orphan DB（VPC右外、Cloud内）:**
- RDS/ElastiCache/Redshift でSubnetがVPCに属さないもの

## 5. 矢印（接続）の設計

### 接続の種類

| 種類 | 色 | 決定方法 |
|------|---|---------|
| Internet traffic | 青 `#0073BB` | エッジサービスチェーン |
| AWS internal | オレンジ `#ED7D1C` | SecurityGroup ingress |
| VPC Peering | ティール `#009688` | VPCPeering設定 |
| Service connection | グレー `#888888` | `get_service_connections()` |

### 矢印の原則

**すべての矢印はJSON内のrelationshipsまたはconfigurationに根拠があるものだけ描画する。**

### 矢印描画のロジック (`_draw_arrows`)

1. **エッジサービスチェーン**: Route53→CloudFront→ALB/IGW, API GW→Lambda/ALB
2. **Internet/User→IGW→(WAF→)ALB**
3. **SG-based接続**: SG間参照 → リソースに変換 → Same-AZ優先
4. **WAF→ALB**: relationshipsベース
5. **Service-level connections**: JSON内の関連から自動推定

### 矢印アンカーリング (`_side_anchor`)

`self.pos[key] = (cx, cy, hw, hh)` にバウンディングボックスを登録。
ターゲット方向に最も近い辺を自動選択。

## 6. Excel描画の仕組み（DrawingML）

openpyxlはShape/Connectorを直接サポートしないため、ZIP post-processingでDrawingML XMLを注入。

```
1. openpyxl で画像(アイコン)を配置 → 一時xlsx保存
2. ZIPとして開き、xl/drawings/drawing1.xml を取得
3. DrawingML XML で Shape/Connector を追加
4. Z-layer順にソート → 最終xlsxとして保存
```

### Z-layer制御

| Z-layer | 内容 |
|---------|------|
| 0 | Background boxes (Cloud, VPC, Subnet, AZ) |
| 1 | Text labels |
| 2 | Icon images (openpyxl経由) |
| 3 | Connector arrows |
| 4 | Arrow text labels (topmost) |

## 7. 既知の制約

- VPCは1つのみ描画（`--vpc` で指定可能）
- VPC Endpointのデータフロー矢印は未実装（バッジ表示のみ）
- テストは目視確認のみ（自動テストなし）
- Subnet CIDR が `ResourceNotRecorded` の場合、フォールバック推定の精度に限界あり
