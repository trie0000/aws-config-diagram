#!/bin/bash
# 09_collect_snapshot.sh - Config Snapshot の取得・ダウンロード・解凍
source "$(dirname "$0")/env.sh"

echo ""
echo "=========================================="
echo " Phase 9: Config Snapshot Collection"
echo "=========================================="

DOWNLOAD_DIR="$(cd "$(dirname "$0")" && pwd)/snapshots"
mkdir -p "$DOWNLOAD_DIR"

# --- Config Recorder の状態確認 ---
echo "Checking Config Recorder status..."
RECORDER_STATUS=$(aws configservice describe-configuration-recorder-status \
    --query 'ConfigurationRecordersStatus[0].recording' --output text)

if [ "$RECORDER_STATUS" != "True" ]; then
    echo "WARNING: Config Recorder is not recording. Starting it..."
    aws configservice start-configuration-recorder --configuration-recorder-name default
fi

# --- リソースの作成完了を待つ ---
echo ""
echo "=== Waiting for resources to be discovered by Config ==="
echo "  Config needs several minutes to discover newly created resources."
echo "  Waiting 5 minutes..."

for i in $(seq 1 5); do
    echo "  ${i}/5 minutes elapsed..."
    sleep 60
done

# --- EKS クラスターの完了を確認 ---
echo "Checking EKS cluster status..."
EKS_STATUS=$(aws eks describe-cluster --name "${PREFIX}-eks" \
    --query 'cluster.status' --output text 2>/dev/null || echo "NOT_FOUND")
echo "  EKS status: $EKS_STATUS"
if [ "$EKS_STATUS" = "CREATING" ]; then
    echo "  EKS still creating. Waiting up to 10 more minutes..."
    aws eks wait cluster-active --name "${PREFIX}-eks" 2>/dev/null || \
        echo "  WARNING: EKS wait timed out, continuing anyway"
fi

# --- Snapshot トリガー ---
echo ""
echo "=== Triggering Config Snapshot delivery ==="

# 配信バケット確認
BUCKET=$(aws configservice describe-delivery-channels \
    --query 'DeliveryChannels[0].s3BucketName' --output text)
echo "  Delivery bucket: $BUCKET"

SNAPSHOT_ID=$(aws configservice deliver-config-snapshot \
    --delivery-channel-name default \
    --query 'configSnapshotId' --output text)
echo "  Snapshot ID: $SNAPSHOT_ID"

echo "  Waiting 60 seconds for snapshot delivery to S3..."
sleep 60

# --- S3 からダウンロード ---
echo ""
echo "=== Downloading snapshot from S3 ==="

# 最新のスナップショットファイルを検索
LATEST_FILE=$(aws s3 ls "s3://${BUCKET}/AWSLogs/${ACCOUNT_ID}/Config/${AWS_REGION}/" \
    --recursive | grep ConfigSnapshot | sort | tail -1 | awk '{print $4}')

if [ -z "$LATEST_FILE" ]; then
    echo "  No snapshot found yet. Retrying in 2 minutes..."
    sleep 120

    # リトライ
    SNAPSHOT_ID=$(aws configservice deliver-config-snapshot \
        --delivery-channel-name default \
        --query 'configSnapshotId' --output text)
    echo "  Retry Snapshot ID: $SNAPSHOT_ID"
    sleep 60

    LATEST_FILE=$(aws s3 ls "s3://${BUCKET}/AWSLogs/${ACCOUNT_ID}/Config/${AWS_REGION}/" \
        --recursive | grep ConfigSnapshot | sort | tail -1 | awk '{print $4}')
fi

if [ -z "$LATEST_FILE" ]; then
    echo "ERROR: Could not find snapshot file in S3"
    echo "  Check: aws s3 ls s3://${BUCKET}/AWSLogs/${ACCOUNT_ID}/Config/${AWS_REGION}/ --recursive"
    exit 1
fi

echo "  Found: $LATEST_FILE"
aws s3 cp "s3://${BUCKET}/${LATEST_FILE}" "$DOWNLOAD_DIR/snapshot.json.gz"

# --- 解凍 ---
echo "Extracting snapshot..."
gunzip -f "$DOWNLOAD_DIR/snapshot.json.gz"

SNAPSHOT_FILE="$DOWNLOAD_DIR/snapshot.json"
save_id SNAPSHOT_FILE "$SNAPSHOT_FILE"

# --- リソースタイプ集計 ---
echo ""
echo "=== Snapshot Resource Summary ==="
python3 -c "
import json, sys
from collections import Counter

with open('$SNAPSHOT_FILE') as f:
    data = json.load(f)

items = data.get('configurationItems', [])
counts = Counter(item['resourceType'] for item in items)

# カテゴリ分け
categories = {
    'Network': ['AWS::EC2::VPC', 'AWS::EC2::Subnet', 'AWS::EC2::InternetGateway',
                'AWS::EC2::NatGateway', 'AWS::EC2::EIP', 'AWS::EC2::RouteTable',
                'AWS::EC2::NetworkAcl', 'AWS::EC2::SecurityGroup', 'AWS::EC2::NetworkInterface',
                'AWS::EC2::VPCEndpoint', 'AWS::EC2::VPCPeeringConnection',
                'AWS::EC2::TransitGateway', 'AWS::EC2::TransitGatewayAttachment',
                'AWS::EC2::VPNGateway', 'AWS::EC2::VPNConnection', 'AWS::EC2::CustomerGateway',
                'AWS::EC2::ClientVpnEndpoint', 'AWS::NetworkFirewall::Firewall',
                'AWS::Route53Resolver::ResolverEndpoint'],
    'Compute': ['AWS::EC2::Instance', 'AWS::Lambda::Function',
                'AWS::ECS::Cluster', 'AWS::ECS::Service', 'AWS::ECS::TaskDefinition',
                'AWS::EKS::Cluster', 'AWS::AutoScaling::AutoScalingGroup',
                'AWS::ElasticBeanstalk::Environment'],
    'LB/Edge': ['AWS::ElasticLoadBalancingV2::LoadBalancer',
                'AWS::ElasticLoadBalancing::LoadBalancer',
                'AWS::CloudFront::Distribution', 'AWS::ApiGateway::RestApi',
                'AWS::ApiGatewayV2::Api', 'AWS::Route53::HostedZone',
                'AWS::GlobalAccelerator::Accelerator'],
    'Database': ['AWS::RDS::DBInstance', 'AWS::RDS::DBCluster', 'AWS::RDS::DBSubnetGroup',
                 'AWS::DynamoDB::Table', 'AWS::ElastiCache::CacheCluster',
                 'AWS::Redshift::Cluster', 'AWS::S3::Bucket',
                 'AWS::EFS::FileSystem', 'AWS::ECR::Repository'],
    'Messaging': ['AWS::SQS::Queue', 'AWS::SNS::Topic', 'AWS::Kinesis::Stream',
                  'AWS::StepFunctions::StateMachine', 'AWS::Events::Rule',
                  'AWS::AppSync::GraphQLApi'],
    'Security': ['AWS::WAFv2::WebACL', 'AWS::KMS::Key', 'AWS::ACM::Certificate',
                 'AWS::CloudTrail::Trail', 'AWS::CloudWatch::Alarm'],
}

print(f'Total: {len(items)} resources, {len(counts)} types')
print()

for cat, types in categories.items():
    found = [(t, counts[t]) for t in types if t in counts]
    if found:
        print(f'  [{cat}]')
        for t, c in found:
            print(f'    {t}: {c}')

# 未分類のリソース
all_listed = set(t for types in categories.values() for t in types)
unlisted = {t: c for t, c in counts.items() if t not in all_listed}
if unlisted:
    print(f'  [Other]')
    for t, c in sorted(unlisted.items()):
        print(f'    {t}: {c}')

# 期待リソースで未検出のもの
expected_new = [
    'AWS::EC2::EIP', 'AWS::EFS::FileSystem', 'AWS::ACM::Certificate',
    'AWS::ECR::Repository', 'AWS::RDS::DBCluster', 'AWS::RDS::DBSubnetGroup',
    'AWS::EC2::NetworkAcl', 'AWS::ElasticLoadBalancing::LoadBalancer',
    'AWS::EC2::TransitGateway', 'AWS::EC2::TransitGatewayAttachment',
    'AWS::EC2::VPNGateway', 'AWS::EC2::VPNConnection', 'AWS::EC2::CustomerGateway',
    'AWS::EC2::ClientVpnEndpoint', 'AWS::NetworkFirewall::Firewall',
    'AWS::GlobalAccelerator::Accelerator', 'AWS::Route53Resolver::ResolverEndpoint',
    'AWS::Kinesis::Stream', 'AWS::StepFunctions::StateMachine',
    'AWS::Events::Rule', 'AWS::AppSync::GraphQLApi',
]
missing = [t for t in expected_new if t not in counts]
if missing:
    print()
    print('  [WARNING: Expected NEW types not found in snapshot]')
    for t in missing:
        print(f'    MISSING: {t}')
"

echo ""
echo "=== Phase 9 Complete ==="
echo "  Snapshot: $SNAPSHOT_FILE"
echo ""
echo "  次のステップ:"
echo "    cd /Users/a21/mytools/aws-config-diagram"
echo "    source venv/bin/activate"
echo "    python diagram_excel.py test/snapshots/snapshot.json --list"
echo ""
echo "  テスト完了後は必ずクリーンアップを実行:"
echo "    cd test && ./99_cleanup.sh"
