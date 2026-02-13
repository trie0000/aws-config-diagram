#!/bin/bash
# 07_setup_messaging.sh - SQS, SNS, Kinesis, StepFunctions, EventBridge, AppSync
source "$(dirname "$0")/env.sh"

echo ""
echo "=========================================="
echo " Phase 7: Messaging & Integration"
echo "=========================================="

# --- SQS Queue ---
echo "Creating SQS Queue..."
SQS_URL=$(aws sqs create-queue \
    --queue-name "${PREFIX}-queue" \
    --tags Name=${PREFIX}-sqs \
    --query 'QueueUrl' --output text)
save_id SQS_URL "$SQS_URL"

# --- SNS Topic ---
echo "Creating SNS Topic..."
SNS_ARN=$(aws sns create-topic \
    --name "${PREFIX}-topic" \
    --tags Key=Name,Value=${PREFIX}-sns \
    --query 'TopicArn' --output text)
save_id SNS_ARN "$SNS_ARN"

# --- Kinesis Stream ---
echo "Creating Kinesis Data Stream..."
aws kinesis create-stream \
    --stream-name "${PREFIX}-stream" \
    --shard-count 1 \
    --tags Name=${PREFIX}-kinesis
save_id KINESIS_STREAM "${PREFIX}-stream"

# Wait for stream to become active
wait_msg "Kinesis stream becoming active"
aws kinesis wait stream-exists --stream-name "${PREFIX}-stream"

# --- Step Functions State Machine ---
echo "Creating Step Functions State Machine..."

# SFN execution role
cat > /tmp/sfn-trust.json << 'TRUST'
{
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "states.amazonaws.com"},
        "Action": "sts:AssumeRole"
    }]
}
TRUST

aws iam create-role --role-name "${PREFIX}-sfn-role" \
    --assume-role-policy-document file:///tmp/sfn-trust.json \
    2>/dev/null || echo "  SFN role already exists"

SFN_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${PREFIX}-sfn-role"
save_id SFN_ROLE_ARN "$SFN_ROLE_ARN"

sleep 5  # Wait for IAM propagation

SFN_ARN=$(aws stepfunctions create-state-machine \
    --name "${PREFIX}-sfn" \
    --role-arn "$SFN_ROLE_ARN" \
    --definition '{"Comment":"Diagtest","StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}' \
    --tags key=Name,value=${PREFIX}-sfn \
    --query 'stateMachineArn' --output text)
save_id SFN_ARN "$SFN_ARN"

# --- EventBridge Rule ---
echo "Creating EventBridge Rule..."
aws events put-rule \
    --name "${PREFIX}-rule" \
    --schedule-expression "rate(1 day)" \
    --state DISABLED \
    --tags Key=Name,Value=${PREFIX}-eventbridge > /dev/null
save_id EVENTBRIDGE_RULE "${PREFIX}-rule"

# --- AppSync GraphQL API ---
echo "Creating AppSync GraphQL API..."
APPSYNC_ID=$(aws appsync create-graphql-api \
    --name "${PREFIX}-graphql" \
    --authentication-type API_KEY \
    --tags Name=${PREFIX}-appsync \
    --query 'graphqlApi.apiId' --output text)
save_id APPSYNC_ID "$APPSYNC_ID"

echo ""
echo "=== Phase 7 Complete ==="
echo "  SQS: ${PREFIX}-queue"
echo "  SNS: $SNS_ARN"
echo "  Kinesis: ${PREFIX}-stream"
echo "  Step Functions: $SFN_ARN"
echo "  EventBridge: ${PREFIX}-rule (DISABLED)"
echo "  AppSync: $APPSYNC_ID"
