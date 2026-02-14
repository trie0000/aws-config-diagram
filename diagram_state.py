"""
diagram_state.py: DiagramState データモデル + AWSConfigParser → DiagramState 変換

AWSConfigParser のパース結果を、Web エディタで表示・編集可能な
DiagramState（Figma方式フラットマップ）に変換する。

TypeScript 側の frontend/src/types/diagram.ts と同期すること。

設計原則:
- source: 'aws-config' | 'user-manual' で出所を明確に区別
- isUserModified: True の場合、JSON再インポート時に上書きしない
- Figma方式フラットマップ: Dict[str, DiagramNode]
- 座標はピクセル単位（LayoutEngine が後から計算）

Version: 1.0.0
Last Updated: 2026-02-13
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field


# ============================================================
# 基本型
# ============================================================

class Position(BaseModel):
    """ピクセル座標"""
    x: float = 0.0
    y: float = 0.0


class Size(BaseModel):
    """ピクセルサイズ"""
    width: float = 0.0
    height: float = 0.0


# ============================================================
# ノード種別 → AWSリソースタイプ マッピング
# ============================================================

# AWSConfigParser の resourceType → NodeType
AWS_TYPE_TO_NODE_TYPE: Dict[str, str] = {
    "AWS::EC2::VPC": "vpc",
    "AWS::EC2::Subnet": "subnet",
    "AWS::EC2::InternetGateway": "igw",
    "AWS::EC2::NatGateway": "nat-gateway",
    "AWS::EC2::Instance": "ec2",
    "AWS::ElasticLoadBalancingV2::LoadBalancer": "alb",
    "AWS::RDS::DBInstance": "rds",
    "AWS::ECS::Cluster": "ecs",
    "AWS::ECS::Service": "ecs",
    "AWS::EKS::Cluster": "eks",
    "AWS::Lambda::Function": "lambda",
    "AWS::ElastiCache::CacheCluster": "elasticache",
    "AWS::Redshift::Cluster": "redshift",
    "AWS::Route53::HostedZone": "route53",
    "AWS::CloudFront::Distribution": "cloudfront",
    "AWS::ApiGateway::RestApi": "api-gateway",
    "AWS::ApiGatewayV2::Api": "api-gateway",
    "AWS::S3::Bucket": "s3",
    "AWS::DynamoDB::Table": "dynamodb",
    "AWS::SQS::Queue": "sqs",
    "AWS::SNS::Topic": "sns",
    "AWS::WAFv2::WebACL": "waf",
    "AWS::ACM::Certificate": "acm",
    "AWS::KMS::Key": "kms",
    "AWS::CloudTrail::Trail": "cloudtrail",
    "AWS::CloudWatch::Alarm": "cloudwatch",
    "AWS::EC2::VPCEndpoint": "vpc-endpoint",
    "AWS::EC2::VPCPeeringConnection": "vpc-peering",
    "AWS::AutoScaling::AutoScalingGroup": "auto-scaling",
    "AWS::ElasticBeanstalk::Environment": "elastic-beanstalk",
}


# ============================================================
# DiagramNode / DiagramEdge / DiagramState
# ============================================================

class DiagramNode(BaseModel):
    """構成図ノード（リソース/要素）"""
    id: str
    type: str  # NodeType（vpc, subnet, ec2, ...）
    label: str
    source: Literal["aws-config", "user-manual"] = "aws-config"
    is_user_modified: bool = False

    position: Position = Field(default_factory=Position)
    size: Size = Field(default_factory=Size)

    parent_id: Optional[str] = None

    # AWS Config 由来のメタデータ（リソースID, タグ, SG 等）
    metadata: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        # JSON シリアライズ時に camelCase を使用（TypeScript 側と合わせる）
        populate_by_name = True

    def model_dump_camel(self) -> dict:
        """TypeScript 側の camelCase フィールド名で出力"""
        d = self.model_dump()
        return {
            "id": d["id"],
            "type": d["type"],
            "label": d["label"],
            "source": d["source"],
            "isUserModified": d["is_user_modified"],
            "position": d["position"],
            "size": d["size"],
            "parentId": d["parent_id"],
            "metadata": d["metadata"],
        }


class DiagramEdge(BaseModel):
    """構成図エッジ（接続線）"""
    id: str
    type: Literal["containment", "connection", "data-flow", "user-defined"] = "connection"
    source: Literal["aws-config", "user-manual"] = "aws-config"
    source_node_id: str
    target_node_id: str
    label: Optional[str] = None
    is_user_modified: bool = False
    metadata: Dict[str, Any] = Field(default_factory=dict)

    def model_dump_camel(self) -> dict:
        """TypeScript 側の camelCase フィールド名で出力"""
        d = self.model_dump()
        return {
            "id": d["id"],
            "type": d["type"],
            "source": d["source"],
            "sourceNodeId": d["source_node_id"],
            "targetNodeId": d["target_node_id"],
            "label": d["label"],
            "isUserModified": d["is_user_modified"],
            "metadata": d["metadata"],
        }


class DiagramMeta(BaseModel):
    """図のメタデータ"""
    title: str = ""
    created_at: str = ""
    updated_at: str = ""
    config_snapshot_id: Optional[str] = None

    def model_dump_camel(self) -> dict:
        d = self.model_dump()
        return {
            "title": d["title"],
            "createdAt": d["created_at"],
            "updatedAt": d["updated_at"],
            "configSnapshotId": d["config_snapshot_id"],
        }


class DiagramState(BaseModel):
    """構成図全体の状態"""
    meta: DiagramMeta = Field(default_factory=DiagramMeta)
    nodes: Dict[str, DiagramNode] = Field(default_factory=dict)
    edges: Dict[str, DiagramEdge] = Field(default_factory=dict)

    def to_json(self) -> dict:
        """TypeScript 互換の camelCase JSON に変換"""
        return {
            "meta": self.meta.model_dump_camel(),
            "nodes": {
                k: v.model_dump_camel() for k, v in self.nodes.items()
            },
            "edges": {
                k: v.model_dump_camel() for k, v in self.edges.items()
            },
        }


# ============================================================
# AWSConfigParser → DiagramState 変換
# ============================================================

class DiagramStateConverter:
    """AWSConfigParser のパース結果を DiagramState に変換する。

    座標（position, size）はこのクラスでは計算しない。
    LayoutEngine が後から DiagramState に座標を付与する。
    """

    def __init__(self, parser):
        """
        Args:
            parser: AWSConfigParser インスタンス
        """
        self.parser = parser
        self._edge_counter = 0

    def _enrich_metadata(self, resource_id: str, metadata: dict) -> dict:
        """生データからタグ・SG情報を metadata に追加"""
        raw = self.parser.by_id.get(resource_id, {})
        # タグ
        tags = raw.get("tags", {})
        if tags:
            metadata["tags"] = tags
        # SG 詳細（EC2, ALB, RDS 等）
        cfg = raw.get("configuration", {})
        sgs = cfg.get("securityGroups", [])
        if sgs and isinstance(sgs, list):
            if isinstance(sgs[0], dict):
                # EC2 形式: [{"groupId": "...", "groupName": "..."}]
                metadata["securityGroups"] = [
                    {"id": sg.get("groupId", ""), "name": sg.get("groupName", "")}
                    for sg in sgs
                ]
            elif isinstance(sgs[0], str):
                # ALB 形式: ["sg-xxx"]
                metadata["securityGroups"] = [
                    {"id": sg_id, "name": ""} for sg_id in sgs
                ]
        # RDS SG
        vpc_sgs = cfg.get("vpcSecurityGroups", [])
        if vpc_sgs:
            metadata["securityGroups"] = [
                {"id": sg.get("vpcSecurityGroupId", ""), "status": sg.get("status", "")}
                for sg in vpc_sgs
            ]
        # ARN
        arn = raw.get("ARN", "")
        if arn:
            metadata["arn"] = arn
        return metadata

    def convert(self, title: str = "") -> DiagramState:
        """パーサー出力 → DiagramState に変換

        Args:
            title: 図のタイトル

        Returns:
            DiagramState（座標未計算）
        """
        now = datetime.now(timezone.utc).isoformat()
        state = DiagramState(
            meta=DiagramMeta(
                title=title or "AWS Config Diagram",
                created_at=now,
                updated_at=now,
            ),
        )

        # AWS Cloud コンテナ（全体を囲む外枠）
        cloud_node_id = "node-aws-cloud"
        region = ""
        vpcs = self.parser.get_vpcs()
        if vpcs:
            region = vpcs[0].get("region", "")
        state.nodes[cloud_node_id] = DiagramNode(
            id=cloud_node_id,
            type="aws-cloud",
            label=f"AWS Cloud{f' ({region})' if region else ''}",
            metadata={"region": region},
        )

        # VPC 単位で階層構造を構築
        for vpc in vpcs:
            self._add_vpc(state, vpc, cloud_parent_id=cloud_node_id)

        # VPC 外サービス（AWS Cloud の子にする）
        self._add_edge_services(state, cloud_parent_id=cloud_node_id)
        self._add_data_services(state, cloud_parent_id=cloud_node_id)
        self._add_support_services(state, cloud_parent_id=cloud_node_id)

        # 接続線（エッジ）
        self._add_service_connections(state)

        # メタデータ充実（タグ・SG・ARN を生データから追加）
        for node in state.nodes.values():
            resource_id = node.metadata.get("awsResourceId", "")
            if resource_id:
                node.metadata = self._enrich_metadata(resource_id, node.metadata)

        return state

    # ----------------------------------------------------------------
    # VPC + 内部リソース
    # ----------------------------------------------------------------

    def _add_vpc(self, state: DiagramState, vpc: dict, cloud_parent_id: str | None = None) -> None:
        """VPC ノードと内部リソースを追加"""
        vpc_id = vpc["id"]
        vpc_node_id = f"node-{vpc_id}"

        state.nodes[vpc_node_id] = DiagramNode(
            id=vpc_node_id,
            type="vpc",
            label=f'{vpc["name"]} ({vpc["cidr"]})',
            parent_id=cloud_parent_id,
            metadata={
                "awsResourceId": vpc_id,
                "awsResourceType": "AWS::EC2::VPC",
                "cidr": vpc["cidr"],
                "region": vpc["region"],
                "isDefault": vpc.get("is_default", False),
            },
        )

        # AZ を収集（Subnet の AZ から）
        subnets = self.parser.get_subnets_for_vpc(vpc_id)
        azs = sorted(set(s["az"] for s in subnets if s.get("az")))

        for az_name in azs:
            az_node_id = f"node-az-{vpc_id}-{az_name}"
            state.nodes[az_node_id] = DiagramNode(
                id=az_node_id,
                type="az",
                label=az_name,
                parent_id=vpc_node_id,
                metadata={"az": az_name, "vpcId": vpc_id},
            )

            # この AZ に属する Subnet
            az_subnets = [s for s in subnets if s.get("az") == az_name]
            for subnet in az_subnets:
                self._add_subnet(state, subnet, az_node_id, vpc_id)

        # IGW
        igw = self.parser.get_igw_for_vpc(vpc_id)
        if igw:
            igw_node_id = f"node-{igw['id']}"
            state.nodes[igw_node_id] = DiagramNode(
                id=igw_node_id,
                type="igw",
                label=igw["name"],
                parent_id=vpc_node_id,
                metadata={
                    "awsResourceId": igw["id"],
                    "awsResourceType": "AWS::EC2::InternetGateway",
                },
            )

        # NAT Gateway — 所属 Public Subnet の境界に配置
        nats = self.parser.get_nat_gateways_for_vpc(vpc_id)
        for nat in nats:
            nat_node_id = f"node-{nat['id']}"
            nat_subnet_id = nat.get("subnet_id", "")
            nat_subnet_node_id = f"node-{nat_subnet_id}" if nat_subnet_id else ""
            # 所属 Subnet が存在すればその子に、なければ VPC 直下
            nat_parent = nat_subnet_node_id if nat_subnet_node_id in state.nodes else vpc_node_id
            state.nodes[nat_node_id] = DiagramNode(
                id=nat_node_id,
                type="nat-gateway",
                label=nat["name"],
                parent_id=nat_parent,
                metadata={
                    "awsResourceId": nat["id"],
                    "awsResourceType": "AWS::EC2::NatGateway",
                    "subnetId": nat_subnet_id,
                    "publicIp": nat.get("public_ip", ""),
                },
            )

        # NAT Gateway 利用エッジ: Private Subnet → NAT Gateway
        nat_usage = self.parser.get_nat_usage_map(vpc_id)
        for nat_id, using_subnet_ids in nat_usage.items():
            nat_node_id = f"node-{nat_id}"
            if nat_node_id not in state.nodes:
                continue
            for sid in using_subnet_ids:
                subnet_node_id = f"node-{sid}"
                if subnet_node_id not in state.nodes:
                    continue
                self._add_edge(
                    state, subnet_node_id, nat_node_id,
                    edge_type="connection",
                    label="→ NAT",
                    metadata={"connectionType": "subnet→nat-gateway"},
                )

        # ALB
        albs = self.parser.get_albs_for_vpc(vpc_id)
        for alb in albs:
            alb_node_id = f"node-{alb['id']}"
            state.nodes[alb_node_id] = DiagramNode(
                id=alb_node_id,
                type="alb",
                label=alb["name"],
                parent_id=vpc_node_id,
                metadata={
                    "awsResourceId": alb["id"],
                    "awsResourceType": "AWS::ElasticLoadBalancingV2::LoadBalancer",
                    "scheme": alb.get("scheme", ""),
                    "dnsName": alb.get("dns", ""),
                },
            )

            # WAF → ALB
            waf = self.parser.get_waf_for_alb(alb.get("arn", alb["id"]))
            if waf:
                waf_node_id = f"node-{waf['id']}"
                if waf_node_id not in state.nodes:
                    state.nodes[waf_node_id] = DiagramNode(
                        id=waf_node_id,
                        type="waf",
                        label=waf["name"],
                        metadata={
                            "awsResourceId": waf["id"],
                            "awsResourceType": "AWS::WAFv2::WebACL",
                        },
                    )
                self._add_edge(
                    state, waf_node_id, alb_node_id,
                    edge_type="connection", label="WAF → ALB",
                )

        # RDS
        rds_list = self.parser.get_rds_for_vpc(vpc_id)
        for rds in rds_list:
            rds_node_id = f"node-{rds['id']}"
            state.nodes[rds_node_id] = DiagramNode(
                id=rds_node_id,
                type="rds",
                label=rds["name"],
                parent_id=vpc_node_id,
                metadata={
                    "awsResourceId": rds["id"],
                    "awsResourceType": "AWS::RDS::DBInstance",
                    "engine": rds.get("engine", ""),
                    "instanceClass": rds.get("instance_class", ""),
                    "multiAz": rds.get("multi_az", False),
                },
            )

        # VPC Endpoint
        endpoints = self.parser.get_vpc_endpoints_for_vpc(vpc_id)
        for ep in endpoints:
            ep_node_id = f"node-{ep['id']}"
            short_name = ep.get("service", ep["id"])
            state.nodes[ep_node_id] = DiagramNode(
                id=ep_node_id,
                type="vpc-endpoint",
                label=f"VPCE: {short_name}",
                parent_id=vpc_node_id,
                metadata={
                    "awsResourceId": ep["id"],
                    "awsResourceType": "AWS::EC2::VPCEndpoint",
                    "serviceName": ep.get("full_service", ""),
                    "endpointType": ep.get("type", ""),
                },
            )

        # VPC Peering
        peerings = self.parser.get_peering_connections()
        for peer in peerings:
            if peer.get("requester_vpc") == vpc_id or peer.get("accepter_vpc") == vpc_id:
                peer_node_id = f"node-{peer['id']}"
                if peer_node_id not in state.nodes:
                    state.nodes[peer_node_id] = DiagramNode(
                        id=peer_node_id,
                        type="vpc-peering",
                        label=peer.get("name", peer["id"]),
                        parent_id=vpc_node_id,
                        metadata={
                            "awsResourceId": peer["id"],
                            "awsResourceType": "AWS::EC2::VPCPeeringConnection",
                            "requesterVpc": peer.get("requester_vpc", ""),
                            "accepterVpc": peer.get("accepter_vpc", ""),
                        },
                    )

    def _add_subnet(
        self, state: DiagramState, subnet: dict,
        az_node_id: str, vpc_id: str,
    ) -> None:
        """Subnet ノードと内部リソースを追加"""
        subnet_id = subnet["id"]
        subnet_node_id = f"node-{subnet_id}"

        state.nodes[subnet_node_id] = DiagramNode(
            id=subnet_node_id,
            type="subnet",
            label=f'{subnet["name"]} ({subnet["cidr"]})',
            parent_id=az_node_id,
            metadata={
                "awsResourceId": subnet_id,
                "awsResourceType": "AWS::EC2::Subnet",
                "cidr": subnet["cidr"],
                "az": subnet["az"],
                "tier": subnet["tier"],
                "vpcId": vpc_id,
            },
        )

        # Subnet 内の EC2
        instances = self.parser.get_instances_for_subnet(subnet_id)
        for inst in instances:
            inst_node_id = f"node-{inst['id']}"
            state.nodes[inst_node_id] = DiagramNode(
                id=inst_node_id,
                type="ec2",
                label=inst["name"],
                parent_id=subnet_node_id,
                metadata={
                    "awsResourceId": inst["id"],
                    "awsResourceType": "AWS::EC2::Instance",
                    "instanceType": inst.get("type", ""),
                    "privateIp": inst.get("private_ip", ""),
                    "publicIp": inst.get("public_ip"),
                    "sgIds": inst.get("sg_ids", []),
                },
            )

    # ----------------------------------------------------------------
    # VPC 外サービス
    # ----------------------------------------------------------------

    def _add_edge_services(self, state: DiagramState, cloud_parent_id: str | None = None) -> None:
        """エッジサービス（VPC外左側）: Route53, CloudFront, API Gateway"""
        for zone in self.parser.get_route53_hosted_zones():
            node_id = f"node-{zone['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="route53", label=zone["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": zone["id"],
                    "awsResourceType": "AWS::Route53::HostedZone",
                },
            )

        for dist in self.parser.get_cloudfront_distributions():
            node_id = f"node-{dist['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="cloudfront", label=dist["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": dist["id"],
                    "awsResourceType": "AWS::CloudFront::Distribution",
                },
            )

        for api in self.parser.get_api_gateways():
            node_id = f"node-{api['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="api-gateway", label=api["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": api["id"],
                    "awsResourceType": api.get("aws_type", "AWS::ApiGateway::RestApi"),
                },
            )

    def _add_data_services(self, state: DiagramState, cloud_parent_id: str | None = None) -> None:
        """データパスサービス（VPC下部）: Lambda, DynamoDB, SQS, SNS, S3"""
        for fn in self.parser.get_lambda_functions():
            # VPC Lambda は VPC 内に配置されるべきだが、VPC ID がない場合は外部扱い
            node_id = f"node-{fn['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="lambda", label=fn["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": fn["id"],
                    "awsResourceType": "AWS::Lambda::Function",
                    "runtime": fn.get("runtime", ""),
                },
            )

        for table in self.parser.get_dynamodb_tables():
            node_id = f"node-{table['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="dynamodb", label=table["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": table["id"],
                    "awsResourceType": "AWS::DynamoDB::Table",
                },
            )

        for q in self.parser.get_sqs_queues():
            node_id = f"node-{q['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="sqs", label=q["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": q["id"],
                    "awsResourceType": "AWS::SQS::Queue",
                },
            )

        for topic in self.parser.get_sns_topics():
            node_id = f"node-{topic['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="sns", label=topic["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": topic["id"],
                    "awsResourceType": "AWS::SNS::Topic",
                },
            )

        for bucket in self.parser.get_s3_buckets():
            node_id = f"node-{bucket['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="s3", label=bucket["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": bucket["id"],
                    "awsResourceType": "AWS::S3::Bucket",
                },
            )

    def _add_support_services(self, state: DiagramState, cloud_parent_id: str | None = None) -> None:
        """サポートサービス: KMS, CloudTrail, CloudWatch, ECS, EKS, AutoScaling"""
        for key in self.parser.get_kms_keys():
            node_id = f"node-{key['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="kms", label=key["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": key["id"],
                    "awsResourceType": "AWS::KMS::Key",
                },
            )

        for trail in self.parser.get_cloudtrail_trails():
            node_id = f"node-{trail['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="cloudtrail", label=trail["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": trail["id"],
                    "awsResourceType": "AWS::CloudTrail::Trail",
                },
            )

        for alarm in self.parser.get_cloudwatch_alarms():
            node_id = f"node-{alarm['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="cloudwatch", label=alarm["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": alarm["id"],
                    "awsResourceType": "AWS::CloudWatch::Alarm",
                },
            )

        for cluster in self.parser.get_ecs_clusters():
            node_id = f"node-{cluster['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="ecs", label=cluster["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": cluster["id"],
                    "awsResourceType": "AWS::ECS::Cluster",
                },
            )

        for cluster in self.parser.get_eks_clusters():
            node_id = f"node-{cluster['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="eks", label=cluster["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": cluster["id"],
                    "awsResourceType": "AWS::EKS::Cluster",
                },
            )

        for asg in self.parser.get_autoscaling_groups():
            node_id = f"node-{asg['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="auto-scaling", label=asg["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": asg["id"],
                    "awsResourceType": "AWS::AutoScaling::AutoScalingGroup",
                },
            )

        for env in self.parser.get_elasticbeanstalk_environments():
            node_id = f"node-{env['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="elastic-beanstalk", label=env["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": env["id"],
                    "awsResourceType": "AWS::ElasticBeanstalk::Environment",
                },
            )

        for cache in self.parser.get_elasticache_clusters():
            node_id = f"node-{cache['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="elasticache", label=cache["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": cache["id"],
                    "awsResourceType": "AWS::ElastiCache::CacheCluster",
                },
            )

        for rs in self.parser.get_redshift_clusters():
            node_id = f"node-{rs['id']}"
            state.nodes[node_id] = DiagramNode(
                id=node_id, type="redshift", label=rs["name"],
                parent_id=cloud_parent_id,
                metadata={
                    "awsResourceId": rs["id"],
                    "awsResourceType": "AWS::Redshift::Cluster",
                },
            )

    # ----------------------------------------------------------------
    # 接続線（エッジ）
    # ----------------------------------------------------------------

    def _add_service_connections(self, state: DiagramState) -> None:
        """パーサーからエッジを生成（3ソース）"""

        # 1. get_service_connections(): CloudFront→ALB, CloudTrail→S3 等
        try:
            connections = self.parser.get_service_connections()
            for conn in connections:
                # キーは from_id / to_id（パーサー側の命名）
                src_id = conn.get("from_id", "")
                dst_id = conn.get("to_id", "")
                src_node_id = f"node-{src_id}"
                dst_node_id = f"node-{dst_id}"

                if src_node_id in state.nodes and dst_node_id in state.nodes:
                    self._add_edge(
                        state, src_node_id, dst_node_id,
                        edge_type="connection",
                        label=conn.get("label", None),
                        metadata={
                            "connectionType": f"{conn.get('from_type', '')}→{conn.get('to_type', '')}",
                        },
                    )
        except Exception:
            pass

        # 2. SG ベース接続: SG→SG の参照 + SG→リソース のマップ で
        #    リソース→リソース のエッジを生成
        try:
            sg_connections = self.parser.get_sg_connections()
            sg_to_resources = self.parser.build_sg_to_resources_map()

            # SG→リソースの逆引き: resource_id → node_id
            sg_to_node_ids: dict[str, list[str]] = {}
            for sg_id, resources in sg_to_resources.items():
                node_ids = []
                for r in resources:
                    node_id = f"node-{r['id']}"
                    if node_id in state.nodes:
                        node_ids.append(node_id)
                if node_ids:
                    sg_to_node_ids[sg_id] = node_ids

            # SG→SG → リソース→リソース に展開
            seen_edges: set[tuple[str, str]] = set()
            for conn in sg_connections:
                from_sg = conn.get("from_sg", "")
                to_sg = conn.get("to_sg", "")
                port = conn.get("port", "")
                protocol = conn.get("protocol", "")

                # 同一SG間の自己参照はスキップ
                if from_sg == to_sg:
                    continue

                from_nodes = sg_to_node_ids.get(from_sg, [])
                to_nodes = sg_to_node_ids.get(to_sg, [])

                for src_node_id in from_nodes:
                    for dst_node_id in to_nodes:
                        if src_node_id == dst_node_id:
                            continue
                        edge_key = (src_node_id, dst_node_id)
                        if edge_key in seen_edges:
                            continue
                        seen_edges.add(edge_key)

                        label_parts = []
                        if port:
                            label_parts.append(str(port))
                        if protocol and protocol not in ("-1", ""):
                            label_parts.append(protocol)

                        self._add_edge(
                            state, src_node_id, dst_node_id,
                            edge_type="data-flow",
                            label="/".join(label_parts) if label_parts else None,
                            metadata={
                                "fromSg": from_sg,
                                "toSg": to_sg,
                                "port": str(port),
                                "protocol": protocol,
                            },
                        )
        except Exception:
            pass

    def _add_edge(
        self,
        state: DiagramState,
        source_node_id: str,
        target_node_id: str,
        edge_type: str = "connection",
        label: str | None = None,
        metadata: dict | None = None,
    ) -> None:
        """エッジを追加"""
        self._edge_counter += 1
        edge_id = f"edge-{self._edge_counter:04d}"
        state.edges[edge_id] = DiagramEdge(
            id=edge_id,
            type=edge_type,
            source_node_id=source_node_id,
            target_node_id=target_node_id,
            label=label,
            metadata=metadata or {},
        )
