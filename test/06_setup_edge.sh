#!/bin/bash
# 06_setup_edge.sh - Route53, CloudFront, API Gateway, Global Accelerator
source "$(dirname "$0")/env.sh"

echo ""
echo "=========================================="
echo " Phase 6: Edge Services"
echo "=========================================="

# --- Route53 Private Hosted Zone ---
echo "Creating Route53 Private Hosted Zone..."
ZONE_ID=$(aws route53 create-hosted-zone \
    --name "${PREFIX}.internal" \
    --caller-reference "${PREFIX}-$(date +%s)" \
    --vpc "VPCRegion=${AWS_REGION},VPCId=${VPC_ID}" \
    --hosted-zone-config "PrivateZone=true" \
    --query 'HostedZone.Id' --output text)
# Route53 returns /hostedzone/ZXXXX, strip prefix
ZONE_ID=$(echo "$ZONE_ID" | sed 's|/hostedzone/||')
save_id ZONE_ID "$ZONE_ID"

# Add a test record
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --change-batch '{
        "Changes": [{
            "Action": "CREATE",
            "ResourceRecordSet": {
                "Name": "web.'${PREFIX}'.internal",
                "Type": "A",
                "TTL": 300,
                "ResourceRecords": [{"Value": "10.0.1.100"}]
            }
        }]
    }' > /dev/null

# --- CloudFront Distribution ---
echo "Creating CloudFront Distribution..."

# Use the S3 bucket as origin
CF_DIST_ID=$(aws cloudfront create-distribution \
    --distribution-config '{
        "CallerReference": "'${PREFIX}'-'$(date +%s)'",
        "Origins": {
            "Quantity": 1,
            "Items": [{
                "Id": "s3origin",
                "DomainName": "'${S3_BUCKET}'.s3.'${AWS_REGION}'.amazonaws.com",
                "S3OriginConfig": {"OriginAccessIdentity": ""}
            }]
        },
        "DefaultCacheBehavior": {
            "TargetOriginId": "s3origin",
            "ViewerProtocolPolicy": "allow-all",
            "AllowedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]},
            "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
            "Compress": false
        },
        "Comment": "'${PREFIX}' test distribution",
        "Enabled": true
    }' \
    --query 'Distribution.Id' --output text)
save_id CF_DIST_ID "$CF_DIST_ID"
echo "  CloudFront Distribution: $CF_DIST_ID"

# --- API Gateway (REST API v1) ---
echo "Creating API Gateway REST API..."
APIGW_REST_ID=$(aws apigateway create-rest-api \
    --name "${PREFIX}-rest-api" \
    --description "Test REST API" \
    --endpoint-configuration types=REGIONAL \
    --tags Name=${PREFIX}-apigw-rest \
    --query 'id' --output text)
save_id APIGW_REST_ID "$APIGW_REST_ID"

# Add a GET method
ROOT_RESOURCE=$(aws apigateway get-resources --rest-api-id "$APIGW_REST_ID" \
    --query 'items[0].id' --output text)
aws apigateway put-method --rest-api-id "$APIGW_REST_ID" \
    --resource-id "$ROOT_RESOURCE" --http-method GET \
    --authorization-type NONE > /dev/null
aws apigateway put-method-response --rest-api-id "$APIGW_REST_ID" \
    --resource-id "$ROOT_RESOURCE" --http-method GET \
    --status-code 200 > /dev/null
aws apigateway put-integration --rest-api-id "$APIGW_REST_ID" \
    --resource-id "$ROOT_RESOURCE" --http-method GET \
    --type MOCK --request-templates '{"application/json": "{\"statusCode\": 200}"}' > /dev/null

# --- API Gateway (HTTP API v2) ---
echo "Creating API Gateway HTTP API (v2)..."
APIGW_HTTP_ID=$(aws apigatewayv2 create-api \
    --name "${PREFIX}-http-api" \
    --protocol-type HTTP \
    --tags Name=${PREFIX}-apigw-http \
    --query 'ApiId' --output text)
save_id APIGW_HTTP_ID "$APIGW_HTTP_ID"

# --- Global Accelerator (us-west-2 API) ---
echo "Creating Global Accelerator (us-west-2 API)..."
GA_ARN=$(aws globalaccelerator create-accelerator \
    --name "${PREFIX}-ga" \
    --ip-address-type IPV4 \
    --enabled \
    --region us-west-2 \
    --tags Key=Name,Value=${PREFIX}-ga \
    --query 'Accelerator.AcceleratorArn' --output text 2>/dev/null || echo "FAILED")

if [ "$GA_ARN" != "FAILED" ]; then
    save_id GA_ARN "$GA_ARN"
    echo "  Global Accelerator: $GA_ARN"
else
    echo "  WARNING: Global Accelerator creation failed (may require additional permissions)"
fi

echo ""
echo "=== Phase 6 Complete ==="
echo "  Route53: $ZONE_ID (${PREFIX}.internal)"
echo "  CloudFront: $CF_DIST_ID"
echo "  API Gateway REST: $APIGW_REST_ID"
echo "  API Gateway HTTP: $APIGW_HTTP_ID"
echo "  Global Accelerator: ${GA_ARN:-skipped}"
