#!/bin/bash
# 08_setup_monitoring.sh - ALB, Classic LB, WAF, CloudTrail, CloudWatch
source "$(dirname "$0")/env.sh"

echo ""
echo "=========================================="
echo " Phase 8: Load Balancing & Monitoring"
echo "=========================================="

# --- ALB (Application Load Balancer v2) ---
echo "Creating Application Load Balancer..."
ALB_ARN=$(aws elbv2 create-load-balancer \
    --name "${PREFIX}-alb" \
    --subnets "$SUBNET_PUB_1A" "$SUBNET_PUB_1C" \
    --security-groups "$SG_ALB" \
    --scheme internet-facing \
    --type application \
    --tags Key=Name,Value=${PREFIX}-alb \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)
save_id ALB_ARN "$ALB_ARN"

# Target Group
TG_ARN=$(aws elbv2 create-target-group \
    --name "${PREFIX}-tg" \
    --protocol HTTP --port 80 \
    --vpc-id "$VPC_ID" \
    --target-type instance \
    --tags Key=Name,Value=${PREFIX}-tg \
    --query 'TargetGroups[0].TargetGroupArn' --output text)
save_id TG_ARN "$TG_ARN"

# Register EC2 instances
aws elbv2 register-targets --target-group-arn "$TG_ARN" \
    --targets "Id=${EC2_WEB}" 2>/dev/null || true

# Listener
LISTENER_ARN=$(aws elbv2 create-listener \
    --load-balancer-arn "$ALB_ARN" \
    --protocol HTTP --port 80 \
    --default-actions "Type=forward,TargetGroupArn=${TG_ARN}" \
    --query 'Listeners[0].ListenerArn' --output text)
save_id LISTENER_ARN "$LISTENER_ARN"

# --- Classic Load Balancer ---
echo "Creating Classic Load Balancer..."
aws elb create-load-balancer \
    --load-balancer-name "${PREFIX}-classic-lb" \
    --listeners "Protocol=HTTP,LoadBalancerPort=80,InstanceProtocol=HTTP,InstancePort=80" \
    --subnets "$SUBNET_PUB_1A" "$SUBNET_PUB_1C" \
    --security-groups "$SG_ALB" \
    --tags "Key=Name,Value=${PREFIX}-classic-lb" > /dev/null
save_id CLASSIC_LB "${PREFIX}-classic-lb"

# --- WAFv2 WebACL ---
echo "Creating WAFv2 WebACL..."
WAF_ARN=$(aws wafv2 create-web-acl \
    --name "${PREFIX}-waf" \
    --scope REGIONAL \
    --default-action '{"Allow":{}}' \
    --visibility-config '{
        "SampledRequestsEnabled": true,
        "CloudWatchMetricsEnabled": true,
        "MetricName": "'${PREFIX}'waf"
    }' \
    --rules '[{
        "Name": "RateLimit",
        "Priority": 1,
        "Action": {"Block": {}},
        "Statement": {
            "RateBasedStatement": {
                "Limit": 2000,
                "AggregateKeyType": "IP"
            }
        },
        "VisibilityConfig": {
            "SampledRequestsEnabled": true,
            "CloudWatchMetricsEnabled": true,
            "MetricName": "RateLimit"
        }
    }]' \
    --tags Key=Name,Value=${PREFIX}-waf \
    --query 'Summary.ARN' --output text)
save_id WAF_ARN "$WAF_ARN"

# Associate WAF with ALB
aws wafv2 associate-web-acl \
    --web-acl-arn "$WAF_ARN" \
    --resource-arn "$ALB_ARN" 2>/dev/null || \
    echo "  WAF association pending (ALB may still be provisioning)"

# --- CloudTrail ---
echo "Creating CloudTrail..."

# CloudTrail S3 bucket
CT_BUCKET="${PREFIX}-trail-${ACCOUNT_ID}"
aws s3 mb "s3://${CT_BUCKET}" --region "$AWS_REGION" 2>/dev/null || true

# Bucket policy for CloudTrail
cat > /tmp/ct-bucket-policy.json << POLICY
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AWSCloudTrailAclCheck",
            "Effect": "Allow",
            "Principal": {"Service": "cloudtrail.amazonaws.com"},
            "Action": "s3:GetBucketAcl",
            "Resource": "arn:aws:s3:::${CT_BUCKET}"
        },
        {
            "Sid": "AWSCloudTrailWrite",
            "Effect": "Allow",
            "Principal": {"Service": "cloudtrail.amazonaws.com"},
            "Action": "s3:PutObject",
            "Resource": "arn:aws:s3:::${CT_BUCKET}/*",
            "Condition": {
                "StringEquals": {"s3:x-amz-acl": "bucket-owner-full-control"}
            }
        }
    ]
}
POLICY

aws s3api put-bucket-policy --bucket "$CT_BUCKET" \
    --policy file:///tmp/ct-bucket-policy.json

CT_ARN=$(aws cloudtrail create-trail \
    --name "${PREFIX}-trail" \
    --s3-bucket-name "$CT_BUCKET" \
    --is-multi-region-trail \
    --tags-list Key=Name,Value=${PREFIX}-trail \
    --query 'TrailARN' --output text 2>/dev/null || echo "EXISTS")

if [ "$CT_ARN" = "EXISTS" ]; then
    CT_ARN=$(aws cloudtrail describe-trails --trail-name-list "${PREFIX}-trail" \
        --query 'trailList[0].TrailARN' --output text)
fi
save_id CT_ARN "$CT_ARN"
save_id CT_BUCKET "$CT_BUCKET"

# --- CloudWatch Alarm ---
echo "Creating CloudWatch Alarm..."
aws cloudwatch put-metric-alarm \
    --alarm-name "${PREFIX}-cpu-alarm" \
    --metric-name CPUUtilization \
    --namespace AWS/EC2 \
    --statistic Average \
    --period 300 \
    --threshold 80 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 1 \
    --dimensions "Name=InstanceId,Value=${EC2_WEB}" \
    --tags Key=Name,Value=${PREFIX}-alarm
save_id CW_ALARM "${PREFIX}-cpu-alarm"

echo ""
echo "=== Phase 8 Complete ==="
echo "  ALB: ${PREFIX}-alb"
echo "  Classic LB: ${PREFIX}-classic-lb"
echo "  WAF: $WAF_ARN"
echo "  CloudTrail: ${PREFIX}-trail"
echo "  CloudWatch Alarm: ${PREFIX}-cpu-alarm"
