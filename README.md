# AWS Config Diagram Generator

AWS Config のスナップショット JSON から、AWSネットワーク構成図を自動生成するツールです。

Excel (`.xlsx`) または PowerPoint (`.pptx`) 形式で出力します。

## 対応リソース

| カテゴリ | リソースタイプ |
|---------|--------------|
| ネットワーク | VPC, Subnet, Internet Gateway, NAT Gateway, Route Table, VPC Endpoint, VPC Peering |
| コンピューティング | EC2, ECS, EKS, Lambda, Auto Scaling, Elastic Beanstalk |
| ロードバランサー | ALB/NLB (Elastic Load Balancing) |
| データベース | RDS, ElastiCache, Redshift, DynamoDB |
| セキュリティ | Security Group, WAF, KMS, ACM |
| ストレージ・メッセージング | S3, SQS, SNS |
| エッジ | CloudFront, API Gateway, Route 53 |
| 監視 | CloudTrail, CloudWatch |

## セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/trie0000/aws-config-diagram.git
cd aws-config-diagram

# Python仮想環境を作成
python3 -m venv venv
source venv/bin/activate

# 依存パッケージをインストール
pip install -r requirements.txt
```

## AWS Config スナップショットの取得方法

### 前提条件

- AWS Config が有効化されていること
- Config の配信チャネル（S3バケット）が設定されていること

### 方法1: AWS マネジメントコンソール（ブラウザ）から取得

1. [AWS マネジメントコンソール](https://console.aws.amazon.com/) にログイン
2. **AWS Config** サービスに移動
3. 左メニューから **「高度なクエリ」** を選択
4. 以下のクエリを実行して、記録されているリソースを確認:
   ```sql
   SELECT resourceType, resourceId, resourceName, configuration
   WHERE resourceType IN (
     'AWS::EC2::VPC',
     'AWS::EC2::Subnet',
     'AWS::EC2::Instance',
     'AWS::EC2::SecurityGroup',
     'AWS::EC2::RouteTable',
     'AWS::EC2::InternetGateway',
     'AWS::EC2::NatGateway',
     'AWS::ElasticLoadBalancingV2::LoadBalancer',
     'AWS::RDS::DBInstance',
     'AWS::Lambda::Function',
     'AWS::S3::Bucket'
   )
   ```
5. 結果をJSONでエクスポート

### 方法2: S3 に配信されたスナップショットを直接ダウンロード

1. AWS Config の **配信チャネル** に設定されている S3 バケットを確認
   - AWS Config → **設定** → 配信チャネルの S3 バケット名
2. **S3** サービスに移動し、該当バケットを開く
3. 以下のパスにスナップショットファイルが格納されている:
   ```
   s3://<バケット名>/AWSLogs/<アカウントID>/Config/<リージョン>/YYYY/M/D/
   ```
   例: `s3://my-config-bucket/AWSLogs/123456789012/Config/ap-northeast-1/2026/2/12/`
4. `ConfigSnapshot` を含む `.json.gz` ファイルをダウンロード
5. 解凍して `.json` ファイルを取得:
   ```bash
   gunzip 123456789012_Config_ap-northeast-1_ConfigSnapshot_20260212T*.json.gz
   ```

### 方法3: AWS CLI でスナップショットを取得

```bash
# スナップショット配信をトリガー
aws configservice deliver-config-snapshot --delivery-channel-name default

# S3 バケットから最新スナップショットをダウンロード
aws s3 ls s3://<バケット名>/AWSLogs/<アカウントID>/Config/<リージョン>/ --recursive | sort | tail -1
aws s3 cp s3://<バケット名>/AWSLogs/.../ConfigSnapshot_xxx.json.gz .
gunzip ConfigSnapshot_xxx.json.gz
```

## 使い方

### Excel 出力（推奨）

シートサイズの制限がないため、大規模な構成でも図が収まります。

```bash
# VPC一覧を表示
python diagram_excel.py config_snapshot.json --list

# 自動選択（スコアが最も高いVPCを描画）
python diagram_excel.py config_snapshot.json

# 特定のVPCを指定
python diagram_excel.py config_snapshot.json --vpc vpc-0123456789abcdef0

# 複数VPCを指定
python diagram_excel.py config_snapshot.json --vpc vpc-aaa,vpc-bbb
```

出力: `network_diagram.xlsx`（入力ファイルと同じディレクトリ）

### PowerPoint 出力

```bash
python diagram_pptx.py config_snapshot.json --list
python diagram_pptx.py config_snapshot.json
python diagram_pptx.py config_snapshot.json --vpc vpc-0123456789abcdef0
```

出力: `network_diagram.pptx`

> **注意**: PPTX はスライドサイズに上限（56×56インチ）があるため、大規模構成では Excel 版を推奨します。

### デバッグ

パーサーが JSON からどのリソースを検出したか確認できます。

```bash
# パース結果のサマリーを表示
python debug_diagram.py config_snapshot.json

# サブネットの生データをダンプ（CIDR等のトラブルシュート用）
python debug_raw_subnet.py config_snapshot.json
```

## ファイル構成

```
aws-config-diagram/
├── aws_config_parser.py   # AWS Config JSON パーサー（共通）
├── diagram_excel.py       # Excel (.xlsx) 図生成
├── diagram_pptx.py        # PowerPoint (.pptx) 図生成
├── debug_diagram.py       # パース結果デバッグ
├── debug_raw_subnet.py    # サブネット生データダンプ
├── requirements.txt       # Python 依存パッケージ
└── icons/                 # AWS サービスアイコン (PNG)
```

## 図の構成

生成される図は以下のレイアウトです:

```
[End User] → [Route53/CloudFront/API GW] → [IGW] → [WAF] → [ALB]
                                                      │
                        ┌─────────────────────────────────────────┐
                        │ AWS Cloud                               │
                        │  ┌─────────────────────────────────┐    │
                        │  │ VPC (10.0.0.0/16)               │    │
                        │  │  ┌──────────┬──────────┐        │    │
                        │  │  │ Public   │ Private  │        │    │
                        │  │  │ Subnet   │ Subnet   │        │    │
                        │  │  │  EC2     │  EC2     │        │    │
                        │  │  │  NAT GW  │  Lambda  │        │    │
                        │  │  └──────────┴──────────┘        │    │
                        │  │  [Lambda] [DynamoDB] [S3] [SQS] │    │
                        │  └─────────────────────────────────┘    │
                        └─────────────────────────────────────────┘
```

- **横方向**: 左から Public → Private → Isolated の順
- **縦方向**: AZ ごとに行分割
- **ゲートウェイ列**: IGW, NAT, WAF, ALB をサブネット左に配置
- **サポートサービス**: KMS, CloudTrail, CloudWatch 等はゾーン右上にバッジ表示
- **データパスサービス**: Lambda, DynamoDB, S3, SQS, SNS はVPC下部に配置
- **矢印**: セキュリティグループの許可ルールに基づいて自動描画
