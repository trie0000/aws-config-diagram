#!/bin/bash
# 04_setup_database.sh - RDS, Aurora, DynamoDB, ElastiCache, Redshift, EFS, S3, ECR
source "$(dirname "$0")/env.sh"

echo ""
echo "=========================================="
echo " Phase 4: Database & Storage Resources"
echo "=========================================="

# --- RDS DB Subnet Group ---
echo "Creating RDS DB Subnet Group..."
aws rds create-db-subnet-group \
    --db-subnet-group-name "${PREFIX}-db-subnet-group" \
    --db-subnet-group-description "Test DB subnet group for isolated subnets" \
    --subnet-ids "$SUBNET_ISO_1A" "$SUBNET_ISO_1C" \
    --tags Key=Name,Value=${PREFIX}-db-subnet-group > /dev/null
save_id DB_SUBNET_GROUP "${PREFIX}-db-subnet-group"

# --- RDS MySQL Instance ---
echo "Creating RDS MySQL Instance (takes 5-10 min)..."
aws rds create-db-instance \
    --db-instance-identifier "${PREFIX}-mysql" \
    --db-instance-class db.t3.micro \
    --engine mysql --engine-version "8.0" \
    --master-username admin --master-user-password "TestPass123!" \
    --allocated-storage 20 \
    --db-subnet-group-name "${PREFIX}-db-subnet-group" \
    --vpc-security-group-ids "$SG_DB" \
    --no-publicly-accessible \
    --no-multi-az \
    --backup-retention-period 0 \
    --tags Key=Name,Value=${PREFIX}-mysql > /dev/null
save_id RDS_MYSQL "${PREFIX}-mysql"
echo "  RDS MySQL creation started (background)"

# --- RDS Aurora Cluster ---
echo "Creating Aurora MySQL Cluster..."
aws rds create-db-cluster \
    --db-cluster-identifier "${PREFIX}-aurora" \
    --engine aurora-mysql \
    --master-username admin --master-user-password "TestPass123!" \
    --db-subnet-group-name "${PREFIX}-db-subnet-group" \
    --vpc-security-group-ids "$SG_DB" \
    --backup-retention-period 1 \
    --tags Key=Name,Value=${PREFIX}-aurora > /dev/null
save_id AURORA_CLUSTER "${PREFIX}-aurora"

aws rds create-db-instance \
    --db-instance-identifier "${PREFIX}-aurora-instance" \
    --db-cluster-identifier "${PREFIX}-aurora" \
    --engine aurora-mysql \
    --db-instance-class db.t3.medium \
    --tags Key=Name,Value=${PREFIX}-aurora-instance > /dev/null
save_id AURORA_INSTANCE "${PREFIX}-aurora-instance"
echo "  Aurora cluster + instance creation started (background)"

# --- DynamoDB Table ---
echo "Creating DynamoDB Table..."
aws dynamodb create-table \
    --table-name "${PREFIX}-table" \
    --attribute-definitions AttributeName=id,AttributeType=S \
    --key-schema AttributeName=id,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --tags Key=Name,Value=${PREFIX}-dynamodb > /dev/null
save_id DYNAMODB_TABLE "${PREFIX}-table"

# --- ElastiCache (Redis) ---
echo "Creating ElastiCache Redis Cluster..."

# ElastiCache Subnet Group
aws elasticache create-cache-subnet-group \
    --cache-subnet-group-name "${PREFIX}-cache-subnet" \
    --cache-subnet-group-description "Test cache subnet group" \
    --subnet-ids "$SUBNET_ISO_1A" "$SUBNET_ISO_1C" > /dev/null
save_id CACHE_SUBNET_GROUP "${PREFIX}-cache-subnet"

aws elasticache create-cache-cluster \
    --cache-cluster-id "${PREFIX}-redis" \
    --cache-node-type cache.t3.micro \
    --engine redis \
    --num-cache-nodes 1 \
    --cache-subnet-group-name "${PREFIX}-cache-subnet" \
    --security-group-ids "$SG_DB" \
    --tags Key=Name,Value=${PREFIX}-redis > /dev/null
save_id ELASTICACHE_CLUSTER "${PREFIX}-redis"
echo "  ElastiCache Redis creation started (background)"

# --- Redshift Cluster ---
echo "Creating Redshift Cluster..."

# Redshift Subnet Group
aws redshift create-cluster-subnet-group \
    --cluster-subnet-group-name "${PREFIX}-redshift-subnet" \
    --description "Test Redshift subnet group" \
    --subnet-ids "$SUBNET_ISO_1A" "$SUBNET_ISO_1C" \
    --tags Key=Name,Value=${PREFIX}-redshift-subnet > /dev/null
save_id REDSHIFT_SUBNET_GROUP "${PREFIX}-redshift-subnet"

aws redshift create-cluster \
    --cluster-identifier "${PREFIX}-redshift" \
    --node-type dc2.large \
    --number-of-nodes 1 \
    --master-username admin --master-user-password "TestPass123!" \
    --cluster-subnet-group-name "${PREFIX}-redshift-subnet" \
    --vpc-security-group-ids "$SG_DB" \
    --no-publicly-accessible \
    --tags Key=Name,Value=${PREFIX}-redshift > /dev/null
save_id REDSHIFT_CLUSTER "${PREFIX}-redshift"
echo "  Redshift cluster creation started (background)"

# --- S3 Bucket ---
echo "Creating S3 Bucket..."
S3_BUCKET="${PREFIX}-data-${ACCOUNT_ID}"
aws s3 mb "s3://${S3_BUCKET}" --region "$AWS_REGION" 2>/dev/null || \
    echo "  Bucket already exists"
save_id S3_BUCKET "$S3_BUCKET"

aws s3api put-bucket-tagging --bucket "$S3_BUCKET" \
    --tagging "TagSet=[{Key=Name,Value=${PREFIX}-data}]"

# --- EFS File System ---
echo "Creating EFS File System..."
EFS_ID=$(aws efs create-file-system \
    --performance-mode generalPurpose \
    --throughput-mode bursting \
    --encrypted \
    --tags Key=Name,Value=${PREFIX}-efs \
    --query 'FileSystemId' --output text)
save_id EFS_ID "$EFS_ID"

# Wait for EFS to be available
sleep 5

# Mount target in private subnet
EFS_MT=$(aws efs create-mount-target \
    --file-system-id "$EFS_ID" \
    --subnet-id "$SUBNET_PRIV_1A" \
    --security-groups "$SG_APP" \
    --query 'MountTargetId' --output text)
save_id EFS_MT "$EFS_MT"

# --- ECR Repository ---
echo "Creating ECR Repository..."
ECR_URI=$(aws ecr create-repository \
    --repository-name "${PREFIX}-app" \
    --image-scanning-configuration scanOnPush=true \
    --tags Key=Name,Value=${PREFIX}-ecr \
    --query 'repository.repositoryUri' --output text)
save_id ECR_URI "$ECR_URI"
save_id ECR_REPO "${PREFIX}-app"

echo ""
echo "=== Phase 4 Complete ==="
echo "  RDS MySQL: ${PREFIX}-mysql (creating...)"
echo "  Aurora: ${PREFIX}-aurora + instance (creating...)"
echo "  DynamoDB: ${PREFIX}-table"
echo "  ElastiCache: ${PREFIX}-redis (creating...)"
echo "  Redshift: ${PREFIX}-redshift (creating...)"
echo "  S3: $S3_BUCKET"
echo "  EFS: $EFS_ID"
echo "  ECR: $ECR_URI"
echo "  DB Subnet Group: ${PREFIX}-db-subnet-group"
