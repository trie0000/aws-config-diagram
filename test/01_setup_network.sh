#!/bin/bash
# 01_setup_network.sh - VPC, Subnet, IGW, NAT, EIP, Route Table, NACL
source "$(dirname "$0")/env.sh"

echo ""
echo "=========================================="
echo " Phase 1: Network Foundation"
echo "=========================================="

# --- VPC ---
echo "Creating VPC..."
VPC_ID=$(aws ec2 create-vpc --cidr-block "$VPC_CIDR" \
    --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=${PREFIX}-vpc}]" \
    --query 'Vpc.VpcId' --output text)
save_id VPC_ID "$VPC_ID"

aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames '{"Value":true}'
aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support '{"Value":true}'

# --- Internet Gateway ---
echo "Creating Internet Gateway..."
IGW_ID=$(aws ec2 create-internet-gateway \
    --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=${PREFIX}-igw}]" \
    --query 'InternetGateway.InternetGatewayId' --output text)
save_id IGW_ID "$IGW_ID"

aws ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"

# --- Subnets (2 AZs x 3 tiers = 6) ---
echo "Creating Subnets..."

# Public 1a
SUBNET_PUB_1A=$(aws ec2 create-subnet --vpc-id "$VPC_ID" \
    --cidr-block "10.0.1.0/24" --availability-zone "${AWS_REGION}a" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PREFIX}-public-1a},{Key=Tier,Value=Public}]" \
    --query 'Subnet.SubnetId' --output text)
save_id SUBNET_PUB_1A "$SUBNET_PUB_1A"

# Public 1c
SUBNET_PUB_1C=$(aws ec2 create-subnet --vpc-id "$VPC_ID" \
    --cidr-block "10.0.2.0/24" --availability-zone "${AWS_REGION}c" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PREFIX}-public-1c},{Key=Tier,Value=Public}]" \
    --query 'Subnet.SubnetId' --output text)
save_id SUBNET_PUB_1C "$SUBNET_PUB_1C"

# Private 1a
SUBNET_PRIV_1A=$(aws ec2 create-subnet --vpc-id "$VPC_ID" \
    --cidr-block "10.0.11.0/24" --availability-zone "${AWS_REGION}a" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PREFIX}-private-1a},{Key=Tier,Value=Private}]" \
    --query 'Subnet.SubnetId' --output text)
save_id SUBNET_PRIV_1A "$SUBNET_PRIV_1A"

# Private 1c
SUBNET_PRIV_1C=$(aws ec2 create-subnet --vpc-id "$VPC_ID" \
    --cidr-block "10.0.12.0/24" --availability-zone "${AWS_REGION}c" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PREFIX}-private-1c},{Key=Tier,Value=Private}]" \
    --query 'Subnet.SubnetId' --output text)
save_id SUBNET_PRIV_1C "$SUBNET_PRIV_1C"

# Isolated 1a
SUBNET_ISO_1A=$(aws ec2 create-subnet --vpc-id "$VPC_ID" \
    --cidr-block "10.0.21.0/24" --availability-zone "${AWS_REGION}a" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PREFIX}-isolated-1a},{Key=Tier,Value=Isolated}]" \
    --query 'Subnet.SubnetId' --output text)
save_id SUBNET_ISO_1A "$SUBNET_ISO_1A"

# Isolated 1c
SUBNET_ISO_1C=$(aws ec2 create-subnet --vpc-id "$VPC_ID" \
    --cidr-block "10.0.22.0/24" --availability-zone "${AWS_REGION}c" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PREFIX}-isolated-1c},{Key=Tier,Value=Isolated}]" \
    --query 'Subnet.SubnetId' --output text)
save_id SUBNET_ISO_1C "$SUBNET_ISO_1C"

# --- Elastic IP (for NAT Gateway) ---
echo "Allocating Elastic IP..."
EIP_ALLOC=$(aws ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${PREFIX}-nat-eip}]" \
    --query 'AllocationId' --output text)
save_id EIP_ALLOC "$EIP_ALLOC"

# --- NAT Gateway ---
echo "Creating NAT Gateway (this takes 2-3 minutes)..."
NAT_ID=$(aws ec2 create-nat-gateway --subnet-id "$SUBNET_PUB_1A" \
    --allocation-id "$EIP_ALLOC" \
    --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=${PREFIX}-nat}]" \
    --query 'NatGateway.NatGatewayId' --output text)
save_id NAT_ID "$NAT_ID"

wait_msg "NAT Gateway becoming available"
aws ec2 wait nat-gateway-available --nat-gateway-ids "$NAT_ID"
echo "  NAT Gateway ready"

# --- Route Tables ---
echo "Creating Route Tables..."

# Public Route Table
RT_PUBLIC=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${PREFIX}-rt-public}]" \
    --query 'RouteTable.RouteTableId' --output text)
save_id RT_PUBLIC "$RT_PUBLIC"

aws ec2 create-route --route-table-id "$RT_PUBLIC" \
    --destination-cidr-block "0.0.0.0/0" --gateway-id "$IGW_ID" > /dev/null

aws ec2 associate-route-table --route-table-id "$RT_PUBLIC" --subnet-id "$SUBNET_PUB_1A" > /dev/null
aws ec2 associate-route-table --route-table-id "$RT_PUBLIC" --subnet-id "$SUBNET_PUB_1C" > /dev/null

# Private Route Table
RT_PRIVATE=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${PREFIX}-rt-private}]" \
    --query 'RouteTable.RouteTableId' --output text)
save_id RT_PRIVATE "$RT_PRIVATE"

aws ec2 create-route --route-table-id "$RT_PRIVATE" \
    --destination-cidr-block "0.0.0.0/0" --nat-gateway-id "$NAT_ID" > /dev/null

aws ec2 associate-route-table --route-table-id "$RT_PRIVATE" --subnet-id "$SUBNET_PRIV_1A" > /dev/null
aws ec2 associate-route-table --route-table-id "$RT_PRIVATE" --subnet-id "$SUBNET_PRIV_1C" > /dev/null

# Isolated Route Table (no internet route)
RT_ISOLATED=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${PREFIX}-rt-isolated}]" \
    --query 'RouteTable.RouteTableId' --output text)
save_id RT_ISOLATED "$RT_ISOLATED"

aws ec2 associate-route-table --route-table-id "$RT_ISOLATED" --subnet-id "$SUBNET_ISO_1A" > /dev/null
aws ec2 associate-route-table --route-table-id "$RT_ISOLATED" --subnet-id "$SUBNET_ISO_1C" > /dev/null

# --- Network ACL (Custom for Isolated subnets) ---
echo "Creating Network ACL..."
NACL_ID=$(aws ec2 create-network-acl --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=network-acl,Tags=[{Key=Name,Value=${PREFIX}-isolated-nacl}]" \
    --query 'NetworkAcl.NetworkAclId' --output text)
save_id NACL_ID "$NACL_ID"

# Inbound: allow from VPC CIDR only
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" \
    --ingress --rule-number 100 --protocol -1 \
    --cidr-block "10.0.0.0/16" --rule-action allow

# Outbound: allow all
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" \
    --egress --rule-number 100 --protocol -1 \
    --cidr-block "0.0.0.0/0" --rule-action allow

# Isolated subnetの既存NACL associationを取得して置換
for SUBNET in "$SUBNET_ISO_1A" "$SUBNET_ISO_1C"; do
    ASSOC_ID=$(aws ec2 describe-network-acls \
        --filters "Name=association.subnet-id,Values=$SUBNET" \
        --query 'NetworkAcls[0].Associations[?SubnetId==`'$SUBNET'`].NetworkAclAssociationId' \
        --output text)
    if [ -n "$ASSOC_ID" ] && [ "$ASSOC_ID" != "None" ]; then
        aws ec2 replace-network-acl-association \
            --association-id "$ASSOC_ID" --network-acl-id "$NACL_ID" > /dev/null
    fi
done

echo ""
echo "=== Phase 1 Complete ==="
echo "  VPC: $VPC_ID ($VPC_CIDR)"
echo "  Subnets: 6 (2 AZ x 3 tiers)"
echo "  IGW: $IGW_ID"
echo "  NAT: $NAT_ID (EIP: $EIP_ALLOC)"
echo "  Route Tables: 3 (public/private/isolated)"
echo "  NACL: $NACL_ID (isolated subnets)"
