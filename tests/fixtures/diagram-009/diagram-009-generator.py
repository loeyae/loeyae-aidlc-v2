#!/usr/bin/env python3
"""Generate diagram-009 actual SVG and sidecar from the approved Mermaid flow."""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIAGRAM_ID = "diagram-009"
MERMAID = ROOT / "diagram-009.mmd"
MANIFEST = ROOT / "diagram-009.diagram.json"
SVG = ROOT / "diagram-009.svg"
EXPECTED = ROOT / "diagram-009.expected.json"
FONT = "Microsoft YaHei, 微软雅黑, sans-serif"
CONFIG_SUMMARY = "按图表设计流程从冻结 Mermaid 来源重建门店自提订单履约流程：TB 主轴、局部分支 lane、受控关系合并与最短合法反馈回路"
GENERATOR_VERSION = "6.1.1"
CONFIG_DIGEST = "sha256:" + hashlib.sha256(CONFIG_SUMMARY.encode()).hexdigest()
GEOMETRY_PROFILE = {
    "version": "1",
    "nodeHorizontalPadding": 16,
    "nodeVerticalPadding": 12,
    "frameLineHeight": 24,
    "entityGap": 24,
    "portGap": 36,
    "obstacleGap": 12,
    "laneGap": 48,
    "canvasMargin": 24,
}
SHAPE_BASE_SIZES = {
    "round": {"minWidth": 160, "minHeight": 72, "boundaryModel": "rectangle"},
    "rect": {"minWidth": 160, "minHeight": 72, "boundaryModel": "rectangle"},
    "diamond": {"minWidth": 180, "minHeight": 120, "boundaryModel": "diamond"},
    "ellipse": {"minWidth": 160, "minHeight": 96, "boundaryModel": "ellipse"},
    "database": {"minWidth": 180, "minHeight": 96, "boundaryModel": "database"},
    "actor": {"minWidth": 160, "minHeight": 120, "boundaryModel": "actor"},
    "note": {"minWidth": 180, "minHeight": 96, "boundaryModel": "note"},
}

AXIS_SPACING = {
    "referenceShape": "rect",
    "referenceWidth": 400,
    "referenceHeight": 120,
    "referenceLongSide": 400,
    "referenceShortSide": 120,
    "lrMinimumGap": 200,
    "tbMinimumGap": 120,  # ceil(1.0 * referenceHeight)
}

# This model is the controlled semantic transcription of diagram-009.mmd.  It deliberately
# contains business identities and relationships only; all coordinates/routes are generated below.
NODES = [
    ("open-store", "打开商城", "rect"), ("switch-pickup", "切换到店自提模式", "rect"),
    ("select-store", "选择自提门店", "rect"), ("browse-products", "浏览门店商品", "rect"),
    ("add-cart", "加入购物车", "rect"), ("cart-checkout", "购物车页点击结算", "rect"),
    ("minimum-order", "达到最低下单金额", "diamond"), ("checkout-blocked", "购物车页提示不可结算", "rect"),
    ("product-validation", "校验商品可售 上下架 库存", "rect"), ("checkout", "进入结算页", "rect"),
    ("pickup-time", "选择自提时间", "rect"), ("coupon", "选择优惠券", "rect"),
    ("amount-confirmation", "确认金额明细", "rect"), ("reserve-order", "提交订单·预占库存", "rect"),
    ("initiate-payment", "发起支付", "rect"), ("alcohol-check", "是否含酒品", "diamond"),
    ("age-confirmation", "展示限酒令提示 确认满18岁", "rect"), ("payment-success", "支付是否成功", "diamond"),
    ("deduct-inventory", "扣减库存·核销优惠券", "rect"), ("order-detail", "进入订单详情页", "rect"),
    ("fulfillment-progress", "展示履约进度 预计时间 商品明细 金额明细", "rect"), ("order-preparing", "订单准备中", "rect"),
    ("payment-pending", "订单保持待付款·库存仍预占", "rect"), ("pending-action", "待付款处理", "diamond"),
    ("cancel-release", "取消订单·释放库存退券·订单关闭", "rect"), ("store-accept", "门店接单·开始拣货", "rect"),
    ("picking-result", "拣货结果", "diamond"), ("stockout-strategy", "缺货处理方式", "diamond"),
    ("full-refund", "整单退款·订单关闭", "rect"), ("partial-refund", "缺货部分退款·剩余继续履约", "rect"),
    ("substitution-start", "拣货员发起换品", "rect"), ("substitution-recommend", "系统推荐替代品", "rect"),
    ("substitution-confirm", "推送顾客确认换货", "rect"), ("substitution-accepted", "顾客是否接受", "diamond"),
    ("substitute-picked", "拣出替代品", "rect"), ("substitute-available", "替代品是否拣到", "diamond"),
    ("order-amend", "改单·替换商品行", "rect"), ("refund-partial", "缺货部分转退款", "rect"),
    ("waiting-pickup", "门店备货·等待自取", "rect"), ("pickup-notification", "收到到店通知与取货凭证", "rect"),
    ("pickup-on-time", "是否按期到店取货", "diamond"), ("present-voucher", "到店出示取货凭证", "rect"),
    ("handoff", "店员在 Dmall APP 核销签收", "rect"), ("completed", "提货完成·订单完成", "rect"),
    ("reject", "您已拒收 · 全额退款", "rect"), ("overdue", "超期訂單完成 · 不退款", "rect"),
    ("cancel-request", "门店是否已开始拣货", "diamond"), ("cancel-success", "取消成功并退款", "rect"),
    ("cancel-blocked", "不可取消·引导签收后申请退款", "rect"), ("after-sale", "仅退款·售后有效期内", "rect"),
]

# Mermaid 标识与显示节点一一对应；该映射是 source_graph 的不可变来源身份。
SOURCE_NODE_IDS = [
    "A", "B", "C", "E", "F", "G", "H", "H1", "CK1", "G2", "I", "J2", "J", "K", "L", "ALC", "ALC2", "M", "PAY1", "PD1", "PD2", "N", "M1", "M2", "M3",
    "PK1", "PK2", "PKC", "PK4", "PK3", "EX1", "EX2", "EX3", "EX4", "EX5", "EX6", "EX8", "EX7", "O", "P", "Q", "R", "S", "T", "RJ", "U1", "V", "W", "X", "Y",
]

# (source, target, visible label, line kind).  Edge IDs are stable in the Mermaid statement order.
RELATIONS = [
    ("open-store", "switch-pickup", None, "directed"), ("switch-pickup", "select-store", None, "directed"),
    ("select-store", "browse-products", None, "directed"), ("browse-products", "add-cart", None, "directed"),
    ("add-cart", "cart-checkout", None, "directed"), ("cart-checkout", "minimum-order", None, "directed"),
    ("minimum-order", "checkout-blocked", "否", "directed"), ("checkout-blocked", "add-cart", None, "directed"),
    ("minimum-order", "product-validation", "是", "directed"), ("product-validation", "checkout", None, "directed"),
    ("checkout", "pickup-time", None, "directed"), ("pickup-time", "coupon", None, "directed"),
    ("coupon", "amount-confirmation", None, "directed"), ("amount-confirmation", "reserve-order", None, "directed"),
    ("reserve-order", "initiate-payment", None, "directed"), ("initiate-payment", "alcohol-check", None, "directed"),
    ("alcohol-check", "payment-success", "否", "directed"), ("alcohol-check", "age-confirmation", "是", "directed"),
    ("age-confirmation", "payment-success", None, "directed"), ("payment-success", "deduct-inventory", "是", "directed"),
    ("deduct-inventory", "order-detail", None, "directed"), ("order-detail", "fulfillment-progress", None, "directed"),
    ("fulfillment-progress", "order-preparing", None, "directed"), ("payment-success", "payment-pending", "否", "directed"),
    ("payment-pending", "pending-action", None, "directed"), ("pending-action", "initiate-payment", "重新发起支付", "directed"),
    ("pending-action", "cancel-release", "主动取消／支付超时15分钟未付", "directed"),
    ("order-preparing", "store-accept", None, "directed"), ("store-accept", "picking-result", None, "directed"),
    ("picking-result", "waiting-pickup", "全部拣到", "directed"), ("picking-result", "stockout-strategy", "部分缺货", "directed"),
    ("picking-result", "full-refund", "全部缺货", "directed"), ("stockout-strategy", "partial-refund", "部分退款", "directed"),
    ("stockout-strategy", "substitution-start", "部分换货", "directed"), ("substitution-start", "substitution-recommend", None, "directed"),
    ("substitution-recommend", "substitution-confirm", None, "directed"), ("substitution-confirm", "substitution-accepted", None, "directed"),
    ("substitution-accepted", "substitute-picked", "接受", "directed"), ("substitution-accepted", "refund-partial", "拒绝/超时未回应", "directed"),
    ("substitute-picked", "substitute-available", None, "directed"),
    ("substitute-available", "order-amend", "拣到", "directed"), ("substitute-available", "refund-partial", "拣不到", "directed"),
    ("partial-refund", "waiting-pickup", None, "directed"), ("order-amend", "waiting-pickup", None, "directed"),
    ("refund-partial", "waiting-pickup", None, "directed"), ("waiting-pickup", "pickup-notification", None, "directed"),
    ("pickup-notification", "pickup-on-time", None, "directed"), ("pickup-on-time", "present-voucher", "是", "directed"),
    ("present-voucher", "handoff", None, "directed"), ("handoff", "completed", None, "directed"),
    ("pickup-on-time", "reject", "到店后当面拒收", "directed"), ("pickup-on-time", "overdue", "逾期未取", "directed"),
    ("order-preparing", "cancel-request", "发起取消", "dashed"), ("cancel-request", "cancel-success", "否·未开始拣货", "directed"),
    ("cancel-request", "cancel-blocked", "是·已开始拣货", "directed"), ("cancel-blocked", "waiting-pickup", "继续履约", "dashed"),
    ("completed", "after-sale", "申请售后", "dashed"),
]
RELATION_EDGE_IDS = [f"edge-{index:03d}" for index in [*range(1, 28), *range(29, 41), *range(42, 60)]]
SOURCE_RELATION_MERGES = [{
    "display_edge_id": "edge-027",
    "source_relation_ordinals": [27, 28],
    "source_relations": [
        {"from": "pending-action", "to": "cancel-release", "label": "主动取消"},
        {"from": "pending-action", "to": "cancel-release", "label": "支付超时15分钟未付"},
    ],
    "display_label": "主动取消／支付超时15分钟未付",
    "reason": "两条 Mermaid 实线关系端点与线型相同；合并为同轴直连以保留条件并消除无业务必要的端口偏移和绕行。",
}, {
    "display_edge_id": "edge-040",
    "source_relation_ordinals": [40, 41],
    "source_relations": [
        {"from": "substitution-accepted", "to": "refund-partial", "label": "拒绝"},
        {"from": "substitution-accepted", "to": "refund-partial", "label": "超时未回应"},
    ],
    "display_label": "拒绝/超时未回应",
    "reason": "不修改 Mermaid 来源；同一判断到同一退款目标的两条条件合并为一条可见连接。",
}]
PRIMARY_FLOW_NODE_IDS = [
    "open-store", "switch-pickup", "select-store", "browse-products", "add-cart", "cart-checkout", "minimum-order",
    "product-validation", "checkout", "pickup-time", "coupon", "amount-confirmation", "reserve-order", "initiate-payment",
    "alcohol-check", "payment-success", "deduct-inventory", "order-detail", "fulfillment-progress", "order-preparing",
    "store-accept", "picking-result", "waiting-pickup", "pickup-notification", "pickup-on-time", "present-voucher", "handoff", "completed",
]
PRIMARY_FLOW_EDGE_IDS = {
    RELATION_EDGE_IDS[index]
    for index, (source, target, _label, _kind) in enumerate(RELATIONS)
    if (source, target) in set(zip(PRIMARY_FLOW_NODE_IDS, PRIMARY_FLOW_NODE_IDS[1:]))
}
LOOP_EDGE_INDEXES = {
    7: ("cart-retry-right", "right", 840, "最低金额不满足时使用紧邻不可结算节点的最窄合法右侧反馈 lane 返回购物车"),
    25: ("payment-retry-left", "left", 890, "待付款订单避开待付款节点左边界后使用最窄合法左侧反馈 lane 重新发起支付"),
    55: ("cancel-continue-left", "left", 960, "已开始拣货不可取消时沿左侧局部反馈 lane 继续履约"),
}

LOOP_EDGE_IDS = {RELATION_EDGE_IDS[index] for index in LOOP_EDGE_INDEXES}

# 先冻结业务阅读计划，再由统一路由函数计算端口、候选路径和实际边界。
# 坐标是 raw layout 坐标，最终画布平移由 translate_to_canvas 统一完成。
LAYOUT_PLAN = {
    "direction": "TB",
    "main_axis": 0,
    "node_centers": {
        "open-store": (0, 120), "switch-pickup": (0, 300), "select-store": (0, 480),
        "browse-products": (0, 660), "add-cart": (0, 840), "cart-checkout": (0, 1020),
        "minimum-order": (0, 1200), "checkout-blocked": (600, 1380), "product-validation": (0, 1380),
        "checkout": (0, 1560), "pickup-time": (0, 1740), "coupon": (0, 1920),
        "amount-confirmation": (0, 2100), "reserve-order": (0, 2280), "initiate-payment": (0, 2460),
        "alcohol-check": (0, 2640), "age-confirmation": (600, 3000), "payment-success": (0, 3000),
        "payment-pending": (-650, 3180), "deduct-inventory": (0, 3180), "order-detail": (0, 3360),
        "pending-action": (-650, 3420), "fulfillment-progress": (0, 3540), "cancel-release": (-650, 3660),
        "order-preparing": (0, 3780), "store-accept": (0, 4020), "cancel-request": (-1320, 3990),
        "picking-result": (0, 4260), "cancel-success": (-1320, 4200), "cancel-blocked": (-840, 4200),
        "stockout-strategy": (1000, 4500), "full-refund": (-720, 4500), "partial-refund": (450, 4680),
        "substitution-start": (1000, 4680), "substitution-recommend": (1000, 4860),
        "substitution-confirm": (1000, 5040), "substitution-accepted": (1000, 5220),
        "substitute-picked": (1000, 5400), "substitute-available": (1000, 5580),
        "order-amend": (1000, 5760), "refund-partial": (1800, 5760),
        "waiting-pickup": (0, 6060), "pickup-notification": (0, 6240), "pickup-on-time": (0, 6420),
        "present-voucher": (0, 6600), "handoff": (0, 6780), "completed": (0, 6960),
        "after-sale": (0, 7140), "reject": (650, 6600), "overdue": (-650, 6600),
    },
    # TB：主流程出口走 bottom，局部分支从左右离开；目标默认从 top 进入。
    "side_branch_ports": {
        "edge-007": "right", "edge-018": "right", "edge-024": "left",
        "edge-027": "left", "edge-032": "right", "edge-033": "left",
        "edge-035": "right", "edge-040": "right", "edge-044": "right",
        "edge-053": "right", "edge-054": "left", "edge-055": "left", "edge-057": "right",
    },
    "branch_layer_exception_sources": {"picking-result", "substitution-accepted"},
}
BRANCH_GROUP_CONFIGS = [
    ("alcohol-check", ["edge-017", "edge-018"], None, 1, "inline", "酒品年龄判断分支在支付成功节点合流。"),
    ("cancel-request", ["edge-056", "edge-057"], None, 0, "inline", "取消请求按是否已开始拣货进入不同取消终态。"),
    ("minimum-order", ["edge-007", "edge-009"], None, 1, "inline", "最低金额判断分为不可结算和继续履约两路。"),
    ("payment-success", ["edge-020", "edge-024"], None, 1, "inline", "支付成功判断分为扣减库存和保持待付款两路。"),
    ("pending-action", ["edge-026", "edge-027"], None, 0, "inline", "待付款处理分为重新支付和受控合并的取消条件；合并边完整映射主动取消与支付超时。"),
    ("picking-result", ["edge-031", "edge-032", "edge-033"], None, 3, "local-lane", "拣货结果分为继续取货、缺货策略和全额退款局部支路。"),
    ("pickup-on-time", ["edge-050", "edge-053", "edge-054"], None, 0, "inline", "到店取货判断分为正常交接、拒绝和逾期三路。"),
    ("stockout-strategy", ["edge-034", "edge-035"], None, 2, "inline", "缺货策略分为部分退款和换货流程两路。"),
    ("substitute-available", ["edge-043", "edge-044"], None, 0, "local-lane", "换货可用判断分为订单修改和部分退款局部支路。"),
    ("substitution-accepted", ["edge-039", "edge-040"], None, 1, "local-lane", "顾客接受换货后分为继续拣货和合并条件的部分退款。"),
]
BRANCH_PRIMARY_EDGE_IDS = {
    "alcohol-check": "edge-017",
    "cancel-request": "edge-056",
    "minimum-order": "edge-009",
    "payment-success": "edge-020",
    "picking-result": "edge-031",
    "pickup-on-time": "edge-050",
    "stockout-strategy": "edge-035",
    "substitute-available": "edge-043",
    "substitution-accepted": "edge-039",
}

LOCAL_APPROACH_GAPS = {}
LOCAL_APPROACH_ABOVE_EDGES = set()
LOCAL_CLEARANCE_DISTANCES = {"edge-047": 360}
LABEL_SIDE_OFFSETS = {"edge-044": -64}
LOCAL_CLEARANCE_EDGES = {"edge-047"}
DECLARED_CROSSING_PAIRS = set()
TARGET_OFFSETS = {
    "edge-004": 0, "edge-008": 160, "edge-015": 0,
    "edge-040": 32, "edge-044": -32, "edge-045": 40, "edge-046": 160, "edge-047": 200,
    "edge-031": 0, "edge-058": -80,
}
# 这些是实际发生的跨业务层局部支路，不能用空声明掩盖；其余分支保持同层。
BRANCH_LAYER_EXCEPTION_EDGE_IDS = {"edge-031", "edge-032", "edge-033", "edge-039", "edge-040"}


def sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def text_width(text: str, font_size: float = 16) -> float:
    return sum(font_size * (0.35 if character.isspace() else 1 if ord(character) >= 0x2E80 else 0.56) for character in text)


def node_size(label, shape):
    lines = str(label).splitlines() or [""]
    text_width_value = max(text_width(line) for line in lines)
    base = SHAPE_BASE_SIZES[shape]
    width = max(base["minWidth"], int(text_width_value + GEOMETRY_PROFILE["nodeHorizontalPadding"] * 2 + 0.999))
    height = max(base["minHeight"], int(len(lines) * GEOMETRY_PROFILE["frameLineHeight"] + GEOMETRY_PROFILE["nodeVerticalPadding"] * 2 + 0.999))
    if shape == "diamond":
        return max(width, 320), max(height, 180)
    return max(width, 400), max(height, 120)


def spaced_node_centers(node_sizes):
    """按原始业务层保留同层关系，并用方向性 TB 基准扩展层间净空。"""
    raw_centers = LAYOUT_PLAN["node_centers"]
    layers = sorted({center_y for _center_x, center_y in raw_centers.values()})
    spaced_layers = {layers[0]: layers[0]}
    for previous_layer, current_layer in zip(layers, layers[1:]):
        previous_half_height = max(node_sizes[node_id][1] / 2 for node_id, center in raw_centers.items() if center[1] == previous_layer)
        current_half_height = max(node_sizes[node_id][1] / 2 for node_id, center in raw_centers.items() if center[1] == current_layer)
        spaced_layers[current_layer] = spaced_layers[previous_layer] + previous_half_height + AXIS_SPACING["tbMinimumGap"] + current_half_height
    return {
        node_id: (center_x, spaced_layers[center_y])
        for node_id, (center_x, center_y) in raw_centers.items()
    }


def geometry_profile_actual():
    return {
        "version": GEOMETRY_PROFILE["version"],
        "entityGap": GEOMETRY_PROFILE["entityGap"],
        "portGap": GEOMETRY_PROFILE["portGap"],
        "obstacleGap": GEOMETRY_PROFILE["obstacleGap"],
        "laneGap": GEOMETRY_PROFILE["laneGap"],
        "shapeBaseSizes": SHAPE_BASE_SIZES,
        "axisSpacing": AXIS_SPACING,
    }


def geometry_profile_expected():
    return {
        "version": GEOMETRY_PROFILE["version"],
        "entity_gap": GEOMETRY_PROFILE["entityGap"],
        "port_gap": GEOMETRY_PROFILE["portGap"],
        "obstacle_gap": GEOMETRY_PROFILE["obstacleGap"],
        "lane_gap": GEOMETRY_PROFILE["laneGap"],
        "shape_base_sizes": {
            shape: {
                "min_width": profile["minWidth"],
                "min_height": profile["minHeight"],
                "boundary_model": profile["boundaryModel"],
            }
            for shape, profile in SHAPE_BASE_SIZES.items()
        },
        "axis_spacing": {
            "reference_shape": AXIS_SPACING["referenceShape"],
            "reference_width": AXIS_SPACING["referenceWidth"],
            "reference_height": AXIS_SPACING["referenceHeight"],
            "reference_long_side": AXIS_SPACING["referenceLongSide"],
            "reference_short_side": AXIS_SPACING["referenceShortSide"],
            "lr_minimum_gap": AXIS_SPACING["lrMinimumGap"],
            "tb_minimum_gap": AXIS_SPACING["tbMinimumGap"],
        },
    }


def compact(points):
    result = []
    for point in points:
        if not result or result[-1] != point:
            result.append(point)
    changed = True
    while changed:
        changed = False
        for index in range(1, len(result) - 1):
            a, b, c = result[index - 1:index + 2]
            if (a[0] == b[0] == c[0]) or (a[1] == b[1] == c[1]):
                result.pop(index)
                changed = True
                break
    return result


def port_point(node, port, offset=0):
    cx, cy = node["x"] + node["width"] / 2, node["y"] + node["height"] / 2
    if port == "top": return [cx + offset, node["y"]]
    if port == "right": return [node["x"] + node["width"], cy + offset]
    if port == "bottom": return [cx - offset, node["y"] + node["height"]]
    return [node["x"], cy - offset]


def arrow_path(end, port):
    """Draw one arrowhead outside the target boundary, pointing into the target."""
    x, y = end
    if port == "left": return f"M {x} {y} L {x - 10} {y - 5} L {x - 10} {y + 5} Z"
    if port == "right": return f"M {x} {y} L {x + 10} {y - 5} L {x + 10} {y + 5} Z"
    if port == "top": return f"M {x} {y} L {x - 5} {y - 10} L {x + 5} {y - 10} Z"
    return f"M {x} {y} L {x - 5} {y + 10} L {x + 5} {y + 10} Z"


def directions(points):
    result = []
    for first, second in zip(points, points[1:]):
        direction = "right" if second[0] > first[0] else "left" if second[0] < first[0] else "down" if second[1] > first[1] else "up"
        if not result or result[-1] != direction:
            result.append(direction)
    return result


def route_loop(start, end, lane_x, source_clearance, from_port="bottom", to_port="top"):
    """在声明的外侧 lane 中生成最少必要折点的反馈路径。"""
    near_end_y = end[1] - 30
    if from_port in {"left", "right"}:
        if to_port == "left":
            # 左侧反馈从源节点外侧进入目标左端；不能把 target:left 当作 top 端点处理。
            return compact([start, [lane_x, start[1]], [lane_x, end[1]], end])
        # 侧向离开源节点，在独立 lane 中回到目标层，再从目标顶端进入。
        return compact([start, [lane_x, start[1]], [lane_x, near_end_y], [end[0], near_end_y], end])
    if from_port == "bottom" and to_port == "left":
        # 支付重试从判断节点下方离开，先绕过取消节点列，再从 initiate-payment 左侧回入。
        exit_y = start[1] + source_clearance
        return compact([start, [start[0], exit_y], [lane_x, exit_y], [lane_x, end[1]], end])
    if start[0] == lane_x:
        # 源节点已占据声明 lane，省略无意义的水平清场段。
        return compact([start, [start[0], near_end_y], [end[0], near_end_y], end])
    exit_y = start[1] + source_clearance
    return compact([start, [start[0], exit_y], [lane_x, exit_y], [lane_x, near_end_y], [end[0], near_end_y], end])


def route_local(start, end, from_port, to_port, force_clearance=False, approach_gap=30, approach_above=False, clearance_distance=72, side_corridor_x=None):
    if from_port == "bottom" and to_port == "top":
        if start[0] == end[0] and end[1] > start[1]:
            return [start, end]
        middle_y = min(end[1] - 30, max(start[1] + 30, (start[1] + end[1]) / 2))
        return compact([start, [start[0], middle_y], [end[0], middle_y], end])
    if from_port in {"left", "right"} and to_port == "top":
        # Branches aimed back toward the spine first clear the source through its
        # declared outward port, then turn inside their local branch region.
        outward = 1 if from_port == "right" else -1
        if force_clearance or (end[0] - start[0]) * outward <= 0:
            clear_x = start[0] + outward * clearance_distance
            approach_y = start[1] - approach_gap if approach_above else end[1] - approach_gap
            return compact([start, [clear_x, start[1]], [clear_x, approach_y], [end[0], approach_y], end])
        return compact([start, [end[0], start[1]], end])
    if from_port in {"left", "right"} and to_port in {"left", "right"}:
        if start[1] == end[1] and not force_clearance:
            return [start, end]
        if force_clearance and from_port == "right" and to_port == "right":
            # 目标右端外侧留出竖向走廊，最后一段从右侧水平进入目标端口。
            corridor_x = max(start[0] + clearance_distance, end[0] + 40)
            return compact([start, [corridor_x, start[1]], [corridor_x, end[1]], end])
        middle_x = side_corridor_x if side_corridor_x is not None else (start[0] + end[0]) / 2
        if force_clearance:
            clearance_y = start[1] - clearance_distance if approach_above else start[1] + clearance_distance
            outward = 1 if from_port == "right" else -1
            clear_x = start[0] + outward * 40
            return compact([start, [clear_x, start[1]], [clear_x, clearance_y], [middle_x, clearance_y], [middle_x, end[1]], end])
        return compact([start, [middle_x, start[1]], [middle_x, end[1]], end])
    if from_port == "bottom":
        middle_y = max(start[1] + 72, end[1] - 72)
        return compact([start, [start[0], middle_y], [end[0], middle_y], end])
    return compact([start, [end[0], start[1]], end])


def place_label(edge):
    label_width = text_width(edge["labelText"], 14)
    minimum_side_offset = label_width / 2 + 6
    if edge["id"] == "edge-027":
        source = edge["points"][0]
        target = edge["points"][-1]
        return {"text": edge["labelText"], "x": source[0] + max(100, minimum_side_offset), "y": (source[1] + target[1]) / 2, "fontSize": 14}
    vertical = [(first, second) for first, second in zip(edge["points"], edge["points"][1:]) if first[0] == second[0] and first[1] != second[1]]
    if vertical:
        first, second = max(vertical, key=lambda segment: abs(segment[1][1] - segment[0][1]))
        requested_side_offset = LABEL_SIDE_OFFSETS.get(edge["id"], 64)
        side_offset = max(abs(requested_side_offset), minimum_side_offset)
        if requested_side_offset < 0:
            side_offset = -side_offset
        side = -side_offset if edge["fromPort"] in {"left", "bottom"} else side_offset
        return {"text": edge["labelText"], "x": first[0] + side, "y": (first[1] + second[1]) / 2, "fontSize": 14}
    first, second = edge["points"][0], edge["points"][1]
    return {"text": edge["labelText"], "x": (first[0] + second[0]) / 2, "y": first[1] - 42, "fontSize": 14}


def translate_to_canvas(nodes, edges):
    min_x = min(node["x"] for node in nodes.values())
    max_x = max(node["x"] + node["width"] for node in nodes.values())
    min_y = min(node["y"] for node in nodes.values())
    max_y = max(node["y"] + node["height"] for node in nodes.values())
    for edge in edges:
        for x, y in edge["points"]:
            min_x, max_x = min(min_x, x - 10), max(max_x, x + 10)
            min_y, max_y = min(min_y, y - 10), max(max_y, y + 10)
        if "label" in edge:
            label = edge["label"]
            half_width = text_width(label["text"], 14) / 2 + 8
            min_x, max_x = min(min_x, label["x"] - half_width), max(max_x, label["x"] + half_width)
            min_y, max_y = min(min_y, label["y"] - 22), max(max_y, label["y"] + 22)
    padding = 64
    dx, dy = padding - min_x, padding - min_y
    for node in nodes.values():
        node["x"] += dx
        node["y"] += dy
    for edge in edges:
        edge["points"] = [[x + dx, y + dy] for x, y in edge["points"]]
        if "label" in edge:
            edge["label"]["x"] += dx
            edge["label"]["y"] += dy
    return {"width": int(max_x - min_x + 2 * padding), "height": int(max_y - min_y + 2 * padding), "mainAxis": LAYOUT_PLAN["main_axis"] + dx}


def make_model():
    node_sizes = {node_id: node_size(label, shape) for node_id, label, shape in NODES}
    spaced_centers = spaced_node_centers(node_sizes)
    nodes = {}
    for node_id, label, shape in NODES:
        width, height = node_sizes[node_id]
        center_x, center_y = spaced_centers[node_id]
        nodes[node_id] = {"id": node_id, "shape": shape, "label": label, "x": center_x - width / 2, "y": center_y - height / 2, "width": width, "height": height, "fontSize": 16}

    outgoing = {}
    relation_targets = {}
    for index, (source, target, _label, _kind) in enumerate(RELATIONS, 1):
        edge_id = RELATION_EDGE_IDS[index - 1]
        outgoing.setdefault(source, []).append(edge_id)
        relation_targets[edge_id] = target

    edges = []
    for index, (source, target, label, kind) in enumerate(RELATIONS, 1):
        edge_id = RELATION_EDGE_IDS[index - 1]
        source_node, target_node = nodes[source], nodes[target]
        is_branch = len(outgoing[source]) >= 2 and source_node["shape"] == "diamond"
        loop = LOOP_EDGE_INDEXES.get(index - 1)
        if loop:
            if edge_id == "edge-026":
                from_port, to_port = "left", "left"
            elif edge_id == "edge-008":
                from_port, to_port = "right", "top"
            else:
                from_port, to_port = "bottom", "top"
        elif edge_id == "edge-027":
            # 主动取消与支付超时是同端点、同线型的受控来源合并；沿同轴主线直接进入取消释放节点。
            from_port, to_port = "bottom", "top"
        elif is_branch:
            if edge_id == BRANCH_PRIMARY_EDGE_IDS.get(source) or edge_id in PRIMARY_FLOW_EDGE_IDS:
                from_port = "bottom"
            else:
                local_branch_edges = [candidate for candidate in outgoing[source] if candidate not in PRIMARY_FLOW_EDGE_IDS and candidate not in LOOP_EDGE_IDS]
                if not any(candidate in PRIMARY_FLOW_EDGE_IDS for candidate in outgoing[source]) and len(local_branch_edges) >= 3 and edge_id == local_branch_edges[0]:
                    from_port = "bottom"
                else:
                    duplicate_target_edges = [candidate for candidate in local_branch_edges if relation_targets[candidate] == target]
                    if len(duplicate_target_edges) > 1:
                        from_port = "left" if duplicate_target_edges.index(edge_id) % 2 == 0 else "right"
                    else:
                        source_center_x = source_node["x"] + source_node["width"] / 2
                        target_center_x = target_node["x"] + target_node["width"] / 2
                        if target_center_x == source_center_x:
                            raise SystemExit(f"local branch {edge_id} has no lateral target lane")
                        from_port = "right" if target_center_x > source_center_x else "left"
            to_port = "top"
        elif edge_id == "edge-046":
            from_port, to_port = "bottom", "top"
        elif edge_id == "edge-025":
            same_lane = source_node["x"] + source_node["width"] / 2 == target_node["x"] + target_node["width"] / 2
            from_port, to_port = ("bottom", "top") if same_lane else ("right", "top")
        elif edge_id == "edge-055":
            # 矩形备货节点的取消关系从局部左支路进入取消判断顶部，避免与判断出口共线路径重叠。
            from_port, to_port = "left", "top"
        elif target_node["shape"] == "diamond" and source_node["x"] + source_node["width"] / 2 != target_node["x"] + target_node["width"] / 2:
            source_center_x = source_node["x"] + source_node["width"] / 2
            target_center_x = target_node["x"] + target_node["width"] / 2
            from_port, to_port = ("right", "left") if source_center_x < target_center_x else ("left", "right")
        elif source_node["x"] + source_node["width"] / 2 == target_node["x"] + target_node["width"] / 2 and target_node["y"] > source_node["y"]:
            from_port, to_port = "bottom", "top"
        elif target_node["y"] > source_node["y"]:
            from_port, to_port = ("right" if target_node["x"] > source_node["x"] else "left"), "top"
        else:
            from_port, to_port = ("right" if target_node["x"] > source_node["x"] else "left"), "top"
        to_offset = TARGET_OFFSETS.get(edge_id, 0)
        start = port_point(source_node, from_port)
        end = port_point(target_node, to_port, to_offset)
        if loop:
            lane_x = LAYOUT_PLAN["main_axis"] + (loop[2] if loop[1] == "right" else -loop[2])
            clearance = {"edge-008": 30, "edge-026": 30, "edge-058": 45}[edge_id]
            points = route_loop(start, end, lane_x, clearance, from_port, to_port)
        else:
            points = route_local(start, end, from_port, to_port, edge_id in LOCAL_CLEARANCE_EDGES, LOCAL_APPROACH_GAPS.get(edge_id, 30), edge_id in LOCAL_APPROACH_ABOVE_EDGES, LOCAL_CLEARANCE_DISTANCES.get(edge_id, 72), None)
        edge = {"id": edge_id, "from": source, "fromPort": from_port, "to": target, "toPort": to_port, "kind": kind, "points": points, "arrowTarget": f"{target}:{to_port}"}
        if to_offset:
            edge["toPortOffset"] = to_offset
        if label:
            edge["labelText"] = label
            edge["label"] = place_label(edge)
            del edge["labelText"]
        edges.append(edge)
    canvas = translate_to_canvas(nodes, edges)
    return nodes, edges, canvas

def merge_nodes(edges):
    incoming = {}
    for edge in edges:
        incoming.setdefault(edge["to"], []).append(edge)
    return [{"nodeId": target, "reason": "Mermaid 业务分支在此汇合", "edgeIds": [edge["id"] for edge in group], "ports": {edge["id"]: edge["toPort"] for edge in group}} for target, group in incoming.items() if len(group) > 1]


def point_inside_node(node, x, y):
    """Return true only for the strict interior of a node shape."""
    if node["shape"] == "diamond":
        center_x = node["x"] + node["width"] / 2
        center_y = node["y"] + node["height"] / 2
        return abs(x - center_x) / (node["width"] / 2) + abs(y - center_y) / (node["height"] / 2) < 1
    return node["x"] < x < node["x"] + node["width"] and node["y"] < y < node["y"] + node["height"]


def segment_enters_node(node, first, second):
    x1, y1 = first
    x2, y2 = second
    if x1 == x2:
        if node["shape"] == "diamond":
            center_x = node["x"] + node["width"] / 2
            center_y = node["y"] + node["height"] / 2
            half_height = node["height"] / 2
            delta = abs(x1 - center_x) / (node["width"] / 2)
            if delta >= 1:
                return False
            span = half_height * (1 - delta)
            low, high = center_y - span, center_y + span
        else:
            if not node["x"] < x1 < node["x"] + node["width"]:
                return False
            low, high = node["y"], node["y"] + node["height"]
        segment_low, segment_high = sorted((y1, y2))
        return max(segment_low, low) < min(segment_high, high)
    if y1 == y2:
        if node["shape"] == "diamond":
            center_x = node["x"] + node["width"] / 2
            center_y = node["y"] + node["height"] / 2
            half_width = node["width"] / 2
            delta = abs(y1 - center_y) / (node["height"] / 2)
            if delta >= 1:
                return False
            span = half_width * (1 - delta)
            low, high = center_x - span, center_x + span
        else:
            if not node["y"] < y1 < node["y"] + node["height"]:
                return False
            low, high = node["x"], node["x"] + node["width"]
        segment_low, segment_high = sorted((x1, x2))
        return max(segment_low, low) < min(segment_high, high)
    raise SystemExit(f"non-orthogonal segment encountered: {first}->{second}")


def edge_node_collisions(nodes, edges):
    collisions = []
    for edge in edges:
        for node_id, node in nodes.items():
            for first, second in zip(edge["points"], edge["points"][1:]):
                if segment_enters_node(node, first, second):
                    collisions.append(f"{edge['id']}:{node_id}")
                    break
    return sorted(set(collisions))


def crossing_pairs(edges):
    pairs = set()
    for first_index, first_edge in enumerate(edges):
        for second_edge in edges[first_index + 1:]:
            shared_graph_node = first_edge["to"] == second_edge["from"] or first_edge["from"] == second_edge["to"] or first_edge["to"] == second_edge["to"] or first_edge["from"] == second_edge["from"]
            for a, b in zip(first_edge["points"], first_edge["points"][1:]):
                for c, d in zip(second_edge["points"], second_edge["points"][1:]):
                    first_vertical = a[0] == b[0]
                    second_vertical = c[0] == d[0]
                    if first_vertical == second_vertical:
                        continue
                    vertical_a, vertical_b, horizontal_a, horizontal_b = (a, b, c, d) if first_vertical else (c, d, a, b)
                    x, y = vertical_a[0], horizontal_a[1]
                    if min(vertical_a[1], vertical_b[1]) <= y <= max(vertical_a[1], vertical_b[1]) and min(horizontal_a[0], horizontal_b[0]) <= x <= max(horizontal_a[0], horizontal_b[0]):
                        point = [x, y]
                        on_first_endpoint = point in (a, b)
                        on_second_endpoint = point in (c, d)
                        if shared_graph_node and on_first_endpoint and on_second_endpoint:
                            continue
                        pairs.add(tuple(sorted((first_edge["id"], second_edge["id"]))))
    return sorted(pairs)

def branch_groups(edges):
    edge_by_id = {edge["id"]: edge for edge in edges}
    result = []
    for group_id, edge_ids, merge_node_id, depth, mode, reason in BRANCH_GROUP_CONFIGS:
        missing = [edge_id for edge_id in edge_ids if edge_id not in edge_by_id]
        if missing:
            raise SystemExit(f"branch group {group_id} references missing edges: {', '.join(missing)}")
        target_ids = []
        for edge_id in edge_ids:
            target_id = edge_by_id[edge_id]["to"]
            if target_id not in target_ids:
                target_ids.append(target_id)
        tolerance = 1 if any(edge_id in BRANCH_LAYER_EXCEPTION_EDGE_IDS for edge_id in edge_ids) else 220
        group = {"id": group_id, "decisionNodeId": group_id, "edgeIds": edge_ids, "targetIds": target_ids, "direction": "TB", "tolerance": tolerance, "depth": depth, "mode": mode, "reason": reason}
        if merge_node_id:
            group["mergeNodeId"] = merge_node_id
        result.append(group)
    return result


def branch_layout_plan(edges):
    edge_by_id = {edge["id"]: edge for edge in edges}
    outgoing = {}
    for edge in edges:
        if edge["id"] not in LOOP_EDGE_IDS:
            outgoing.setdefault(edge["from"], []).append(edge)

    def path_score(node_id, visited):
        if node_id in visited:
            return 0
        next_visited = visited | {node_id}
        return max([0] + [1 + path_score(edge["to"], next_visited) for edge in outgoing.get(node_id, [])])

    groups = []
    for group_id, edge_ids, merge_node_id, depth, mode, _reason in BRANCH_GROUP_CONFIGS:
        scores = {edge_id: path_score(edge_by_id[edge_id]["to"], {group_id}) for edge_id in edge_ids}
        primary_edge_ids = [edge_id for edge_id in edge_ids if edge_id in PRIMARY_FLOW_EDGE_IDS]
        primary_edge_id = primary_edge_ids[0] if primary_edge_ids else BRANCH_PRIMARY_EDGE_IDS.get(group_id) or sorted(edge_ids, key=lambda edge_id: (-scores[edge_id], edge_id))[0]
        branch_order = sorted(edge_ids, key=lambda edge_id: (0 if edge_id == primary_edge_id else 1, -scores[edge_id], edge_id))
        candidate = sorted(edge_ids, key=lambda edge_id: (-scores[edge_id], edge_id))[0]
        target_ids = []
        for edge_id in branch_order:
            target_id = edge_by_id[edge_id]["to"]
            if target_id not in target_ids:
                target_ids.append(target_id)
        group = {
            "id": f"branch-{group_id}",
            "decisionNodeId": group_id,
            "edgeIds": list(edge_ids),
            "targetNodeIds": target_ids,
            "branchOrder": branch_order,
            "layoutCandidateEdgeId": candidate,
            "depth": depth,
            "mode": mode,
            "branchGap": GEOMETRY_PROFILE["laneGap"],
        }
        group["primaryEdgeId"] = primary_edge_id
        if merge_node_id:
            group["mergeNodeId"] = merge_node_id
        groups.append(group)
    return {
        "status": "planned",
        "strategy": "primary-flow-then-longest-branch",
        "frozenOrder": ["primary-flow", *[group["id"] for group in groups]],
        "baselineGap": GEOMETRY_PROFILE["laneGap"],
        "groups": groups,
    }


def branch_layout_plan_expected(edges):
    actual = branch_layout_plan(edges)
    return {
        "strategy": actual["strategy"],
        "frozen_order": actual["frozenOrder"],
        "baseline_gap": actual["baselineGap"],
        "groups": [{
            "id": group["id"],
            "decision_node_id": group["decisionNodeId"],
            "edge_ids": group["edgeIds"],
            "target_ids": group["targetNodeIds"],
            "branch_order": group["branchOrder"],
            "layout_candidate_edge_id": group["layoutCandidateEdgeId"],
            "primary_edge_id": group["primaryEdgeId"],
            **({"merge_node_id": group["mergeNodeId"]} if "mergeNodeId" in group else {}),
            "depth": group["depth"],
            "mode": group["mode"],
            "branch_gap": group["branchGap"],
        } for group in actual["groups"]],
    }


def exceptions(edges):
    result = []
    unverified_visual_evidence = {
        "required": True,
        "status": "UNVERIFIED",
        "refs": ["Chrome normal/fit/zoom evidence not captured in this run"],
    }
    for edge_id in sorted(BRANCH_LAYER_EXCEPTION_EDGE_IDS):
        if not any(edge["id"] == edge_id for edge in edges):
            raise SystemExit(f"branch-layer exception references missing edge: {edge_id}")
        if edge_id in {"edge-031", "edge-032", "edge-033"}:
            business_reason = "拣货结果的全部拣到路径直接进入等待自提，缺货结果必须先经过缺货处理局部支路。"
            geometric_reason = "保持 picking-result 到 waiting-pickup 的主轴连续，同时为缺货和全额退款分支预留局部 lane，三个目标不处于同一业务层。"
        else:
            business_reason = "顾客接受换货后继续拣货，拒绝或超时未回应则进入部分退款，两个结果处于不同履约阶段。"
            geometric_reason = "保留 substitution-accepted 的主流程 bottom 出口，并让合并退款边在右侧局部 lane 进入更下方的退款节点。"
        result.append({
            "type": "branch-layer",
            "object": {"kind": "edge", "ids": [edge_id]},
            "business_reason": business_reason,
            "geometric_reason": geometric_reason,
            "scope": {"diagram_id": DIAGRAM_ID, "applies_to": ["source", "browser"], "condition": "仅适用于该判断的实际跨层局部分支"},
            "visual_evidence": dict(unverified_visual_evidence),
        })
    for first_id, second_id in crossing_pairs(edges):
        if (first_id, second_id) not in DECLARED_CROSSING_PAIRS:
            continue
        result.append({
            "type": "crossing",
            "object": {"kind": "edge-pair", "ids": [first_id, second_id]},
            "business_reason": "完整保留来源业务关系，不能删除或改义。",
            "geometric_reason": "该局部关系在保持主轴连续、端口法向和最短合法通道的前提下发生实际 connector crossing。",
            "scope": {"diagram_id": DIAGRAM_ID, "applies_to": ["source", "browser"], "condition": "仅适用于当前实际命中的精确边对"},
            "visual_evidence": dict(unverified_visual_evidence),
        })
    return result


def primary_flow(edges):
    edge_by_pair = {(edge["from"], edge["to"]): edge["id"] for edge in edges}
    edge_ids = []
    for source, target in zip(PRIMARY_FLOW_NODE_IDS, PRIMARY_FLOW_NODE_IDS[1:]):
        edge_id = edge_by_pair.get((source, target))
        if edge_id is None:
            raise SystemExit(f"primary flow edge is missing for {source}->{target}")
        edge_ids.append(edge_id)
    return {"nodeIds": PRIMARY_FLOW_NODE_IDS, "edgeIds": edge_ids, "reason": "来源 Mermaid 的正常履约主路径"}


def source_graph():
    """从冻结 Mermaid 语义构造 expected，不读取 actual 节点、端口或路径。"""
    source_nodes = [{"source_id": source_id, "display_id": display_id, "label": label, "shape": shape} for source_id, (display_id, label, shape) in zip(SOURCE_NODE_IDS, NODES)]
    source_id_by_display = {display_id: source_id for source_id, (display_id, _label, _shape) in zip(SOURCE_NODE_IDS, NODES)}
    relations = []
    for index, (source, target, label, kind) in enumerate(RELATIONS, 1):
        edge_id = RELATION_EDGE_IDS[index - 1]
        merge_labels = {
            "edge-027": ((27, "主动取消"), (28, "支付超时15分钟未付")),
            "edge-040": ((40, "拒绝"), (41, "超时未回应")),
        }.get(edge_id)
        if merge_labels:
            for ordinal, source_label in merge_labels:
                relations.append({"source_ordinal": ordinal, "from_source_id": source_id_by_display[source], "to_source_id": source_id_by_display[target], "display_edge_id": edge_id, "kind": kind, "label": source_label, "display_label": label})
            continue
        relations.append({"source_ordinal": int(edge_id.split("-")[1]), "from_source_id": source_id_by_display[source], "to_source_id": source_id_by_display[target], "display_edge_id": edge_id, "kind": kind, **({"label": label} if label else {})})
    return {"nodes": source_nodes, "relations": relations, "reading_paths": [
        {"id": "normal-fulfillment", "node_ids": PRIMARY_FLOW_NODE_IDS, "edge_ids": primary_flow()["edgeIds"], "required_labels": ["是", "否", "全部拣到"]},
        {"id": "pending-cancel", "node_ids": ["payment-pending", "pending-action", "cancel-release"], "edge_ids": ["edge-025", "edge-027"], "required_labels": ["主动取消／支付超时15分钟未付"]},
    ]}


def semantic_edges():
    return [{"id": RELATION_EDGE_IDS[index], "from": source, "to": target, "kind": kind, "label": label} for index, (source, target, label, kind) in enumerate(RELATIONS)]


def primary_flow():
    edge_by_pair = {(source, target): RELATION_EDGE_IDS[index] for index, (source, target, _label, _kind) in enumerate(RELATIONS)}
    edge_ids = []
    for source, target in zip(PRIMARY_FLOW_NODE_IDS, PRIMARY_FLOW_NODE_IDS[1:]):
        edge_id = edge_by_pair.get((source, target))
        if edge_id is None:
            raise SystemExit(f"primary flow edge is missing for {source}->{target}")
        edge_ids.append(edge_id)
    return {"nodeIds": PRIMARY_FLOW_NODE_IDS, "edgeIds": edge_ids, "reason": "来源 Mermaid 的正常履约主路径"}


def expected_branch_layer_exceptions():
    return [{
        "type": "branch-layer",
        "object": {"kind": "edge", "ids": [edge_id]},
        "business_reason": "来源判断的结果进入不同履约阶段，保留全部来源关系。",
        "geometric_reason": "主轴保持连续，跨层局部分支在声明的局部 lane 内进入目标。",
        "scope": {"diagram_id": DIAGRAM_ID, "applies_to": ["source", "browser"], "condition": "仅适用于该判断的实际跨层局部分支"},
        "visual_evidence": {"required": True, "refs": ["Chrome normal/fit/zoom evidence not captured in this run"]},
    } for edge_id in sorted(BRANCH_LAYER_EXCEPTION_EDGE_IDS)]


def build_expected():
    loop_lanes = [{"id": lane_id, "side": side, "lane_offset": offset, "edge_ids": [RELATION_EDGE_IDS[zero_index]], "reason": reason} for zero_index, (lane_id, side, offset, reason) in LOOP_EDGE_INDEXES.items()]
    primary = primary_flow()
    semantic = semantic_edges()
    branches = branch_groups(semantic)
    intents = []
    for edge in semantic:
        loop = next((lane for lane in loop_lanes if edge["id"] in lane["edge_ids"]), None)
        intent = {"edge_id": edge["id"], "kind": "loop" if loop else "custom", "label_required": edge["label"] is not None}
        if loop:
            intent["lane_id"] = loop["id"]
            intent["min_bend_count"] = 1
        if edge["label"] is not None:
            intent["label_text"] = edge["label"]
        intents.append(intent)
    return {"version": "1", "type": "diagram-expected-contract", "source": {"kind": "approved-mermaid-business-source", "ref": "diagram-009.mmd", "revision": "user-provided-mermaid-v1", "digest": sha256(MERMAID)}, "generator": {"name": "diagram-009-mermaid-generator", "version": GENERATOR_VERSION, "config_summary": CONFIG_SUMMARY, "config_digest": CONFIG_DIGEST, "source_refs": ["diagram-009.mmd"]}, "diagrams": [{"id": DIAGRAM_ID, "diagram_type": "flowchart", "intent": "验证从复杂门店自提订单 Mermaid 业务流到单色 SVG 的结构提取、分支、回路与履约绘制能力", "nodes": [{"id": node_id, "shape": shape} for node_id, _label, shape in NODES], "edges": [{"id": edge["id"], "from": edge["from"], "to": edge["to"], "kind": edge["kind"]} for edge in semantic], "source_graph": source_graph(), "groups": [], "legend_ids": [], "annotation_ids": [], "lifeline_ids": [], "route_contract": {"direction": "TB", "affected_edge_ids": [edge["id"] for edge in semantic], "edge_intents": intents, "main_flow": {"entry_node_ids": ["open-store"], "exit_node_ids": ["cancel-release", "full-refund", "cancel-success", "reject", "overdue", "after-sale"], "node_ids": [node_id for node_id, _label, _shape in NODES], "edge_ids": [edge["id"] for edge in semantic]}, "primary_flow": {"node_ids": primary["nodeIds"], "edge_ids": primary["edgeIds"], "reason": primary["reason"]}, "loop_lanes": loop_lanes, "merge_nodes": [], "branch_groups": [{"id": group["id"], "decision_node_id": group["decisionNodeId"], "edge_ids": group["edgeIds"], "target_ids": group["targetIds"], "direction": group["direction"], "tolerance": group["tolerance"], **({"merge_node_id": group["mergeNodeId"]} if "mergeNodeId" in group else {}), "depth": group["depth"], "mode": group["mode"], "reason": group["reason"]} for group in branches], "geometry_profile": geometry_profile_expected(), "branch_layout_plan": branch_layout_plan_expected(semantic), "exceptions": expected_branch_layer_exceptions()}}]}


def build_manifest(nodes, edges, canvas):
    loop_lanes = [{"id": lane_id, "side": side, "laneOffset": offset, "reason": reason, "edgeIds": [RELATION_EDGE_IDS[zero_index]]} for zero_index, (lane_id, side, offset, reason) in LOOP_EDGE_INDEXES.items()]
    branch_edges = sorted(BRANCH_LAYER_EXCEPTION_EDGE_IDS)
    route_config = json.loads(os.environ.get("AIDLC_ROUTE_CONFIG_JSON", json.dumps({"diagram_id": DIAGRAM_ID, "affected_edge_ids": [edge["id"] for edge in edges], "strategy": "spine-first-local-routing", "source_relation_merges": SOURCE_RELATION_MERGES})))
    return {"version": 1, "document": "diagram-009.md", "expected_contract_path": "diagram-009.expected.json", "diagrams": [{"id": DIAGRAM_ID, "output": "diagram-009.svg", "title": "图表 009｜门店自提订单履约流程", "description": "从打开商城、门店自提结算、支付与库存处理，到拣货、换货、取货、取消和售后的完整订单履约流程。", "diagramType": "flowchart", "canvas": {"width": canvas["width"], "height": canvas["height"]}, "sourceBasis": [{"kind": "approved-mermaid", "path": "diagram-009.mmd", "digest": sha256(MERMAID)}], "nodes": list(nodes.values()), "edges": edges, "groups": [], "designNotes": {"intent": "让读者追踪门店自提订单从结算到履约、取消和售后的完整业务分支。", "sourceRelationMerges": SOURCE_RELATION_MERGES, "semanticModes": ["process-flow"], "visualSemantics": [{"channel": "node-shape", "role": "semantic", "reason": "菱形直接表达需要选择的业务判断。"}, {"channel": "edge-kind", "role": "semantic", "reason": "线型严格对应 Mermaid 来源关系；反馈路由角色不改变关系线型。"}], "legendDecision": {"status": "exempt", "reason": "判断、反馈和重试均由节点形状及相邻边标签就地说明。", "inlineSemanticEvidence": [{"object": "minimum-order", "meaning": "菱形和是/否标签表达最低金额判断"}, {"object": "edge-008", "meaning": "外侧反馈 lane 表达最低金额失败回退，关系线型与标签保持 Mermaid 来源"}]}, "splitDecision": {"status": "kept-single", "reason": "支付、拣货、换货、取货、取消和售后是同一订单生命周期，拆分会损失回路与终态关系。", "singleGoal": "追踪门店自提订单生命周期", "staticBoundary": "不混入系统静态边界", "processFlowDistinction": "仅表达有向业务过程流", "readabilityEvidence": {state: {"status": "UNVERIFIED", "evidence": f".aidlc/evidence/diagram-contract/diagram-contract-provider.json#views.{state}"} for state in ("normal", "fit", "zoom")}}, "layout": {"direction": "TB", "mainAxis": canvas["mainAxis"], "layerTolerance": 220, "symmetryGroups": [], "mergeNodes": merge_nodes(edges), "branchLayerExceptions": [{"edgeIds": branch_edges, "reason": "跨阶段反馈或多步履约支路保持局部阅读顺序，避免破坏主干连续性。"}], "branchPortExceptions": [{"edgeIds": item["object"]["ids"], "reason": item["geometric_reason"]} for item in exceptions(edges) if item["type"] == "branch-port"], "sideSwitchExceptions": [{"edgeIds": item["object"]["ids"], "reason": item["geometric_reason"]} for item in exceptions(edges) if item["type"] == "side-switch"], "crossingExceptions": [{"edgeIds": item["object"]["ids"], "businessReason": item["business_reason"], "geometricReason": item["geometric_reason"], "visualEvidence": item["visual_evidence"]} for item in exceptions(edges) if item["type"] == "crossing"], "readabilityEvidence": {state: {"status": "UNVERIFIED", "evidence": f".aidlc/evidence/diagram-contract/diagram-contract-provider.json#views.{state}"} for state in ("normal", "fit", "zoom")}, "mainFlow": {"entryNodeId": "open-store", "exitNodeIds": ["cancel-release", "full-refund", "cancel-success", "reject", "overdue", "after-sale"], "nodeIds": list(nodes), "edgeIds": [edge["id"] for edge in edges]}, "branchGroups": branch_groups(edges), "primaryFlow": {"nodeIds": primary_flow()["nodeIds"], "edgeIds": primary_flow()["edgeIds"], "reason": primary_flow()["reason"]}, "loopLanes": loop_lanes, "geometryProfile": geometry_profile_actual(), "branchLayoutPlan": branch_layout_plan(edges), "changeImpactReview": {"baseline": "comparison-samples/diagram-009/2026-08-29-before-redraw/diagram-009.diagram.json", "movedNodeIds": list(nodes), "impactedEdgeIds": [edge["id"] for edge in edges], "edgeReviews": [{"edgeId": edge["id"], "status": "recomputed"} for edge in edges]}}}, "generation": {"generator": {"name": "diagram-009-mermaid-generator", "version": GENERATOR_VERSION}, "config": {"summary": CONFIG_SUMMARY, "digest": CONFIG_DIGEST}, "route_config": route_config, "source_refs": ["diagram-009.mmd"], "outputs": ["diagram-009.svg", "diagram-009.diagram.json", "diagram-009.expected.json"], "command_argv": ["python3", "diagram-009-generator.py"], "cwd": "."}}]}


def render_svg(nodes, edges, canvas):
    parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{canvas["width"]}" height="{canvas["height"]}" viewBox="0 0 {canvas["width"]} {canvas["height"]}" role="img" aria-labelledby="diagram-009-title diagram-009-desc">
<title id="diagram-009-title">图表 009｜门店自提订单履约流程</title>
<desc id="diagram-009-desc">门店自提订单从商城、结算、支付到拣货、换货、取货、取消和售后的完整业务流程。</desc>
<rect data-canvas-background="true" x="0" y="0" width="100%" height="100%" fill="#ffffff" stroke="none" />
<defs><marker id="arrow" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="10" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#000000" /></marker></defs>
''']
    for edge in edges:
        d = "M " + " L ".join(f"{point[0]:g} {point[1]:g}" for point in edge["points"])
        dash = ' stroke-dasharray="8 6"' if edge["kind"] == "dashed" else ""
        label_attr = f' data-edge-label="{edge["id"]}"' if "label" in edge else ""
        from_offset_attr = f' data-from-port-offset="{edge["fromPortOffset"]:g}"' if "fromPortOffset" in edge else ""
        to_offset_attr = f' data-to-port-offset="{edge["toPortOffset"]:g}"' if "toPortOffset" in edge else ""
        parts.append(f'<path data-edge="{edge["id"]}" data-from="{edge["from"]}" data-from-port="{edge["fromPort"]}" data-to="{edge["to"]}" data-to-port="{edge["toPort"]}" data-arrow-target="{edge["arrowTarget"]}"{from_offset_attr}{to_offset_attr}{label_attr} d="{d}" fill="none" stroke="#000000" stroke-width="2" marker-end="url(#arrow)"{dash} />')
    for node in nodes.values():
        x, y, w, h = node["x"], node["y"], node["width"], node["height"]
        label = html.escape(node["label"])
        parts.append(f'<g data-node="{node["id"]}" data-node-shape="{node["shape"]}">')
        if node["shape"] == "diamond":
            points = f"{x + w / 2:g},{y:g} {x + w:g},{y + h / 2:g} {x + w / 2:g},{y + h:g} {x:g},{y + h / 2:g}"
            parts.append(f'<polygon points="{points}" fill="none" stroke="#000000" stroke-width="2" />')
        else:
            rx = ' rx="14"' if node["shape"] == "round" else ''
            parts.append(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}"{rx} fill="none" stroke="#000000" stroke-width="2" />')
        parts.append(f'<text data-text-id="{node["id"]}-label" x="{x + w / 2:g}" y="{y + h / 2 + 6:g}" text-anchor="middle" dominant-baseline="middle" font-family="{FONT}" font-size="16" fill="#000000">{label}</text></g>')
    for edge in edges:
        if "label" in edge:
            label = edge["label"]
            parts.append(f'<text data-edge-label="{edge["id"]}" data-text-id="{edge["id"]}-label" x="{label["x"]:g}" y="{label["y"]:g}" text-anchor="middle" dominant-baseline="middle" font-family="{FONT}" font-size="14" fill="#000000">{html.escape(label["text"])}</text>')
    for edge in edges:
        parts.append(f'<path data-edge-arrow="{edge["id"]}" data-edge="{edge["id"]}" data-arrow-target="{edge["arrowTarget"]}" d="{arrow_path(edge["points"][-1], edge["toPort"])}" fill="#000000" />')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def validate_mermaid_source():
    source = MERMAID.read_text()
    required = ["打开商城", "达到最低下单金额", "支付超时15分钟未付", "顾客是否接受", "拒绝", "超时未回应", "申请售后"]
    if any(item not in source for item in required) or not re.search(r"flowchart\s+TD", source):
        raise SystemExit("diagram-009.mmd is not the approved complex Mermaid source")


def main():
    validate_mermaid_source()
    if os.environ.get("AIDLC_DIAGRAM_ID") not in {None, DIAGRAM_ID}:
        raise SystemExit("unexpected diagram id")
    nodes, edges, canvas = make_model()
    collisions = edge_node_collisions(nodes, edges)
    if collisions:
        raise SystemExit("edge-node collisions: " + ", ".join(collisions))
    if "--write-expected" in sys.argv:
        EXPECTED.write_text(json.dumps(build_expected(), ensure_ascii=False, indent=2) + "\n")
        print("diagram-009 expected contract generated")
        return
    expected_path = os.environ.get("AIDLC_EXPECTED_CONTRACT_PATH")
    if expected_path and not Path(expected_path).is_file():
        raise SystemExit("expected contract path is not readable")
    MANIFEST.write_text(json.dumps(build_manifest(nodes, edges, canvas), ensure_ascii=False, indent=2) + "\n")
    SVG.write_text(render_svg(nodes, edges, canvas))
    print("diagram-009 Mermaid SVG and sidecar generated")


if __name__ == "__main__":
    main()
