#!/bin/bash
# 03_setup_compute.sh - EC2, Lambda, ECS, EKS, ASG, Elastic Beanstalk
source "$(dirname "$0")/env.sh"

echo ""
echo "=========================================="
echo " Phase 3: Compute Resources"
echo "=========================================="

# --- IAM Roles ---
echo "Creating IAM Roles..."

# Lambda execution role
cat > /tmp/lambda-trust.json << 'TRUST'
{
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "lambda.amazonaws.com"},
        "Action": "sts:AssumeRole"
    }]
}
TRUST

aws iam create-role --role-name "${PREFIX}-lambda-role" \
    --assume-role-policy-document file:///tmp/lambda-trust.json \
    2>/dev/null || echo "  Lambda role already exists"

aws iam attach-role-policy --role-name "${PREFIX}-lambda-role" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" 2>/dev/null || true
aws iam attach-role-policy --role-name "${PREFIX}-lambda-role" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole" 2>/dev/null || true

LAMBDA_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${PREFIX}-lambda-role"
save_id LAMBDA_ROLE_ARN "$LAMBDA_ROLE_ARN"

# EKS cluster role
cat > /tmp/eks-trust.json << 'TRUST'
{
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "eks.amazonaws.com"},
        "Action": "sts:AssumeRole"
    }]
}
TRUST

aws iam create-role --role-name "${PREFIX}-eks-role" \
    --assume-role-policy-document file:///tmp/eks-trust.json \
    2>/dev/null || echo "  EKS role already exists"

aws iam attach-role-policy --role-name "${PREFIX}-eks-role" \
    --policy-arn "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy" 2>/dev/null || true

EKS_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${PREFIX}-eks-role"
save_id EKS_ROLE_ARN "$EKS_ROLE_ARN"

# ECS task execution role
cat > /tmp/ecs-trust.json << 'TRUST'
{
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "ecs-tasks.amazonaws.com"},
        "Action": "sts:AssumeRole"
    }]
}
TRUST

aws iam create-role --role-name "${PREFIX}-ecs-task-role" \
    --assume-role-policy-document file:///tmp/ecs-trust.json \
    2>/dev/null || echo "  ECS task role already exists"

aws iam attach-role-policy --role-name "${PREFIX}-ecs-task-role" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" 2>/dev/null || true

ECS_TASK_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${PREFIX}-ecs-task-role"
save_id ECS_TASK_ROLE_ARN "$ECS_TASK_ROLE_ARN"

# Elastic Beanstalk service role
cat > /tmp/eb-trust.json << 'TRUST'
{
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "elasticbeanstalk.amazonaws.com"},
        "Action": "sts:AssumeRole"
    }]
}
TRUST

aws iam create-role --role-name "${PREFIX}-eb-role" \
    --assume-role-policy-document file:///tmp/eb-trust.json \
    2>/dev/null || echo "  EB role already exists"

aws iam attach-role-policy --role-name "${PREFIX}-eb-role" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth" 2>/dev/null || true
aws iam attach-role-policy --role-name "${PREFIX}-eb-role" \
    --policy-arn "arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy" 2>/dev/null || true

# EB instance profile
cat > /tmp/ec2-trust.json << 'TRUST'
{
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "ec2.amazonaws.com"},
        "Action": "sts:AssumeRole"
    }]
}
TRUST

aws iam create-role --role-name "${PREFIX}-eb-ec2-role" \
    --assume-role-policy-document file:///tmp/ec2-trust.json \
    2>/dev/null || echo "  EB EC2 role already exists"

aws iam attach-role-policy --role-name "${PREFIX}-eb-ec2-role" \
    --policy-arn "arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier" 2>/dev/null || true

aws iam create-instance-profile --instance-profile-name "${PREFIX}-eb-ec2-profile" 2>/dev/null || true
aws iam add-role-to-instance-profile --instance-profile-name "${PREFIX}-eb-ec2-profile" \
    --role-name "${PREFIX}-eb-ec2-role" 2>/dev/null || true

echo "  Waiting for IAM role propagation (15s)..."
sleep 15

# --- EC2 Instances ---
echo "Creating EC2 Instances..."

# Get latest Amazon Linux 2023 AMI
AMI_ID=$(aws ssm get-parameters \
    --names "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64" \
    --query 'Parameters[0].Value' --output text)
save_id AMI_ID "$AMI_ID"
echo "  AMI: $AMI_ID"

# Web server in public subnet
EC2_WEB=$(aws ec2 run-instances --image-id "$AMI_ID" \
    --instance-type t3.micro \
    --subnet-id "$SUBNET_PUB_1A" \
    --security-group-ids "$SG_WEB" \
    --associate-public-ip-address \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${PREFIX}-web-1}]" \
    --query 'Instances[0].InstanceId' --output text)
save_id EC2_WEB "$EC2_WEB"

# App server in private subnet
EC2_APP=$(aws ec2 run-instances --image-id "$AMI_ID" \
    --instance-type t3.micro \
    --subnet-id "$SUBNET_PRIV_1A" \
    --security-group-ids "$SG_APP" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${PREFIX}-app-1}]" \
    --query 'Instances[0].InstanceId' --output text)
save_id EC2_APP "$EC2_APP"

# --- Lambda Functions ---
echo "Creating Lambda Functions..."

# Create minimal Lambda zip
LAMBDA_DIR="/tmp/${PREFIX}-lambda"
mkdir -p "$LAMBDA_DIR"
cat > "$LAMBDA_DIR/index.py" << 'HANDLER'
def handler(event, context):
    return {"statusCode": 200, "body": "Hello from diagtest"}
HANDLER

(cd "$LAMBDA_DIR" && zip -q /tmp/${PREFIX}-lambda.zip index.py)

# Serverless Lambda (no VPC)
aws lambda create-function --function-name "${PREFIX}-serverless" \
    --runtime python3.12 --handler index.handler \
    --role "$LAMBDA_ROLE_ARN" \
    --zip-file "fileb:///tmp/${PREFIX}-lambda.zip" \
    --tags Name=${PREFIX}-serverless \
    --timeout 30 --memory-size 128 > /dev/null
save_id LAMBDA_SERVERLESS "${PREFIX}-serverless"

# VPC-attached Lambda
aws lambda create-function --function-name "${PREFIX}-vpc-lambda" \
    --runtime python3.12 --handler index.handler \
    --role "$LAMBDA_ROLE_ARN" \
    --zip-file "fileb:///tmp/${PREFIX}-lambda.zip" \
    --vpc-config "SubnetIds=${SUBNET_PRIV_1A},${SUBNET_PRIV_1C},SecurityGroupIds=${SG_APP}" \
    --tags Name=${PREFIX}-vpc-lambda \
    --timeout 30 --memory-size 128 > /dev/null
save_id LAMBDA_VPC "${PREFIX}-vpc-lambda"

# --- ECS ---
echo "Creating ECS Cluster + Service..."

# Cluster
ECS_CLUSTER_ARN=$(aws ecs create-cluster --cluster-name "${PREFIX}-cluster" \
    --tags key=Name,value=${PREFIX}-ecs \
    --query 'cluster.clusterArn' --output text)
save_id ECS_CLUSTER_ARN "$ECS_CLUSTER_ARN"

# Task Definition
aws ecs register-task-definition \
    --family "${PREFIX}-task" \
    --network-mode awsvpc \
    --requires-compatibilities FARGATE \
    --cpu "256" --memory "512" \
    --execution-role-arn "$ECS_TASK_ROLE_ARN" \
    --container-definitions '[{
        "name": "app",
        "image": "nginx:alpine",
        "portMappings": [{"containerPort": 80, "protocol": "tcp"}],
        "essential": true
    }]' > /dev/null
save_id ECS_TASK_DEF "${PREFIX}-task"

# Service (desired=0 to avoid running tasks and incurring cost)
aws ecs create-service --cluster "${PREFIX}-cluster" \
    --service-name "${PREFIX}-service" \
    --task-definition "${PREFIX}-task" \
    --desired-count 0 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_PRIV_1A},${SUBNET_PRIV_1C}],securityGroups=[${SG_APP}]}" \
    --tags key=Name,value=${PREFIX}-ecs-service > /dev/null
save_id ECS_SERVICE "${PREFIX}-service"

# --- EKS (takes 10-15 min) ---
echo "Creating EKS Cluster (background, takes 10-15 min)..."
aws eks create-cluster --name "${PREFIX}-eks" \
    --role-arn "$EKS_ROLE_ARN" \
    --resources-vpc-config "subnetIds=${SUBNET_PRIV_1A},${SUBNET_PRIV_1C},securityGroupIds=${SG_APP}" \
    --tags Name=${PREFIX}-eks > /dev/null 2>&1 || echo "  EKS cluster creation initiated or already exists"
save_id EKS_CLUSTER "${PREFIX}-eks"
echo "  EKS cluster creation started (will complete in background)"

# --- Auto Scaling Group ---
echo "Creating Auto Scaling Group..."

# Launch Template
LT_ID=$(aws ec2 create-launch-template \
    --launch-template-name "${PREFIX}-lt" \
    --launch-template-data "{
        \"ImageId\": \"${AMI_ID}\",
        \"InstanceType\": \"t3.micro\",
        \"SecurityGroupIds\": [\"${SG_WEB}\"]
    }" \
    --tag-specifications "ResourceType=launch-template,Tags=[{Key=Name,Value=${PREFIX}-lt}]" \
    --query 'LaunchTemplate.LaunchTemplateId' --output text)
save_id LT_ID "$LT_ID"

aws autoscaling create-auto-scaling-group \
    --auto-scaling-group-name "${PREFIX}-asg" \
    --launch-template "LaunchTemplateId=${LT_ID},Version=\$Latest" \
    --min-size 0 --max-size 1 --desired-capacity 0 \
    --vpc-zone-identifier "${SUBNET_PUB_1A},${SUBNET_PUB_1C}" \
    --tags "Key=Name,Value=${PREFIX}-asg,PropagateAtLaunch=true"
save_id ASG_NAME "${PREFIX}-asg"

# --- Elastic Beanstalk ---
echo "Creating Elastic Beanstalk Environment..."

aws elasticbeanstalk create-application --application-name "${PREFIX}-eb-app" \
    --tags Key=Name,Value=${PREFIX}-eb 2>/dev/null || echo "  EB app already exists"
save_id EB_APP "${PREFIX}-eb-app"

# Get latest Docker solution stack
EB_STACK=$(aws elasticbeanstalk list-available-solution-stacks \
    --query 'SolutionStacks[?contains(@, `Docker`) && contains(@, `Amazon Linux 2023`)] | [0]' \
    --output text 2>/dev/null || echo "64bit Amazon Linux 2023 v4.3.0 running Docker")

aws elasticbeanstalk create-environment \
    --application-name "${PREFIX}-eb-app" \
    --environment-name "${PREFIX}-eb-env" \
    --solution-stack-name "$EB_STACK" \
    --option-settings \
        "Namespace=aws:autoscaling:launchconfiguration,OptionName=IamInstanceProfile,Value=${PREFIX}-eb-ec2-profile" \
        "Namespace=aws:ec2:vpc,OptionName=VPCId,Value=${VPC_ID}" \
        "Namespace=aws:ec2:vpc,OptionName=Subnets,Value=${SUBNET_PUB_1A}" \
        "Namespace=aws:autoscaling:asg,OptionName=MaxSize,Value=1" \
    > /dev/null 2>&1 || echo "  EB environment creation initiated"
save_id EB_ENV "${PREFIX}-eb-env"

echo ""
echo "=== Phase 3 Complete ==="
echo "  EC2: 2 instances (web + app)"
echo "  Lambda: 2 functions (serverless + VPC)"
echo "  ECS: cluster + task def + service (desired=0)"
echo "  EKS: cluster (creating in background...)"
echo "  ASG: ${PREFIX}-asg (desired=0)"
echo "  EB: ${PREFIX}-eb-env"
