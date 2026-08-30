"""Canonical monochrome styling for generated SVG test fixtures."""

import re
import xml.etree.ElementTree as ET


def _local_name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _svg_tag(root: ET.Element, name: str) -> str:
    if root.tag.startswith("{"):
        return f"{root.tag.split('}', 1)[0]}}}{name}"
    return name


def _number(value: float) -> str:
    return str(int(value)) if value.is_integer() else str(value)


def canonicalize_svg(content: str) -> str:
    root = ET.fromstring(content)
    if root.tag.startswith("{"):
        ET.register_namespace("", root.tag.split("}", 1)[0][1:])

    for parent in list(root.iter()):
        for child in list(parent):
            if (
                child.get("data-canvas-background") is not None
                or child.get("data-legend-item") is not None
                or child.get("data-note") is not None
            ):
                parent.remove(child)

    parent_by_child = {child: parent for parent in root.iter() for child in parent}

    def ancestors(element: ET.Element):
        current = parent_by_child.get(element)
        while current is not None:
            yield current
            current = parent_by_child.get(current)

    def ancestor_value(element: ET.Element, attribute: str):
        return next((candidate.get(attribute) for candidate in ancestors(element) if candidate.get(attribute) is not None), None)

    def inside_mask(element: ET.Element) -> bool:
        return any(_local_name(candidate) == "mask" for candidate in ancestors(element))

    def is_node_shape(element: ET.Element, name: str) -> bool:
        return name in {"rect", "polygon", "ellipse", "circle", "path"} and (
            element.get("data-node") is not None
            or ancestor_value(element, "data-node") is not None
        )

    def node_white_fill(element: ET.Element) -> bool:
        fills = [element.get("fill"), element.get("data-node-fill"), ancestor_value(element, "data-node-fill"), ancestor_value(element, "fill")]
        return any(value is not None and value.strip().lower() in {"#fff", "#ffffff", "white", "rgb(255,255,255)", "rgb(255, 255, 255)"} for value in fills)
    label_containers = [
        element
        for element in root.iter()
        if element.get("data-edge-label") is not None
        and _local_name(element) not in {"path", "text"}
    ]
    for container in label_containers:
        parent = parent_by_child.get(container)
        label = next(
            (candidate for candidate in container.iter() if _local_name(candidate) == "text"),
            None,
        )
        if parent is None or label is None:
            continue
        index = list(parent).index(container)
        direct_label = ET.Element(_svg_tag(root, "text"), dict(label.attrib))
        direct_label.text = "".join(label.itertext())
        direct_label.set("data-edge-label", container.get("data-edge-label", ""))
        parent.remove(container)
        parent.insert(index, direct_label)

    background = ET.Element(
        _svg_tag(root, "rect"),
        {
            "data-canvas-background": "true",
            "x": "0",
            "y": "0",
            "width": "100%",
            "height": "100%",
            "fill": "#ffffff",
            "stroke": "none",
        },
    )
    background_index = 0
    while background_index < len(root) and _local_name(root[background_index]) in {
        "title",
        "desc",
    }:
        background_index += 1
    root.insert(background_index, background)

    marker_shapes: set[ET.Element] = set()
    for marker in (element for element in root.iter() if _local_name(element) == "marker"):
        marker.attrib.update(
            {
                "markerWidth": "10",
                "markerHeight": "10",
                "markerUnits": "userSpaceOnUse",
                "viewBox": "0 0 10 10",
                "refX": "10",
                "refY": "5",
                "orient": "auto",
            }
        )
        shape = next(
            (
                candidate
                for candidate in marker.iter()
                if _local_name(candidate) in {"path", "polygon"}
            ),
            None,
        )
        if shape is not None:
            marker_shapes.add(shape)
            shape.set("fill", "#000000")
            if _local_name(shape) == "path":
                shape.set("d", "M0 0 L10 5 L0 10 Z")

    for element in root.iter():
        name = _local_name(element)
        if inside_mask(element):
            # Mask base/cutout 的白色与透明度是 structural alpha 契约的一部分，不能按业务对象样式重写。
            continue
        if name == "text":
            edge_label = element.get("data-edge-label") is not None
            structural_group_title = (
                element.get("data-group-title") is not None
                and element.get("data-group-style-role") == "structural"
            )
            element.set("font-family", "Microsoft YaHei, 微软雅黑, sans-serif")
            element.set("font-size", "14" if edge_label else "16")
            element.set("fill", "#666666" if structural_group_title else "#000000")
            if edge_label:
                element.set("text-anchor", "middle")
                element.set("dominant-baseline", "middle")
        if element is background or element in marker_shapes:
            continue
        if name in {"rect", "polygon", "ellipse", "circle", "line", "polyline"}:
            structural_group_frame = (
                element.get("data-group") is not None
                and element.get("data-group-style-role") == "structural"
            )
            node_shape = is_node_shape(element, name)
            element.set("fill", "#ffffff" if node_shape and node_white_fill(element) else "none")
            element.set("stroke", "#666666" if structural_group_frame else "#000000")
            element.set("stroke-width", "2")
        if (
            name == "path"
            and element.get("data-edge") is not None
            and element.get("data-edge-arrow") is None
        ):
            element.set("fill", "none")
            element.set("stroke", "#000000")
            element.set("stroke-width", "2")
        if name == "path" and is_node_shape(element, name):
            element.set("fill", "#ffffff" if node_white_fill(element) else "none")
            element.set("stroke", "#000000")
            element.set("stroke-width", "2")

    edge_paths = {
        element.get("data-edge"): element
        for element in root.iter()
        if _local_name(element) == "path"
        and element.get("data-edge")
        and element.get("data-edge-arrow") is None
    }
    for arrow in (
        element
        for element in root.iter()
        if _local_name(element) == "path"
        and element.get("data-edge-arrow") is not None
    ):
        edge = edge_paths.get(arrow.get("data-edge-arrow"))
        values = (
            [
                float(value)
                for value in re.findall(
                    r"[-+]?(?:\d*\.?\d+)(?:[eE][-+]?\d+)?", edge.get("d", "")
                )
            ]
            if edge is not None
            else []
        )
        if len(values) >= 2:
            x, y = values[-2], values[-1]
            port = arrow.get("data-arrow-target", ":right").rsplit(":", 1)[-1]
            if port == "top":
                points = [(x - 5, y - 10), (x, y), (x + 5, y - 10)]
            elif port == "bottom":
                points = [(x - 5, y + 10), (x, y), (x + 5, y + 10)]
            elif port == "left":
                points = [(x - 10, y - 5), (x, y), (x - 10, y + 5)]
            else:
                points = [(x + 10, y - 5), (x, y), (x + 10, y + 5)]
            arrow.set(
                "d",
                "M" + " L".join(f"{_number(px)} {_number(py)}" for px, py in points),
            )
        arrow.set("fill", "#000000")
        arrow.attrib.pop("stroke", None)
        arrow.attrib.pop("stroke-width", None)

    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="unicode")
