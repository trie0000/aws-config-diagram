#!/bin/bash
# 05_setup_networking_adv.sh - VPC Peering, VPCE, Transit GW, VPN, Client VPN, NW Firewall, Resolver
source "$(dirname "$0")/env.sh"

echo ""
echo "=========================================="
echo " Phase 5: Advanced Networking"
echo "=========================================="
echo " WARNING: These resources have hourly charges."
echo " Run 99_cleanup.sh promptly after snapshot collection."
echo ""

# --- VPC Peering ---
echo "Creating VPC Peering Connection..."

# Get default VPC
DEFAULT_VPC=$(aws ec2 describe-vpcs \
    --filters "Name=isDefault,Values=true" \
    --query 'Vpcs[0].VpcId' --output text 2>/dev/null || echo "None")

if [ "$DEFAULT_VPC" != "None" ] && [ -n "$DEFAULT_VPC" ]; then
    PEERING_ID=$(aws ec2 create-vpc-peering-connection \
        --vpc-id "$VPC_ID" --peer-vpc-id "$DEFAULT_VPC" \
        --tag-specifications "ResourceType=vpc-peering-connection,Tags=[{Key=Name,Value=${PREFIX}-peering}]" \
        --query 'VpcPeeringConnection.VpcPeeringConnectionId' --output text)
    save_id PEERING_ID "$PEERING_ID"

    # Auto-accept (same account)
    aws ec2 accept-vpc-peering-connection --vpc-peering-connection-id "$PEERING_ID" > /dev/null
    echo "  VPC Peering: $PEERING_ID (${VPC_ID} <-> ${DEFAULT_VPC})"
else
    echo "  SKIP: No default VPC found for peering"
fi

# --- VPC Endpoints ---
echo "Creating VPC Endpoints..."

# Gateway Endpoint (S3) - free
VPCE_S3=$(aws ec2 create-vpc-endpoint \
    --vpc-id "$VPC_ID" \
    --service-name "com.amazonaws.${AWS_REGION}.s3" \
    --vpc-endpoint-type Gateway \
    --route-table-ids "$RT_PRIVATE" "$RT_ISOLATED" \
    --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=${PREFIX}-vpce-s3}]" \
    --query 'VpcEndpoint.VpcEndpointId' --output text)
save_id VPCE_S3 "$VPCE_S3"

# Interface Endpoint (SQS)
VPCE_SQS=$(aws ec2 create-vpc-endpoint \
    --vpc-id "$VPC_ID" \
    --service-name "com.amazonaws.${AWS_REGION}.sqs" \
    --vpc-endpoint-type Interface \
    --subnet-ids "$SUBNET_PRIV_1A" "$SUBNET_PRIV_1C" \
    --security-group-ids "$SG_APP" \
    --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=${PREFIX}-vpce-sqs}]" \
    --query 'VpcEndpoint.VpcEndpointId' --output text)
save_id VPCE_SQS "$VPCE_SQS"

# --- Transit Gateway ---
echo "Creating Transit Gateway (takes ~5 min)..."
TGW_ID=$(aws ec2 create-transit-gateway \
    --description "${PREFIX} test TGW" \
    --tag-specifications "ResourceType=transit-gateway,Tags=[{Key=Name,Value=${PREFIX}-tgw}]" \
    --query 'TransitGateway.TransitGatewayId' --output text)
save_id TGW_ID "$TGW_ID"

echo "  Waiting for Transit Gateway to become available..."
for i in $(seq 1 30); do
    TGW_STATE=$(aws ec2 describe-transit-gateways --transit-gateway-ids "$TGW_ID" \
        --query 'TransitGateways[0].State' --output text 2>/dev/null)
    if [ "$TGW_STATE" = "available" ]; then
        break
    fi
    sleep 10
done
echo "  Transit Gateway ready: $TGW_ID (state: $TGW_STATE)"

# TGW VPC Attachment
TGW_ATT_ID=$(aws ec2 create-transit-gateway-vpc-attachment \
    --transit-gateway-id "$TGW_ID" --vpc-id "$VPC_ID" \
    --subnet-ids "$SUBNET_PRIV_1A" "$SUBNET_PRIV_1C" \
    --tag-specifications "ResourceType=transit-gateway-attachment,Tags=[{Key=Name,Value=${PREFIX}-tgw-att}]" \
    --query 'TransitGatewayVpcAttachment.TransitGatewayAttachmentId' --output text)
save_id TGW_ATT_ID "$TGW_ATT_ID"

# --- VPN Gateway + Customer Gateway + VPN Connection ---
echo "Creating VPN Gateway..."
VGW_ID=$(aws ec2 create-vpn-gateway --type ipsec.1 \
    --tag-specifications "ResourceType=vpn-gateway,Tags=[{Key=Name,Value=${PREFIX}-vgw}]" \
    --query 'VpnGateway.VpnGatewayId' --output text)
save_id VGW_ID "$VGW_ID"

aws ec2 attach-vpn-gateway --vpn-gateway-id "$VGW_ID" --vpc-id "$VPC_ID"

echo "Creating Customer Gateway..."
CGW_ID=$(aws ec2 create-customer-gateway --type ipsec.1 \
    --public-ip "203.0.113.1" --bgp-asn 65000 \
    --tag-specifications "ResourceType=customer-gateway,Tags=[{Key=Name,Value=${PREFIX}-cgw}]" \
    --query 'CustomerGateway.CustomerGatewayId' --output text)
save_id CGW_ID "$CGW_ID"

echo "Creating VPN Connection..."
VPN_ID=$(aws ec2 create-vpn-connection --type ipsec.1 \
    --vpn-gateway-id "$VGW_ID" --customer-gateway-id "$CGW_ID" \
    --options '{"StaticRoutesOnly":true}' \
    --tag-specifications "ResourceType=vpn-connection,Tags=[{Key=Name,Value=${PREFIX}-vpn}]" \
    --query 'VpnConnection.VpnConnectionId' --output text)
save_id VPN_ID "$VPN_ID"

# --- Client VPN Endpoint ---
echo "Creating Client VPN Endpoint..."

# Generate self-signed certificate for Client VPN
CERT_DIR="/tmp/${PREFIX}-certs"
mkdir -p "$CERT_DIR"

# Generate CA key and cert
openssl req -new -newkey rsa:2048 -days 1 -nodes -x509 \
    -subj "/CN=${PREFIX}-ca" \
    -keyout "$CERT_DIR/ca.key" -out "$CERT_DIR/ca.crt" 2>/dev/null

# Generate server key and cert
openssl req -new -newkey rsa:2048 -nodes \
    -subj "/CN=${PREFIX}-server" \
    -keyout "$CERT_DIR/server.key" -out "$CERT_DIR/server.csr" 2>/dev/null
openssl x509 -req -in "$CERT_DIR/server.csr" -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" \
    -CAcreateserial -out "$CERT_DIR/server.crt" -days 1 2>/dev/null

# Import server cert to ACM
SERVER_CERT_ARN=$(aws acm import-certificate \
    --certificate "fileb://${CERT_DIR}/server.crt" \
    --private-key "fileb://${CERT_DIR}/server.key" \
    --certificate-chain "fileb://${CERT_DIR}/ca.crt" \
    --tags Key=Name,Value=${PREFIX}-server-cert \
    --query 'CertificateArn' --output text)
save_id SERVER_CERT_ARN "$SERVER_CERT_ARN"

# Import CA cert to ACM
CA_CERT_ARN=$(aws acm import-certificate \
    --certificate "fileb://${CERT_DIR}/ca.crt" \
    --private-key "fileb://${CERT_DIR}/ca.key" \
    --tags Key=Name,Value=${PREFIX}-ca-cert \
    --query 'CertificateArn' --output text)
save_id CA_CERT_ARN "$CA_CERT_ARN"

CLIENT_VPN_ID=$(aws ec2 create-client-vpn-endpoint \
    --client-cidr-block "172.16.0.0/22" \
    --server-certificate-arn "$SERVER_CERT_ARN" \
    --authentication-options "Type=certificate-authentication,MutualAuthentication={ClientRootCertificateChainArn=${CA_CERT_ARN}}" \
    --connection-log-options "Enabled=false" \
    --tag-specifications "ResourceType=client-vpn-endpoint,Tags=[{Key=Name,Value=${PREFIX}-clientvpn}]" \
    --query 'ClientVpnEndpointId' --output text)
save_id CLIENT_VPN_ID "$CLIENT_VPN_ID"

# --- Network Firewall ---
echo "Creating Network Firewall (takes 5-10 min)..."

# Firewall Policy
NF_POLICY_ARN=$(aws network-firewall create-firewall-policy \
    --firewall-policy-name "${PREFIX}-nf-policy" \
    --firewall-policy '{"StatelessDefaultActions":["aws:pass"],"StatelessFragmentDefaultActions":["aws:pass"]}' \
    --tags Key=Name,Value=${PREFIX}-nf-policy \
    --query 'FirewallPolicyResponse.FirewallPolicyArn' --output text)
save_id NF_POLICY_ARN "$NF_POLICY_ARN"

NF_ARN=$(aws network-firewall create-firewall \
    --firewall-name "${PREFIX}-nf" \
    --firewall-policy-arn "$NF_POLICY_ARN" \
    --vpc-id "$VPC_ID" \
    --subnet-mappings "SubnetId=${SUBNET_PUB_1A}" \
    --tags Key=Name,Value=${PREFIX}-nf \
    --query 'Firewall.FirewallArn' --output text)
save_id NF_ARN "$NF_ARN"
save_id NF_NAME "${PREFIX}-nf"
echo "  Network Firewall creation started (background)"

# --- Route53 Resolver Endpoint ---
echo "Creating Route53 Resolver Endpoint..."
RESOLVER_ID=$(aws route53resolver create-resolver-endpoint \
    --creator-request-id "${PREFIX}-resolver-$(date +%s)" \
    --security-group-ids "$SG_APP" \
    --direction INBOUND \
    --ip-addresses "SubnetId=${SUBNET_PRIV_1A}" "SubnetId=${SUBNET_PRIV_1C}" \
    --name "${PREFIX}-resolver" \
    --tags Key=Name,Value=${PREFIX}-resolver \
    --query 'ResolverEndpoint.Id' --output text)
save_id RESOLVER_ID "$RESOLVER_ID"

echo ""
echo "=== Phase 5 Complete ==="
echo "  VPC Peering: ${PEERING_ID:-skipped}"
echo "  VPCE S3 (Gateway): $VPCE_S3"
echo "  VPCE SQS (Interface): $VPCE_SQS"
echo "  Transit Gateway: $TGW_ID + attachment"
echo "  VPN: $VGW_ID + $CGW_ID + $VPN_ID"
echo "  Client VPN: $CLIENT_VPN_ID"
echo "  Network Firewall: ${PREFIX}-nf (creating...)"
echo "  Route53 Resolver: $RESOLVER_ID"
echo ""
echo "  WARNING: Hourly charges are now accruing!"
