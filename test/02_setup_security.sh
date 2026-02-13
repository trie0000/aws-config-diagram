#!/bin/bash
# 02_setup_security.sh - Security Groups, KMS, ACM
source "$(dirname "$0")/env.sh"

echo ""
echo "=========================================="
echo " Phase 2: Security Resources"
echo "=========================================="

# --- Security Groups ---
echo "Creating Security Groups..."

# ALB SG (HTTP/HTTPS from internet)
SG_ALB=$(aws ec2 create-security-group --group-name "${PREFIX}-sg-alb" \
    --description "ALB - HTTP/HTTPS from internet" \
    --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${PREFIX}-sg-alb}]" \
    --query 'GroupId' --output text)
save_id SG_ALB "$SG_ALB"

aws ec2 authorize-security-group-ingress --group-id "$SG_ALB" \
    --protocol tcp --port 80 --cidr "0.0.0.0/0" > /dev/null
aws ec2 authorize-security-group-ingress --group-id "$SG_ALB" \
    --protocol tcp --port 443 --cidr "0.0.0.0/0" > /dev/null

# Web SG (HTTP from ALB)
SG_WEB=$(aws ec2 create-security-group --group-name "${PREFIX}-sg-web" \
    --description "Web tier - HTTP from ALB" \
    --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${PREFIX}-sg-web}]" \
    --query 'GroupId' --output text)
save_id SG_WEB "$SG_WEB"

aws ec2 authorize-security-group-ingress --group-id "$SG_WEB" \
    --protocol tcp --port 80 --source-group "$SG_ALB" > /dev/null

# App SG (port 8080 from Web)
SG_APP=$(aws ec2 create-security-group --group-name "${PREFIX}-sg-app" \
    --description "App tier - 8080 from Web" \
    --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${PREFIX}-sg-app}]" \
    --query 'GroupId' --output text)
save_id SG_APP "$SG_APP"

aws ec2 authorize-security-group-ingress --group-id "$SG_APP" \
    --protocol tcp --port 8080 --source-group "$SG_WEB" > /dev/null

# DB SG (MySQL from App)
SG_DB=$(aws ec2 create-security-group --group-name "${PREFIX}-sg-db" \
    --description "DB tier - MySQL from App" \
    --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${PREFIX}-sg-db}]" \
    --query 'GroupId' --output text)
save_id SG_DB "$SG_DB"

aws ec2 authorize-security-group-ingress --group-id "$SG_DB" \
    --protocol tcp --port 3306 --source-group "$SG_APP" > /dev/null
aws ec2 authorize-security-group-ingress --group-id "$SG_DB" \
    --protocol tcp --port 6379 --source-group "$SG_APP" > /dev/null

# --- KMS Key ---
echo "Creating KMS Key..."
KMS_KEY_ID=$(aws kms create-key \
    --description "${PREFIX} test encryption key" \
    --tags TagKey=Name,TagValue=${PREFIX}-kms \
    --query 'KeyMetadata.KeyId' --output text)
save_id KMS_KEY_ID "$KMS_KEY_ID"

aws kms create-alias --alias-name "alias/${PREFIX}-key" --target-key-id "$KMS_KEY_ID"

# --- ACM Certificate ---
echo "Creating ACM Certificate (DNS validation - will stay PENDING)..."
ACM_ARN=$(aws acm request-certificate \
    --domain-name "test.${PREFIX}.example.com" \
    --validation-method DNS \
    --tags Key=Name,Value=${PREFIX}-cert \
    --query 'CertificateArn' --output text)
save_id ACM_ARN "$ACM_ARN"

echo ""
echo "=== Phase 2 Complete ==="
echo "  Security Groups: 4 (ALB/Web/App/DB)"
echo "  KMS Key: $KMS_KEY_ID"
echo "  ACM Certificate: $ACM_ARN (PENDING_VALIDATION)"
