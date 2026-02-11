"""
generate_diagram_v2.py: AWS Config JSON -> AWS-style Network Diagram (pptx)

Generates a diagram matching AWS Architecture diagram style with:
- AWS official icons (PNG) for 30+ service types
- Horizontal AZ rows (AZ-A top, AZ-C bottom)
- Subnet columns: Public | Private | Private(Isolated/RDS)
- TCP(port) arrow labels on connections
- External actors (Internet, End User) and edge services (Route53, CloudFront, API GW)
- VPC-external services row (ACM, WAF, KMS, CloudTrail, CloudWatch)
- Serverless services row (Lambda, DynamoDB, SQS, SNS, S3)
- Same-AZ arrows preferred; cross-AZ arrows minimized

Usage:
    python generate_diagram_v2.py tabelog_aws_config.json

Version: 3.0.0
Last Updated: 2026-02-11
"""

import json
import sys
import os
from collections import defaultdict

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from lxml import etree

from generate_diagram import AWSConfigParser

# ============================================================
# Icon paths
# ============================================================
ICON_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")

ICONS = {}
_ICON_NAMES = [
    # Existing
    "internet", "users", "client", "ec2", "rds", "alb", "igw", "nat",
    "waf", "acm", "s3", "s3_bucket", "vpc_endpoint", "vpc_icon",
    "region", "aws_cloud", "public_subnet", "private_subnet",
    # New
    "lambda", "ecs", "eks", "autoscaling", "cloudfront", "apigateway",
    "route53", "dynamodb", "elasticache", "redshift", "sqs", "sns",
    "kms", "cloudtrail", "cloudwatch", "elasticbeanstalk",
]
for name in _ICON_NAMES:
    path = os.path.join(ICON_DIR, f"{name}.png")
    if os.path.exists(path):
        ICONS[name] = path


# ============================================================
# Colors
# ============================================================
class C:
    CLOUD_BG = RGBColor(0xF5, 0xF5, 0xF5)
    CLOUD_BD = RGBColor(0x9A, 0x9A, 0x9A)
    VPC_BG   = RGBColor(0xF0, 0xF7, 0xF0)
    VPC_BD   = RGBColor(0x1A, 0x8C, 0x1A)

    PUB_BG   = RGBColor(0xE8, 0xF5, 0xE2)
    PUB_BD   = RGBColor(0x24, 0x8F, 0x24)
    PRIV_BG  = RGBColor(0xE3, 0xED, 0xF7)
    PRIV_BD  = RGBColor(0x14, 0x7E, 0xBA)

    ARROW_INET = RGBColor(0x00, 0x73, 0xBB)
    ARROW_AWS  = RGBColor(0xED, 0x7D, 0x1C)
    ARROW_GRAY = RGBColor(0x88, 0x88, 0x88)

    TEXT   = RGBColor(0x33, 0x33, 0x33)
    TEXT_G = RGBColor(0x77, 0x77, 0x77)
    WHITE  = RGBColor(0xFF, 0xFF, 0xFF)


# ============================================================
# V2 Generator (v3.0 - multi-service support)
# ============================================================
class DiagramV2:
    def __init__(self, parser: AWSConfigParser):
        self.p = parser
        self.prs = Presentation()
        self.prs.slide_width = Inches(16)
        self.prs.slide_height = Inches(9)
        self.pos = {}       # key -> (cx, cy) center of icon

    def generate(self, out):
        vpcs = self.p.get_vpcs()
        if not vpcs:
            print("No VPCs found")
            return
        # Skip default VPC, prefer user-created VPCs
        target = vpcs[0]
        for v in vpcs:
            if not v.get("is_default", False):
                target = v
                break
        self._build(target)
        self.prs.save(out)
        print(f"Saved: {out}")

    # ==========================================================
    # Main build
    # ==========================================================
    def _build(self, vpc):
        sl = self.prs.slides.add_slide(self.prs.slide_layouts[6])

        # ---- Gather all resources ----
        subs = self.p.get_subnets_for_vpc(vpc["id"])
        igw = self.p.get_igw_for_vpc(vpc["id"])
        nats = self.p.get_nat_gateways_for_vpc(vpc["id"])
        albs = self.p.get_albs_for_vpc(vpc["id"])
        rdss = self.p.get_rds_for_vpc(vpc["id"])
        s3s = self.p.get_s3_buckets()
        sg_conns = self.p.get_sg_connections()

        # New services
        lambdas = self.p.get_lambda_functions()
        ecs_services = self.p.get_ecs_services()
        eks_clusters = self.p.get_eks_clusters()
        cf_dists = self.p.get_cloudfront_distributions()
        api_gws = self.p.get_api_gateways()
        r53_zones = self.p.get_route53_hosted_zones()
        dynamo_tables = self.p.get_dynamodb_tables()
        cache_clusters = self.p.get_elasticache_clusters()
        rs_clusters = self.p.get_redshift_clusters()
        sqs_queues = self.p.get_sqs_queues()
        sns_topics = self.p.get_sns_topics()
        kms_keys = self.p.get_kms_keys()
        ct_trails = self.p.get_cloudtrail_trails()
        cw_alarms = self.p.get_cloudwatch_alarms()
        svc_conns = self.p.get_service_connections()

        waf = None
        for a in albs:
            waf = self.p.get_waf_for_alb(a["id"])
            if waf:
                break

        # Separate Lambda: VPC-attached vs serverless
        lambdas_vpc = [l for l in lambdas if l.get("in_vpc")]
        lambdas_serverless = [l for l in lambdas if not l.get("in_vpc")]

        azs = sorted(set(s["az"] for s in subs if s["az"]))[:2]
        tiers = defaultdict(lambda: defaultdict(list))
        for s in subs:
            tiers[s["tier"]][s["az"]].append(s)

        # ---- Detect what edge/bottom services exist ----
        has_edge = bool(r53_zones or cf_dists or api_gws)

        infra_items = []
        infra_items.append(("acm", "AWS Certificate\nManager", "acm"))
        if waf:
            infra_items.append(("waf", "AWS WAF", "waf"))
        infra_items.append(("vpc_endpoint", "VPC Endpoint", "vpc_ep"))
        if kms_keys:
            infra_items.append(("kms", "AWS KMS", "kms"))
        if ct_trails:
            infra_items.append(("cloudtrail", "CloudTrail", "cloudtrail"))
        if cw_alarms:
            infra_items.append(("cloudwatch", "CloudWatch", "cloudwatch"))

        svless_items = []
        if lambdas_serverless:
            svless_items.append(("lambda", "Lambda", "lambda_svless"))
        if dynamo_tables:
            svless_items.append(("dynamodb", "DynamoDB", "dynamodb"))
        if sqs_queues:
            svless_items.append(("sqs", "Amazon SQS", "sqs"))
        if sns_topics:
            svless_items.append(("sns", "Amazon SNS", "sns"))
        if s3s:
            svless_items.append(("s3_bucket", "Amazon S3", "s3"))

        has_svless = bool(svless_items)

        # ===== LAYOUT CONSTANTS =====
        left_margin = Inches(2.5) if has_edge else Inches(1.5)

        # AWS Cloud box
        cx, cy = left_margin, Inches(0.35)
        cw = Inches(16) - left_margin - Inches(0.3)
        ch = Inches(8.3)

        # Bottom rows height calculation
        bottom_rows = 1  # infra row always
        if has_svless:
            bottom_rows = 2
        bottom_h = Inches(0.7) * bottom_rows + Inches(0.2)

        # VPC box (inside Cloud, leave room below for VPC-external services)
        vx = cx + Inches(0.2)
        vy = cy + Inches(0.65)
        vw = cw - Inches(0.4)
        vh = ch - Inches(0.45) - bottom_h

        # AZ row heights
        az_gap = Inches(0.25)
        az_content_h = vh - Inches(0.5) - az_gap
        az_h = az_content_h / 2
        az_a_y = vy + Inches(0.45)
        az_c_y = az_a_y + az_h + az_gap

        # Subnet column positions (inside VPC)
        col_margin = Inches(0.15)
        col_gap = Inches(0.15)

        pub_w = Inches(3.8)
        priv_w = Inches(4.0)
        iso_w = vw - pub_w - priv_w - col_margin * 2 - col_gap * 2

        pub_x = vx + col_margin
        priv_x = pub_x + pub_w + col_gap
        iso_x = priv_x + priv_w + col_gap

        # ===== DRAW STRUCTURE =====
        # Title
        self._txt(sl, Inches(0.2), Inches(0.05), Inches(6), Inches(0.3),
                  "AWS Network Architecture", 14, True)

        # AWS Cloud
        self._box(sl, cx, cy, cw, ch, C.CLOUD_BG, C.CLOUD_BD)
        self._ilabel(sl, cx + Inches(0.08), cy + Inches(0.05), "aws_cloud",
                     "AWS Cloud", 9, True)
        self._ilabel(sl, cx + Inches(0.08), cy + Inches(0.28), "region",
                     f"Region: {vpc['region']}", 8, color=C.TEXT_G)

        # VPC
        self._box(sl, vx, vy, vw, vh, C.VPC_BG, C.VPC_BD, Pt(2))
        self._ilabel(sl, vx + Inches(0.08), vy + Inches(0.05), "vpc_icon",
                     f"VPC  {vpc['cidr']}", 9, True, color=C.VPC_BD)

        # ===== AZ ROWS =====
        for ai, az in enumerate(azs):
            row_y = az_a_y if ai == 0 else az_c_y
            az_short = az.split("-")[-1].upper() if "-" in az else az.upper()

            self._txt(sl, vx + Inches(0.08), row_y + Inches(0.02),
                      Inches(3.5), Inches(0.2),
                      f"Availability Zone {az_short}", 8, True, C.TEXT_G)

            sub_y = row_y + Inches(0.22)
            sub_h = az_h - Inches(0.27)

            # --- Public Subnet ---
            ps = tiers.get("Public", {}).get(az, [])
            if ps:
                sub = ps[0]
                self._box(sl, pub_x, sub_y, pub_w, sub_h, C.PUB_BG, C.PUB_BD)
                self._ilabel(sl, pub_x + Inches(0.05), sub_y + Inches(0.03),
                             "public_subnet",
                             f"Public subnet  {sub['cidr']}", 7, color=C.PUB_BD)

                icon_y = int(sub_y + sub_h / 2 - Inches(0.35))

                # NAT Gateway (AZ-A only)
                if ai == 0:
                    for nat in nats:
                        if nat["subnet_id"] == sub["id"]:
                            self._ibox(sl, int(pub_x + Inches(0.25)), icon_y,
                                       "nat", f"NAT Gateway\n{nat['public_ip']}",
                                       f"nat_{nat['id']}")

                # EC2 instances in Public subnet
                insts = self.p.get_instances_for_subnet(sub["id"])
                for idx, inst in enumerate(insts):
                    x_off = Inches(1.8) + idx * Inches(1.2)
                    self._ibox(sl, int(pub_x + x_off), icon_y,
                               "ec2", f"EC2\n{inst['name']}",
                               f"ec2_{inst['id']}")

            # --- Private Subnet ---
            pvs = tiers.get("Private", {}).get(az, [])
            if pvs:
                sub = pvs[0]
                self._box(sl, priv_x, sub_y, priv_w, sub_h, C.PRIV_BG, C.PRIV_BD)
                self._ilabel(sl, priv_x + Inches(0.05), sub_y + Inches(0.03),
                             "private_subnet",
                             f"Private subnet  {sub['cidr']}", 7, color=C.PRIV_BD)

                icon_y = int(sub_y + sub_h / 2 - Inches(0.35))
                x_cursor = Inches(0.5)

                # EC2 instances
                insts = self.p.get_instances_for_subnet(sub["id"])
                for idx, inst in enumerate(insts):
                    self._ibox(sl, int(priv_x + x_cursor), icon_y,
                               "ec2", f"EC2\n{inst['name']}",
                               f"ec2_{inst['id']}")
                    x_cursor += Inches(1.5)

                # ECS Services in this subnet
                for svc in ecs_services:
                    if sub["id"] in svc.get("subnet_ids", []):
                        self._ibox(sl, int(priv_x + x_cursor), icon_y,
                                   "ecs", f"ECS\n{svc['name']}",
                                   f"ecs_{svc['id']}")
                        x_cursor += Inches(1.5)

                # Lambda (VPC-attached) in this subnet
                for lf in lambdas_vpc:
                    if sub["id"] in lf.get("vpc_subnet_ids", []):
                        self._ibox(sl, int(priv_x + x_cursor), icon_y,
                                   "lambda", f"Lambda\n{lf['name'][:12]}",
                                   f"lambda_{lf['id']}")
                        x_cursor += Inches(1.5)

                # EKS in this subnet
                for ek in eks_clusters:
                    if sub["id"] in ek.get("subnet_ids", []):
                        self._ibox(sl, int(priv_x + x_cursor), icon_y,
                                   "eks", f"EKS\n{ek['name'][:12]}",
                                   f"eks_{ek['id']}")
                        x_cursor += Inches(1.5)

            # --- Isolated Subnet (RDS/ElastiCache/Redshift) ---
            isos = tiers.get("Isolated", {}).get(az, [])
            if isos:
                sub = isos[0]
                self._box(sl, iso_x, sub_y, iso_w, sub_h, C.PRIV_BG, C.PRIV_BD)
                self._ilabel(sl, iso_x + Inches(0.05), sub_y + Inches(0.03),
                             "private_subnet",
                             f"Private subnet  {sub['cidr']}", 7, color=C.PRIV_BD)

                icon_y = int(sub_y + sub_h / 2 - Inches(0.35))
                x_cursor = Inches(0.5)

                # RDS
                for db in rdss:
                    if sub["id"] in db["subnet_ids"]:
                        role = "(Primary)" if ai == 0 else "(Standby)"
                        self._ibox(sl, int(iso_x + x_cursor), icon_y,
                                   "rds", f"Amazon RDS\n{role}",
                                   f"rds_{db['id']}_{ai}")
                        x_cursor += Inches(1.6)

                # ElastiCache
                for cc in cache_clusters:
                    self._ibox(sl, int(iso_x + x_cursor), icon_y,
                               "elasticache", f"ElastiCache\n{cc['engine']}",
                               f"cache_{cc['id']}")
                    x_cursor += Inches(1.6)

                # Redshift
                for rc in rs_clusters:
                    self._ibox(sl, int(iso_x + x_cursor), icon_y,
                               "redshift", f"Redshift\n{rc['name'][:10]}",
                               f"redshift_{rc['id']}")
                    x_cursor += Inches(1.6)

        # ===== External actors (left of Cloud) =====
        ext_x = int(Inches(0.3))
        inet_y = int(az_a_y + az_h / 2 - Inches(0.24))
        user_y = int(az_c_y + az_h / 2 - Inches(0.24))

        # Edge services (Route53, CloudFront, API Gateway) above Internet
        if has_edge:
            edge_y = int(cy + Inches(0.1))
            edge_gap = Inches(0.85)
            edge_idx = 0

            if r53_zones:
                self._ibox(sl, ext_x, int(edge_y + edge_gap * edge_idx),
                           "route53", "Route 53", "route53", nobg=True)
                edge_idx += 1

            if cf_dists:
                self._ibox(sl, ext_x, int(edge_y + edge_gap * edge_idx),
                           "cloudfront", "CloudFront", "cloudfront", nobg=True)
                edge_idx += 1

            if api_gws:
                self._ibox(sl, ext_x, int(edge_y + edge_gap * edge_idx),
                           "apigateway", "API Gateway", "apigateway", nobg=True)
                edge_idx += 1

        self._ibox(sl, ext_x, inet_y,
                   "internet", "Internet", "inet", nobg=True)
        self._ibox(sl, ext_x, user_y,
                   "users", "End User", "user", nobg=True)

        # IGW (inside Cloud, left edge)
        if igw:
            igw_y = int((inet_y + user_y) / 2)
            self._ibox(sl, int(cx + Inches(0.15)), igw_y,
                       "igw", "Internet\nGateway", f"igw_{igw['id']}")

        # ===== ALB (inside VPC left margin, centered between AZ rows) =====
        alb_y = int((az_a_y + az_h / 2 + az_c_y + az_h / 2) / 2 - Inches(0.24))
        for alb in albs:
            self._ibox(sl, int(vx + Inches(1.5)), alb_y,
                       "alb", "Elastic Load\nBalancing",
                       f"alb_{alb['id']}")

        # ===== VPC-external services (below VPC, inside Cloud) =====
        svc_base_y = int(vy + vh + Inches(0.1))

        # Row 1: Infrastructure services
        if infra_items:
            svc_gap = (cw - Inches(0.4)) / max(len(infra_items), 1)
            for idx, (icon, label, key) in enumerate(infra_items):
                self._ibox(sl, int(vx + Inches(0.2) + svc_gap * idx), svc_base_y,
                           icon, label, key, nobg=True)

        # Row 2: Serverless services
        if has_svless:
            svless_y = svc_base_y + int(Inches(0.7))
            svc_gap = (cw - Inches(0.4)) / max(len(svless_items), 1)
            for idx, (icon, label, key) in enumerate(svless_items):
                self._ibox(sl, int(vx + Inches(0.2) + svc_gap * idx), svless_y,
                           icon, label, key, nobg=True)

        # ===== Legend =====
        self._legend(sl, Inches(0.15), Inches(7.5))

        # ===== Arrows =====
        self._draw_arrows(sl, albs, nats, rdss, igw, sg_conns, s3s, waf, azs,
                          cf_dists, api_gws, r53_zones, lambdas_serverless,
                          svc_conns)

    # ==========================================================
    # Arrow drawing - same-AZ preferred
    # ==========================================================
    def _draw_arrows(self, sl, albs, nats, rdss, igw, sg_conns, s3s, waf, azs,
                     cf_dists, api_gws, r53_zones, lambdas_svless, svc_conns):
        sg_map = self.p.build_sg_to_resources_map()
        drawn = set()

        # ---- Edge service chain ----
        # Route53 -> CloudFront -> ALB/IGW
        if "route53" in self.pos and "cloudfront" in self.pos:
            self._arr(sl, "route53", "cloudfront", C.ARROW_INET, "DNS")
        elif "route53" in self.pos:
            # Route53 -> ALB or IGW
            for alb in albs:
                ak = f"alb_{alb['id']}"
                if ak in self.pos:
                    self._arr(sl, "route53", ak, C.ARROW_INET, "DNS")
                    break
            else:
                if igw:
                    igw_key = f"igw_{igw['id']}"
                    if igw_key in self.pos:
                        self._arr(sl, "route53", igw_key, C.ARROW_INET, "DNS")

        if "cloudfront" in self.pos:
            # CloudFront -> ALB or IGW
            for alb in albs:
                ak = f"alb_{alb['id']}"
                if ak in self.pos:
                    self._arr(sl, "cloudfront", ak, C.ARROW_INET, "HTTPS")
                    break
            else:
                if igw:
                    igw_key = f"igw_{igw['id']}"
                    if igw_key in self.pos:
                        self._arr(sl, "cloudfront", igw_key, C.ARROW_INET, "HTTPS")

        # API Gateway -> Lambda (serverless) or ALB
        if "apigateway" in self.pos:
            if "lambda_svless" in self.pos:
                self._arr(sl, "apigateway", "lambda_svless", C.ARROW_AWS, "invoke")
            else:
                for alb in albs:
                    ak = f"alb_{alb['id']}"
                    if ak in self.pos:
                        self._arr(sl, "apigateway", ak, C.ARROW_AWS, "HTTP")
                        break

        # ---- Internet/User -> IGW -> ALB ----
        if igw:
            igw_key = f"igw_{igw['id']}"
            if igw_key in self.pos:
                # Only draw Internet->IGW if no edge services connected
                if "cloudfront" not in self.pos and "route53" not in self.pos:
                    self._arr(sl, "inet", igw_key, C.ARROW_INET, "HTTPS")
                    self._arr(sl, "user", igw_key, C.ARROW_INET, "HTTPS")
                else:
                    self._arr(sl, "inet", igw_key, C.ARROW_INET, "HTTPS")
                    self._arr(sl, "user", igw_key, C.ARROW_INET, "HTTPS")

                # IGW -> ALB
                for alb in albs:
                    alb_key = f"alb_{alb['id']}"
                    if alb_key in self.pos:
                        self._arr(sl, igw_key, alb_key, C.ARROW_INET, "TCP(80,443)")

        # ---- SG-based internal connections ----
        for conn in sg_conns:
            frs = sg_map.get(conn["from_sg"], [])
            trs = sg_map.get(conn["to_sg"], [])
            port = conn.get("port", "")
            proto = conn.get("protocol", "tcp").upper()
            label = f"{proto}({port})" if port else ""

            fr_by_az = self._group_by_az(frs)
            tr_by_az = self._group_by_az(trs)

            # Same-AZ connections
            for az_suffix, az_frs in fr_by_az.items():
                if az_suffix == "_global":
                    continue
                az_trs = tr_by_az.get(az_suffix, [])
                for fr in az_frs:
                    for tr in az_trs:
                        fk = self._resolve_key(f"{fr['prefix']}{fr['id']}")
                        tk = self._resolve_key(f"{tr['prefix']}{tr['id']}")
                        if not fk or not tk:
                            continue
                        aid = f"{fk}->{tk}"
                        if aid not in drawn:
                            drawn.add(aid)
                            self._arr(sl, fk, tk, C.ARROW_AWS, label)

            # Global resources (ALB) -> all targets
            for fr in fr_by_az.get("_global", []):
                fk = self._resolve_key(f"{fr['prefix']}{fr['id']}")
                if not fk:
                    continue
                for tr in trs:
                    tk = self._resolve_key(f"{tr['prefix']}{tr['id']}")
                    if not tk:
                        continue
                    aid = f"{fk}->{tk}"
                    if aid not in drawn:
                        drawn.add(aid)
                        self._arr(sl, fk, tk, C.ARROW_AWS, label)

            # Source EC2/ECS/Lambda -> Global target (RDS with suffixes)
            for az_suffix, az_frs in fr_by_az.items():
                if az_suffix == "_global":
                    continue
                for fr in az_frs:
                    fk = self._resolve_key(f"{fr['prefix']}{fr['id']}")
                    if not fk:
                        continue
                    for tr in tr_by_az.get("_global", []):
                        if tr['type'] == 'RDS':
                            rds_suffix = "_0" if az_suffix.endswith("a") else "_1"
                            tk = f"{tr['prefix']}{tr['id']}{rds_suffix}"
                            if tk in self.pos:
                                aid = f"{fk}->{tk}"
                                if aid not in drawn:
                                    drawn.add(aid)
                                    self._arr(sl, fk, tk, C.ARROW_AWS, label)
                        else:
                            # ElastiCache, Redshift etc.
                            tk = self._resolve_key(f"{tr['prefix']}{tr['id']}")
                            if tk:
                                aid = f"{fk}->{tk}"
                                if aid not in drawn:
                                    drawn.add(aid)
                                    self._arr(sl, fk, tk, C.ARROW_AWS, label)

        # ---- VPC Endpoints -> S3 ----
        if "vpc_ep" in self.pos and "s3" in self.pos:
            self._arr(sl, "vpc_ep", "s3", C.ARROW_AWS, "HTTPS(443)")

        # ---- ACM -> ALB ----
        if "acm" in self.pos:
            for alb in albs:
                alb_key = f"alb_{alb['id']}"
                if alb_key in self.pos:
                    self._arr(sl, "acm", alb_key, C.ARROW_AWS, "TLS")

        # ---- WAF -> ALB ----
        if waf:
            for alb in albs:
                alb_key = f"alb_{alb['id']}"
                if "waf" in self.pos and alb_key in self.pos:
                    self._arr(sl, "waf", alb_key, C.ARROW_AWS, "")

        # ---- Serverless Lambda -> DynamoDB/SQS/SNS ----
        if "lambda_svless" in self.pos:
            if "dynamodb" in self.pos:
                self._arr(sl, "lambda_svless", "dynamodb", C.ARROW_AWS, "")
            if "sqs" in self.pos:
                self._arr(sl, "lambda_svless", "sqs", C.ARROW_AWS, "")
            if "sns" in self.pos:
                self._arr(sl, "lambda_svless", "sns", C.ARROW_AWS, "")

        # ---- Service-level connections (non-SG based) ----
        for conn in svc_conns:
            ft = conn.get("from_type", "")
            fi = conn.get("from_id", "")
            tt = conn.get("to_type", "")
            ti = conn.get("to_id", "")
            label = conn.get("label", "")

            # Try to find matching position keys
            fk = self._find_pos_key(ft, fi)
            tk = self._find_pos_key(tt, ti)
            if fk and tk:
                aid = f"{fk}->{tk}"
                if aid not in drawn:
                    drawn.add(aid)
                    self._arr(sl, fk, tk, C.ARROW_GRAY, label)

    def _find_pos_key(self, svc_type, svc_id):
        """Find a position key for a service connection."""
        # Direct key match
        if svc_type in self.pos:
            return svc_type
        # Try prefixed key
        candidates = [
            f"{svc_type}_{svc_id}",
            svc_type,
            svc_id,
        ]
        for c in candidates:
            if c in self.pos:
                return c
        return None

    def _group_by_az(self, resources):
        """Group resources by AZ suffix (e.g., '1a', '1c') from their name."""
        groups = defaultdict(list)
        for r in resources:
            name = r.get("name", "")
            az_suffix = None
            for part in name.split("-"):
                if len(part) == 2 and part[0].isdigit() and part[1].isalpha():
                    az_suffix = part
                    break
            if az_suffix:
                groups[az_suffix].append(r)
            else:
                groups["_global"].append(r)
        return groups

    def _resolve_key(self, key):
        if key in self.pos:
            return key
        for s in ["_0", "_1"]:
            if key + s in self.pos:
                return key + s
        return None

    # ==========================================================
    # Primitives
    # ==========================================================
    def _box(self, sl, x, y, w, h, fill, border, bw=Pt(1), r=0.015):
        s = sl.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                int(x), int(y), int(w), int(h))
        s.fill.solid()
        s.fill.fore_color.rgb = fill
        s.line.color.rgb = border
        s.line.width = bw
        s.adjustments[0] = r
        s.text_frame.clear()
        return s

    def _txt(self, sl, x, y, w, h, text, sz=10, bold=False, color=None,
             align=PP_ALIGN.LEFT):
        tb = sl.shapes.add_textbox(int(x), int(y), int(w), int(h))
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = text
        p.font.size = Pt(sz)
        p.font.bold = bold
        p.font.color.rgb = color or C.TEXT
        p.alignment = align
        p.space_before = Pt(0)
        p.space_after = Pt(0)
        return tb

    def _ilabel(self, sl, x, y, icon, text, sz=8, bold=False, color=None):
        """Icon + inline text label (for box headers)."""
        isz = Inches(0.22)
        if icon and icon in ICONS:
            sl.shapes.add_picture(ICONS[icon], int(x), int(y), isz, isz)
            self._txt(sl, int(x) + isz + Inches(0.04), int(y),
                      Inches(3.5), isz, text, sz, bold, color)
        else:
            self._txt(sl, int(x), int(y), Inches(3.5), Inches(0.22),
                      text, sz, bold, color)

    def _ibox(self, sl, x, y, icon, label, key, nobg=False):
        """Icon + label below. Register center position for arrows."""
        isz = Inches(0.48)
        tw = Inches(1.4)
        ix = int(x + tw / 2 - isz / 2)

        if icon in ICONS:
            sl.shapes.add_picture(ICONS[icon], ix, int(y), isz, isz)

        self._txt(sl, int(x), int(y) + isz + Inches(0.02),
                  tw, Inches(0.4), label, 7, True, C.TEXT, PP_ALIGN.CENTER)

        # Register center point for arrows
        self.pos[key] = (int(x + tw / 2), int(y + isz / 2))

    def _arr(self, sl, fk, tk, color, label=""):
        """Draw arrow with arrowhead from fk to tk."""
        if fk not in self.pos or tk not in self.pos:
            return

        sx, sy = self.pos[fk]
        ex, ey = self.pos[tk]

        cn = sl.shapes.add_connector(1, sx, sy, ex, ey)
        cn.line.color.rgb = color
        cn.line.width = Pt(1.5)

        # Add arrowhead via XML
        sp = cn._element.find(qn('p:spPr'))
        ln = sp.find(qn('a:ln'))
        if ln is None:
            ln = etree.SubElement(sp, qn('a:ln'))
        te = ln.find(qn('a:tailEnd'))
        if te is None:
            te = etree.SubElement(ln, qn('a:tailEnd'))
        te.set('type', 'triangle')
        te.set('w', 'med')
        te.set('len', 'med')

        # Label near midpoint
        if label:
            mx = int((sx + ex) / 2)
            my = int((sy + ey) / 2)

            dx = ex - sx
            dy = ey - sy
            if abs(dy) > abs(dx):
                mx += int(Inches(0.18))
            else:
                my -= int(Inches(0.15))

            self._txt(sl, mx - int(Inches(0.5)), my - int(Inches(0.1)),
                      Inches(1.1), Inches(0.22), label, 6, True, color,
                      PP_ALIGN.CENTER)

    def _legend(self, sl, x, y):
        """Legend box with arrow color meanings."""
        lw = Inches(2.2)
        lh = Inches(1.1)
        self._box(sl, x, y, lw, lh, C.WHITE, RGBColor(0xCC, 0xCC, 0xCC))
        self._txt(sl, x + Inches(0.1), y + Inches(0.05),
                  Inches(1.5), Inches(0.18), "Legend:", 8, True)

        ly = y + Inches(0.26)
        self._txt(sl, x + Inches(0.1), ly, Inches(0.35), Inches(0.16),
                  "───▶", 7, True, C.ARROW_INET)
        self._txt(sl, x + Inches(0.48), ly, Inches(1.6), Inches(0.16),
                  "Internet traffic", 7)

        ly += Inches(0.2)
        self._txt(sl, x + Inches(0.1), ly, Inches(0.35), Inches(0.16),
                  "───▶", 7, True, C.ARROW_AWS)
        self._txt(sl, x + Inches(0.48), ly, Inches(1.6), Inches(0.16),
                  "AWS internal traffic", 7)

        ly += Inches(0.2)
        self._txt(sl, x + Inches(0.1), ly, Inches(0.35), Inches(0.16),
                  "───▶", 7, True, C.ARROW_GRAY)
        self._txt(sl, x + Inches(0.48), ly, Inches(1.6), Inches(0.16),
                  "Service connection", 7)


# ============================================================
def main():
    if len(sys.argv) < 2:
        print("Usage: python generate_diagram_v2.py <config.json>")
        sys.exit(1)

    inp = sys.argv[1]
    if not os.path.exists(inp):
        print(f"Error: {inp} not found")
        sys.exit(1)

    out = os.path.join(os.path.dirname(os.path.abspath(inp)), "network_diagram_v2.pptx")
    parser = AWSConfigParser(inp)

    print(f"Parsing: {inp}")
    for rt, items in sorted(parser.by_type.items()):
        print(f"  {rt}: {len(items)}")

    print(f"\nGenerating v2 diagram...")
    DiagramV2(parser).generate(out)
    print("Done!")


if __name__ == "__main__":
    main()
