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

## 4. DiagramV2 レイアウト設計（v4.2 境界配置）

### スライド構成（16:9, 16×9インチ）

```
┌──────────────────────────────────────────────────────────┐
│ Title                                                     │
│                                                           │
│ Edge Svcs  ┌─ AWS Cloud ───────────────────────────────┐ │
│ (Route53)  │  Region label                              │ │
│ (CloudFront│ ┌IGW┐                                      │ │
│ (API GW)   │  ┌─ VPC ──────────────────────────────┐    │ │
│            │  │ GW列  │ Public    │ Private│ Iso   │[Peer]│
│ Internet   │  │       │  ┌NAT┐   │        │       │    │ │
│ User       │  │ WAF   │EC2      │EC2  ┌EB┐│ RDS   │ AZ-A│
│            │  │ ALB   ├─────────┼────────┼───────┤    │ │
│            │  │       │EC2      │EC2     │ RDS   │ AZ-C│
│ Legend     │  └───────┴─────────┴────────┴───────┘    │ │
│ ASG Info   │  [KMS] [CloudTrail] [CloudWatch]          │ │
│            │  [Lambda] [DynamoDB] [SQS] [SNS] [S3]     │ │
│            └───────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### レイアウトの設計原則

1. **境界配置**: ネットワーク境界サービスは境界線上にまたがるように配置（小アイコン 0.30in）
   - IGW: VPC左端境界（外部→VPCの入口）
   - NAT Gateway: Public Subnet上端境界（ルートテーブルベース）
   - VPC Peering: VPC右端境界（2VPC間の接続点）
   - VPC Endpoint: VPC下端境界（VPC→AWSサービスの接続点、JSONに存在する場合のみ）
2. **Gateway Column**: WAF/ALBを配置する専用列。両AZ行を縦断
   - 左パネル(Internet)→IGW(境界)→Gateway Column→Subnet列の左→右フロー
   - ALB関連サービス（WAF）をALBの近くに配置
3. **サービス分類**: データパスサービスと管理サービスを視覚的に区別
   - データパスサービス（EC2, ECS等）: 通常アイコン(0.42in)でSubnet内に配置
   - 管理/オーケストレーションサービス（ElasticBeanstalk等）: 小アイコン(0.28in)バッジでSubnet右上に配置
4. **JSONに存在するリソースのみ表示**: パーサーが検出しないサービスのアイコンは描画しない
4. **ボトムアップ計算**: 下部サービス行の高さを先に確保し、残りをVPCに割当（はみ出し防止）
5. **動的列幅**: アイコン数に比例してSubnet列幅を自動計算
6. **動的アイコン配置**: Subnet幅内にアイコンを均等配置（圧縮可能）

### レイアウト計算フロー（`_calc_layout()`）

```
slide_h = 9.0in
cloud_bottom = 8.95in

bottom_rows = infra(0.65in) + serverless(0.65in, optional) + gap(0.10in)
vpc_h = cloud_h - region_header - bottom_rows - padding
az_h = (vpc_h - vpc_header - vpc_pad - az_gap) / 2

Gateway Column: w=1.30in (VPC左端, 固定幅)
Subnet Area: vpc_w - gw_w - margins
  → _calc_col_widths() で動的分配
```

### 列幅計算（`_calc_col_widths()`）

1. 各tier×AZのアイコン数をカウント（`_collect_subnet_icons()`使用）
2. `desired_w = max(icon_count * 1.10in, 1.80in_minimum)`
3. 利用可能幅に比例配分: `actual_w = desired_w * (available / total_desired)`

### アイコン配置（`_place_icons_row()`）

1. 理想間隔 1.10in/アイコン → Subnet幅に収まるか判定
2. 収まる → 中央寄せで理想間隔配置
3. 収まらない → `spacing = available / n` に圧縮

### 付帯サービスバッジ配置（`_place_aux_badges()`）

Subnet右上に小アイコン(0.28in)で管理サービスを配置。
アイコン + ラベル(0.80in幅) を縦に積む。

### レイアウト定数（主要）

| 要素 | 位置/サイズ | 条件 |
|------|-----------|------|
| AWS Cloud | left_w=2.3in (edge有), 1.3in (edge無) | エッジサービスの有無 |
| 右マージン | 0.9in (peering有), 0.3in (無) | VPC Peeringの有無 |
| VPC | Cloud内 +0.15in padding | |
| Gateway Column | VPC左端, w=1.30in, 両AZ行を縦断 | |
| AZ行 | 2行固定, gap=0.15in | |
| サブネット列 | 動的幅 (min=1.80in) | アイコン数に比例 |
| 通常アイコン | 0.42×0.42in + ラベル0.28in | データパスサービス |
| 小アイコンバッジ | 0.28×0.28in + ラベル0.20in | 管理サービス |
| 境界アイコン(IGW) | 0.30×0.30in, VPC左端境界またがり | VPC入口 |
| 境界アイコン(NAT) | 0.30×0.30in, Subnet上端境界またがり | ルートテーブルベース |
| 境界アイコン(Peering) | 通常アイコン, VPC右端境界またがり | 2VPC間接続点 |
| VPC外部行 | VPC下部, Cloud内 | infra/serverlessの2行 |

### リソース配置ルール

**VPC境界上（小アイコン 0.30in、境界線またがり）**:
- IGW: VPC左端境界、AZ-A上部。外部→VPCの入口
- NAT Gateway: Public Subnet上端、AZ-Aのみ、右寄せ
- VPC Peering: VPC右端境界中央、アイコン中心が境界線上

**Gateway Column（VPC内左端、AZ横断）**:
- WAF（JSONに存在する場合のみ、ALBの上 — トラフィックフィルタリング）
- ALB

**VPC内（AZ行×Subnet列に配置）**:
- Public: EC2
- Private: EC2 + ECS + Lambda(VPC) + EKS（データパス）、ElasticBeanstalk（小バッジ、AZ-Aのみ）
- Isolated: RDS(Primary/Standby) + ElastiCache + Redshift

**VPC外左側（エッジサービス）**:
- Route53 → CloudFront → API Gateway（上から順に、0.85in間隔）
- Internet, End User（AZ行の中央高さに配置）

**VPC外下部（Cloud内）**:
- Row 1 (infra): KMS, CloudTrail, CloudWatch
- Row 2 (serverless): Lambda, DynamoDB, SQS, SNS, S3

## 5. 矢印（接続）の設計

### 接続の種類

| 種類 | ソース | 色 | 決定方法 |
|------|-------|---|---------|
| Internet traffic | Edge→IGW→ALB | 青 `#0073BB` | エッジサービスチェーン |
| AWS internal | ALB→EC2, EC2→RDS等 | オレンジ `#ED7D1C` | SecurityGroup ingress |
| Service connection | CloudTrail→S3等 | グレー `#888888` | `get_service_connections()` |

### 矢印の原則

**すべての矢印はJSON内のrelationshipsまたはconfigurationに根拠があるものだけ描画する。**
JSONに接続情報がないサービス間にハードコード矢印を引いてはならない。

### 矢印描画のロジック（`_draw_arrows`）

1. **エッジサービスチェーン**: Route53→CloudFront→ALB/IGW, API GW→Lambda/ALB
2. **Internet/User→IGW→(WAF→)ALB**: WAF存在時はIGW→WAF→ALBルート、なければIGW→ALB直接
3. **SG-based接続**:
   - `get_sg_connections()` でSG間参照を取得
   - `build_sg_to_resources_map()` でSG→リソースに変換
   - **Same-AZ優先**: `_group_by_az()` でAZごとにグループ化し、同一AZ内の接続を優先
   - Cross-AZ接続は同AZペアがない場合のみ描画
4. **WAF→ALB**: WAFのrelationshipsにALBとの関連が明記されている場合のみ
5. **Service-level connections**: `get_service_connections()`でJSON内の関連から自動推定（CloudFront→ALB, CloudTrail→S3等）
6. **ASG**: 注釈テキストとして左パネルに表示（アイコンではない）

### 削除済みハードコード矢印（v4.1で整理）

以下の矢印はJSON内に根拠がないため削除した:
- ~~VPC Endpoint → S3~~: ルートテーブルベース。JSONにEndpoint→S3の関連なし
- ~~ACM → ALB~~: ACMのJSONにALBとの関連なし
- ~~Lambda → DynamoDB/SQS/SNS~~: 推測ベース。JSONに接続情報なし
- ~~ALB → VPC Peering~~: Peering はVPC間接続。ALBとの直接的な関係なし

### 矢印アンカーリング（`_side_anchor`）

矢印はアイコンの中心ではなく**バウンディングボックスの側面**から出る。
`self.pos[key] = (cx, cy, hw, hh)` に中心座標と半幅/半高を登録。
ターゲット方向に最も近い辺を自動選択。

### AZグルーピング（`_group_by_az`）
リソース名からAZサフィックス（例: "1a", "1c"）を抽出。見つからない場合は `_global` グループ（ALB, RDS等のマルチAZリソース）。

## 6. 描画プリミティブ

| メソッド | 用途 |
|---------|------|
| `_box()` | 角丸矩形（サブネット・Cloud・VPC・Gateway Column枠） |
| `_txt()` | テキストボックス |
| `_ilabel()` | アイコン+インラインテキスト（ボックスヘッダー用） |
| `_ibox()` | アイコン+ラベル（リソースノード）。`self.pos[key]` にバウンディングボックスを登録 |
| `_arr()` | 矢印コネクタ（XML直接操作でarrowhead追加、側面アンカー） |
| `_legend()` | 凡例ボックス |

### 座標管理
`self.pos: dict[str, tuple[int,int,int,int]]` にリソースキー→`(cx, cy, hw, hh)` EMU座標を保持。
矢印描画時に `_side_anchor()` でバウンディングボックス側面の座標を計算。

キー命名規則: `{prefix}_{id}` （例: `ec2_i-xxxxx`, `alb_arn-xxxxx`, `rds_db-xxxxx_0`）

### 新メソッド（v4.0/v4.1追加）

| メソッド | 用途 |
|---------|------|
| `_calc_layout()` | ボトムアップでレイアウト全体を計算。Ldict返却 |
| `_calc_col_widths()` | アイコン数に基づく動的Subnet列幅計算 |
| `_collect_subnet_icons()` | (tier, az, subnet) → (main_icons, aux_labels)。計算・描画兼用 |
| `_place_icons_row()` | Subnet幅内にアイコンを均等配置 |
| `_place_aux_badges()` | Subnet右上に小アイコンバッジ配置（管理サービス用） |

## 7. 既知の制約・課題

- AZ数は2固定（3AZ以上は未対応）
- VPCは1つのみ描画（複数VPCはスキップ）
- v1のパーサーに依存しているため、パーサー変更時はv1側を編集する必要がある
- テストはPPTX目視確認のみ（自動テストなし）
