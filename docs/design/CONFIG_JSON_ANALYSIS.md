# Config JSON 実データ分析 & 実装ガイド

## 1. データ概要

テスト環境から取得したConfig Snapshotの実データ分析結果。

| 項目 | 値 |
|------|-----|
| リソース総数 | 259 |
| リソースタイプ数 | 80 |
| 明示的リレーション数 | 378 |
| リレーション保持リソース | 112/259 (43%) |
| ファイルサイズ | 376KB |
| スナップショット保存先 | `test/snapshots/snapshot.json` |

---

## 2. リレーションのキー構造（注意）

relationships配列の各要素には **3つの異なるキーパターン** が存在する:

| パターン | 件数 | 例 |
|---------|------|-----|
| `resourceId` + `resourceName` + `resourceType` + `name` | 8 | EC2 → Volume |
| `resourceId` + `resourceType` + `name` | 362 | Subnet → VPC |
| `resourceName` + `resourceType` + `name`（**resourceId なし**） | 8 | Lambda → IAM Role, EB → ASG |

### パーサー実装への影響

```python
# BAD: resourceId前提のコード
target_id = rel['resourceId']  # KeyError の可能性

# GOOD: 両方に対応
target_id = rel.get('resourceId') or rel.get('resourceName')
```

**resourceName のみのケース**: 主に IAM Role、ASG 等。resourceName でリソースを逆引きする必要がある。

---

## 3. リレーションの方向性（重要）

VPC → Subnet の関係は **逆方向** で記録されている。

| 記録場所 | リレーション名 | 方向 |
|---------|--------------|------|
| Subnet 側 | `"Is contained in Vpc"` | Subnet → VPC |
| VPC 側 | `"Contains Subnet"` は **一部VPCにしか存在しない** | VPC → Subnet (不安定) |

### パーサー設計への影響

VPC配下のSubnet一覧を取得するには、**VPCのrelationshipsではなく、全Subnetを走査して "Is contained in Vpc" を逆引き** する方が確実。

```python
# 全Subnetをスキャンしてvpc_idで逆引き
subnets_for_vpc = [
    item for item in items
    if item['resourceType'] == 'AWS::EC2::Subnet'
    and any(r.get('resourceId') == vpc_id and 'contained in Vpc' in r.get('name', '')
            for r in item.get('relationships', []))
]
```

### 全リレーション名一覧

| リレーション名 | 件数 | 用途 |
|---------------|------|------|
| Is contained in Vpc | 70 | Subnet, SG, RouteTable 等 → VPC |
| Contains NetworkInterface | 46 | VPC → ENI |
| Is associated with SecurityGroup | 34 | EC2, RDS, Lambda 等 → SG |
| Is contained in Subnet | 31 | ENI, Lambda 等 → Subnet |
| Is associated with NetworkInterface | 24 | EC2 → ENI |
| Is associated with (名前なし) | 22 | 汎用 |
| Is contained in (名前なし) | 20 | 汎用 |
| Contains Subnet | 17 | VPC → Subnet（不安定） |
| Is attached to Subnet | 13 | NAT GW, ENI → Subnet |
| Is attached to NetworkAcl | 11 | Subnet → NACL |
| Contains SecurityGroup | 11 | VPC → SG |
| Is contained in RouteTable | 8 | Route → RouteTable |
| Contains RouteTable | 6 | VPC → RouteTable |

---

## 4. SGルールの ipRanges 形式（注意）

Config JSON の SG ipPermissions 内の `ipRanges` は **通常の AWS API とは異なる形式**。

```json
// Config JSON の形式（文字列リスト）
"ipRanges": ["0.0.0.0/0"]

// 通常の AWS API (describe-security-groups) の形式
"ipRanges": [{"cidrIp": "0.0.0.0/0"}]
```

### パーサー実装

```python
# ipRanges は文字列リストとして扱う
for cidr in perm.get('ipRanges', []):
    # cidr は文字列（例: "0.0.0.0/0"）
    if cidr == '0.0.0.0/0':
        source = 'Internet'
```

---

## 5. リソースタイプ別のデータ取得方法

### 5.1 二つの取得パス

| パス | ソース | 信頼度 | カバレッジ |
|------|--------|--------|-----------|
| パス1 | `relationships` 配列 | 高（明示的） | 基本構造の80% |
| パス2 | `configuration` フィールド | 高（詳細） | 残り20% + 詳細情報 |

**原則**: まず relationships で構造を組み立て、configuration で補完・詳細化する。

### 5.2 リソースタイプ別の取得状況

#### ネットワーク基盤

| リソース | relationships | configuration | 備考 |
|---------|--------------|---------------|------|
| VPC | ✅ Contains SG/RT/ENI/Instance | cidrBlock, isDefault | Subnet は逆引きが必要 |
| Subnet | ✅ Is contained in Vpc | availabilityZone, cidrBlock, mapPublicIpOnLaunch | mapPublicIp は tier 分類に使える |
| Route Table | ✅ Is contained in Vpc, Contains Route | routeSet[].destinationCidrBlock, gatewayId, natGatewayId | IGW route → Public 判定 |
| IGW | ✅ Is attached to Vpc | — | |
| NAT GW | ✅ Is attached to Subnet | subnetId | |
| NACL | ✅ Is attached to Subnet | entries[].ruleNumber, protocol, cidrBlock | |

#### セキュリティ

| リソース | relationships | configuration | 備考 |
|---------|--------------|---------------|------|
| SG | ✅ Is contained in Vpc | ipPermissions, ipPermissionsEgress | **ipRanges は文字列リスト**（上記参照） |
| SG→SG参照 | — | userIdGroupPairs[].groupId | トラフィックフロー矢印の根拠 |

#### コンピュート

| リソース | relationships | configuration | 備考 |
|---------|--------------|---------------|------|
| EC2 | ✅ Is contained in Subnet/Vpc, SG, Volume | instanceType, privateIpAddress | |
| Lambda (VPC内) | ✅ Is contained in Subnet, Is associated with SG | vpcConfig.subnetIds, securityGroupIds | **relationships と configuration 両方にデータあり** |
| Lambda (VPC外) | ✅ Is associated with IAM Role | vpcConfig = {} | VPC外なので図に配置しない |
| ECS Service | **❌ relationships = 0** | **NetworkConfiguration = {} (空)** | **要注意: ネットワーク情報が取れない** |
| ECS Task Def | ❌ 0 | containerDefinitions, networkMode, executionRoleArn | ネットワーク配置情報なし |
| EKS | **❌ relationships = 0** | ResourcesVpcConfig.SubnetIds, SecurityGroupIds | **configuration からのみ取得可能** |
| ASG | ✅ 1 | launchConfigurationName | |
| EB | ✅ Is associated with IAM Role | — | |

#### データベース

| リソース | relationships | configuration | 備考 |
|---------|--------------|---------------|------|
| RDS Instance | ✅ SG, DBSubnetGroup | engine, engineVersion, instanceClass | |
| RDS DBCluster | ✅ Contains DBInstance, DBSubnetGroup, SG | engine, endpoint | **一部 relationships が resourceName のみ** |
| DynamoDB | ❌ 0 | tableName, attributeDefinitions | VPC外サービス |
| Redshift | ✅ SG, SubnetGroup, Vpc | nodeType, clusterStatus | |

#### ネットワーク接続

| リソース | relationships | configuration | 備考 |
|---------|--------------|---------------|------|
| VPC Endpoint | ✅ Is contained in Vpc, Is contained in Subnet | vpcId, serviceName, vpcEndpointType | Gateway 型は routeTableIds あり |
| VPC Peering | ✅ (要確認) | accepterVpcInfo, requesterVpcInfo | |
| TGW | ❌ 0 | — | |
| TGW Attachment | **❌ relationships = 0** | VpcId, TransitGatewayId, SubnetIds | **configuration からのみ** |
| VPN Connection | ✅ Is attached to VpnGateway, CustomerGateway | — | |
| VPN Gateway | ✅ Is attached to Vpc | — | |
| Client VPN | ❌ 0 | (要確認) | |

#### エッジ / モニタリング

| リソース | relationships | configuration | 備考 |
|---------|--------------|---------------|------|
| ALB | ✅ SG, Subnet, Vpc | — | |
| Listener | ❌ 0 | LoadBalancerArn, DefaultActions[].TargetGroupArn | **configuration からのみ** |
| TargetGroup | ❌ 0 | Targets[].Id (InstanceId), VpcId | **configuration からのみ** |
| WAF WebACL | ✅ Is associated with ALB | — | **レポートは「紐付け不明」としたが、実際は取得可能** |
| CloudTrail | ❌ 0 | s3BucketName | |
| CloudWatch Alarm | ❌ 0 | dimensions, namespace, metricName | |

#### Config 未サポート / 未取得

| リソース | 理由 |
|---------|------|
| ElastiCache | **Config のサポート対象外**（公式ドキュメントに未掲載） |
| CloudFront | Config サポート対象だが検出に長時間かかる（30分以上待っても未検出） |
| Route53 Hosted Zone | Resolver は取得可能。Hosted Zone は未取得（検出遅延の可能性） |
| Global Accelerator | スナップショットに含まれず |

---

## 6. Subnet Tier 分類のデータソース

Subnet を Public / Private / Isolated に分類するための情報:

### 方法1: Route Table 解析（推奨、高精度）

```
Route Table の routeSet を確認:
  - 0.0.0.0/0 → igw-xxx  → Public
  - 0.0.0.0/0 → nat-xxx  → Private
  - デフォルトルートなし   → Isolated
```

Route Table → Subnet 紐付けは `relationships` で取得可能（"Is contained in RouteTable"）。

### 方法2: mapPublicIpOnLaunch（フォールバック）

```
mapPublicIpOnLaunch = true  → Public
mapPublicIpOnLaunch = false → Private or Isolated（区別不可）
```

**注意**: テストデータでは diagtest-public-1a も `mapPublicIpOnLaunch = false` だった（スクリプトで auto-assign を有効化しなかったため）。実環境でも false の Public Subnet は普通にあるので、**Route Table 解析を主、mapPublicIpOnLaunch をフォールバック** とすべき。

---

## 7. 実装上の課題まとめ

### 課題1: ECS Service のネットワーク情報が空

**問題**: ECS Service の `NetworkConfiguration` が空オブジェクト `{}`、relationships も 0。
**影響**: ECS Service をどの Subnet/AZ に配置するか不明。
**対策案**:
- ECS Task Definition の `networkMode` から Fargate/awsvpc を判定
- ECS Service の `Cluster` からクラスタ名を取得し、同クラスタの他情報と紐付け
- ENI の description に "ECS" が含まれるものからSubnet を推論
- **割り切り**: ECS はVPC 外に配置して「ECS クラスタ」として表示

### 課題2: ALB→TG→Instance チェーンが relationships にない

**問題**: Listener、TargetGroup ともに relationships = 0。
**対策**: `configuration` フィールドから ARN マッチングで復元。

```python
# Listener → TargetGroup
for action in listener_config['DefaultActions']:
    tg_arn = action['TargetGroupArn']

# TargetGroup → Instance
for target in tg_config['Targets']:
    instance_id = target['Id']
```

### 課題3: TGW Attachment の relationships が空

**問題**: relationships = 0。
**対策**: `configuration` に `VpcId`, `TransitGatewayId`, `SubnetIds` があるのでそこから復元。

### 課題4: 2つの VPC の重複

**問題**: スナップショットに同名の `diagtest-vpc` が2つ存在（前回実行の残骸 + 今回作成分）。
**影響**: VPC 選択時に resourceId で区別する必要がある。
**対策**: `--vpc` オプションで resourceId を指定する設計は正しい。Name タグだけでの特定は危険。

### 課題5: CloudFront が Config に含まれない

**問題**: CloudFront Distribution は Config サポート対象だが、30分以上待っても検出されなかった。
**影響**: CloudFront を図に含める場合、Config JSON だけでは不十分な可能性。
**対策案**:
- CloudFront は VPC 外サービスなので、検出できれば外部リソースとして表示
- 検出できない場合は単純にスキップ（図の主要価値はVPC内構成）

### 課題6: ElastiCache は Config 非サポート

**問題**: AWS Config が ElastiCache::CacheCluster をサポートしていない。
**影響**: ElastiCache は Config JSON からは取得不可能。
**対策**: Config JSON のみで完結する設計方針に従い、ElastiCache は対応外とする。将来的に追加入力（describe-cache-clusters の JSON）をオプション入力にする拡張は可能。

---

## 8. テストデータのリソースタイプ全一覧（80種類）

```
AWS::ACM::Certificate: 3
AWS::ApiGateway::Method: 1
AWS::ApiGateway::RestApi: 1
AWS::ApiGatewayV2::Api: 1
AWS::AppConfig::DeploymentStrategy: 4
AWS::AppSync::GraphQLApi: 1
AWS::Athena::WorkGroup: 1
AWS::AutoScaling::AutoScalingGroup: 2
AWS::AutoScaling::ScalingPolicy: 2
AWS::Cassandra::Keyspace: 4
AWS::CloudTrail::Trail: 1
AWS::CloudWatch::Alarm: 3
AWS::CodeDeploy::DeploymentConfig: 17
AWS::Config::ConfigurationRecorder: 1
AWS::DynamoDB::Table: 1
AWS::EC2::ClientVpnEndpoint: 1
AWS::EC2::CustomerGateway: 2
AWS::EC2::DHCPOptions: 1
AWS::EC2::EIP: 5
AWS::EC2::EIPAssociation: 5
AWS::EC2::Instance: 3
AWS::EC2::InternetGateway: 2
AWS::EC2::LaunchTemplate: 2
AWS::EC2::NatGateway: 2
AWS::EC2::NetworkAcl: 4
AWS::EC2::NetworkInterface: 28
AWS::EC2::RouteTable: 6
AWS::EC2::SecurityGroup: 13
AWS::EC2::SnapshotBlockPublicAccess: 1
AWS::EC2::Subnet: 15
AWS::EC2::SubnetNetworkAclAssociation: 11
AWS::EC2::SubnetRouteTableAssociation: 6
AWS::EC2::TransitGateway: 2
AWS::EC2::TransitGatewayAttachment: 1
AWS::EC2::TransitGatewayRouteTable: 1
AWS::EC2::VPC: 3
AWS::EC2::VPCBlockPublicAccessOptions: 1
AWS::EC2::VPCEndpoint: 4
AWS::EC2::VPCGatewayAttachment: 3
AWS::EC2::VPCPeeringConnection: 2
AWS::EC2::VPNConnection: 2
AWS::EC2::VPNGateway: 2
AWS::EC2::Volume: 3
AWS::ECR::Repository: 1
AWS::ECS::CapacityProvider: 2
AWS::ECS::Cluster: 1
AWS::ECS::Service: 1
AWS::ECS::TaskDefinition: 1
AWS::EFS::FileSystem: 1
AWS::EKS::Cluster: 1
AWS::ElasticBeanstalk::Application: 1
AWS::ElasticLoadBalancing::LoadBalancer: 2
AWS::ElasticLoadBalancingV2::Listener: 1
AWS::ElasticLoadBalancingV2::LoadBalancer: 1
AWS::ElasticLoadBalancingV2::TargetGroup: 1
AWS::Events::EventBus: 1
AWS::Events::Rule: 1
AWS::IAM::Role: 22
AWS::IAM::User: 1
AWS::IoT::DomainConfiguration: 3
AWS::KMS::Alias: 3
AWS::KMS::Key: 4
AWS::Kinesis::Stream: 1
AWS::Lambda::Function: 2
AWS::RDS::DBCluster: 1
AWS::RDS::DBInstance: 2
AWS::RDS::DBSubnetGroup: 1
AWS::RDS::OptionGroup: 2
AWS::Redshift::Cluster: 1
AWS::Redshift::ClusterParameterGroup: 1
AWS::Redshift::ClusterSubnetGroup: 1
AWS::Route53Resolver::ResolverEndpoint: 2
AWS::Route53Resolver::ResolverRule: 1
AWS::Route53Resolver::ResolverRuleAssociation: 3
AWS::S3::Bucket: 4
AWS::SNS::Topic: 1
AWS::SQS::Queue: 1
AWS::StepFunctions::StateMachine: 1
AWS::WAFv2::WebACL: 1
```
