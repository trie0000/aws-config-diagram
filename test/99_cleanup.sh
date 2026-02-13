#!/bin/bash
# 99_cleanup.sh - 全リソース削除（依存の逆順）
# コスト制御のため、テスト完了後は必ず実行してください

source "$(dirname "$0")/env.sh"

echo ""
echo "=========================================="
echo " CLEANUP: Deleting all test resources"
echo "=========================================="
echo " This will delete ALL resources with prefix '${PREFIX}'"
echo ""

# エラーで停止しない（個別リソースの削除失敗を許容）
set +e

# --- Phase 8: Monitoring & LB ---
echo "--- Cleaning Phase 8: Monitoring & LB ---"

# WAF association 解除
if [ -n "${WAF_ARN:-}" ] && [ -n "${ALB_ARN:-}" ]; then
    echo "  Disassociating WAF..."
    aws wafv2 disassociate-web-acl --resource-arn "$ALB_ARN" 2>/dev/null
fi

# WAF WebACL 削除
if [ -n "${WAF_ARN:-}" ]; then
    echo "  Deleting WAF WebACL..."
    WAF_LOCK=$(aws wafv2 get-web-acl --name "${PREFIX}-waf" --scope REGIONAL --id \
        $(aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[?Name=='${PREFIX}-waf'].Id" --output text 2>/dev/null) \
        --query 'LockToken' --output text 2>/dev/null)
    if [ -n "$WAF_LOCK" ] && [ "$WAF_LOCK" != "None" ]; then
        WAF_WCL_ID=$(aws wafv2 list-web-acls --scope REGIONAL --query "WebACLs[?Name=='${PREFIX}-waf'].Id" --output text 2>/dev/null)
        aws wafv2 delete-web-acl --name "${PREFIX}-waf" --scope REGIONAL --id "$WAF_WCL_ID" --lock-token "$WAF_LOCK" 2>/dev/null
    fi
fi

# CloudWatch Alarm
echo "  Deleting CloudWatch Alarm..."
aws cloudwatch delete-alarms --alarm-names "${PREFIX}-cpu-alarm" 2>/dev/null

# CloudTrail
echo "  Deleting CloudTrail..."
aws cloudtrail delete-trail --name "${PREFIX}-trail" 2>/dev/null

# Classic LB
echo "  Deleting Classic LB..."
aws elb delete-load-balancer --load-balancer-name "${PREFIX}-classic-lb" 2>/dev/null

# ALB (listener → target group → LB)
echo "  Deleting ALB..."
if [ -n "${LISTENER_ARN:-}" ]; then
    aws elbv2 delete-listener --listener-arn "$LISTENER_ARN" 2>/dev/null
fi
if [ -n "${TG_ARN:-}" ]; then
    aws elbv2 delete-target-group --target-group-arn "$TG_ARN" 2>/dev/null
fi
if [ -n "${ALB_ARN:-}" ]; then
    aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN" 2>/dev/null
fi

# CloudTrail S3 bucket
if [ -n "${CT_BUCKET:-}" ]; then
    echo "  Emptying CloudTrail bucket..."
    aws s3 rm "s3://${CT_BUCKET}" --recursive 2>/dev/null
    aws s3 rb "s3://${CT_BUCKET}" 2>/dev/null
fi

# --- Phase 7: Messaging ---
echo "--- Cleaning Phase 7: Messaging ---"

echo "  Deleting AppSync..."
[ -n "${APPSYNC_ID:-}" ] && aws appsync delete-graphql-api --api-id "$APPSYNC_ID" 2>/dev/null

echo "  Deleting EventBridge Rule..."
aws events remove-targets --rule "${PREFIX}-rule" --ids "1" 2>/dev/null
aws events delete-rule --name "${PREFIX}-rule" 2>/dev/null

echo "  Deleting Step Functions..."
[ -n "${SFN_ARN:-}" ] && aws stepfunctions delete-state-machine --state-machine-arn "$SFN_ARN" 2>/dev/null

echo "  Deleting Kinesis Stream..."
aws kinesis delete-stream --stream-name "${PREFIX}-stream" --enforce-consumer-deletion 2>/dev/null

echo "  Deleting SNS Topic..."
[ -n "${SNS_ARN:-}" ] && aws sns delete-topic --topic-arn "$SNS_ARN" 2>/dev/null

echo "  Deleting SQS Queue..."
[ -n "${SQS_URL:-}" ] && aws sqs delete-queue --queue-url "$SQS_URL" 2>/dev/null

# --- Phase 6: Edge ---
echo "--- Cleaning Phase 6: Edge ---"

# Global Accelerator
if [ -n "${GA_ARN:-}" ]; then
    echo "  Disabling Global Accelerator..."
    aws globalaccelerator update-accelerator --accelerator-arn "$GA_ARN" --no-enabled --region us-west-2 2>/dev/null
    echo "  Waiting for GA to disable (30s)..."
    sleep 30
    aws globalaccelerator delete-accelerator --accelerator-arn "$GA_ARN" --region us-west-2 2>/dev/null
fi

# API Gateway
echo "  Deleting API Gateways..."
[ -n "${APIGW_REST_ID:-}" ] && aws apigateway delete-rest-api --rest-api-id "$APIGW_REST_ID" 2>/dev/null
[ -n "${APIGW_HTTP_ID:-}" ] && aws apigatewayv2 delete-api --api-id "$APIGW_HTTP_ID" 2>/dev/null

# CloudFront (disable first, then delete)
if [ -n "${CF_DIST_ID:-}" ]; then
    echo "  Disabling CloudFront Distribution..."
    CF_ETAG=$(aws cloudfront get-distribution-config --id "$CF_DIST_ID" --query 'ETag' --output text 2>/dev/null)
    CF_CONFIG=$(aws cloudfront get-distribution-config --id "$CF_DIST_ID" --query 'DistributionConfig' 2>/dev/null)
    if [ -n "$CF_CONFIG" ] && [ "$CF_CONFIG" != "null" ]; then
        echo "$CF_CONFIG" | python3 -c "
import sys, json
config = json.load(sys.stdin)
config['Enabled'] = False
json.dump(config, open('/tmp/cf-disable.json', 'w'))
"
        aws cloudfront update-distribution --id "$CF_DIST_ID" --if-match "$CF_ETAG" \
            --distribution-config file:///tmp/cf-disable.json 2>/dev/null
        echo "  Waiting for CloudFront to disable (this takes several minutes)..."
        aws cloudfront wait distribution-deployed --id "$CF_DIST_ID" 2>/dev/null || true
        NEW_ETAG=$(aws cloudfront get-distribution-config --id "$CF_DIST_ID" --query 'ETag' --output text 2>/dev/null)
        aws cloudfront delete-distribution --id "$CF_DIST_ID" --if-match "$NEW_ETAG" 2>/dev/null
    fi
fi

# Route53
if [ -n "${ZONE_ID:-}" ]; then
    echo "  Deleting Route53 records and hosted zone..."
    # Delete non-default records
    aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
        --query "ResourceRecordSets[?Type!='SOA' && Type!='NS']" --output json 2>/dev/null | \
    python3 -c "
import sys, json
records = json.load(sys.stdin)
if records:
    changes = [{'Action': 'DELETE', 'ResourceRecordSet': r} for r in records]
    print(json.dumps({'Changes': changes}))
" 2>/dev/null | while read batch; do
        if [ -n "$batch" ]; then
            aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
                --change-batch "$batch" 2>/dev/null
        fi
    done
    aws route53 delete-hosted-zone --id "$ZONE_ID" 2>/dev/null
fi

# --- Phase 5: Advanced Networking ---
echo "--- Cleaning Phase 5: Advanced Networking ---"

# Route53 Resolver
if [ -n "${RESOLVER_ID:-}" ]; then
    echo "  Deleting Route53 Resolver..."
    # Get resolver IP addresses
    RESOLVER_IPS=$(aws route53resolver list-resolver-endpoint-ip-addresses \
        --resolver-endpoint-id "$RESOLVER_ID" \
        --query 'IpAddresses[].IpAddressId' --output text 2>/dev/null)
    aws route53resolver delete-resolver-endpoint --resolver-endpoint-id "$RESOLVER_ID" 2>/dev/null
fi

# Network Firewall
if [ -n "${NF_NAME:-}" ]; then
    echo "  Deleting Network Firewall (takes several minutes)..."
    aws network-firewall delete-firewall --firewall-name "${NF_NAME}" 2>/dev/null
    echo "  Waiting for Network Firewall deletion (60s)..."
    sleep 60
    [ -n "${NF_POLICY_ARN:-}" ] && aws network-firewall delete-firewall-policy \
        --firewall-policy-arn "$NF_POLICY_ARN" 2>/dev/null
fi

# Client VPN
if [ -n "${CLIENT_VPN_ID:-}" ]; then
    echo "  Deleting Client VPN..."
    # Disassociate all target networks first
    ASSOC_IDS=$(aws ec2 describe-client-vpn-target-networks \
        --client-vpn-endpoint-id "$CLIENT_VPN_ID" \
        --query 'ClientVpnTargetNetworks[].AssociationId' --output text 2>/dev/null)
    for ASSOC in $ASSOC_IDS; do
        aws ec2 disassociate-client-vpn-target-network \
            --client-vpn-endpoint-id "$CLIENT_VPN_ID" --association-id "$ASSOC" 2>/dev/null
    done
    aws ec2 delete-client-vpn-endpoint --client-vpn-endpoint-id "$CLIENT_VPN_ID" 2>/dev/null
fi

# VPN Connection
if [ -n "${VPN_ID:-}" ]; then
    echo "  Deleting VPN Connection..."
    aws ec2 delete-vpn-connection --vpn-connection-id "$VPN_ID" 2>/dev/null
    echo "  Waiting for VPN deletion (60s)..."
    sleep 60
fi

# Customer Gateway
[ -n "${CGW_ID:-}" ] && aws ec2 delete-customer-gateway --customer-gateway-id "$CGW_ID" 2>/dev/null

# VPN Gateway
if [ -n "${VGW_ID:-}" ]; then
    echo "  Detaching and deleting VPN Gateway..."
    aws ec2 detach-vpn-gateway --vpn-gateway-id "$VGW_ID" --vpc-id "$VPC_ID" 2>/dev/null
    sleep 10
    aws ec2 delete-vpn-gateway --vpn-gateway-id "$VGW_ID" 2>/dev/null
fi

# Transit Gateway
if [ -n "${TGW_ATT_ID:-}" ]; then
    echo "  Deleting Transit Gateway Attachment..."
    aws ec2 delete-transit-gateway-vpc-attachment --transit-gateway-attachment-id "$TGW_ATT_ID" 2>/dev/null
    sleep 30
fi
if [ -n "${TGW_ID:-}" ]; then
    echo "  Deleting Transit Gateway..."
    aws ec2 delete-transit-gateway --transit-gateway-id "$TGW_ID" 2>/dev/null
fi

# VPC Endpoints
echo "  Deleting VPC Endpoints..."
[ -n "${VPCE_SQS:-}" ] && aws ec2 delete-vpc-endpoints --vpc-endpoint-ids "$VPCE_SQS" 2>/dev/null
[ -n "${VPCE_S3:-}" ] && aws ec2 delete-vpc-endpoints --vpc-endpoint-ids "$VPCE_S3" 2>/dev/null

# VPC Peering
[ -n "${PEERING_ID:-}" ] && aws ec2 delete-vpc-peering-connection \
    --vpc-peering-connection-id "$PEERING_ID" 2>/dev/null

# Imported ACM certs
[ -n "${SERVER_CERT_ARN:-}" ] && aws acm delete-certificate --certificate-arn "$SERVER_CERT_ARN" 2>/dev/null
[ -n "${CA_CERT_ARN:-}" ] && aws acm delete-certificate --certificate-arn "$CA_CERT_ARN" 2>/dev/null

# --- Phase 4: Database ---
echo "--- Cleaning Phase 4: Database ---"

# ECR
echo "  Deleting ECR..."
aws ecr delete-repository --repository-name "${PREFIX}-app" --force 2>/dev/null

# EFS
if [ -n "${EFS_MT:-}" ]; then
    echo "  Deleting EFS mount target..."
    aws efs delete-mount-target --mount-target-id "$EFS_MT" 2>/dev/null
    sleep 30
fi
if [ -n "${EFS_ID:-}" ]; then
    echo "  Deleting EFS..."
    aws efs delete-file-system --file-system-id "$EFS_ID" 2>/dev/null
fi

# Redshift
echo "  Deleting Redshift..."
aws redshift delete-cluster --cluster-identifier "${PREFIX}-redshift" \
    --skip-final-cluster-snapshot 2>/dev/null

# ElastiCache
echo "  Deleting ElastiCache..."
aws elasticache delete-cache-cluster --cache-cluster-id "${PREFIX}-redis" 2>/dev/null

# Aurora (instance first, then cluster)
echo "  Deleting Aurora..."
aws rds delete-db-instance --db-instance-identifier "${PREFIX}-aurora-instance" \
    --skip-final-snapshot 2>/dev/null
echo "  Waiting for Aurora instance deletion (this takes several minutes)..."
aws rds wait db-instance-deleted --db-instance-identifier "${PREFIX}-aurora-instance" 2>/dev/null || true
aws rds delete-db-cluster --db-cluster-identifier "${PREFIX}-aurora" \
    --skip-final-snapshot 2>/dev/null

# RDS MySQL
echo "  Deleting RDS MySQL..."
aws rds delete-db-instance --db-instance-identifier "${PREFIX}-mysql" \
    --skip-final-snapshot --delete-automated-backups 2>/dev/null

echo "  Waiting for DB instances to delete (this takes several minutes)..."
aws rds wait db-instance-deleted --db-instance-identifier "${PREFIX}-mysql" 2>/dev/null || true

# DynamoDB
echo "  Deleting DynamoDB..."
aws dynamodb delete-table --table-name "${PREFIX}-table" 2>/dev/null

# S3 data bucket
if [ -n "${S3_BUCKET:-}" ]; then
    echo "  Emptying and deleting S3 bucket..."
    aws s3 rm "s3://${S3_BUCKET}" --recursive 2>/dev/null
    aws s3 rb "s3://${S3_BUCKET}" 2>/dev/null
fi

# Wait for ElastiCache and Redshift
echo "  Waiting for ElastiCache deletion..."
aws elasticache wait cache-cluster-deleted --cache-cluster-id "${PREFIX}-redis" 2>/dev/null || true

echo "  Waiting for Redshift deletion..."
aws redshift wait cluster-deleted --cluster-identifier "${PREFIX}-redshift" 2>/dev/null || true

# DB Subnet Groups (must delete after DB instances)
echo "  Deleting DB Subnet Groups..."
aws rds delete-db-subnet-group --db-subnet-group-name "${PREFIX}-db-subnet-group" 2>/dev/null
aws elasticache delete-cache-subnet-group --cache-subnet-group-name "${PREFIX}-cache-subnet" 2>/dev/null
aws redshift delete-cluster-subnet-group --cluster-subnet-group-name "${PREFIX}-redshift-subnet" 2>/dev/null

# --- Phase 3: Compute ---
echo "--- Cleaning Phase 3: Compute ---"

# Elastic Beanstalk
echo "  Deleting Elastic Beanstalk..."
aws elasticbeanstalk terminate-environment --environment-name "${PREFIX}-eb-env" 2>/dev/null
sleep 10
aws elasticbeanstalk delete-application --application-name "${PREFIX}-eb-app" --terminate-env-by-force 2>/dev/null

# EKS
echo "  Deleting EKS Cluster (takes 10+ min)..."
aws eks delete-cluster --name "${PREFIX}-eks" 2>/dev/null

# ECS
echo "  Deleting ECS..."
aws ecs update-service --cluster "${PREFIX}-cluster" --service "${PREFIX}-service" --desired-count 0 2>/dev/null
aws ecs delete-service --cluster "${PREFIX}-cluster" --service "${PREFIX}-service" --force 2>/dev/null
aws ecs deregister-task-definition --task-definition "${PREFIX}-task:1" 2>/dev/null
aws ecs delete-cluster --cluster "${PREFIX}-cluster" 2>/dev/null

# Auto Scaling Group
echo "  Deleting ASG..."
aws autoscaling delete-auto-scaling-group --auto-scaling-group-name "${PREFIX}-asg" --force-delete 2>/dev/null
[ -n "${LT_ID:-}" ] && aws ec2 delete-launch-template --launch-template-id "$LT_ID" 2>/dev/null

# Lambda
echo "  Deleting Lambda Functions..."
aws lambda delete-function --function-name "${PREFIX}-serverless" 2>/dev/null
aws lambda delete-function --function-name "${PREFIX}-vpc-lambda" 2>/dev/null

# EC2
echo "  Terminating EC2 instances..."
INSTANCE_IDS=""
[ -n "${EC2_WEB:-}" ] && INSTANCE_IDS="$EC2_WEB"
[ -n "${EC2_APP:-}" ] && INSTANCE_IDS="$INSTANCE_IDS $EC2_APP"
if [ -n "$INSTANCE_IDS" ]; then
    aws ec2 terminate-instances --instance-ids $INSTANCE_IDS 2>/dev/null
    echo "  Waiting for EC2 termination..."
    aws ec2 wait instance-terminated --instance-ids $INSTANCE_IDS 2>/dev/null || true
fi

# --- Phase 2: Security ---
echo "--- Cleaning Phase 2: Security ---"

# ACM Certificate
[ -n "${ACM_ARN:-}" ] && aws acm delete-certificate --certificate-arn "$ACM_ARN" 2>/dev/null

# KMS (schedule deletion)
if [ -n "${KMS_KEY_ID:-}" ]; then
    echo "  Scheduling KMS key deletion (7 days)..."
    aws kms schedule-key-deletion --key-id "$KMS_KEY_ID" --pending-window-in-days 7 2>/dev/null
    aws kms delete-alias --alias-name "alias/${PREFIX}-key" 2>/dev/null
fi

# Security Groups
echo "  Deleting Security Groups..."
for SG_VAR in SG_DB SG_APP SG_WEB SG_ALB; do
    SG_ID="${!SG_VAR:-}"
    if [ -n "$SG_ID" ]; then
        aws ec2 delete-security-group --group-id "$SG_ID" 2>/dev/null || \
            echo "    WARNING: Could not delete $SG_VAR ($SG_ID) - may have dependencies"
    fi
done

# --- Phase 1: Network ---
echo "--- Cleaning Phase 1: Network ---"

# NAT Gateway
if [ -n "${NAT_ID:-}" ]; then
    echo "  Deleting NAT Gateway..."
    aws ec2 delete-nat-gateway --nat-gateway-id "$NAT_ID" 2>/dev/null
    echo "  Waiting for NAT Gateway deletion (60s)..."
    sleep 60
fi

# EIP
[ -n "${EIP_ALLOC:-}" ] && aws ec2 release-address --allocation-id "$EIP_ALLOC" 2>/dev/null

# NACL (replace associations back to default first)
if [ -n "${NACL_ID:-}" ]; then
    echo "  Deleting Network ACL..."
    # Get default NACL
    DEFAULT_NACL=$(aws ec2 describe-network-acls \
        --filters "Name=vpc-id,Values=${VPC_ID}" "Name=default,Values=true" \
        --query 'NetworkAcls[0].NetworkAclId' --output text 2>/dev/null)
    if [ -n "$DEFAULT_NACL" ] && [ "$DEFAULT_NACL" != "None" ]; then
        # Replace custom NACL associations with default
        CUSTOM_ASSOCS=$(aws ec2 describe-network-acls \
            --network-acl-ids "$NACL_ID" \
            --query 'NetworkAcls[0].Associations[].NetworkAclAssociationId' --output text 2>/dev/null)
        for ASSOC in $CUSTOM_ASSOCS; do
            aws ec2 replace-network-acl-association \
                --association-id "$ASSOC" --network-acl-id "$DEFAULT_NACL" 2>/dev/null || true
        done
    fi
    aws ec2 delete-network-acl --network-acl-id "$NACL_ID" 2>/dev/null
fi

# Internet Gateway
if [ -n "${IGW_ID:-}" ]; then
    echo "  Detaching and deleting Internet Gateway..."
    aws ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID" 2>/dev/null
    aws ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID" 2>/dev/null
fi

# Route Tables (disassociate non-main associations first)
echo "  Deleting Route Tables..."
for RT_VAR in RT_PUBLIC RT_PRIVATE RT_ISOLATED; do
    RT_ID="${!RT_VAR:-}"
    if [ -n "$RT_ID" ]; then
        ASSOC_IDS=$(aws ec2 describe-route-tables --route-table-ids "$RT_ID" \
            --query 'RouteTables[0].Associations[?!Main].RouteTableAssociationId' --output text 2>/dev/null)
        for ASSOC in $ASSOC_IDS; do
            aws ec2 disassociate-route-table --association-id "$ASSOC" 2>/dev/null
        done
        aws ec2 delete-route-table --route-table-id "$RT_ID" 2>/dev/null
    fi
done

# Subnets
echo "  Deleting Subnets..."
for SUB_VAR in SUBNET_PUB_1A SUBNET_PUB_1C SUBNET_PRIV_1A SUBNET_PRIV_1C SUBNET_ISO_1A SUBNET_ISO_1C; do
    SUB_ID="${!SUB_VAR:-}"
    [ -n "$SUB_ID" ] && aws ec2 delete-subnet --subnet-id "$SUB_ID" 2>/dev/null
done

# VPC
if [ -n "${VPC_ID:-}" ]; then
    echo "  Deleting VPC..."
    aws ec2 delete-vpc --vpc-id "$VPC_ID" 2>/dev/null
fi

# --- Phase 0: Config & IAM ---
echo "--- Cleaning Phase 0: Config & IAM ---"

# Config Recorder（既存の場合は削除しない）
if [ "${CONFIG_EXISTING:-false}" = "false" ]; then
    echo "  Stopping Config Recorder..."
    aws configservice stop-configuration-recorder --configuration-recorder-name default 2>/dev/null
    aws configservice delete-delivery-channel --delivery-channel-name default 2>/dev/null
    aws configservice delete-configuration-recorder --configuration-recorder-name default 2>/dev/null

    # Config S3 bucket
    if [ -n "${CONFIG_BUCKET:-}" ]; then
        echo "  Emptying Config bucket..."
        aws s3 rm "s3://${CONFIG_BUCKET}" --recursive 2>/dev/null
        aws s3 rb "s3://${CONFIG_BUCKET}" 2>/dev/null
    fi
fi

# IAM Roles
echo "  Deleting IAM Roles..."
for ROLE in "${PREFIX}-config-role" "${PREFIX}-lambda-role" "${PREFIX}-eks-role" \
    "${PREFIX}-ecs-task-role" "${PREFIX}-sfn-role" "${PREFIX}-eb-role" "${PREFIX}-eb-ec2-role"; do
    # Detach all managed policies
    POLICIES=$(aws iam list-attached-role-policies --role-name "$ROLE" \
        --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null)
    for POLICY_ARN in $POLICIES; do
        aws iam detach-role-policy --role-name "$ROLE" --policy-arn "$POLICY_ARN" 2>/dev/null
    done
    # Delete inline policies
    INLINE_POLICIES=$(aws iam list-role-policies --role-name "$ROLE" \
        --query 'PolicyNames[]' --output text 2>/dev/null)
    for POLICY_NAME in $INLINE_POLICIES; do
        aws iam delete-role-policy --role-name "$ROLE" --policy-name "$POLICY_NAME" 2>/dev/null
    done
    aws iam delete-role --role-name "$ROLE" 2>/dev/null
done

# Instance Profile
aws iam remove-role-from-instance-profile --instance-profile-name "${PREFIX}-eb-ec2-profile" \
    --role-name "${PREFIX}-eb-ec2-role" 2>/dev/null
aws iam delete-instance-profile --instance-profile-name "${PREFIX}-eb-ec2-profile" 2>/dev/null

# Budget
echo "  Deleting Budget..."
aws budgets delete-budget --account-id "$ACCOUNT_ID" --budget-name "${PREFIX}-cost-limit" 2>/dev/null

# --- Clean up resource_ids.sh ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "#!/bin/bash" > "${SCRIPT_DIR}/resource_ids.sh"
echo "# Cleaned up - $(date)" >> "${SCRIPT_DIR}/resource_ids.sh"

echo ""
echo "=========================================="
echo " CLEANUP Complete"
echo "=========================================="
echo ""
echo " Note: Some resources may take additional time to fully delete:"
echo "   - EKS Cluster: up to 10 minutes"
echo "   - KMS Key: 7 days (scheduled deletion)"
echo "   - CloudFront: may take several minutes"
echo ""
echo " To verify, check the AWS Console or run:"
echo "   aws resourcegroupstaggingapi get-resources --tag-filters Key=Name,Values='${PREFIX}*'"
