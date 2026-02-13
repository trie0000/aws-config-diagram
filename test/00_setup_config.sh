#!/bin/bash
# 00_setup_config.sh - AWS Config Recorder + S3配信チャネル設定
source "$(dirname "$0")/env.sh"

echo ""
echo "=========================================="
echo " Phase 0: AWS Config Setup"
echo "=========================================="

# --- 既存の Config Recorder 確認 ---
EXISTING_RECORDER=$(aws configservice describe-configuration-recorders \
    --query 'ConfigurationRecorders[0].name' --output text 2>/dev/null || echo "None")

if [ "$EXISTING_RECORDER" != "None" ] && [ "$EXISTING_RECORDER" != "" ]; then
    echo "WARNING: Config Recorder already exists: $EXISTING_RECORDER"
    echo "  既存のConfig Recorderを使用します。"
    echo "  allSupported=true になっているか確認してください。"

    # 配信チャネル確認
    EXISTING_BUCKET=$(aws configservice describe-delivery-channels \
        --query 'DeliveryChannels[0].s3BucketName' --output text 2>/dev/null || echo "None")
    if [ "$EXISTING_BUCKET" != "None" ] && [ "$EXISTING_BUCKET" != "" ]; then
        echo "  既存の配信バケット: $EXISTING_BUCKET"
        save_id CONFIG_BUCKET "$EXISTING_BUCKET"
        save_id CONFIG_EXISTING "true"
        echo "=== Phase 0 Complete (using existing Config) ==="
        exit 0
    fi
fi

save_id CONFIG_EXISTING "false"

# --- S3 バケット作成（Config配信用） ---
CONFIG_BUCKET="${PREFIX}-config-${ACCOUNT_ID}"
echo "Creating S3 bucket: $CONFIG_BUCKET"

aws s3 mb "s3://${CONFIG_BUCKET}" --region "$AWS_REGION" 2>/dev/null || \
    echo "  Bucket already exists or creation failed, continuing..."

save_id CONFIG_BUCKET "$CONFIG_BUCKET"

# バケットポリシー設定（Config が書き込めるように）
cat > /tmp/config-bucket-policy.json << POLICY
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AWSConfigBucketPermissionsCheck",
            "Effect": "Allow",
            "Principal": {"Service": "config.amazonaws.com"},
            "Action": "s3:GetBucketAcl",
            "Resource": "arn:aws:s3:::${CONFIG_BUCKET}"
        },
        {
            "Sid": "AWSConfigBucketDelivery",
            "Effect": "Allow",
            "Principal": {"Service": "config.amazonaws.com"},
            "Action": "s3:PutObject",
            "Resource": "arn:aws:s3:::${CONFIG_BUCKET}/*",
            "Condition": {
                "StringEquals": {
                    "s3:x-amz-acl": "bucket-owner-full-control"
                }
            }
        }
    ]
}
POLICY

aws s3api put-bucket-policy --bucket "$CONFIG_BUCKET" \
    --policy file:///tmp/config-bucket-policy.json
echo "  Bucket policy set"

# --- IAM ロール作成（Config用） ---
CONFIG_ROLE="${PREFIX}-config-role"
echo "Creating IAM role: $CONFIG_ROLE"

cat > /tmp/config-trust-policy.json << TRUST
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {"Service": "config.amazonaws.com"},
            "Action": "sts:AssumeRole"
        }
    ]
}
TRUST

aws iam create-role --role-name "$CONFIG_ROLE" \
    --assume-role-policy-document file:///tmp/config-trust-policy.json \
    --tags Key=Name,Value=${PREFIX}-config-role \
    2>/dev/null || echo "  Role already exists"

aws iam attach-role-policy --role-name "$CONFIG_ROLE" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWS_ConfigRole" \
    2>/dev/null || echo "  Policy already attached"

# S3書き込み権限を追加
cat > /tmp/config-s3-policy.json << S3POLICY
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": ["s3:PutObject", "s3:GetBucketAcl"],
            "Resource": [
                "arn:aws:s3:::${CONFIG_BUCKET}",
                "arn:aws:s3:::${CONFIG_BUCKET}/*"
            ]
        }
    ]
}
S3POLICY

aws iam put-role-policy --role-name "$CONFIG_ROLE" \
    --policy-name "${PREFIX}-config-s3" \
    --policy-document file:///tmp/config-s3-policy.json

save_id CONFIG_ROLE_ARN "arn:aws:iam::${ACCOUNT_ID}:role/${CONFIG_ROLE}"

# IAMロール伝播を待機
echo "  Waiting for IAM role propagation (10s)..."
sleep 10

# --- Config Recorder 設定 ---
echo "Creating Config Recorder..."
aws configservice put-configuration-recorder \
    --configuration-recorder "name=default,roleARN=arn:aws:iam::${ACCOUNT_ID}:role/${CONFIG_ROLE}" \
    --recording-group '{"allSupported":true,"includeGlobalResourceTypes":true}'

# --- 配信チャネル設定 ---
echo "Creating Delivery Channel..."
aws configservice put-delivery-channel \
    --delivery-channel "name=default,s3BucketName=${CONFIG_BUCKET}"

# --- Recorder 開始 ---
echo "Starting Config Recorder..."
aws configservice start-configuration-recorder --configuration-recorder-name default

echo ""
echo "=== Phase 0 Complete ==="
echo "  Config Recorder: started (allSupported=true)"
echo "  Delivery Bucket: $CONFIG_BUCKET"
echo "  注意: リソース作成後、Config が記録するまで数分かかります"
