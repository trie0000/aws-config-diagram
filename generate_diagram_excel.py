"""
generate_diagram_excel.py: AWS Config JSON -> AWS-style Network Diagram (xlsx)

Excel version of generate_diagram_v2.py.
Uses openpyxl for images + ZIP post-processing for shapes/connectors (DrawingML).

No slide size limit — large AWS configurations can fit without clipping.

Usage:
    python generate_diagram_excel.py tabelog_aws_config.json [--list] [--vpc vpc-id1,id2]

Version: 1.0.0
Last Updated: 2026-02-12
"""

import json
import sys
import os
import zipfile
import math
from collections import defaultdict
from io import BytesIO
from lxml import etree

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XlImage

from generate_diagram import AWSConfigParser

# ============================================================
# Icon paths
# ============================================================
ICON_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")

ICONS = {}
_ICON_NAMES = [
    "internet", "users", "client", "ec2", "rds", "alb", "igw", "nat",
    "waf", "acm", "s3", "s3_bucket", "vpc_endpoint", "vpc_icon",
    "region", "aws_cloud", "public_subnet", "private_subnet",
    "lambda", "ecs", "eks", "autoscaling", "cloudfront", "apigateway",
    "route53", "dynamodb", "elasticache", "redshift", "sqs", "sns",
    "kms", "cloudtrail", "cloudwatch", "elasticbeanstalk",
]
for name in _ICON_NAMES:
    path = os.path.join(ICON_DIR, f"{name}.png")
    if os.path.exists(path):
        ICONS[name] = path

# ============================================================
# Unit conversions
# ============================================================
EMU_PER_INCH = 914400
EMU_PER_PT = 12700

def Inches(val):
    """Convert inches to EMU (matching python-pptx convention)."""
    return int(val * EMU_PER_INCH)

def Pt(val):
    """Convert points to EMU."""
    return int(val * EMU_PER_PT)

def emu_to_pt(emu):
    """Convert EMU to points (for Excel positioning)."""
    return emu / EMU_PER_PT

# ============================================================
# DrawingML XML helpers
# ============================================================
XDR_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def _make_shape_xml(shape_id, name, left, top, width, height,
                    fill_color=None, line_color="333333", line_width_pt=1.0,
                    text=None, font_size=10, font_bold=False, font_color="000000",
                    corner_radius=None, no_fill=False):
    """Create a rounded rectangle or rectangle shape in DrawingML."""
    anchor = etree.SubElement(etree.Element("dummy"), f"{{{XDR_NS}}}absoluteAnchor")

    pos = etree.SubElement(anchor, f"{{{XDR_NS}}}pos")
    pos.set("x", str(int(left)))
    pos.set("y", str(int(top)))

    ext = etree.SubElement(anchor, f"{{{XDR_NS}}}ext")
    ext.set("cx", str(int(width)))
    ext.set("cy", str(int(height)))

    sp = etree.SubElement(anchor, f"{{{XDR_NS}}}sp")
    sp.set("macro", "")
    sp.set("textlink", "")

    nv = etree.SubElement(sp, f"{{{XDR_NS}}}nvSpPr")
    cNvPr = etree.SubElement(nv, f"{{{XDR_NS}}}cNvPr")
    cNvPr.set("id", str(shape_id))
    cNvPr.set("name", name)
    etree.SubElement(nv, f"{{{XDR_NS}}}cNvSpPr")

    spPr = etree.SubElement(sp, f"{{{XDR_NS}}}spPr")

    xfrm = etree.SubElement(spPr, f"{{{A_NS}}}xfrm")
    off = etree.SubElement(xfrm, f"{{{A_NS}}}off")
    off.set("x", str(int(left)))
    off.set("y", str(int(top)))
    ext2 = etree.SubElement(xfrm, f"{{{A_NS}}}ext")
    ext2.set("cx", str(int(width)))
    ext2.set("cy", str(int(height)))

    prst = "roundRect" if corner_radius else "rect"
    prstGeom = etree.SubElement(spPr, f"{{{A_NS}}}prstGeom")
    prstGeom.set("prst", prst)
    avLst = etree.SubElement(prstGeom, f"{{{A_NS}}}avLst")
    if corner_radius:
        gd = etree.SubElement(avLst, f"{{{A_NS}}}gd")
        gd.set("name", "adj")
        gd.set("fmla", f"val {corner_radius}")

    if no_fill:
        etree.SubElement(spPr, f"{{{A_NS}}}noFill")
    elif fill_color:
        solidFill = etree.SubElement(spPr, f"{{{A_NS}}}solidFill")
        srgb = etree.SubElement(solidFill, f"{{{A_NS}}}srgbClr")
        srgb.set("val", fill_color)
    else:
        etree.SubElement(spPr, f"{{{A_NS}}}noFill")

    ln = etree.SubElement(spPr, f"{{{A_NS}}}ln")
    ln.set("w", str(int(line_width_pt * EMU_PER_PT)))
    solidFill_ln = etree.SubElement(ln, f"{{{A_NS}}}solidFill")
    srgb_ln = etree.SubElement(solidFill_ln, f"{{{A_NS}}}srgbClr")
    srgb_ln.set("val", line_color)

    if text:
        _add_text_body(sp, text, font_size, font_bold, font_color, XDR_NS)

    etree.SubElement(anchor, f"{{{XDR_NS}}}clientData")
    return anchor


def _make_textbox_xml(shape_id, name, left, top, width, height,
                      text="", font_size=10, font_bold=False, font_color="000000",
                      alignment="l"):
    """Create a textbox (no fill, no border) in DrawingML."""
    anchor = etree.SubElement(etree.Element("dummy"), f"{{{XDR_NS}}}absoluteAnchor")

    pos = etree.SubElement(anchor, f"{{{XDR_NS}}}pos")
    pos.set("x", str(int(left)))
    pos.set("y", str(int(top)))

    ext = etree.SubElement(anchor, f"{{{XDR_NS}}}ext")
    ext.set("cx", str(int(width)))
    ext.set("cy", str(int(height)))

    sp = etree.SubElement(anchor, f"{{{XDR_NS}}}sp")
    sp.set("macro", "")
    sp.set("textlink", "")

    nv = etree.SubElement(sp, f"{{{XDR_NS}}}nvSpPr")
    cNvPr = etree.SubElement(nv, f"{{{XDR_NS}}}cNvPr")
    cNvPr.set("id", str(shape_id))
    cNvPr.set("name", name)
    cNvSpPr = etree.SubElement(nv, f"{{{XDR_NS}}}cNvSpPr")
    cNvSpPr.set("txBox", "1")

    spPr = etree.SubElement(sp, f"{{{XDR_NS}}}spPr")

    xfrm = etree.SubElement(spPr, f"{{{A_NS}}}xfrm")
    off = etree.SubElement(xfrm, f"{{{A_NS}}}off")
    off.set("x", str(int(left)))
    off.set("y", str(int(top)))
    ext2 = etree.SubElement(xfrm, f"{{{A_NS}}}ext")
    ext2.set("cx", str(int(width)))
    ext2.set("cy", str(int(height)))

    prstGeom = etree.SubElement(spPr, f"{{{A_NS}}}prstGeom")
    prstGeom.set("prst", "rect")
    etree.SubElement(prstGeom, f"{{{A_NS}}}avLst")

    etree.SubElement(spPr, f"{{{A_NS}}}noFill")
    ln = etree.SubElement(spPr, f"{{{A_NS}}}ln")
    etree.SubElement(ln, f"{{{A_NS}}}noFill")

    txBody = etree.SubElement(sp, f"{{{XDR_NS}}}txBody")
    bodyPr = etree.SubElement(txBody, f"{{{A_NS}}}bodyPr")
    bodyPr.set("vertOverflow", "clip")
    bodyPr.set("horzOverflow", "clip")
    bodyPr.set("wrap", "square")

    etree.SubElement(txBody, f"{{{A_NS}}}lstStyle")

    for line_text in text.split("\n"):
        p = etree.SubElement(txBody, f"{{{A_NS}}}p")
        pPr = etree.SubElement(p, f"{{{A_NS}}}pPr")
        pPr.set("algn", alignment)

        r = etree.SubElement(p, f"{{{A_NS}}}r")
        rPr = etree.SubElement(r, f"{{{A_NS}}}rPr")
        rPr.set("lang", "ja-JP")
        rPr.set("sz", str(font_size * 100))
        if font_bold:
            rPr.set("b", "1")
        solidFill_t = etree.SubElement(rPr, f"{{{A_NS}}}solidFill")
        srgb_t = etree.SubElement(solidFill_t, f"{{{A_NS}}}srgbClr")
        srgb_t.set("val", font_color)

        t = etree.SubElement(r, f"{{{A_NS}}}t")
        t.text = line_text

    etree.SubElement(anchor, f"{{{XDR_NS}}}clientData")
    return anchor


def _make_connector_xml(shape_id, name, x1, y1, x2, y2,
                        color="ED7D1C", line_width_pt=1.5, arrow=True,
                        start_shape_id=None, start_idx=None,
                        end_shape_id=None, end_idx=None):
    """Create a straight connector (arrow) in DrawingML.

    Args:
        start_shape_id/end_shape_id: shape ID to bind connector to (stCxn/endCxn)
        start_idx/end_idx: connection point index (0=top, 1=left, 2=bottom, 3=right)
    """
    left = min(x1, x2)
    top = min(y1, y2)
    w = abs(x2 - x1)
    h = abs(y2 - y1)
    if w == 0:
        w = 1
    if h == 0:
        h = 1

    flipH = "1" if x2 < x1 else "0"
    flipV = "1" if y2 < y1 else "0"

    anchor = etree.SubElement(etree.Element("dummy"), f"{{{XDR_NS}}}absoluteAnchor")

    pos = etree.SubElement(anchor, f"{{{XDR_NS}}}pos")
    pos.set("x", str(int(left)))
    pos.set("y", str(int(top)))

    ext = etree.SubElement(anchor, f"{{{XDR_NS}}}ext")
    ext.set("cx", str(int(w)))
    ext.set("cy", str(int(h)))

    cxnSp = etree.SubElement(anchor, f"{{{XDR_NS}}}cxnSp")
    cxnSp.set("macro", "")

    nv = etree.SubElement(cxnSp, f"{{{XDR_NS}}}nvCxnSpPr")
    cNvPr = etree.SubElement(nv, f"{{{XDR_NS}}}cNvPr")
    cNvPr.set("id", str(shape_id))
    cNvPr.set("name", name)
    cNvCxnSpPr = etree.SubElement(nv, f"{{{XDR_NS}}}cNvCxnSpPr")

    # Bind connector to shapes
    if start_shape_id is not None and start_idx is not None:
        stCxn = etree.SubElement(cNvCxnSpPr, f"{{{A_NS}}}stCxn")
        stCxn.set("id", str(start_shape_id))
        stCxn.set("idx", str(start_idx))
    if end_shape_id is not None and end_idx is not None:
        endCxn = etree.SubElement(cNvCxnSpPr, f"{{{A_NS}}}endCxn")
        endCxn.set("id", str(end_shape_id))
        endCxn.set("idx", str(end_idx))

    spPr = etree.SubElement(cxnSp, f"{{{XDR_NS}}}spPr")

    xfrm = etree.SubElement(spPr, f"{{{A_NS}}}xfrm")
    if flipH == "1":
        xfrm.set("flipH", "1")
    if flipV == "1":
        xfrm.set("flipV", "1")

    off = etree.SubElement(xfrm, f"{{{A_NS}}}off")
    off.set("x", str(int(left)))
    off.set("y", str(int(top)))
    ext2 = etree.SubElement(xfrm, f"{{{A_NS}}}ext")
    ext2.set("cx", str(int(w)))
    ext2.set("cy", str(int(h)))

    prstGeom = etree.SubElement(spPr, f"{{{A_NS}}}prstGeom")
    prstGeom.set("prst", "straightConnector1")
    etree.SubElement(prstGeom, f"{{{A_NS}}}avLst")

    ln = etree.SubElement(spPr, f"{{{A_NS}}}ln")
    ln.set("w", str(int(line_width_pt * EMU_PER_PT)))
    solidFill = etree.SubElement(ln, f"{{{A_NS}}}solidFill")
    srgb = etree.SubElement(solidFill, f"{{{A_NS}}}srgbClr")
    srgb.set("val", color)

    if arrow:
        tailEnd = etree.SubElement(ln, f"{{{A_NS}}}tailEnd")
        tailEnd.set("type", "triangle")
        tailEnd.set("w", "med")
        tailEnd.set("len", "med")

    etree.SubElement(anchor, f"{{{XDR_NS}}}clientData")
    return anchor


def _add_text_body(parent_sp, text, font_size, font_bold, font_color, ns):
    """Add txBody to a shape element."""
    txBody = etree.SubElement(parent_sp, f"{{{ns}}}txBody")
    bodyPr = etree.SubElement(txBody, f"{{{A_NS}}}bodyPr")
    bodyPr.set("vertOverflow", "clip")
    bodyPr.set("horzOverflow", "clip")
    bodyPr.set("wrap", "square")
    bodyPr.set("lIns", "72000")
    bodyPr.set("tIns", "36000")
    bodyPr.set("rIns", "72000")
    bodyPr.set("bIns", "36000")

    etree.SubElement(txBody, f"{{{A_NS}}}lstStyle")

    for line_text in text.split("\n"):
        p = etree.SubElement(txBody, f"{{{A_NS}}}p")
        r = etree.SubElement(p, f"{{{A_NS}}}r")
        rPr = etree.SubElement(r, f"{{{A_NS}}}rPr")
        rPr.set("lang", "ja-JP")
        rPr.set("sz", str(font_size * 100))
        if font_bold:
            rPr.set("b", "1")
        solidFill_t = etree.SubElement(rPr, f"{{{A_NS}}}solidFill")
        srgb_t = etree.SubElement(solidFill_t, f"{{{A_NS}}}srgbClr")
        srgb_t.set("val", font_color)

        t = etree.SubElement(r, f"{{{A_NS}}}t")
        t.text = line_text


def _rgb_hex(r, g, b):
    """Convert RGB ints to hex string."""
    return f"{r:02X}{g:02X}{b:02X}"


# ============================================================
# Colors (hex strings for DrawingML)
# ============================================================
class C:
    CLOUD_BG = "F5F5F5"
    CLOUD_BD = "9A9A9A"
    VPC_BG   = "F0F7F0"
    VPC_BD   = "1A8C1A"

    PUB_BG   = "E8F5E2"
    PUB_BD   = "248F24"
    PRIV_BG  = "E3EDF7"
    PRIV_BD  = "147EBA"
    GW_BG    = "FDF0E0"
    GW_BD    = "CCBB99"

    ARROW_INET = "0073BB"
    ARROW_AWS  = "ED7D1C"
    ARROW_GRAY = "888888"
    ARROW_PEER = "009688"

    TEXT   = "333333"
    TEXT_G = "777777"
    WHITE  = "FFFFFF"


# ============================================================
# Excel Diagram Generator
# ============================================================
class DiagramExcel:
    def __init__(self, parser: AWSConfigParser):
        self.p = parser
        self.pos = {}       # key -> (cx, cy, hw, hh) EMU bounding box
        self.shapes = {}    # key -> shape_id (for connector binding)
        # Z-layer ordering: 0=boxes, 1=labels, 2=images, 3=connectors, 4=arrow_labels
        self._xml_elements = []  # (z_layer, xml_element) — sorted on save
        self._shape_id = 100     # auto-incrementing shape ID
        self._images = []        # (path, left_emu, top_emu, w_emu, h_emu, key_or_none)

    def _next_id(self):
        sid = self._shape_id
        self._shape_id += 1
        return sid

    def _score_vpc(self, v):
        vid = v["id"]
        score = (len(self.p.get_subnets_for_vpc(vid))
                 + len(self.p.get_albs_for_vpc(vid)) * 10
                 + len(self.p.get_rds_for_vpc(vid)) * 5)
        sub_ids = {s["id"] for s in self.p.get_subnets_for_vpc(vid)}
        for item in self.p.by_type["AWS::EC2::Instance"]:
            cfg = item.get("configuration", {})
            if cfg.get("subnetId", "") in sub_ids:
                score += 1
        return score

    def list_vpcs(self):
        vpcs = self.p.get_vpcs()
        result = []
        for v in vpcs:
            score = self._score_vpc(v)
            result.append({**v, "score": score})
        return result

    def generate(self, out, vpc_ids=None):
        vpcs = self.p.get_vpcs()
        if not vpcs:
            print("No VPCs found")
            return

        if vpc_ids:
            vpc_map = {v["id"]: v for v in vpcs}
            targets = []
            for vid in vpc_ids:
                if vid in vpc_map:
                    targets.append(vpc_map[vid])
                else:
                    print(f"  Warning: VPC {vid} not found, skipping")
            if not targets:
                print("Error: none of the specified VPCs found")
                return
        else:
            non_default = [v for v in vpcs if not v.get("is_default", False)]
            candidates = non_default if non_default else vpcs
            if len(candidates) == 1:
                targets = [candidates[0]]
            else:
                scored = [(self._score_vpc(v), v) for v in candidates]
                scored.sort(key=lambda x: -x[0])
                for score, v in scored:
                    print(f"  VPC {v['name']} ({v['id']}): score={score}")
                targets = [scored[0][1]]

        for v in targets:
            print(f"  Drawing VPC: {v['name']} ({v['id']})")
            self.pos = {}
            self.shapes = {}
            self._xml_elements = []
            self._shape_id = 100
            self._images = []
            self._build(v)

        # Save Excel file
        self._save_xlsx(out)
        print(f"Saved: {out}")

    # ==========================================================
    # Layout calculation (reused from v2 with minor adaptations)
    # ==========================================================
    def _calc_layout(self, has_edge, has_peering, has_svless, has_infra,
                     tiers, azs, res_ctx, gw_item_count=0,
                     icon_conns=None, all_icon_tiers=None):
        L = {}

        L['left_w'] = Inches(2.3) if has_edge else Inches(1.3)
        L['right_margin'] = Inches(0.9) if has_peering else Inches(0.3)

        L['cloud_x'] = L['left_w']
        L['cloud_y'] = Inches(0.35)
        L['cloud_w'] = Inches(16) - L['left_w'] - L['right_margin']

        # Excel: no slide bottom limit — use content-driven sizing
        # Start with a reasonable default, expand as needed
        cloud_bottom_default = Inches(8.95)

        bottom_row_h = Inches(0.65)
        n_bottom = (1 if has_infra else 0) + (1 if has_svless else 0)
        bottom_total = Inches(0.10) + bottom_row_h * n_bottom if n_bottom > 0 \
            else Inches(0.05)

        n_az = max(len(azs), 1)
        az_gap = Inches(0.15)
        min_az_h_1row = Inches(1.05)

        gw_min_h = Inches(0.15) + Inches(0.78) * max(gw_item_count, 1)
        min_az_from_gw = (gw_min_h - az_gap * (n_az - 1)) / n_az
        min_az_h = max(min_az_h_1row, min_az_from_gw)

        cloud_pad = Inches(0.15)
        L['vpc_x'] = L['cloud_x'] + cloud_pad
        L['vpc_y'] = L['cloud_y'] + Inches(0.40)
        L['vpc_w'] = L['cloud_w'] - 2 * cloud_pad

        vpc_header = Inches(0.30)
        vpc_pad = Inches(0.10)

        # Column widths
        L['gw_x'] = L['vpc_x'] + vpc_pad
        L['gw_w'] = Inches(1.30)

        col_gap = Inches(0.10)
        subnet_area_x = L['gw_x'] + L['gw_w'] + col_gap
        subnet_area_w = (L['vpc_x'] + L['vpc_w'] - vpc_pad) - subnet_area_x

        if icon_conns is None:
            icon_conns = {}
        if all_icon_tiers is None:
            all_icon_tiers = {}
        col_widths, max_icon_rows = self._calc_col_widths(
            tiers, azs, subnet_area_w, col_gap, res_ctx,
            icon_conns, all_icon_tiers)

        icon_row_h = Inches(0.75)
        content_min_az = Inches(0.22 + 0.22 + 0.05) + icon_row_h * max(max_icon_rows, 1)

        # Excel: no hard slide limit, allow expansion
        min_az_h = max(min_az_h, content_min_az)
        max_az_h = content_min_az + Inches(0.20)
        max_az_h = max(max_az_h, min_az_from_gw)

        total_az_gaps = az_gap * (n_az - 1)
        min_vpc_h = vpc_header + vpc_pad + n_az * min_az_h + total_az_gaps
        available_vpc_h = (cloud_bottom_default - L['vpc_y']
                           - bottom_total - Inches(0.10))
        L['vpc_h'] = max(available_vpc_h, min_vpc_h)

        actual_cloud_bottom = max(
            cloud_bottom_default,
            L['vpc_y'] + L['vpc_h'] + bottom_total + Inches(0.10))
        L['cloud_bottom'] = actual_cloud_bottom
        L['cloud_h'] = L['cloud_bottom'] - L['cloud_y']

        # AZ rows
        az_area_top = L['vpc_y'] + vpc_header
        az_area_h = L['vpc_h'] - vpc_header - vpc_pad
        az_h = (az_area_h - total_az_gaps) / n_az
        az_h = min(az_h, max_az_h)

        L['az_ys'] = []
        for i in range(n_az):
            L['az_ys'].append(az_area_top + i * (az_h + az_gap))
        L['az_a_y'] = L['az_ys'][0] if L['az_ys'] else az_area_top
        L['az_c_y'] = L['az_ys'][1] if len(L['az_ys']) > 1 else L['az_a_y'] + az_h + az_gap
        L['az_h'] = az_h

        last_az_y = L['az_ys'][-1] if L['az_ys'] else az_area_top
        L['gw_y'] = L['az_a_y']
        L['gw_h'] = (last_az_y + az_h) - L['az_a_y']

        L['pub_x'] = subnet_area_x
        L['pub_w'] = col_widths['Public']
        L['priv_x'] = L['pub_x'] + L['pub_w'] + col_gap
        L['priv_w'] = col_widths['Private']
        L['iso_x'] = L['priv_x'] + L['priv_w'] + col_gap
        L['iso_w'] = col_widths['Isolated']

        L['infra_y'] = L['vpc_y'] + L['vpc_h'] + Inches(0.15) \
            if has_infra else None
        if has_svless:
            if has_infra:
                L['svless_y'] = L['infra_y'] + bottom_row_h
            else:
                L['svless_y'] = L['vpc_y'] + L['vpc_h'] + Inches(0.15)
        else:
            L['svless_y'] = None

        return L

    def _calc_col_widths(self, tiers, azs, subnet_area_w, col_gap, res_ctx,
                         icon_conns, all_icon_tiers):
        icon_slot = Inches(1.10)
        min_col = Inches(1.80)

        all_subnet_icons = {}
        max_icons = {"Public": 0, "Private": 0, "Isolated": 0}
        for tier in max_icons:
            for ai, az in enumerate(azs):
                subs = tiers.get(tier, {}).get(az, [])
                if subs:
                    icons, _aux = self._collect_subnet_icons(tier, ai, subs, res_ctx)
                    all_subnet_icons[(tier, ai)] = icons
                    max_icons[tier] = max(max_icons[tier], len(icons))

        active_tiers = [t for t in ["Public", "Private", "Isolated"]
                        if max_icons[t] > 0 or any(tiers.get(t, {}).get(az, []) for az in azs)]
        n_gaps = max(len(active_tiers) - 1, 0)
        available = subnet_area_w - col_gap * n_gaps

        desired = {}
        for t in ["Public", "Private", "Isolated"]:
            desired[t] = max(max_icons[t] * icon_slot, min_col)

        total_desired = sum(desired.values())
        if total_desired > 0 and available > 0:
            scale = available / total_desired
            col_widths = {t: desired[t] * scale for t in desired}
        else:
            equal = available / 3 if available > 0 else min_col
            col_widths = {"Public": equal, "Private": equal, "Isolated": equal}

        max_icon_rows = 1
        for tier in ["Public", "Private", "Isolated"]:
            for ai in range(len(azs)):
                icons = all_subnet_icons.get((tier, ai), [])
                if icons:
                    rows = self._num_icon_rows(icons, col_widths[tier],
                                               tier, icon_conns, all_icon_tiers)
                    max_icon_rows = max(max_icon_rows, rows)

        return col_widths, max_icon_rows

    # ==========================================================
    # Collect icons for a subnet (same as v2)
    # ==========================================================
    def _collect_subnet_icons(self, tier, ai, subs, ctx):
        icons = []
        aux = []
        seen_keys = set()
        sub_ids = {s["id"] for s in subs}

        if tier == "Public":
            for sub in subs:
                for inst in self.p.get_instances_for_subnet(sub["id"]):
                    key = f"ec2_{inst['id']}"
                    if key not in seen_keys:
                        seen_keys.add(key)
                        icons.append(("ec2", f"EC2\n{inst['name']}", key))

        elif tier == "Private":
            for sub in subs:
                for inst in self.p.get_instances_for_subnet(sub["id"]):
                    key = f"ec2_{inst['id']}"
                    if key not in seen_keys:
                        seen_keys.add(key)
                        icons.append(("ec2", f"EC2\n{inst['name']}", key))
            for lf in ctx['lambdas_vpc']:
                if sub_ids & set(lf.get("vpc_subnet_ids", [])):
                    key = f"lambda_{lf['id']}"
                    if key not in seen_keys:
                        seen_keys.add(key)
                        icons.append(("lambda", f"Lambda\n{lf['name'][:12]}", key))
            for svc in ctx['ecs_services']:
                if sub_ids & set(svc.get("subnet_ids", [])):
                    key = f"ecs_{svc['id']}"
                    if key not in seen_keys:
                        seen_keys.add(key)
                        icons.append(("ecs", f"ECS\n{svc['name']}", key))
            for ek in ctx['eks_clusters']:
                if sub_ids & set(ek.get("subnet_ids", [])):
                    key = f"eks_{ek['id']}"
                    if key not in seen_keys:
                        seen_keys.add(key)
                        icons.append(("eks", f"EKS\n{ek['name'][:12]}", key))
            if ai == 0:
                for eb in ctx['eb_envs']:
                    key = f"eb_{eb['id']}"
                    if key not in seen_keys:
                        seen_keys.add(key)
                        aux.append(("elasticbeanstalk",
                                   f"Beanstalk\n{eb['name'][:12]}", key))

        elif tier == "Isolated":
            for db in ctx['rdss']:
                if sub_ids & set(db["subnet_ids"]) or not db["subnet_ids"]:
                    key = f"rds_{db['id']}_{ai}"
                    if key not in seen_keys:
                        seen_keys.add(key)
                        role = "(Primary)" if ai == 0 else "(Standby)"
                        icons.append(("rds", f"Amazon RDS\n{role}", key))
            for cc in ctx['cache_clusters']:
                key = f"cache_{cc['id']}"
                if key not in seen_keys:
                    seen_keys.add(key)
                    icons.append(("elasticache", f"ElastiCache\n{cc['engine']}", key))
            for rc in ctx['rs_clusters']:
                key = f"redshift_{rc['id']}"
                if key not in seen_keys:
                    seen_keys.add(key)
                    icons.append(("redshift", f"Redshift\n{rc['name'][:10]}", key))

        return icons, aux

    # ==========================================================
    # Connection-aware icon placement (same logic as v2)
    # ==========================================================
    def _build_icon_connections(self, sg_conns, svc_conns, sg_map):
        conns = defaultdict(set)
        for conn in sg_conns:
            frs = sg_map.get(conn["from_sg"], [])
            trs = sg_map.get(conn["to_sg"], [])
            for fr in frs:
                fk = f"{fr['prefix']}{fr['id']}"
                for tr in trs:
                    tk = f"{tr['prefix']}{tr['id']}"
                    if tr['type'] == 'RDS':
                        conns[fk].add(tk + "_0")
                        conns[fk].add(tk + "_1")
                        conns[tk + "_0"].add(fk)
                        conns[tk + "_1"].add(fk)
                    else:
                        conns[fk].add(tk)
                        conns[tk].add(fk)
        for conn in sg_conns:
            frs = sg_map.get(conn["from_sg"], [])
            trs = sg_map.get(conn["to_sg"], [])
            for fr in frs:
                if fr['type'] == 'ALB':
                    fk = f"alb_{fr['id']}"
                    for tr in trs:
                        tk = f"{tr['prefix']}{tr['id']}"
                        conns[fk].add(tk)
                        conns[tk].add(fk)
        for conn in svc_conns:
            ft = conn.get("from_type", "")
            fi = conn.get("from_id", "")
            tt = conn.get("to_type", "")
            ti = conn.get("to_id", "")
            fk = ft if ft else f"{ft}_{fi}"
            tk = tt if tt else f"{tt}_{ti}"
            conns[fk].add(tk)
            conns[tk].add(fk)
        return conns

    _TIER_ORDER = {"Gateway": 0, "Public": 1, "Private": 2, "Isolated": 3,
                   "external": 4}

    def _build_topology_rows(self, icons, area_w, tier, icon_conns,
                             all_icon_tiers):
        if not icons:
            return []

        margin = Inches(0.10)
        spacing = Inches(1.10)
        available = area_w - 2 * margin
        max_per_row = max(1, int(available / spacing))

        my_order = self._TIER_ORDER.get(tier, 2)
        icon_keys = [ic[2] for ic in icons]
        icon_map = {ic[2]: ic for ic in icons}
        icon_set = set(icon_keys)
        placed = set()
        rows = []

        def left_score(key):
            neighbors = icon_conns.get(key, set())
            scores = []
            for nk in neighbors:
                nt = all_icon_tiers.get(nk)
                if nt is not None:
                    scores.append(self._TIER_ORDER.get(nt, 2))
            return min(scores) if scores else my_order

        entry_keys = []
        other_keys = []
        for key in icon_keys:
            neighbors = icon_conns.get(key, set())
            has_left = any(
                self._TIER_ORDER.get(all_icon_tiers.get(nk, ""), 99) < my_order
                for nk in neighbors
                if all_icon_tiers.get(nk) is not None
            )
            if has_left:
                entry_keys.append(key)
            else:
                other_keys.append(key)

        entry_keys.sort(key=left_score)

        def build_chain(start_key):
            chain = [start_key]
            placed.add(start_key)
            frontier = [start_key]
            while frontier:
                cur = frontier.pop(0)
                neighbors = icon_conns.get(cur, set())
                for nk in sorted(neighbors):
                    if nk in icon_set and nk not in placed:
                        chain.append(nk)
                        placed.add(nk)
                        frontier.append(nk)
            return chain

        multi_chains = []
        single_icons = []

        for ek in entry_keys:
            if ek in placed:
                continue
            chain = build_chain(ek)
            if len(chain) > 1:
                multi_chains.append(chain)
            else:
                single_icons.append(chain[0])

        for ok in other_keys:
            if ok in placed:
                continue
            chain = build_chain(ok)
            if len(chain) > 1:
                multi_chains.append(chain)
            else:
                single_icons.append(chain[0])

        for chain in multi_chains:
            for i in range(0, len(chain), max_per_row):
                row = [icon_map[k] for k in chain[i:i+max_per_row]]
                rows.append(row)

        if single_icons:
            for i in range(0, len(single_icons), max_per_row):
                row = [icon_map[k] for k in single_icons[i:i+max_per_row]]
                rows.append(row)

        return rows

    def _num_icon_rows(self, icons, area_w, tier, icon_conns, all_icon_tiers):
        if not icons:
            return 0
        rows = self._build_topology_rows(icons, area_w, tier,
                                         icon_conns, all_icon_tiers)
        return len(rows)

    def _place_icons_grid(self, icons, area_x, area_w, y_base,
                          tier, icon_conns, all_icon_tiers):
        rows = self._build_topology_rows(icons, area_w, tier,
                                         icon_conns, all_icon_tiers)
        if not rows:
            return

        margin = Inches(0.10)
        spacing = Inches(1.10)
        available = area_w - 2 * margin
        row_h = Inches(0.75)

        for row_i, row_icons in enumerate(rows):
            nr = len(row_icons)
            if nr * spacing <= available:
                sp = spacing
            else:
                sp = available / nr
            total = nr * sp
            start_x = area_x + margin + (available - total) / 2
            row_y = y_base + row_i * row_h

            for i, (icon_name, label, key) in enumerate(row_icons):
                x = int(start_x + i * sp)
                self._ibox(x, int(row_y), icon_name, label, key)

    def _place_aux_badges(self, aux, area_x, area_w, sub_y):
        if not aux:
            return
        isz = Inches(0.28)
        lbl_w = Inches(0.80)
        lbl_h = Inches(0.20)
        item_h = isz + lbl_h
        gap = Inches(0.02)
        total_w = lbl_w
        x = int(area_x + area_w - total_w - Inches(0.05))
        y = int(sub_y + Inches(0.03))
        for icon_name, label, key in aux:
            ix = int(x + total_w / 2 - isz / 2)
            sid = self._next_id()
            if icon_name in ICONS:
                self._images.append((ICONS[icon_name], ix, y, int(isz), int(isz), key))
            self._txt(x, int(y + isz + Inches(0.01)),
                      lbl_w, lbl_h, label, 5, True, C.TEXT, "ctr")
            icon_cx = int(x + total_w / 2)
            icon_cy = int(y + isz / 2)
            icon_hw = int(isz / 2)
            icon_hh = int(isz / 2)
            self.pos[key] = (icon_cx, icon_cy, icon_hw, icon_hh)
            self.shapes[key] = sid
            y += int(item_h + gap)

    # ==========================================================
    # Main build (adapted from v2)
    # ==========================================================
    def _build(self, vpc):
        # ---- Gather all resources ----
        subs = self.p.get_subnets_for_vpc(vpc["id"])
        igw = self.p.get_igw_for_vpc(vpc["id"])
        nats = self.p.get_nat_gateways_for_vpc(vpc["id"])
        albs = self.p.get_albs_for_vpc(vpc["id"])
        rdss = self.p.get_rds_for_vpc(vpc["id"])
        s3s = self.p.get_s3_buckets()
        sg_conns = self.p.get_sg_connections()

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
        asgs = self.p.get_autoscaling_groups()
        eb_envs = self.p.get_elasticbeanstalk_environments()
        peerings = self.p.get_peering_connections()

        waf = None
        for a in albs:
            waf = self.p.get_waf_for_alb(a["id"])
            if waf:
                break

        lambdas_vpc = [l for l in lambdas if l.get("in_vpc")]
        lambdas_serverless = [l for l in lambdas if not l.get("in_vpc")]

        asg_by_subnet = {}
        for asg in asgs:
            for sid in asg.get("subnet_ids", []):
                asg_by_subnet[sid] = asg

        azs = sorted(set(s["az"] for s in subs if s["az"]))
        tiers = defaultdict(lambda: defaultdict(list))
        for s in subs:
            tiers[s["tier"]][s["az"]].append(s)

        has_edge = bool(r53_zones or cf_dists or api_gws)
        has_peering = bool(peerings)

        gw_before_alb = []
        if waf:
            gw_before_alb.append(("waf", "AWS WAF", "waf"))
        gw_after_alb = []

        infra_items = []
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
        has_infra = bool(infra_items)

        res_ctx = {
            'nats': nats, 'asg_by_subnet': asg_by_subnet,
            'eb_envs': eb_envs, 'ecs_services': ecs_services,
            'lambdas_vpc': lambdas_vpc, 'eks_clusters': eks_clusters,
            'rdss': rdss, 'cache_clusters': cache_clusters,
            'rs_clusters': rs_clusters,
        }

        sg_map = self.p.build_sg_to_resources_map()
        icon_conns = self._build_icon_connections(sg_conns, svc_conns, sg_map)

        all_icon_tiers = {}
        for alb in albs:
            all_icon_tiers[f"alb_{alb['id']}"] = "Gateway"
        if waf:
            all_icon_tiers["waf"] = "Gateway"
        for ai, az in enumerate(azs):
            for tier_name in ["Public", "Private", "Isolated"]:
                sub_list = tiers.get(tier_name, {}).get(az, [])
                if sub_list:
                    icons, _aux = self._collect_subnet_icons(
                        tier_name, ai, sub_list, res_ctx)
                    for _icon, _label, key in icons:
                        all_icon_tiers[key] = tier_name
        for _icon, _label, key in infra_items + svless_items:
            all_icon_tiers[key] = "external"

        gw_item_count = len(gw_before_alb) + len(albs) + len(gw_after_alb)
        L = self._calc_layout(has_edge, has_peering, has_svless, has_infra,
                              tiers, azs, res_ctx, gw_item_count,
                              icon_conns, all_icon_tiers)

        # ===== DRAW STRUCTURE =====

        # Title
        self._txt(Inches(0.2), Inches(0.05), Inches(6), Inches(0.3),
                  "AWS Network Architecture", 14, True)

        # AWS Cloud box
        self._box(L['cloud_x'], L['cloud_y'], L['cloud_w'], L['cloud_h'],
                  C.CLOUD_BG, C.CLOUD_BD)
        self._ilabel(L['cloud_x'] + Inches(0.08),
                     L['cloud_y'] + Inches(0.05),
                     "aws_cloud", "AWS Cloud", 9, True)
        self._ilabel(L['cloud_x'] + Inches(1.8),
                     L['cloud_y'] + Inches(0.05),
                     "region", f"Region: {vpc['region']}", 8, color=C.TEXT_G)

        # VPC box
        self._box(L['vpc_x'], L['vpc_y'], L['vpc_w'], L['vpc_h'],
                  C.VPC_BG, C.VPC_BD, 2.0)
        self._ilabel(L['vpc_x'] + Inches(0.08),
                     L['vpc_y'] + Inches(0.05),
                     "vpc_icon", f"VPC  {vpc['cidr']}", 9, True,
                     color=C.VPC_BD)

        # Gateway Column
        self._box(L['gw_x'], L['gw_y'], L['gw_w'], L['gw_h'],
                  C.GW_BG, C.GW_BD, 0.75)

        gw_icon_x = int(L['gw_x'] + L['gw_w'] / 2 - Inches(0.6))
        gw_cursor_y = L['gw_y'] + Inches(0.15)
        gw_first_y = int(gw_cursor_y)
        alb_y_pos = None

        for icon, label, key in gw_before_alb:
            self._ibox(gw_icon_x, int(gw_cursor_y), icon, label, key)
            gw_cursor_y += Inches(0.85)

        for alb in albs:
            alb_y_pos = int(gw_cursor_y)
            self._ibox(gw_icon_x, int(gw_cursor_y),
                       "alb", "Elastic Load\nBalancing", f"alb_{alb['id']}")
            gw_cursor_y += Inches(1.0)

        for icon, label, key in gw_after_alb:
            self._ibox(gw_icon_x, int(gw_cursor_y), icon, label, key)
            gw_cursor_y += Inches(0.85)

        if alb_y_pos is None:
            alb_y_pos = gw_first_y

        # IGW straddling VPC left border
        if igw:
            igw_isz = Inches(0.42)
            igw_tw = Inches(1.2)
            igw_x = int(L['vpc_x'] - igw_tw / 2)
            igw_y = gw_first_y
            igw_ix = int(igw_x + igw_tw / 2 - igw_isz / 2)
            igw_key = f"igw_{igw['id']}"
            igw_sid = self._next_id()
            if "igw" in ICONS:
                self._images.append((ICONS["igw"], igw_ix, igw_y,
                                     int(igw_isz), int(igw_isz), igw_key))
            self._txt(igw_x, int(igw_y + igw_isz + Inches(0.01)),
                      igw_tw, Inches(0.28), "Internet\nGateway",
                      6, True, C.TEXT, "ctr")
            cx = int(igw_x + igw_tw / 2)
            cy = int(igw_y + igw_isz / 2)
            hw = int(igw_isz / 2)
            hh = int(igw_isz / 2)
            self.pos[igw_key] = (cx, cy, hw, hh)
            self.shapes[igw_key] = igw_sid

        # AZ Rows with Subnet Columns
        for ai, az in enumerate(azs):
            row_y = L['az_ys'][ai] if ai < len(L['az_ys']) else L['az_ys'][-1]
            az_h = L['az_h']
            az_short = az.split("-")[-1].upper() if "-" in az else az.upper()

            self._txt(L['pub_x'], row_y + Inches(0.02),
                      Inches(3.5), Inches(0.2),
                      f"Availability Zone {az_short}", 8, True, C.TEXT_G)

            sub_y = row_y + Inches(0.22)
            sub_h = az_h - Inches(0.27)
            icon_y_base = sub_y + Inches(0.22)

            # Public Subnet
            ps = tiers.get("Public", {}).get(az, [])
            if ps:
                cidr_label = ", ".join(s["cidr"] for s in ps if s["cidr"])
                self._box(L['pub_x'], sub_y, L['pub_w'], sub_h,
                          C.PUB_BG, C.PUB_BD)
                self._ilabel(L['pub_x'] + Inches(0.05), sub_y + Inches(0.03),
                             "public_subnet",
                             f"Public subnet  {cidr_label}", 7, color=C.PUB_BD)
                icons, aux = self._collect_subnet_icons("Public", ai, ps, res_ctx)
                self._place_icons_grid(icons, L['pub_x'], L['pub_w'],
                                       icon_y_base, "Public",
                                       icon_conns, all_icon_tiers)
                self._place_aux_badges(aux, L['pub_x'], L['pub_w'], sub_y)
                # NAT Gateway
                if ai == 0:
                    ps_ids = {s["id"] for s in ps}
                    for nat in nats:
                        if nat["subnet_id"] in ps_ids or not nat["subnet_id"]:
                            nat_isz = Inches(0.42)
                            nat_tw = Inches(1.2)
                            nat_x = int(L['pub_x'] + L['pub_w']
                                        - nat_tw - Inches(0.05))
                            nat_y = int(sub_y - nat_isz / 2)
                            nat_ix = int(nat_x + nat_tw / 2 - nat_isz / 2)
                            nk = f"nat_{nat['id']}"
                            nat_sid = self._next_id()
                            if "nat" in ICONS:
                                self._images.append((ICONS["nat"], nat_ix, nat_y,
                                                     int(nat_isz), int(nat_isz), nk))
                            self._txt(nat_x,
                                      int(nat_y + nat_isz + Inches(0.01)),
                                      nat_tw, Inches(0.28),
                                      f"NAT GW\n{nat['public_ip']}",
                                      6, True, C.TEXT, "ctr")
                            cx = int(nat_x + nat_tw / 2)
                            cy = int(nat_y + nat_isz / 2)
                            hw = int(nat_isz / 2)
                            hh = int(nat_isz / 2)
                            self.pos[nk] = (cx, cy, hw, hh)
                            self.shapes[nk] = nat_sid

            # Private Subnet
            pvs = tiers.get("Private", {}).get(az, [])
            if pvs:
                cidr_label = ", ".join(s["cidr"] for s in pvs if s["cidr"])
                self._box(L['priv_x'], sub_y, L['priv_w'], sub_h,
                          C.PRIV_BG, C.PRIV_BD)
                self._ilabel(L['priv_x'] + Inches(0.05), sub_y + Inches(0.03),
                             "private_subnet",
                             f"Private subnet  {cidr_label}", 7, color=C.PRIV_BD)
                icons, aux = self._collect_subnet_icons("Private", ai, pvs, res_ctx)
                self._place_icons_grid(icons, L['priv_x'], L['priv_w'],
                                       icon_y_base, "Private",
                                       icon_conns, all_icon_tiers)
                self._place_aux_badges(aux, L['priv_x'], L['priv_w'], sub_y)

            # Isolated Subnet
            isos = tiers.get("Isolated", {}).get(az, [])
            if isos:
                cidr_label = ", ".join(s["cidr"] for s in isos if s["cidr"])
                self._box(L['iso_x'], sub_y, L['iso_w'], sub_h,
                          C.PRIV_BG, C.PRIV_BD)
                self._ilabel(L['iso_x'] + Inches(0.05), sub_y + Inches(0.03),
                             "private_subnet",
                             f"Private subnet  {cidr_label}", 7, color=C.PRIV_BD)
                icons, aux = self._collect_subnet_icons("Isolated", ai, isos,
                                                        res_ctx)
                self._place_icons_grid(icons, L['iso_x'], L['iso_w'],
                                       icon_y_base, "Isolated",
                                       icon_conns, all_icon_tiers)
                self._place_aux_badges(aux, L['iso_x'], L['iso_w'], sub_y)

        # External actors (left of Cloud)
        ext_x = int(Inches(0.3))
        user_y = gw_first_y
        self._ibox(ext_x, user_y, "users", "End User", "user")

        if has_edge:
            edge_gap = Inches(0.85)
            edge_items = []
            if r53_zones:
                edge_items.append(("route53", "Route 53", "route53"))
            if cf_dists:
                edge_items.append(("cloudfront", "CloudFront", "cloudfront"))
            if api_gws:
                edge_items.append(("apigateway", "API Gateway", "apigateway"))

            if len(edge_items) == 1:
                icon, label, key = edge_items[0]
                self._ibox(ext_x, alb_y_pos, icon, label, key)
            else:
                total_h = edge_gap * (len(edge_items) - 1)
                start_y = int(alb_y_pos - total_h / 2)
                min_y = int(L['cloud_y'] + Inches(0.1))
                if start_y < min_y:
                    start_y = min_y
                for ei, (icon, label, key) in enumerate(edge_items):
                    self._ibox(ext_x, int(start_y + edge_gap * ei),
                               icon, label, key)

        # VPC-external services (below VPC)
        bottom_svc_gap = Inches(1.40)
        bottom_start_x = L['vpc_x'] + Inches(0.2)

        if infra_items and L['infra_y'] is not None:
            for idx, (icon, label, key) in enumerate(infra_items):
                self._ibox(int(bottom_start_x + bottom_svc_gap * idx),
                           int(L['infra_y']), icon, label, key)

        if has_svless and L['svless_y'] is not None:
            for idx, (icon, label, key) in enumerate(svless_items):
                self._ibox(int(bottom_start_x + bottom_svc_gap * idx),
                           int(L['svless_y']), icon, label, key)

        # VPC Peering
        if peerings:
            ibox_tw = Inches(1.2)
            peer_x = int(L['vpc_x'] + L['vpc_w'] - ibox_tw / 2)
            slide_w = Inches(16)
            max_x = int(slide_w - ibox_tw - Inches(0.05))
            if peer_x > max_x:
                peer_x = max_x
            peer_y = int(L['vpc_y'] + L['vpc_h'] / 2 - Inches(0.24))
            for pi, peer in enumerate(peerings):
                if peer["requester_vpc"] == vpc["id"]:
                    peer_label = f"VPC Peering\n{peer['accepter_cidr']}"
                else:
                    peer_label = f"VPC Peering\n{peer['requester_cidr']}"
                self._ibox(peer_x, int(peer_y + pi * Inches(1.0)),
                           "vpc_icon", peer_label, f"peering_{peer['id']}")

        # Legend
        legend_h = Inches(1.3)
        legend_y = max(user_y + int(Inches(1.0)), int(Inches(7.3)))
        asg_h = Inches(0.15) * (len(asgs) + 1) if asgs else 0
        total_needed = int(legend_h + Inches(0.10) + asg_h)
        cloud_bottom_int = int(L['cloud_bottom'])
        if legend_y + total_needed > cloud_bottom_int:
            legend_y = cloud_bottom_int - total_needed
        self._legend(Inches(0.15), legend_y)

        # ASG Annotation
        if asgs:
            asg_note_y = legend_y + int(legend_h) + int(Inches(0.10))
            asg_lines = ["Auto Scaling Groups:"]
            for asg in asgs:
                name = asg.get("name", asg["id"][:20])
                asg_lines.append(
                    f"  {name}  ({asg['min_size']}-{asg['max_size']})")
            self._txt(Inches(0.15), asg_note_y,
                      Inches(2.2), Inches(0.15) * len(asg_lines),
                      "\n".join(asg_lines), 6, False, C.TEXT_G)

        # Arrows
        inet_sgs = self.p.get_internet_facing_sgs()
        self._draw_arrows(albs, nats, rdss, igw, sg_conns, s3s, waf, azs,
                          cf_dists, api_gws, r53_zones, lambdas_serverless,
                          svc_conns, inet_sgs)

    # ==========================================================
    # Arrow drawing (adapted from v2)
    # ==========================================================
    def _draw_arrows(self, albs, nats, rdss, igw, sg_conns, s3s, waf, azs,
                     cf_dists, api_gws, r53_zones, lambdas_svless, svc_conns,
                     inet_sgs=None):
        sg_map = self.p.build_sg_to_resources_map()
        drawn = set()

        # Edge service chain
        if "route53" in self.pos and "cloudfront" in self.pos:
            self._arr("route53", "cloudfront", C.ARROW_INET, "DNS")
        elif "route53" in self.pos:
            for alb in albs:
                ak = f"alb_{alb['id']}"
                if ak in self.pos:
                    self._arr("route53", ak, C.ARROW_INET, "DNS")
                    break
            else:
                if igw:
                    igw_key = f"igw_{igw['id']}"
                    if igw_key in self.pos:
                        self._arr("route53", igw_key, C.ARROW_INET, "DNS")

        if "cloudfront" in self.pos:
            for alb in albs:
                ak = f"alb_{alb['id']}"
                if ak in self.pos:
                    self._arr("cloudfront", ak, C.ARROW_INET, "HTTPS")
                    break
            else:
                if igw:
                    igw_key = f"igw_{igw['id']}"
                    if igw_key in self.pos:
                        self._arr("cloudfront", igw_key, C.ARROW_INET, "HTTPS")

        if "apigateway" in self.pos:
            if "lambda_svless" in self.pos:
                self._arr("apigateway", "lambda_svless", C.ARROW_AWS, "invoke")
            else:
                for alb in albs:
                    ak = f"alb_{alb['id']}"
                    if ak in self.pos:
                        self._arr("apigateway", ak, C.ARROW_AWS, "HTTP")
                        break

        # End User -> IGW -> (WAF ->) ALB
        if igw:
            igw_key = f"igw_{igw['id']}"
            if igw_key in self.pos:
                self._arr("user", igw_key, C.ARROW_INET, "HTTPS")
                if waf and "waf" in self.pos:
                    self._arr(igw_key, "waf", C.ARROW_INET, "TCP(80,443)")
                else:
                    for alb in albs:
                        alb_key = f"alb_{alb['id']}"
                        if alb_key in self.pos:
                            self._arr(igw_key, alb_key, C.ARROW_INET,
                                      "TCP(80,443)")

        # IGW -> internet-facing resources
        if igw and inet_sgs:
            igw_key = f"igw_{igw['id']}"
            if igw_key in self.pos:
                alb_sg_ids = set()
                for alb in albs:
                    alb_sg_ids.update(alb.get("sg_ids", []))

                for isg in inet_sgs:
                    sg_id = isg["sg_id"]
                    if sg_id in alb_sg_ids:
                        continue
                    port = isg.get("port", "")
                    proto = isg.get("protocol", "tcp").upper()
                    label = f"{proto}({port})" if port else ""
                    for res in sg_map.get(sg_id, []):
                        tk = self._resolve_key(f"{res['prefix']}{res['id']}")
                        if tk and tk in self.pos:
                            aid = f"{igw_key}->{tk}"
                            if aid not in drawn:
                                drawn.add(aid)
                                self._arr(igw_key, tk, C.ARROW_INET, label)

        # SG-based internal connections
        for conn in sg_conns:
            frs = sg_map.get(conn["from_sg"], [])
            trs = sg_map.get(conn["to_sg"], [])
            port = conn.get("port", "")
            proto = conn.get("protocol", "tcp").upper()
            label = f"{proto}({port})" if port else ""

            fr_by_az = self._group_by_az(frs)
            tr_by_az = self._group_by_az(trs)

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
                            self._arr(fk, tk, C.ARROW_AWS, label)

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
                        self._arr(fk, tk, C.ARROW_AWS, label)

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
                                    self._arr(fk, tk, C.ARROW_AWS, label)
                        else:
                            tk = self._resolve_key(f"{tr['prefix']}{tr['id']}")
                            if tk:
                                aid = f"{fk}->{tk}"
                                if aid not in drawn:
                                    drawn.add(aid)
                                    self._arr(fk, tk, C.ARROW_AWS, label)

        # WAF -> ALB
        if waf:
            for alb in albs:
                alb_key = f"alb_{alb['id']}"
                if "waf" in self.pos and alb_key in self.pos:
                    self._arr("waf", alb_key, C.ARROW_AWS, "Filter")

        # Service-level connections
        for conn in svc_conns:
            ft = conn.get("from_type", "")
            fi = conn.get("from_id", "")
            tt = conn.get("to_type", "")
            ti = conn.get("to_id", "")
            label = conn.get("label", "")

            fk = self._find_pos_key(ft, fi)
            tk = self._find_pos_key(tt, ti)
            if fk and tk:
                aid = f"{fk}->{tk}"
                if aid not in drawn:
                    drawn.add(aid)
                    self._arr(fk, tk, C.ARROW_GRAY, label)

    def _find_pos_key(self, svc_type, svc_id):
        if svc_type in self.pos:
            return svc_type
        candidates = [f"{svc_type}_{svc_id}", svc_type, svc_id]
        for c in candidates:
            if c in self.pos:
                return c
        return None

    def _group_by_az(self, resources):
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
    # Drawing Primitives (DrawingML XML)
    # ==========================================================
    # Z-layer constants
    Z_BOX = 0       # Background boxes (Cloud, VPC, Subnet)
    Z_LABEL = 1     # Text labels on boxes
    Z_IMAGE = 2     # Icon images (drawn by openpyxl, ordered separately)
    Z_CONNECTOR = 3 # Connector arrows
    Z_ARROWLBL = 4  # Arrow text labels (topmost)

    def _box(self, x, y, w, h, fill, border, bw_pt=1.0, r_ratio=0.015):
        # Convert ratio to DrawingML adj value
        # In DrawingML, adj val 50000 = fully rounded (circle), val 0 = sharp corners
        # PPTX adjustments[0] = 0.015 means 1.5% rounding
        # Equivalent DrawingML: val = ratio * 50000 = 750
        corner_radius = int(r_ratio * 50000) if r_ratio > 0 else None
        elem = _make_shape_xml(
            self._next_id(), "box",
            left=int(x), top=int(y), width=int(w), height=int(h),
            fill_color=fill, line_color=border, line_width_pt=bw_pt,
            corner_radius=corner_radius)
        self._xml_elements.append((self.Z_BOX, elem))

    def _txt(self, x, y, w, h, text, sz=10, bold=False, color=None,
             alignment="l", z_layer=None):
        color = color or C.TEXT
        elem = _make_textbox_xml(
            self._next_id(), "txt",
            left=int(x), top=int(y), width=int(w), height=int(h),
            text=text, font_size=sz, font_bold=bold, font_color=color,
            alignment=alignment)
        layer = z_layer if z_layer is not None else self.Z_LABEL
        self._xml_elements.append((layer, elem))

    def _ilabel(self, x, y, icon, text, sz=8, bold=False, color=None):
        isz = Inches(0.22)
        if icon and icon in ICONS:
            self._images.append((ICONS[icon], int(x), int(y), int(isz), int(isz), None))
            self._txt(int(x) + isz + Inches(0.04), int(y),
                      Inches(3.5), isz, text, sz, bold, color)
        else:
            self._txt(int(x), int(y), Inches(3.5), Inches(0.22),
                      text, sz, bold, color)

    def _ibox(self, x, y, icon, label, key):
        isz = Inches(0.42)
        tw = Inches(1.2)
        ix = int(x + tw / 2 - isz / 2)

        sid = self._next_id()
        if icon in ICONS:
            self._images.append((ICONS[icon], ix, int(y), int(isz), int(isz), key))

        self._txt(int(x), int(y) + isz + Inches(0.01),
                  tw, Inches(0.28), label, 6, True, C.TEXT, "ctr")

        icon_cx = int(x + tw / 2)
        icon_cy = int(y + isz / 2)
        icon_hw = int(isz / 2)
        icon_hh = int(isz / 2)
        self.pos[key] = (icon_cx, icon_cy, icon_hw, icon_hh)
        self.shapes[key] = sid

    @staticmethod
    def _side_anchor(pos_data, target_cx, target_cy):
        if len(pos_data) == 4:
            cx, cy, hw, hh = pos_data
        else:
            cx, cy = pos_data
            hw, hh = Inches(0.3), Inches(0.3)

        dx = target_cx - cx
        dy = target_cy - cy

        if dx == 0 and dy == 0:
            return cx + hw, cy

        if hw == 0:
            hw = 1
        if hh == 0:
            hh = 1

        if abs(dx) * hh > abs(dy) * hw:
            if dx > 0:
                return cx + hw, cy
            else:
                return cx - hw, cy
        else:
            if dy > 0:
                return cx, cy + hh
            else:
                return cx, cy - hh

    @staticmethod
    def _cxn_idx(pos_data, target_cx, target_cy):
        """Return connection point index (0=top, 1=left, 2=bottom, 3=right)."""
        if len(pos_data) == 4:
            cx, cy, hw, hh = pos_data
        else:
            cx, cy = pos_data
            hw, hh = Inches(0.3), Inches(0.3)

        dx = target_cx - cx
        dy = target_cy - cy

        if dx == 0 and dy == 0:
            return 3  # right

        if hw == 0:
            hw = 1
        if hh == 0:
            hh = 1

        if abs(dx) * hh > abs(dy) * hw:
            return 3 if dx > 0 else 1  # right or left
        else:
            return 2 if dy > 0 else 0  # bottom or top

    def _arr(self, fk, tk, color, label=""):
        if fk not in self.pos or tk not in self.pos:
            return

        fp = self.pos[fk]
        tp = self.pos[tk]

        fcx, fcy = fp[0], fp[1]
        tcx, tcy = tp[0], tp[1]

        sx, sy = self._side_anchor(fp, tcx, tcy)
        ex, ey = self._side_anchor(tp, fcx, fcy)

        # Get shape IDs and connection indices for binding
        f_sid = self.shapes.get(fk)
        t_sid = self.shapes.get(tk)
        f_idx = self._cxn_idx(fp, tcx, tcy) if f_sid else None
        t_idx = self._cxn_idx(tp, fcx, fcy) if t_sid else None

        elem = _make_connector_xml(
            self._next_id(), f"{fk}_to_{tk}",
            x1=int(sx), y1=int(sy), x2=int(ex), y2=int(ey),
            color=color, line_width_pt=1.5, arrow=True,
            start_shape_id=f_sid, start_idx=f_idx,
            end_shape_id=t_sid, end_idx=t_idx)
        self._xml_elements.append((self.Z_CONNECTOR, elem))

        if label:
            dx = ex - sx
            dy = ey - sy
            arr_len = (dx * dx + dy * dy) ** 0.5
            if arr_len < Inches(0.5):
                return
            mx = int(sx + dx * 0.4)
            my = int(sy + dy * 0.4)
            if abs(dy) > abs(dx):
                mx += int(Inches(0.22))
            else:
                my -= int(Inches(0.18))
            self._txt(mx - int(Inches(0.5)), my - int(Inches(0.1)),
                      Inches(1.1), Inches(0.22), label, 6, True, color, "ctr",
                      z_layer=self.Z_ARROWLBL)

    def _legend(self, x, y):
        lw = Inches(2.2)
        lh = Inches(1.3)
        self._box(x, y, lw, lh, C.WHITE, "CCCCCC")
        self._txt(x + Inches(0.1), y + Inches(0.05),
                  Inches(1.5), Inches(0.18), "Legend:", 8, True)

        entries = [
            (C.ARROW_INET, "Internet traffic"),
            (C.ARROW_AWS, "AWS internal traffic"),
            (C.ARROW_PEER, "VPC Peering"),
            (C.ARROW_GRAY, "Service connection"),
        ]
        ly = y + Inches(0.26)
        for color, desc in entries:
            self._txt(x + Inches(0.1), ly, Inches(0.35), Inches(0.16),
                      "----->", 7, True, color)
            self._txt(x + Inches(0.48), ly, Inches(1.6), Inches(0.16),
                      desc, 7)
            ly += Inches(0.2)

    # ==========================================================
    # Save to xlsx (openpyxl + ZIP post-processing)
    # ==========================================================
    def _save_xlsx(self, out_path):
        wb = Workbook()
        ws = wb.active
        ws.title = "Network Diagram"
        ws.sheet_view.showGridLines = False

        # Build key->shape_id mapping for images (for connector binding)
        key_to_shape_id = {}
        image_pos_to_key = {}
        for path, left_emu, top_emu, w_emu, h_emu, key in self._images:
            if key and key in self.shapes:
                key_to_shape_id[key] = self.shapes[key]
                image_pos_to_key[(int(left_emu), int(top_emu))] = key

        # Add images via openpyxl API (they get proper rId references)
        from openpyxl.drawing.spreadsheet_drawing import AbsoluteAnchor
        from openpyxl.drawing.xdr import XDRPoint2D, XDRPositiveSize2D

        for path, left_emu, top_emu, w_emu, h_emu, key in self._images:
            img = XlImage(path)
            px_per_emu = 96.0 / EMU_PER_INCH
            img.width = int(w_emu * px_per_emu)
            img.height = int(h_emu * px_per_emu)
            img.anchor = AbsoluteAnchor(
                pos=XDRPoint2D(int(left_emu), int(top_emu)),
                ext=XDRPositiveSize2D(int(w_emu), int(h_emu)))
            ws.add_image(img)

        # Save to temporary file
        import tempfile
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".xlsx")
        os.close(tmp_fd)
        wb.save(tmp_path)

        # Post-process: reorder all elements by Z-layer
        # Z-order: boxes(0) → labels(1) → images(2) → connectors(3) → arrow_labels(4)
        drawing_file = 'xl/drawings/drawing1.xml'
        with zipfile.ZipFile(tmp_path, 'r') as zin:
            if drawing_file not in zin.namelist():
                os.rename(tmp_path, out_path)
                return

            with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    data = zin.read(item.filename)
                    if item.filename == drawing_file:
                        root = etree.fromstring(data)

                        # Extract all existing anchors (images from openpyxl)
                        existing_anchors = []
                        for abs_anchor in list(root.findall(
                                f"{{{XDR_NS}}}absoluteAnchor")):
                            # Rewrite pic IDs for connector binding
                            pic = abs_anchor.find(f"{{{XDR_NS}}}pic")
                            if pic is not None:
                                pos_el = abs_anchor.find(f"{{{XDR_NS}}}pos")
                                if pos_el is not None:
                                    px = int(pos_el.get("x", "0"))
                                    py = int(pos_el.get("y", "0"))
                                    key = image_pos_to_key.get((px, py))
                                    if key and key in key_to_shape_id:
                                        desired_id = key_to_shape_id[key]
                                        nv = pic.find(f"{{{XDR_NS}}}nvPicPr")
                                        if nv is not None:
                                            cNvPr = nv.find(
                                                f"{{{XDR_NS}}}cNvPr")
                                            if cNvPr is not None:
                                                cNvPr.set("id",
                                                          str(desired_id))
                            existing_anchors.append(abs_anchor)
                            root.remove(abs_anchor)

                        # Also remove twoCellAnchor / oneCellAnchor if any
                        for tag in ['twoCellAnchor', 'oneCellAnchor']:
                            for el in list(root.findall(f"{{{XDR_NS}}}{tag}")):
                                existing_anchors.append(el)
                                root.remove(el)

                        # Sort xml_elements by Z-layer
                        sorted_elems = sorted(self._xml_elements,
                                              key=lambda x: x[0])

                        # Rebuild drawing: boxes → labels → images → connectors → arrow_labels
                        # Insert shapes at z_layer < Z_IMAGE first
                        for z_layer, elem in sorted_elems:
                            if z_layer < self.Z_IMAGE:
                                root.append(elem)

                        # Insert images (z_layer = Z_IMAGE)
                        for anchor in existing_anchors:
                            root.append(anchor)

                        # Insert shapes at z_layer >= Z_IMAGE
                        for z_layer, elem in sorted_elems:
                            if z_layer >= self.Z_IMAGE:
                                root.append(elem)

                        data = etree.tostring(
                            root, xml_declaration=True,
                            encoding="UTF-8", standalone=True)
                    zout.writestr(item, data)
        os.remove(tmp_path)


# ============================================================
def main():
    if len(sys.argv) < 2:
        print("Usage: python generate_diagram_excel.py <config.json> [--list] [--vpc vpc-id1,id2]")
        sys.exit(1)

    inp = sys.argv[1]
    if not os.path.exists(inp):
        print(f"Error: {inp} not found")
        sys.exit(1)

    out = os.path.join(os.path.dirname(os.path.abspath(inp)),
                       "network_diagram.xlsx")
    parser = AWSConfigParser(inp)

    print(f"Parsing: {inp}")
    for rt, items in sorted(parser.by_type.items()):
        print(f"  {rt}: {len(items)}")

    if "--list" in sys.argv:
        dg = DiagramExcel(parser)
        vpcs = dg.list_vpcs()
        print(f"\nVPCs found: {len(vpcs)}")
        for v in sorted(vpcs, key=lambda x: -x["score"]):
            default_tag = " (default)" if v.get("is_default") else ""
            print(f"  {v['id']}  {v['name']:30s}  {v['cidr']:18s}  score={v['score']}{default_tag}")
        print(f"\nUsage: python generate_diagram_excel.py {inp} --vpc {vpcs[0]['id']}")
        return

    vpc_ids = None
    for i, arg in enumerate(sys.argv):
        if arg == "--vpc" and i + 1 < len(sys.argv):
            vpc_ids = [v.strip() for v in sys.argv[i + 1].split(",")]

    print(f"\nGenerating Excel diagram...")
    DiagramExcel(parser).generate(out, vpc_ids=vpc_ids)
    print("Done!")


if __name__ == "__main__":
    main()
