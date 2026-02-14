# GW系アイコンの境界またぎ配置 + NAT Gateway エッジ追加

## 目標

AWS構成図で以下を実現する:
1. **IGW**: VPC境界にまたがって配置（現状維持、既に実装済み）
2. **NAT Gateway**: 所属するPublic Subnetの境界にまたがって配置
3. **Private Subnet → NAT Gateway のエッジ**を追加（どのSubnetがNATGWを使うか可視化）

## 現状の配置

```
┌─────── VPC ──────────────────────────────┐
│  [IGW]   [NAT-GW]  [ALB]   ← VPC上部横並び│
│                                           │
│  ┌── AZ-1a ─────────────────────────┐    │
│  │ ┌─Public─┐ ┌─Private─┐ ┌─Iso──┐ │    │
│  │ │ EC2    │ │ ECS     │ │ RDS  │ │    │
│  │ └────────┘ └─────────┘ └──────┘ │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

## 変更後の配置

```
       ┌─────── VPC ──────────────────────────────┐
       │                [ALB]   ← ALB等はVPC上部残す│
       │                                           │
[IGW]──│  ┌── AZ-1a ─────────────────────────┐    │
       │  │ ┌Public──┐ [NATGW] ┌Private──┐   │    │
       │  │ │ EC2    │←-------→│ ECS ----│---→[NAT]│
       │  │ └────────┘         └─────────┘   │    │
       │  └──────────────────────────────────┘    │
       └──────────────────────────────────────────┘

※ NAT GW は Public Subnet の右端境界にまたがる
※ Private Subnet 内のリソースから NAT GW への接続線あり
```

## 変更ファイルと内容

### 1. `diagram_state.py` — NAT Gateway の parent_id 変更 + エッジ追加

**NAT Gateway の parent_id を所属 Subnet ノードに変更:**
- 現状: `parent_id=vpc_node_id`（VPC直下）
- 変更後: `parent_id=subnet_node_id`（所属する Public Subnet の直下）
- NAT Gateway の `metadata.subnetId` から所属 Subnet を特定し、対応する Subnet ノードIDを検索

**NAT Gateway 利用エッジの追加（新規メソッド）:**
- `aws_config_parser.py` の `_build_subnet_tier_map` で使っているルートテーブル解析ロジックを活用
- RouteTable → routes に `natGatewayId` がある → associations の `subnetId` が利用Subnet
- 利用 Subnet → NAT Gateway のエッジを生成

### 2. `layout_engine.py` — NAT Gateway をSubnet境界に配置

**_layout_vpc_services から NAT Gateway を除外:**
- `vpc_children` から type="nat-gateway" を除外（VPC上部サービス行から移動）

**_layout_subnets でNAT Gateway を境界配置:**
- NAT Gateway ノードの parent_id が Subnet の場合、Subnet の右端境界にまたがる位置に配置
- position.x = subnet_x + subnet_w - icon_w/2 （Subnet右端にまたがる）
- position.y = Subnet の垂直中央

### 3. `aws_config_parser.py` — NAT利用Subnet情報の取得メソッド追加

**新メソッド `get_nat_usage_map(vpc_id)` 追加:**
```python
def get_nat_usage_map(self, vpc_id: str) -> dict[str, list[str]]:
    """NAT Gateway ID → [利用Subnet IDs] のマッピングを返す。
    ルートテーブル解析で、natGatewayId を参照するSubnetを特定。
    """
```
- ルートテーブルの routes で natGatewayId を検出
- そのルートテーブルの associations から subnetId を収集
- 戻り値: `{ "nat-xxx": ["subnet-aaa", "subnet-bbb"] }`

### 4. フロントエンド変更は不要

- IGW は既に VPC 境界またぎで描画されている
- NAT Gateway は position/size が変わるだけで、描画コンポーネント（IconNode.tsx）の変更は不要
- edgeRouter は CONTAINER_TYPES に含まれないノードを障害物として扱うので、NAT GW がSubnet境界にいても自動的に正しくルーティングされる
- エッジは DiagramState に追加されるだけなので EdgeLine.tsx の変更も不要

## 実装順序

1. `aws_config_parser.py`: `get_nat_usage_map()` メソッド追加
2. `diagram_state.py`: NAT Gateway の parent_id を Subnet ノードに変更 + NAT利用エッジ追加
3. `layout_engine.py`: NAT Gateway をVPC上部サービスから除外 → Subnet境界に配置
4. TypeScript ビルド確認（フロントエンド変更なしだがエッジデータ構造変化の確認）
5. バックエンド起動して動作確認
