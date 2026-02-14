"""
layout_engine.py: DiagramState → 座標計算

DiagramState の各ノードに position (x, y) と size (width, height) を
ピクセル単位で付与する。座標系は左上原点。

レイアウトアルゴリズム (v2: データフロー順配置):
1. データフロー方向（左→右）: 外部 → エッジサービス → ALB → EC2 → RDS
2. VPC → AZ → Subnet の階層を上から下にネスト配置
3. Subnet を tier (Public / Private / Isolated) で左→右に列配置
4. Subnet 内のリソースを接続関係に沿ってフロー配置
5. VPC外サービスをデータフロー順に左側に配置
6. 矢印の交差を最小化するため接続先の近くに配置

Version: 2.0.0
Last Updated: 2026-02-14
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
AZ_GAP = 24
AZ_PADDING = 12
AZ_HEADER_H = 28

# Subnet
SUBNET_GAP = 20
SUBNET_PADDING = 14
SUBNET_HEADER_H = 24
SUBNET_MIN_W = 200
SUBNET_MIN_H = 120

# リソースアイコン
ICON_W = 64
ICON_H = 64
ICON_GAP = 24           # v2: アイコン間隔を広げて矢印の余地を確保
ICON_COLS_PER_SUBNET = 3

# VPC 外サービス配置（データフロー順: 左側に縦並び）
EDGE_SERVICE_GAP = 90
EDGE_SERVICE_ICON_W = 72
EDGE_SERVICE_ICON_H = 72

# VPC外→VPC間の水平マージン
VPC_LEFT_MARGIN = 160

# VPC内サービス（IGW, NAT, ALB等）
VPC_SERVICE_ICON_W = 56
VPC_SERVICE_ICON_H = 56
VPC_SERVICE_GAP = 100          # v2.1: ラベル重なり防止のため拡大

# AWS Cloud コンテナ
CLOUD_PADDING = 30
CLOUD_HEADER_H = 40


# ============================================================
# データフロー優先順位（左→右方向の配置順序）
# ============================================================

# VPC外: 左端から順に配置するサービスの優先度
EDGE_SERVICE_ORDER = {
    "waf": 0,
    "cloudfront": 1,
    "route53": 2,
    "api-gateway": 3,
}

# VPC内サービス: データフロー順（左→右）
VPC_SERVICE_ORDER = {
    "igw": 0,
    "nat-gateway": 1,
    "alb": 2,
    "vpc-endpoint": 3,
    "vpc-peering": 4,
    "auto-scaling": 5,
    "elastic-beanstalk": 6,
    "ecs": 7,
    "eks": 8,
    "elasticache": 9,
    "redshift": 10,
}


# ============================================================
# LayoutEngine
# ============================================================

class LayoutEngine:
    """DiagramState にピクセル座標を付与する。

    v2: データフロー順配置 + 接続関係考慮レイアウト

    使い方:
        engine = LayoutEngine()
        state = engine.calculate(state)  # position/size が設定される
    """

    def calculate(self, state: DiagramState) -> DiagramState:
        """DiagramState の全ノードに座標を計算して設定する。"""
        # エッジ情報を構築（接続関係ソート用）
        self._edges = state.edges

        # AWS Cloud ノードを取得
        cloud_node = None
        for node in state.nodes.values():
            if node.type == "aws-cloud":
                cloud_node = node
                break

        # ノードを種別ごとに分類
        vpcs = []
        edge_services = []    # route53, cloudfront, api-gateway, waf
        data_services = []    # lambda, dynamodb, sqs, sns, s3
        support_services = [] # kms, cloudtrail, cloudwatch

        edge_types = {"route53", "cloudfront", "api-gateway", "waf", "acm"}
        data_types = {"lambda", "dynamodb", "sqs", "sns", "s3"}
        support_types = {"kms", "cloudtrail", "cloudwatch"}

        cloud_id = cloud_node.id if cloud_node else None

        for node in state.nodes.values():
            if node.type == "aws-cloud":
                continue
            elif node.type == "vpc":
                vpcs.append(node)
            elif node.type in edge_types and (node.parent_id is None or node.parent_id == cloud_id):
                edge_services.append(node)
            elif node.type in data_types and (node.parent_id is None or node.parent_id == cloud_id):
                data_services.append(node)
            elif node.type in support_types and (node.parent_id is None or node.parent_id == cloud_id):
                support_services.append(node)
            # VPC内のサービス（ecs, eks等）はVPC直下の子として処理

        # データフロー順にソート
        edge_services.sort(key=lambda n: EDGE_SERVICE_ORDER.get(n.type, 99))

        # Cloud の内側パディングを考慮した開始位置
        cloud_offset_x = CLOUD_PADDING if cloud_node else 0
        cloud_offset_y = (CLOUD_PADDING + CLOUD_HEADER_H) if cloud_node else 0

        # VPC の配置開始位置
        vpc_start_x = CANVAS_PADDING + VPC_LEFT_MARGIN + cloud_offset_x
        vpc_start_y = CANVAS_PADDING + cloud_offset_y
        current_y = vpc_start_y

        for vpc_node in vpcs:
            vpc_bottom = self._layout_vpc(state, vpc_node, vpc_start_x, current_y)
            current_y = vpc_bottom + 40

        # エッジサービス（VPC 左側、データフロー順に縦並び）
        # VPC の縦方向中央にセンタリング
        vpc_mid_y = vpc_start_y
        if vpcs:
            vpc_total_h = current_y - 40 - vpc_start_y
            vpc_mid_y = vpc_start_y + vpc_total_h / 2
        self._layout_edge_services(edge_services, vpc_mid_y, cloud_offset_x)

        # データパスサービス（VPC 下部、横並び）
        self._layout_data_services(data_services, vpc_start_x, current_y)

        # サポートサービス（VPC 右側、縦並び）
        vpc_right_x = vpc_start_x + VPC_MIN_W
        if vpcs:
            vpc_right_x = max(vpc_right_x, vpcs[0].position.x + vpcs[0].size.width)
        self._layout_support_services(support_services, vpc_right_x + 30, vpc_start_y)

        # AWS Cloud コンテナのサイズを全子要素から計算
        if cloud_node:
            self._layout_cloud(state, cloud_node)

        return state

    # ----------------------------------------------------------------
    # AWS Cloud レイアウト
    # ----------------------------------------------------------------

    def _layout_cloud(self, state: DiagramState, cloud_node) -> None:
        """AWS Cloud コンテナの位置・サイズを全子要素のバウンディングボックスから計算"""
        min_x = float("inf")
        min_y = float("inf")
        max_x = float("-inf")
        max_y = float("-inf")

        for node in state.nodes.values():
            if node.id == cloud_node.id:
                continue
            if node.size.width == 0 and node.size.height == 0:
                continue
            nx = node.position.x
            ny = node.position.y
            nw = node.size.width
            nh = node.size.height
            min_x = min(min_x, nx)
            min_y = min(min_y, ny)
            max_x = max(max_x, nx + nw)
            max_y = max(max_y, ny + nh)

        if min_x == float("inf"):
            cloud_node.position.x = CANVAS_PADDING
            cloud_node.position.y = CANVAS_PADDING
            cloud_node.size.width = 400
            cloud_node.size.height = 300
            return

        cloud_node.position.x = min_x - CLOUD_PADDING
        cloud_node.position.y = min_y - CLOUD_PADDING - CLOUD_HEADER_H
        cloud_node.size.width = (max_x - min_x) + 2 * CLOUD_PADDING
        cloud_node.size.height = (max_y - min_y) + 2 * CLOUD_PADDING + CLOUD_HEADER_H

    # ----------------------------------------------------------------
    # VPC レイアウト
    # ----------------------------------------------------------------

    def _layout_vpc(
        self, state: DiagramState, vpc_node, x: float, y: float
    ) -> float:
        """VPC とその内部要素をレイアウトし、VPC の下端 Y を返す。"""
        vpc_id = vpc_node.id

        az_nodes = [
            n for n in state.nodes.values()
            if n.parent_id == vpc_id and n.type == "az"
        ]
        # VPC直下のサービスノード（IGW, NAT, ALB, VPC-Peering等）
        vpc_children = [
            n for n in state.nodes.values()
            if n.parent_id == vpc_id and n.type not in ("az", "subnet")
        ]

        # AZ をソート（名前順）
        az_nodes.sort(key=lambda n: n.label)

        # 各 AZ の高さを計算（コンテンツ駆動）
        az_heights = []
        az_contents = []

        for az_node in az_nodes:
            subnets = [
                n for n in state.nodes.values()
                if n.parent_id == az_node.id and n.type == "subnet"
            ]
            # tier でソート: Public → Private → Isolated（左→右 = データフロー順）
            tier_order = {"Public": 0, "Private": 1, "Isolated": 2}
            subnets.sort(key=lambda s: (
                tier_order.get(s.metadata.get("tier", "Private"), 1),
                s.label,
            ))

            max_subnet_h = SUBNET_MIN_H
            for subnet_node in subnets:
                children = [
                    n for n in state.nodes.values()
                    if n.parent_id == subnet_node.id
                    and n.type != "nat-gateway"  # 境界配置のため行数から除外
                ]
                rows = max(1, (len(children) + ICON_COLS_PER_SUBNET - 1)
                           // ICON_COLS_PER_SUBNET)
                h = SUBNET_HEADER_H + SUBNET_PADDING + rows * (ICON_H + ICON_GAP) + SUBNET_PADDING
                max_subnet_h = max(max_subnet_h, h)

            n_subnets = max(len(subnets), 1)
            az_h = (AZ_HEADER_H + AZ_PADDING
                    + max_subnet_h
                    + AZ_PADDING)
            az_heights.append(az_h)
            az_contents.append((az_node, subnets))

        # VPC内サービスの高さ分を確保
        vpc_service_h = VPC_SERVICE_ICON_H + 28 if vpc_children else 0  # v2.1: ラベル用余白追加

        # VPC サイズ計算
        n_az = max(len(az_nodes), 1)
        total_az_h = sum(az_heights) + AZ_GAP * (n_az - 1) if az_heights else 200
        vpc_content_h = VPC_HEADER_H + VPC_PADDING + vpc_service_h + total_az_h + VPC_PADDING

        all_tiers = set()
        for _, subnets in az_contents:
            for s in subnets:
                all_tiers.add(s.metadata.get("tier", "Private"))
        n_tiers = max(len(all_tiers), 1)
        subnet_row_w = n_tiers * (SUBNET_MIN_W + SUBNET_GAP) + 2 * VPC_PADDING + 40
        # VPC内サービス行の幅も考慮
        svc_row_w = len(vpc_children) * VPC_SERVICE_GAP + 2 * VPC_PADDING + 40 if vpc_children else 0
        vpc_w = max(VPC_MIN_W, subnet_row_w, svc_row_w)
        vpc_h = max(VPC_MIN_H, vpc_content_h)

        vpc_node.position.x = x
        vpc_node.position.y = y
        vpc_node.size.width = vpc_w
        vpc_node.size.height = vpc_h

        # VPC 内サービス配置（VPC上部にデータフロー順で横並び）
        service_y = y + VPC_HEADER_H + 8
        self._layout_vpc_services(vpc_children, x, service_y, vpc_w)

        # AZ 配置（サービス行の下から）
        az_y = y + VPC_HEADER_H + VPC_PADDING + vpc_service_h
        for i, (az_node, subnets) in enumerate(az_contents):
            az_h = az_heights[i]
            az_x = x + VPC_PADDING
            az_w = vpc_w - 2 * VPC_PADDING

            az_node.position.x = az_x
            az_node.position.y = az_y
            az_node.size.width = az_w
            az_node.size.height = az_h

            # Subnet 配置（横並び、tier 別 = データフロー順: Public→Private→Isolated）
            self._layout_subnets(state, subnets, az_x, az_y, az_w, az_h)

            az_y += az_h + AZ_GAP

        return y + vpc_h

    def _layout_subnets(
        self, state: DiagramState, subnets: list,
        az_x: float, az_y: float, az_w: float, az_h: float,
    ) -> None:
        """AZ 内の Subnet をデータフロー順（Public→Private→Isolated）で横並びに配置"""
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

            # Subnet 内のリソースを分類
            children = [
                nd for nd in state.nodes.values()
                if nd.parent_id == subnet_node.id
            ]
            # NAT Gateway は通常フローから除外 → 境界配置
            gw_nodes = [nd for nd in children if nd.type == "nat-gateway"]
            normal_children = [nd for nd in children if nd.type != "nat-gateway"]

            # 通常リソースを接続関係順でフロー配置
            self._layout_icons_flow(
                state, normal_children,
                sx + SUBNET_PADDING,
                sy + SUBNET_HEADER_H + SUBNET_PADDING,
                subnet_w - 2 * SUBNET_PADDING,
            )

            # NAT Gateway を Subnet 右端境界にまたがる位置に配置
            for i, gw in enumerate(gw_nodes):
                gw.size.width = VPC_SERVICE_ICON_W
                gw.size.height = VPC_SERVICE_ICON_H
                gw.position.x = sx + subnet_w - VPC_SERVICE_ICON_W // 2
                gw.position.y = sy + SUBNET_HEADER_H + SUBNET_PADDING + i * (VPC_SERVICE_ICON_H + 8)

            sx += subnet_w + SUBNET_GAP

    def _layout_icons_flow(
        self, state: DiagramState, nodes: list,
        start_x: float, start_y: float, avail_w: float,
    ) -> None:
        """ノードを接続関係に基づくフロー配置（接続元→接続先の順で左上から）"""
        if not nodes:
            return

        node_ids = {n.id for n in nodes}

        # 接続関係からトポロジカルソート的に並べ替え
        # 入次数（他から矢印が来る数）が少ないノードを先に配置
        in_degree = {n.id: 0 for n in nodes}
        out_edges = {n.id: [] for n in nodes}

        for edge in self._edges.values():
            if edge.source_node_id in node_ids and edge.target_node_id in node_ids:
                in_degree[edge.target_node_id] = in_degree.get(edge.target_node_id, 0) + 1
                out_edges[edge.source_node_id].append(edge.target_node_id)

        # BFS 的にソート（入次数0から始める）
        sorted_ids = []
        queue = [nid for nid, deg in in_degree.items() if deg == 0]
        # 入次数0が無い場合は全ノードをキューに
        if not queue:
            queue = [n.id for n in nodes]

        visited = set()
        while queue:
            nid = queue.pop(0)
            if nid in visited:
                continue
            visited.add(nid)
            sorted_ids.append(nid)
            for target in out_edges.get(nid, []):
                if target not in visited:
                    queue.append(target)

        # 未訪問ノードを追加
        for n in nodes:
            if n.id not in visited:
                sorted_ids.append(n.id)

        node_map = {n.id: n for n in nodes}
        sorted_nodes = [node_map[nid] for nid in sorted_ids if nid in node_map]

        # グリッド配置（ソート済みの順番で）
        cols = max(1, int(avail_w / (ICON_W + ICON_GAP)))
        cols = min(cols, ICON_COLS_PER_SUBNET)
        for i, node in enumerate(sorted_nodes):
            col = i % cols
            row = i // cols
            node.position.x = start_x + col * (ICON_W + ICON_GAP)
            node.position.y = start_y + row * (ICON_H + ICON_GAP)
            node.size.width = ICON_W
            node.size.height = ICON_H

    def _layout_vpc_services(
        self, nodes: list, vpc_x: float, service_y: float, vpc_w: float,
    ) -> None:
        """VPC直下のサービスノード（IGW, ALB等）をデータフロー順に配置

        IGW: VPC左端境界（VPCの出入口を表現）
        NAT Gateway: Subnet に所属する場合は _layout_subnets で境界配置されるため除外
        その他: VPC内上部にデータフロー順で横並び
        """
        # NAT Gateway は Subnet 境界配置に移動したため除外
        # （parent_id が VPC 直下のままの NAT GW は残す）
        nodes = [n for n in nodes if n.type != "nat-gateway"]

        # データフロー順にソート
        nodes.sort(key=lambda n: VPC_SERVICE_ORDER.get(n.type, 99))

        # IGW は VPC 左端境界に配置（入口を視覚的に表現）
        igw_nodes = [n for n in nodes if n.type == "igw"]
        other = [n for n in nodes if n.type != "igw"]

        for i, node in enumerate(igw_nodes):
            node.position.x = vpc_x - VPC_SERVICE_ICON_W // 2
            node.position.y = service_y + i * (VPC_SERVICE_ICON_H + 8)
            node.size.width = VPC_SERVICE_ICON_W
            node.size.height = VPC_SERVICE_ICON_H

        # 他のサービスは VPC 内上部にデータフロー順で横並び
        # 中央揃え
        total_w = len(other) * VPC_SERVICE_GAP - (VPC_SERVICE_GAP - VPC_SERVICE_ICON_W) if other else 0
        sx = vpc_x + (vpc_w - total_w) / 2 if total_w < vpc_w else vpc_x + VPC_PADDING
        for node in other:
            node.position.x = sx
            node.position.y = service_y
            node.size.width = VPC_SERVICE_ICON_W
            node.size.height = VPC_SERVICE_ICON_H
            sx += VPC_SERVICE_GAP

    # ----------------------------------------------------------------
    # VPC 外サービス
    # ----------------------------------------------------------------

    def _layout_edge_services(
        self, nodes: list, vpc_mid_y: float, cloud_offset_x: float,
    ) -> None:
        """エッジサービス（Route53, CloudFront, WAF, API GW）を VPC 左側にセンタリング縦配置"""
        if not nodes:
            return

        total_h = len(nodes) * EDGE_SERVICE_GAP - (EDGE_SERVICE_GAP - EDGE_SERVICE_ICON_H)
        start_y = vpc_mid_y - total_h / 2
        sx = CANVAS_PADDING + cloud_offset_x

        for i, node in enumerate(nodes):
            node.position.x = sx
            node.position.y = start_y + i * EDGE_SERVICE_GAP
            node.size.width = EDGE_SERVICE_ICON_W
            node.size.height = EDGE_SERVICE_ICON_H

    def _layout_data_services(
        self, nodes: list, start_x: float, start_y: float,
    ) -> None:
        """データパスサービス（Lambda, DynamoDB, SQS, SNS, S3）を VPC 下に横配置"""
        sx = start_x
        sy = start_y + 24
        for node in nodes:
            node.position.x = sx
            node.position.y = sy
            node.size.width = ICON_W
            node.size.height = ICON_H
            sx += ICON_W + ICON_GAP * 2

    def _layout_support_services(
        self, nodes: list, start_x: float, start_y: float,
    ) -> None:
        """サポートサービス（KMS, CloudTrail, CloudWatch）を VPC 右側に縦配置"""
        sy = start_y + 40
        for node in nodes:
            node.position.x = start_x
            node.position.y = sy
            node.size.width = 48
            node.size.height = 48
            sy += 60
