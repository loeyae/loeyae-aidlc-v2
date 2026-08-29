#!/usr/bin/env python3
"""从冻结的 diagram-020 业务源图生成迁移版 sidecar、expected 和 SVG。"""
from __future__ import annotations

import hashlib
import html
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE_GRAPH = ROOT / "diagram-020-migrated.source-graph.json"
DOC = ROOT / "docs/草稿/方案设计/zhangyi/蓝图方案-V1.1.md"
FORMAL_SOURCE = ROOT / "docs/正式/20-需求文档/搜索域/蓝图-搜索和推荐V1.1.md"
ASSET_DIR = ROOT / "docs/草稿/方案设计/zhangyi/assets"
SVG = ASSET_DIR / "diagram-020-migrated.svg"
MANIFEST = ASSET_DIR / "diagram-020-migrated.diagram.json"
EXPECTED = ASSET_DIR / "diagram-020-migrated.expected.json"
FONT = "Microsoft YaHei, 微软雅黑, sans-serif"
DIAGRAM_ID = "diagram-020"
GENERATOR_NAME = "diagram-020-migrated-generator"
GENERATOR_VERSION = "1.0.0"
CONFIG_SUMMARY = "diagram-020 迁移重绘：TB 多区域布局、组内独立 lane、CJK 感知节点尺寸、业务对象黑色与结构区域灰色"
CONFIG_DIGEST = "sha256:" + hashlib.sha256(CONFIG_SUMMARY.encode()).hexdigest()
CANVAS = {"width": 3200, "height": 2200}

# 该布局只承载稳定业务语义的重新排布；不从旧 SVG 坐标推断主轴。
NODE_LAYOUT = {
    "diagram-020-node-operator": (1420, 40, 260, 80),
    "diagram-020-node-cloud-admin": (520, 160, 280, 80),
    "diagram-020-node-search-admin": (1830, 160, 300, 80),
    "diagram-020-node-darkword-page": (300, 450, 320, 72),
    "diagram-020-node-darkword-edit": (220, 650, 480, 96),
    "diagram-020-node-darkword-check": (270, 900, 380, 180),
    "diagram-020-node-darkword-error": (160, 1160, 240, 80),
    "diagram-020-node-darkword-save": (440, 1160, 220, 80),
    "diagram-020-node-darkword-status": (270, 1400, 380, 180),
    "diagram-020-node-darkword-effective": (150, 1690, 260, 80),
    "diagram-020-node-darkword-inactive": (620, 1690, 180, 80),
    "diagram-020-node-hotword-page": (1140, 450, 320, 72),
    "diagram-020-node-hotword-edit": (1060, 650, 480, 96),
    "diagram-020-node-required-check": (1110, 900, 380, 180),
    "diagram-020-node-validation-error": (1000, 1160, 240, 80),
    "diagram-020-node-hotword-save": (1280, 1160, 220, 80),
    "diagram-020-node-effective-check": (1110, 1400, 380, 180),
    "diagram-020-node-hotword-effective": (990, 1690, 280, 80),
    "diagram-020-node-hotword-inactive": (1500, 1690, 200, 80),
    "diagram-020-node-operation-admin": (2280, 450, 280, 80),
    "diagram-020-node-blacklist-manage": (1830, 650, 200, 80),
    "diagram-020-node-blacklist-select": (1830, 880, 200, 80),
    "diagram-020-node-blacklist-edit": (1800, 1110, 260, 80),
    "diagram-020-node-blacklist-confirm": (1840, 1340, 180, 80),
    "diagram-020-node-blacklist-effective": (1840, 1570, 180, 80),
    "diagram-020-node-whitelist-manage": (2290, 650, 200, 80),
    "diagram-020-node-whitelist-select": (2290, 880, 200, 80),
    "diagram-020-node-whitelist-edit": (2260, 1110, 260, 80),
    "diagram-020-node-whitelist-confirm": (2300, 1340, 180, 80),
    "diagram-020-node-whitelist-effective": (2300, 1570, 180, 80),
    "diagram-020-node-sort-manage": (2750, 650, 200, 80),
    "diagram-020-node-sort-drag": (2720, 880, 260, 80),
    "diagram-020-node-sort-save": (2790, 1110, 120, 80),
    "diagram-020-node-sort-effective": (2790, 1340, 120, 80),
}

GROUP_LAYOUT = {
    "diagram-020-group-darkword": (80, 330, 760, 1730),
    "diagram-020-group-hotword": (920, 330, 820, 1730),
    "diagram-020-group-operation": (1760, 330, 1320, 1500),
}

LABEL_PLACEMENTS = {
    "diagram-020-edge-006": (1100, 1055),
    "diagram-020-edge-007": (1020, 949),
    "diagram-020-edge-008": (1345, 1060),
    "diagram-020-edge-010": (985, 1570),
    "diagram-020-edge-011": (1545, 1420),
    "diagram-020-edge-030": (225, 1055),
    "diagram-020-edge-031": (165, 949),
    "diagram-020-edge-032": (505, 1060),
    "diagram-020-edge-034": (165, 1570),
    "diagram-020-edge-035": (680, 1420),
}

BRANCH_GROUPS = [
    {
        "id": "diagram-020-node-darkword-check",
        "decisionNodeId": "diagram-020-node-darkword-check",
        "edgeIds": ["diagram-020-edge-030", "diagram-020-edge-032"],
        "targetIds": ["diagram-020-node-darkword-error", "diagram-020-node-darkword-save"],
        "direction": "TB", "tolerance": 24, "depth": 0, "mode": "inline",
        "reason": "暗纹词必填项判断的失败与通过出口在同一业务层就地展开。",
    },
    {
        "id": "diagram-020-node-darkword-status",
        "decisionNodeId": "diagram-020-node-darkword-status",
        "edgeIds": ["diagram-020-edge-034", "diagram-020-edge-035"],
        "targetIds": ["diagram-020-node-darkword-effective", "diagram-020-node-darkword-inactive"],
        "direction": "TB", "tolerance": 24, "depth": 0, "mode": "inline",
        "reason": "暗纹词生效状态的两个出口在同一业务层对称展开。",
    },
    {
        "id": "diagram-020-node-required-check",
        "decisionNodeId": "diagram-020-node-required-check",
        "edgeIds": ["diagram-020-edge-006", "diagram-020-edge-008"],
        "targetIds": ["diagram-020-node-validation-error", "diagram-020-node-hotword-save"],
        "direction": "TB", "tolerance": 24, "depth": 0, "mode": "inline",
        "reason": "搜索热词必填项判断的失败与通过出口在同一业务层就地展开。",
    },
    {
        "id": "diagram-020-node-effective-check",
        "decisionNodeId": "diagram-020-node-effective-check",
        "edgeIds": ["diagram-020-edge-010", "diagram-020-edge-011"],
        "targetIds": ["diagram-020-node-hotword-effective", "diagram-020-node-hotword-inactive"],
        "direction": "TB", "tolerance": 24, "depth": 0, "mode": "inline",
        "reason": "搜索热词生效状态的两个出口在同一业务层对称展开。",
    },
]

LOOP_LANES = [
    {
        "id": "diagram-020-loop-hotword-validation", "side": "left", "laneOffset": 40,
        "edgeIds": ["diagram-020-edge-007"],
        "reason": "搜索热词校验失败沿热词分组左侧独立 lane 返回编辑。",
    },
    {
        "id": "diagram-020-loop-darkword-validation", "side": "left", "laneOffset": 24,
        "edgeIds": ["diagram-020-edge-031"],
        "reason": "暗纹词校验失败沿暗纹词分组左侧独立 lane 返回编辑。",
    },
]


def sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def measure(text: str, font_size: float = 16) -> float:
    return sum(font_size * (0.35 if char.isspace() else 1 if ord(char) >= 0x2E80 else 0.56) for char in text)


def compact(points: list[list[float]]) -> list[list[float]]:
    result: list[list[float]] = []
    for point in points:
        if not result or point != result[-1]:
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


def node_rect(node: dict) -> tuple[float, float, float, float]:
    return node["x"], node["y"], node["width"], node["height"]


def port_point(node: dict, port: str, offset: float = 0) -> list[float]:
    center_x = node["x"] + node["width"] / 2
    center_y = node["y"] + node["height"] / 2
    if node["shape"] == "diamond":
        if port == "top": return [center_x, node["y"]]
        if port == "right": return [node["x"] + node["width"], center_y]
        if port == "bottom": return [center_x, node["y"] + node["height"]]
        return [node["x"], center_y]
    if port == "top": return [center_x + offset, node["y"]]
    if port == "right": return [node["x"] + node["width"], center_y + offset]
    if port == "bottom": return [center_x - offset, node["y"] + node["height"]]
    return [node["x"], center_y - offset]


def arrow_path(end: list[float], port: str) -> str:
    x, y = end
    if port == "left": return f"M {x} {y} L {x - 10} {y - 5} L {x - 10} {y + 5} Z"
    if port == "right": return f"M {x} {y} L {x + 10} {y - 5} L {x + 10} {y + 5} Z"
    if port == "top": return f"M {x} {y} L {x - 5} {y - 10} L {x + 5} {y - 10} Z"
    return f"M {x} {y} L {x - 5} {y + 10} L {x + 5} {y + 10} Z"


def directions(points: list[list[float]]) -> list[str]:
    result: list[str] = []
    for first, second in zip(points, points[1:]):
        direction = "right" if second[0] > first[0] else "left" if second[0] < first[0] else "down" if second[1] > first[1] else "up"
        if not result or result[-1] != direction:
            result.append(direction)
    return result


def route(edge_id: str, nodes: dict[str, dict]) -> tuple[list[list[float]], str, str, float]:
    edge = next(item for item in SOURCE["edges"] if item["id"] == edge_id)
    from_port, to_port = edge["fromPort"], edge["toPort"]
    from_offset = -60 if edge_id == "diagram-020-edge-001" else 60 if edge_id == "diagram-020-edge-026" else 0
    start = port_point(nodes[edge["from"]], from_port, from_offset)
    end = port_point(nodes[edge["to"]], to_port)
    explicit = {
        "diagram-020-edge-001": [start, [start[0], 140], [end[0], 140], end],
        "diagram-020-edge-002": [start, [end[0], start[1]], end],
        "diagram-020-edge-003": [start, [end[0], start[1]], end],
        "diagram-020-edge-006": [start, [1030, start[1]], [1030, end[1] - 40], [end[0], end[1] - 40], end],
        "diagram-020-edge-008": [start, [start[0], end[1] - 40], [end[0], end[1] - 40], end],
        "diagram-020-edge-009": [start, [start[0], end[1] - 40], [end[0], end[1] - 40], end],
        "diagram-020-edge-007": [start, [960, start[1]], [960, end[1]], end],
        "diagram-020-edge-010": [start, [1040, start[1]], [1040, end[1] - 40], [end[0], end[1] - 40], end],
        "diagram-020-edge-011": [start, [end[0], start[1]], end],
        "diagram-020-edge-012": [start, [end[0], start[1]], end],
        "diagram-020-edge-013": [start, [start[0], end[1] - 40], [end[0], end[1] - 40], end],
        "diagram-020-edge-014": [start, [end[0], start[1]], end],
        "diagram-020-edge-026": [start, [start[0], 140], [end[0], 140], end],
        "diagram-020-edge-027": [start, [start[0], 400], [end[0], 400], end],
        "diagram-020-edge-030": [start, [180, start[1]], [180, end[1] - 40], [end[0], end[1] - 40], end],
        "diagram-020-edge-032": [start, [start[0], end[1] - 40], [end[0], end[1] - 40], end],
        "diagram-020-edge-033": [start, [start[0], end[1] - 40], [end[0], end[1] - 40], end],
        "diagram-020-edge-031": [start, [120, start[1]], [120, end[1]], end],
        "diagram-020-edge-034": [start, [220, start[1]], [220, end[1] - 40], [end[0], end[1] - 40], end],
        "diagram-020-edge-035": [start, [end[0], start[1]], end],
    }
    points = explicit.get(edge_id)
    if points is None:
        points = [start, end]
    return compact(points), from_port, to_port, from_offset


def build_nodes() -> dict[str, dict]:
    return {
        item["id"]: {**item, "x": NODE_LAYOUT[item["id"]][0], "y": NODE_LAYOUT[item["id"]][1], "width": NODE_LAYOUT[item["id"]][2], "height": NODE_LAYOUT[item["id"]][3], "fontSize": 16}
        for item in SOURCE["nodes"]
    }


def build_edges(nodes: dict[str, dict]) -> list[dict]:
    result = []
    for source_edge in SOURCE["edges"]:
        edge_id = source_edge["id"]
        points, from_port, to_port, from_offset = route(edge_id, nodes)
        edge = {
            "id": edge_id,
            "from": source_edge["from"],
            "fromPort": from_port,
            "to": source_edge["to"],
            "toPort": to_port,
            "kind": source_edge["kind"],
            "points": points,
            "arrowTarget": f"{source_edge['to']}:{to_port}",
        }
        if from_offset:
            edge["fromPortOffset"] = from_offset
        if "label" in source_edge:
            x, y = LABEL_PLACEMENTS[edge_id]
            edge["label"] = {"text": source_edge["label"], "x": x, "y": y, "fontSize": 14}
        result.append(edge)
    return result


def group_entries() -> list[dict]:
    result = []
    for source_group in SOURCE["groups"]:
        x, y, width, height = GROUP_LAYOUT[source_group["id"]]
        result.append({**source_group, "styleRole": "structural", "x": x, "y": y, "width": width, "height": height, "sourceStatus": "migrated-from-formal-blueprint"})
    return result


def main_flow() -> dict:
    return {
        "type": "branching-process",
        "entryNodeIds": ["diagram-020-node-operator"],
        "exitNodeIds": [
            "diagram-020-node-darkword-effective", "diagram-020-node-darkword-inactive",
            "diagram-020-node-hotword-effective", "diagram-020-node-hotword-inactive",
            "diagram-020-node-blacklist-effective", "diagram-020-node-whitelist-effective",
            "diagram-020-node-sort-effective",
        ],
        "nodeIds": [node["id"] for node in SOURCE["nodes"]],
        "edgeIds": [edge["id"] for edge in SOURCE["edges"]],
    }


def layout_notes() -> dict:
    all_edges = [edge["id"] for edge in SOURCE["edges"]]
    merge_nodes = [
        {
            "nodeId": "diagram-020-node-hotword-edit",
            "reason": "校验失败反馈和配置页面主流程在编辑节点合流。",
            "edgeIds": ["diagram-020-edge-004", "diagram-020-edge-007"],
            "ports": {"diagram-020-edge-004": "top", "diagram-020-edge-007": "left"},
        },
        {
            "nodeId": "diagram-020-node-darkword-edit",
            "reason": "校验失败反馈和配置页面主流程在编辑节点合流。",
            "edgeIds": ["diagram-020-edge-028", "diagram-020-edge-031"],
            "ports": {"diagram-020-edge-028": "top", "diagram-020-edge-031": "left"},
        },
    ]
    branch_ports = [
        ("diagram-020-edge-006", "失败分支从判断左侧出线并从错误提示顶部进入。"),
        ("diagram-020-edge-008", "校验通过继续主流程，从判断底部进入保存节点顶部。"),
        ("diagram-020-edge-010", "生效分支从判断左侧出线进入左侧生效节点顶部。"),
        ("diagram-020-edge-011", "失效分支从判断右侧出线进入右侧失效节点顶部。"),
        ("diagram-020-edge-030", "失败分支从判断左侧出线并从错误提示顶部进入。"),
        ("diagram-020-edge-032", "校验通过继续主流程，从判断底部进入保存节点顶部。"),
        ("diagram-020-edge-034", "生效分支从判断左侧出线进入左侧生效节点顶部。"),
        ("diagram-020-edge-035", "失效分支从判断右侧出线进入右侧失效节点顶部。"),
    ]
    return {
        "direction": "TB",
        "mainAxis": 1550,
        "layerTolerance": 24,
        "symmetryGroups": [],
        "mergeNodes": merge_nodes,
        "branchLayerExceptions": [],
        "branchPortExceptions": [{"edgeIds": [edge_id], "reason": reason} for edge_id, reason in branch_ports],
        "sideSwitchExceptions": [],
        "crossingExceptions": [],
        "readabilityEvidence": {state: {"status": "UNVERIFIED", "evidence": f".aidlc/evidence/diagram-contract/diagram-contract-provider.json#views.{state}"} for state in ("normal", "fit", "zoom")},
        "mainFlow": main_flow(),
        "branchGroups": BRANCH_GROUPS,
        "primaryFlow": {"nodeIds": ["diagram-020-node-operator"], "edgeIds": [], "reason": "入口主轴先分流到三个业务区域；各区域内部沿 TB 主轴连续推进。"},
        "loopLanes": LOOP_LANES,
        "affectedEdgePlan": {"affectedEdgeIds": all_edges, "strategy": "multi-region-tb-with-local-lanes", "review": "所有节点和 incident edges 均按新画布重新计算。"},
        "changeImpactReview": {
            "baseline": "../diagram-020/docs/草稿/方案设计/zhangyi/assets/diagram-020.svg",
            "baselineSha256": "36de3a43bd141cb7c25c887d721b7d2f8298248434a075ad4b3f3326ec798cd2",
            "baselineStaticStatus": "expected-failure: raw metadata lacks canvas/styleRole/generation closure",
            "movedNodeIds": [node["id"] for node in SOURCE["nodes"]],
            "impactedEdgeIds": all_edges,
            "edgeReviews": [{"edgeId": edge_id, "status": "recomputed", "reason": "节点迁移后按端口和局部 lane 重新生成"} for edge_id in all_edges],
        },
    }


def expected_contract(nodes: dict[str, dict], edges: list[dict]) -> dict:
    source_id_by_node = {node["id"]: f"source-{index:03d}" for index, node in enumerate(SOURCE["nodes"], 1)}
    source_nodes = [{"source_id": source_id_by_node[node["id"]], "display_id": node["id"], "label": node["label"], "shape": node["shape"]} for node in SOURCE["nodes"]]
    source_relations = []
    for ordinal, source_edge in enumerate(SOURCE["edges"], 1):
        source_relations.append({"source_ordinal": ordinal, "from_source_id": source_id_by_node[source_edge["from"]], "to_source_id": source_id_by_node[source_edge["to"]], "display_edge_id": source_edge["id"], "kind": source_edge["kind"], **({"label": source_edge["label"]} if "label" in source_edge else {})})
    intents = []
    branch_ids = {item for group in BRANCH_GROUPS for item in group["edgeIds"]}
    loop_ids = {item for lane in LOOP_LANES for item in lane["edgeIds"]}
    for edge in edges:
        dirs = directions(edge["points"])
        bend_count = max(0, len(dirs) - 1)
        kind = "loop" if edge["id"] in loop_ids else "branch" if edge["id"] in branch_ids else "direct" if bend_count == 0 else "manhattan"
        topology = {"orthogonal": True, "segment_count": len(edge["points"]) - 1}
        if len(set(dirs)) == len(dirs):
            topology["directions"] = dirs
        intent = {"edge_id": edge["id"], "kind": kind, "bend_count": bend_count, "label_required": "label" in edge, "arrow_target": edge["arrowTarget"], "topology": topology}
        if "label" in edge:
            intent["label_text"] = edge["label"]["text"]
        if edge["id"] in loop_ids:
            intent["lane_id"] = next(lane["id"] for lane in LOOP_LANES if edge["id"] in lane["edgeIds"])
        intents.append(intent)
    branch_port_ids = ["diagram-020-edge-006", "diagram-020-edge-008", "diagram-020-edge-010", "diagram-020-edge-011", "diagram-020-edge-030", "diagram-020-edge-032", "diagram-020-edge-034", "diagram-020-edge-035"]
    route_exceptions = [{
        "type": "branch-port",
        "object": {"kind": "edge", "ids": [edge_id]},
        "business_reason": "保留来源判断出口的稳定端口语义和对应业务结果。",
        "geometric_reason": "TB 多区域布局中，判断节点的主流程出口继续使用 bottom，左右结果出口使用 left/right，并通过组内留白避免碰撞。",
        "scope": {"diagram_id": DIAGRAM_ID, "applies_to": ["source", "browser"], "condition": "仅适用于该判断出口的实际端口布局"},
        "visual_evidence": {"required": True, "refs": [".aidlc/evidence/diagram-contract/diagram-contract-provider.json#views.normal", ".aidlc/evidence/diagram-contract/diagram-contract-provider.json#views.fit", ".aidlc/evidence/diagram-contract/diagram-contract-provider.json#views.zoom"]},
    } for edge_id in branch_port_ids]
    route = {
        "direction": "TB",
        "affected_edge_ids": [edge["id"] for edge in edges],
        "edge_intents": intents,
        "loop_lanes": [{"id": lane["id"], "side": lane["side"], "lane_offset": lane["laneOffset"], "edge_ids": lane["edgeIds"], "reason": lane["reason"]} for lane in LOOP_LANES],
        "merge_nodes": [{"node_id": "diagram-020-node-hotword-edit", "edge_ids": ["diagram-020-edge-004", "diagram-020-edge-007"], "ports": {"diagram-020-edge-004": "top", "diagram-020-edge-007": "left"}}, {"node_id": "diagram-020-node-darkword-edit", "edge_ids": ["diagram-020-edge-028", "diagram-020-edge-031"], "ports": {"diagram-020-edge-028": "top", "diagram-020-edge-031": "left"}}],
        "branch_groups": [{"id": group["id"], "decision_node_id": group["decisionNodeId"], "edge_ids": group["edgeIds"], "target_ids": group["targetIds"], "direction": group["direction"], "tolerance": group["tolerance"], "depth": group["depth"], "mode": group["mode"], "reason": group["reason"]} for group in BRANCH_GROUPS],
        "exceptions": route_exceptions,
        "main_flow": {"entry_node_ids": main_flow()["entryNodeIds"], "exit_node_ids": main_flow()["exitNodeIds"], "node_ids": main_flow()["nodeIds"], "edge_ids": main_flow()["edgeIds"]},
    }
    return {
        "version": "1", "type": "diagram-expected-contract",
        "source": {"kind": "approved-formal-blueprint", "ref": "docs/正式/20-需求文档/搜索域/蓝图-搜索和推荐V1.1.md", "revision": "working-tree", "digest": sha256(FORMAL_SOURCE)},
        "generator": {"name": GENERATOR_NAME, "version": GENERATOR_VERSION, "config_summary": CONFIG_SUMMARY, "config_digest": CONFIG_DIGEST, "source_refs": ["docs/正式/20-需求文档/搜索域/蓝图-搜索和推荐V1.1.md"]},
        "diagrams": [{
            "id": DIAGRAM_ID, "diagram_type": "flowchart", "intent": "在不改变 34 个业务节点和 35 条连接器语义的前提下，清晰表达搜索域运营配置的责任边界、校验反馈和生效状态。",
            "nodes": [{"id": node["id"], "shape": node["shape"]} for node in SOURCE["nodes"]],
            "edges": [{"id": edge["id"], "from": edge["from"], "to": edge["to"], "from_port": edge["fromPort"], "to_port": edge["toPort"], "kind": edge["kind"], "arrow_target": f"{edge['to']}:{edge['toPort']}"} for edge in SOURCE["edges"]],
            "groups": [{"id": group["id"], "semantic_type": group["semanticType"]} for group in SOURCE["groups"]],
            "legend_ids": [], "annotation_ids": [], "lifeline_ids": [],
            "source_graph": {"nodes": source_nodes, "relations": source_relations},
            "route_contract": route,
        }],
    }


def manifest(nodes: dict[str, dict], edges: list[dict]) -> dict:
    route_config = json.loads(os.environ.get("AIDLC_ROUTE_CONFIG_JSON", json.dumps({"diagram_id": DIAGRAM_ID, "affected_edge_ids": [edge["id"] for edge in edges], "strategy": "multi-region-tb-with-local-lanes", "source_relation_policy": "preserve-all-stable-edges"})))
    notes = {
        "intent": "按正式搜索域来源表达暗纹词、搜索热词和运营后台管理的配置责任边界、校验反馈与生效状态。",
        "semanticModes": ["process-flow"],
        "visualSemantics": [
            {"channel": "node-shape", "role": "semantic", "reason": "矩形表示页面/动作，菱形表示必填项或状态判断。"},
            {"channel": "edge-kind", "role": "semantic", "reason": "所有连接器保留正式来源的有向关系，判断出口用就地文字标签表达。"},
            {"channel": "group-role", "role": "semantic", "reason": "三个业务流程使用 structural 仅表达布局分区层级；节点、连接器和业务文字继续承担业务语义并保持黑色。"},
        ],
        "legendDecision": {"status": "exempt", "reason": "统一视觉基线禁止全局图例；形状、业务边界和判断标签均在对象附近就地表达。", "inlineSemanticEvidence": [{"object": "node-shape", "meaning": "菱形节点和判断出口标签直接表达校验/状态分支。"}, {"object": "group-role", "meaning": "分组标题与成员结构直接表达三个业务配置边界。"}]},
        "splitDecision": {"status": "kept-single", "reason": "正式来源把三个运营配置流程定义为同一搜索域运营目标；迁移版通过分区域扩展画布而非压缩或删减语义。", "singleGoal": "理解搜索域运营如何配置暗纹词、搜索热词和运营后台策略。", "staticBoundary": "本图不固化后台字段、接口契约或实现协议。", "processFlowDistinction": "仅表达按业务发生顺序的配置过程，不把业务边界颜色当作状态语义。", "readabilityEvidence": {state: {"status": "UNVERIFIED", "evidence": f".aidlc/evidence/diagram-contract/diagram-contract-provider.json#views.{state}"} for state in ("normal", "fit", "zoom")}},
        "sourceRelationMerges": [],
        "layout": layout_notes(),
    }
    return {
        "version": 1,
        "document": "docs/草稿/方案设计/zhangyi/蓝图方案-V1.1.md",
        "expected_contract_path": "docs/草稿/方案设计/zhangyi/assets/diagram-020-migrated.expected.json",
        "diagrams": [{
            "id": DIAGRAM_ID, "output": "diagram-020-migrated.svg", "title": "图表 020｜搜索域运营流程（迁移重绘版）", "description": SOURCE["description"], "diagramType": "flowchart", "canvas": CANVAS,
            "sourceBasis": [{"kind": "approved-formal-blueprint", "path": "docs/正式/20-需求文档/搜索域/蓝图-搜索和推荐V1.1.md", "digest": sha256(FORMAL_SOURCE)}],
            "nodes": list(nodes.values()), "edges": edges, "groups": group_entries(), "designNotes": notes, "mainFlow": main_flow(),
            "generation": {"generator": {"name": GENERATOR_NAME, "version": GENERATOR_VERSION}, "config": {"summary": CONFIG_SUMMARY, "digest": CONFIG_DIGEST}, "route_config": route_config, "source_refs": ["docs/正式/20-需求文档/搜索域/蓝图-搜索和推荐V1.1.md"], "outputs": ["docs/草稿/方案设计/zhangyi/assets/diagram-020-migrated.svg", "docs/草稿/方案设计/zhangyi/assets/diagram-020-migrated.diagram.json", "docs/草稿/方案设计/zhangyi/assets/diagram-020-migrated.expected.json"], "command_argv": ["python3", "diagram-020-migrated-generator.py"], "cwd": "."},
        }],
    }


def render_svg(nodes: dict[str, dict], edges: list[dict], groups: list[dict]) -> str:
    parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS['width']}" height="{CANVAS['height']}" viewBox="0 0 {CANVAS['width']} {CANVAS['height']}" role="img" aria-labelledby="diagram-020-migrated-title diagram-020-migrated-desc" data-diagram-id="{DIAGRAM_ID}" data-diagram-type="flowchart">
<title id="diagram-020-migrated-title">图表 020｜搜索域运营流程（迁移重绘版）</title>
<desc id="diagram-020-migrated-desc">搜索域运营对暗纹词、搜索热词以及黑名单、白名单和排序策略的配置流程，包含校验反馈与生效状态判断。</desc>
<rect data-canvas-background="true" x="0" y="0" width="100%" height="100%" fill="#ffffff" stroke="none" />
<defs><marker id="arrow" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="10" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#000000" /></marker></defs>''']
    for group in groups:
        x, y, w, h = group["x"], group["y"], group["width"], group["height"]
        parts.append(f'<g id="group-{group["id"]}" data-group-container="{group["id"]}"><rect data-group="{group["id"]}" data-group-role="{group["semanticType"]}" data-group-style-role="{group["styleRole"]}" x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="#666666" stroke-width="2" /><text data-group-title="{group["id"]}" data-group-style-role="{group["styleRole"]}" x="{x + 24}" y="{y + 30}" text-anchor="start" dominant-baseline="middle" font-family="{FONT}" font-size="16" fill="#666666">{html.escape(group["label"])}</text></g>')
    for edge in edges:
        path = "M " + " L ".join(f"{point[0]:g} {point[1]:g}" for point in edge["points"])
        label_attr = f' data-edge-label="{edge["id"]}"' if "label" in edge else ""
        offset_attr = f' data-from-port-offset="{edge["fromPortOffset"]:g}"' if "fromPortOffset" in edge else ""
        parts.append(f'<path data-edge="{edge["id"]}" data-from="{edge["from"]}" data-from-port="{edge["fromPort"]}" data-to="{edge["to"]}" data-to-port="{edge["toPort"]}" data-arrow-target="{edge["arrowTarget"]}"{offset_attr}{label_attr} d="{path}" fill="none" stroke="#000000" stroke-width="2" marker-end="url(#arrow)" />')
    for node in nodes.values():
        x, y, w, h = node_rect(node)
        label = html.escape(node["label"])
        parts.append(f'<g data-node="{node["id"]}" data-node-shape="{node["shape"]}">')
        if node["shape"] == "diamond":
            points = f"{x + w / 2:g},{y:g} {x + w:g},{y + h / 2:g} {x + w / 2:g},{y + h:g} {x:g},{y + h / 2:g}"
            parts.append(f'<polygon points="{points}" fill="none" stroke="#000000" stroke-width="2" />')
        else:
            parts.append(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" fill="none" stroke="#000000" stroke-width="2" />')
        parts.append(f'<text data-text-id="{node["id"]}-label" x="{x + w / 2:g}" y="{y + h / 2:g}" text-anchor="middle" dominant-baseline="middle" font-family="{FONT}" font-size="16" fill="#000000">{label}</text></g>')
    for edge in edges:
        if "label" in edge:
            label = edge["label"]
            parts.append(f'<text data-edge-label="{edge["id"]}" data-text-id="{edge["id"]}-label" x="{label["x"]:g}" y="{label["y"]:g}" text-anchor="middle" dominant-baseline="middle" font-family="{FONT}" font-size="14" fill="#000000">{html.escape(label["text"])}</text>')
    for edge in edges:
        parts.append(f'<path data-edge-arrow="{edge["id"]}" data-edge="{edge["id"]}" data-arrow-target="{edge["arrowTarget"]}" d="{arrow_path(edge["points"][-1], edge["toPort"])}" fill="#000000" />')
    parts.append('</svg>\n')
    return "\n".join(parts)


def load_source() -> dict:
    global SOURCE
    SOURCE = json.loads(SOURCE_GRAPH.read_text())
    if SOURCE["diagram_id"] != DIAGRAM_ID or len(SOURCE["nodes"]) != 34 or len(SOURCE["edges"]) != 35:
        raise SystemExit("diagram-020 migrated source graph is incomplete")
    return SOURCE


def main() -> None:
    load_source()
    if os.environ.get("AIDLC_DIAGRAM_ID") not in {None, DIAGRAM_ID}:
        raise SystemExit("unexpected diagram id")
    nodes = build_nodes()
    edges = build_edges(nodes)
    groups = group_entries()
    if "--write-expected" in os.sys.argv:
        EXPECTED.write_text(json.dumps(expected_contract(nodes, edges), ensure_ascii=False, indent=2) + "\n")
        print("diagram-020-migrated expected contract generated")
        return
    expected_path = os.environ.get("AIDLC_EXPECTED_CONTRACT_PATH")
    if expected_path and not Path(expected_path).is_file():
        raise SystemExit("expected contract path is not readable")
    MANIFEST.write_text(json.dumps(manifest(nodes, edges), ensure_ascii=False, indent=2) + "\n")
    SVG.write_text(render_svg(nodes, edges, groups))
    print("diagram-020-migrated SVG and sidecar generated")


if __name__ == "__main__":
    main()
