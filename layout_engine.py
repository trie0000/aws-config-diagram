"""
layout_engine.py: DiagramState → 座標計算

DiagramState の各ノードに position (x, y) と size (width, height) を
ピクセル単位で付与する。座標系は左上原点。

レイアウトアルゴリズム:
1. VPC → AZ → Subnet の階層を上から下にネスト配置
2. Subnet を tier (Public / Private / Isolated) で列分け
3. 各 Subnet 内のリソースをグリッド配置
4. VPC 外サービス（エッジ/データパス/サポート）を VPC の周囲に配置
5. VPC サイズはコンテンツ駆動で自動拡張

既存の diagram_pptx.py / diagram_excel.py の _calc_layout() の
設計思想を踏襲しつつ、ピクセル座標系で再実装。

Version: 1.0.0
Last Updated: 2026-02-13
"""

from __future__ import annotations

from diagram_state import DiagramState


# ============================================================
# 定数（ピクセル）
# ============================================================

# Canvas
CANVAS_PADDING = 40

# VPC
VPC_PADDING = 20
VPC_HEADER_H = 36
VPC_MIN_W = 800
VPC_MIN_H = 400

# AZ
AZ_GAP = 16
AZ_PADDING = 12
AZ_HEADER_H = 28

# Subnet
SUBNET_GAP = 16
SUBNET_PADDING = 12
SUBNET_HEADER_H = 24
SUBNET_MIN_W = 200
SUBNET_MIN_H = 120

# リソースアイコン
ICON_W = 64
ICON_H = 64
ICON_GAP = 16
ICON_COLS_PER_SUBNET = 3  # Subnet 内のアイコン列数

# VPC 外サービス配置
EDGE_SERVICE_X = 40           # エッジサービスの X 座標
EDGE_SERVICE_GAP = 80         # エッジサービス間の Y 間隔
EDGE_SERVICE_ICON_W = 72
EDGE_SERVICE_ICON_H = 72

DATA_SERVICE_GAP = 80         # データパスサービス間の X 間隔
DATA_SERVICE_ICON_W = 64
DATA_SERVICE_ICON_H = 64

SUPPORT_SERVICE_GAP = 60
SUPPORT_SERVICE_ICON_W = 48
SUPPORT_SERVICE_ICON_H = 48

# VPC外サービスとVPCの間隔
VPC_LEFT_MARGIN = 200         # エッジサービス分の左マージン


# ============================================================
# LayoutEngine
# ============================================================

class LayoutEngine:
    """DiagramState にピクセル座標を付与する。

    使い方:
        engine = LayoutEngine()
        state = engine.calculate(state)  # position/size が設定される
    """

    def calculate(self, state: DiagramState) -> DiagramState:
        """DiagramState の全ノードに座標を計算して設定する。

        Args:
            state: 座標未設定の DiagramState

        Returns:
            座標設定済みの DiagramState（同一オブジェクトを変更して返す）
        """
        # ノードを種別ごとに分類
        vpcs = []
        edge_services = []    # route53, cloudfront, api-gateway
        data_services = []    # lambda, dynamodb, sqs, sns, s3
        support_services = [] # kms, cloudtrail, cloudwatch, ecs, eks, etc.
        other_nodes = []

        edge_types = {"route53", "cloudfront", "api-gateway"}
        data_types = {"lambda", "dynamodb", "sqs", "sns", "s3"}
        support_types = {
            "kms", "cloudtrail", "cloudwatch", "ecs", "eks",
            "auto-scaling", "elastic-beanstalk", "elasticache", "redshift",
        }

        for node in state.nodes.values():
            if node.type == "vpc":
                vpcs.append(node)
            elif node.type in edge_types and node.parent_id is None:
                edge_services.append(node)
            elif node.type in data_types and node.parent_id is None:
                data_services.append(node)
            elif node.type in support_types and node.parent_id is None:
                support_services.append(node)
            # 親を持つノード（az, subnet, ec2 等）は VPC 内で処理

        # VPC の配置開始位置
        vpc_start_x = CANVAS_PADDING + VPC_LEFT_MARGIN
        vpc_start_y = CANVAS_PADDING
        current_y = vpc_start_y

        for vpc_node in vpcs:
            vpc_bottom = self._layout_vpc(state, vpc_node, vpc_start_x, current_y)
            current_y = vpc_bottom + 40  # VPC 間の間隔

        # エッジサービス（VPC 左側、縦並び）
        self._layout_edge_services(state, edge_services, vpc_start_y)

        # データパスサービス（VPC 下部、横並び）
        self._layout_data_services(state, data_services, vpc_start_x, current_y)

        # サポートサービス（データパスの右側、横並び）
        data_end_x = vpc_start_x + len(data_services) * DATA_SERVICE_GAP
        self._layout_support_services(
            state, support_services, max(data_end_x + 40, vpc_start_x + 600), current_y)

        return state

    # ----------------------------------------------------------------
    # VPC レイアウト
    # ----------------------------------------------------------------

    def _layout_vpc(
        self, state: DiagramState, vpc_node, x: float, y: float
    ) -> float:
        """VPC とその内部要素をレイアウトし、VPC の下端 Y を返す。"""
        vpc_id = vpc_node.id

        # VPC 直下の子ノードを取得
        az_nodes = [
            n for n in state.nodes.values()
            if n.parent_id == vpc_id and n.type == "az"
        ]
        # AZ 以外の VPC 直下ノード (IGW, NAT, ALB, RDS, VPC-Endpoint 等)
        vpc_children = [
            n for n in state.nodes.values()
            if n.parent_id == vpc_id and n.type not in ("az", "subnet")
        ]

        # AZ をソート（名前順）
        az_nodes.sort(key=lambda n: n.label)

        # 各 AZ の高さを計算（コンテンツ駆動）
        az_heights = []
        az_contents = []  # (az_node, subnet_nodes_by_tier)

        for az_node in az_nodes:
            subnets = [
                n for n in state.nodes.values()
                if n.parent_id == az_node.id and n.type == "subnet"
            ]
            # tier でソート: Public → Private → Isolated
            tier_order = {"Public": 0, "Private": 1, "Isolated": 2}
            subnets.sort(key=lambda s: (
                tier_order.get(s.metadata.get("tier", "Private"), 1),
                s.label,
            ))

            # 各 Subnet の高さを計算
            max_subnet_h = SUBNET_MIN_H
            for subnet_node in subnets:
                children = [
                    n for n in state.nodes.values()
                    if n.parent_id == subnet_node.id
                ]
                rows = max(1, (len(children) + ICON_COLS_PER_SUBNET - 1)
                           // ICON_COLS_PER_SUBNET)
                h = SUBNET_HEADER_H + SUBNET_PADDING + rows * (ICON_H + ICON_GAP)
                max_subnet_h = max(max_subnet_h, h)

            n_subnets = max(len(subnets), 1)
            az_h = (AZ_HEADER_H + AZ_PADDING
                    + n_subnets * max_subnet_h
                    + (n_subnets - 1) * SUBNET_GAP
                    + AZ_PADDING)
            az_heights.append(az_h)
            az_contents.append((az_node, subnets))

        # VPC サイズ計算
        n_az = max(len(az_nodes), 1)
        total_az_h = sum(az_heights) + AZ_GAP * (n_az - 1) if az_heights else 200
        vpc_content_h = VPC_HEADER_H + VPC_PADDING + total_az_h + VPC_PADDING

        # VPC 幅: Subnet の tier 数 × Subnet 最小幅 + マージン
        # tier を集める
        all_tiers = set()
        for _, subnets in az_contents:
            for s in subnets:
                all_tiers.add(s.metadata.get("tier", "Private"))
        n_tiers = max(len(all_tiers), 1)
        vpc_w = max(VPC_MIN_W, n_tiers * (SUBNET_MIN_W + SUBNET_GAP) + 2 * VPC_PADDING + 40)
        vpc_h = max(VPC_MIN_H, vpc_content_h)

        vpc_node.position.x = x
        vpc_node.position.y = y
        vpc_node.size.width = vpc_w
        vpc_node.size.height = vpc_h

        # AZ 配置
        az_y = y + VPC_HEADER_H + VPC_PADDING
        for i, (az_node, subnets) in enumerate(az_contents):
            az_h = az_heights[i]
            az_x = x + VPC_PADDING
            az_w = vpc_w - 2 * VPC_PADDING

            az_node.position.x = az_x
            az_node.position.y = az_y
            az_node.size.width = az_w
            az_node.size.height = az_h

            # Subnet 配置（横並び、tier 別）
            self._layout_subnets(state, subnets, az_x, az_y, az_w, az_h)

            az_y += az_h + AZ_GAP

        # VPC 直下の非AZノード（IGW, ALB, NAT 等）を VPC 内右上に配置
        self._layout_vpc_services(vpc_children, x, y, vpc_w)

        return y + vpc_h

    def _layout_subnets(
        self, state: DiagramState, subnets: list,
        az_x: float, az_y: float, az_w: float, az_h: float,
    ) -> None:
        """AZ 内の Subnet を横並びに配置"""
        if not subnets:
            return

        n = len(subnets)
        subnet_w = (az_w - 2 * AZ_PADDING - (n - 1) * SUBNET_GAP) / n
        subnet_w = max(subnet_w, SUBNET_MIN_W)
        subnet_h = az_h - AZ_HEADER_H - 2 * AZ_PADDING

        sx = az_x + AZ_PADDING
        sy = az_y + AZ_HEADER_H + AZ_PADDING

        for subnet_node in subnets:
            subnet_node.position.x = sx
            subnet_node.position.y = sy
            subnet_node.size.width = subnet_w
            subnet_node.size.height = subnet_h

            # Subnet 内のリソースをグリッド配置
            children = [
                n for n in state.nodes.values()
                if n.parent_id == subnet_node.id
            ]
            self._layout_icons_grid(
                children,
                sx + SUBNET_PADDING,
                sy + SUBNET_HEADER_H + SUBNET_PADDING,
                ICON_COLS_PER_SUBNET,
            )

            sx += subnet_w + SUBNET_GAP

    def _layout_icons_grid(
        self, nodes: list, start_x: float, start_y: float, cols: int,
    ) -> None:
        """ノードをグリッド配置"""
        for i, node in enumerate(nodes):
            col = i % cols
            row = i // cols
            node.position.x = start_x + col * (ICON_W + ICON_GAP)
            node.position.y = start_y + row * (ICON_H + ICON_GAP)
            node.size.width = ICON_W
            node.size.height = ICON_H

    def _layout_vpc_services(
        self, nodes: list, vpc_x: float, vpc_y: float, vpc_w: float,
    ) -> None:
        """VPC直下のサービスノード（IGW, NAT, ALB等）を配置"""
        # IGW は VPC 左端
        igw_nodes = [n for n in nodes if n.type == "igw"]
        other = [n for n in nodes if n.type != "igw"]

        for i, node in enumerate(igw_nodes):
            node.position.x = vpc_x - 20
            node.position.y = vpc_y + VPC_HEADER_H + 20 + i * 80
            node.size.width = 48
            node.size.height = 48

        # 他のサービスは VPC 内上部に横並び
        sx = vpc_x + VPC_PADDING + 100
        sy = vpc_y + VPC_HEADER_H + 8
        for node in other:
            node.position.x = sx
            node.position.y = sy
            node.size.width = 56
            node.size.height = 56
            sx += 72

    # ----------------------------------------------------------------
    # VPC 外サービス
    # ----------------------------------------------------------------

    def _layout_edge_services(
        self, state: DiagramState, nodes: list, vpc_y: float,
    ) -> None:
        """エッジサービス（Route53, CloudFront, API GW）を VPC 左側に縦配置"""
        sy = vpc_y + 40
        for node in nodes:
            node.position.x = EDGE_SERVICE_X
            node.position.y = sy
            node.size.width = EDGE_SERVICE_ICON_W
            node.size.height = EDGE_SERVICE_ICON_H
            sy += EDGE_SERVICE_GAP

    def _layout_data_services(
        self, state: DiagramState, nodes: list,
        start_x: float, start_y: float,
    ) -> None:
        """データパスサービス（Lambda, DynamoDB, SQS, SNS, S3）を VPC 下に横配置"""
        sx = start_x
        sy = start_y + 20
        for node in nodes:
            node.position.x = sx
            node.position.y = sy
            node.size.width = DATA_SERVICE_ICON_W
            node.size.height = DATA_SERVICE_ICON_H
            sx += DATA_SERVICE_GAP

    def _layout_support_services(
        self, state: DiagramState, nodes: list,
        start_x: float, start_y: float,
    ) -> None:
        """サポートサービス（KMS, CloudTrail, CloudWatch等）を横配置"""
        sx = start_x
        sy = start_y + 20
        for node in nodes:
            node.position.x = sx
            node.position.y = sy
            node.size.width = SUPPORT_SERVICE_ICON_W
            node.size.height = SUPPORT_SERVICE_ICON_H
            sx += SUPPORT_SERVICE_GAP
