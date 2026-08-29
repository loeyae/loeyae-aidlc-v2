import assert from "node:assert/strict";
import { parseExpectedContract, routeBendCount, routeDirectionTokens, routeIntentErrors } from "../core/tools/diagram-contract.js";
import { DIAGRAM_LAYOUT_METRICS, diagramVisualStyleErrors, edgeLabelPlacementError, measureDiagramText } from "../core/tools/diagram-visual-style.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

const baseContract = () => ({
  version: "1",
  type: "diagram-expected-contract",
  source: { kind: "approved-source", ref: "source.md", revision: "revision-1", digest: digest("0") },
  generator: { name: "contract-generator", version: "1.0.0", config_summary: "generic protocol fixture", config_digest: digest("1"), source_refs: ["source.md"] },
  diagrams: [{
    id: "diagram",
    diagram_type: "flowchart",
    intent: "验证独立业务期望",
    nodes: [{ id: "node-a", shape: "rect" }, { id: "node-b", shape: "rect" }],
    edges: [{ id: "edge-a", from: "node-a", to: "node-b", from_port: "right", to_port: "left", kind: "directed" }],
    groups: [],
    legend_ids: [],
    annotation_ids: [],
    lifeline_ids: [],
    route_contract: {
      edge_intents: [{ edge_id: "edge-a", kind: "manhattan", bend_count: 1, label_required: false }],
      loop_lanes: [],
      branch_groups: [],
      exceptions: [],
    },
  }],
});

assert.equal(routeBendCount([[0, 0], [20, 0], [20, 10]]), 1);
assert.equal(routeBendCount([[0, 0], [10, 0], [20, 0]]), 0);
assert.equal(routeBendCount([[0, 0], [10, 0], [10, 0], [10, 10], [10, 20]]), 1);
assert.equal(parseExpectedContract(baseContract(), "diagram").routeContract.edgeIntents[0].bendCount, 1);


const canonicalSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" width="200" height="120" role="img">
  <title>统一视觉夹具</title>
  <desc>验证统一单色视觉。</desc>
  <rect data-canvas-background="true" x="0" y="0" width="100%" height="100%" fill="#ffffff" stroke="none" />
  <defs><marker id="arrow" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="10" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#000000" /></marker></defs>
  <g data-node="node-a" data-node-shape="rect"><rect x="20" y="20" width="60" height="30" fill="none" stroke="#000000" stroke-width="2" /><text data-text-id="node-a-label" x="50" y="35" font-family="Microsoft YaHei, 微软雅黑, sans-serif" font-size="16" fill="#000000">开始</text></g>
  <path data-edge="edge-a" data-from="node-a" data-from-port="right" data-to="node-b" data-to-port="left" data-edge-label="edge-a" d="M20 80 L180 80" fill="none" stroke="#000000" stroke-width="2" marker-end="url(#arrow)" />
  <path data-edge-arrow="edge-a" data-edge="edge-a" data-arrow-target="node-b:left" d="M170 75 L180 80 L170 85" fill="#000000" />
  <text data-edge-label="edge-a" data-text-id="label-edge-a" x="100" y="60" text-anchor="middle" dominant-baseline="middle" font-family="Microsoft YaHei, 微软雅黑, sans-serif" font-size="14" fill="#000000">完成</text>
</svg>`;

assert.deepEqual(diagramVisualStyleErrors(canonicalSvg), []);
const visualFailures: Array<[string, string, RegExp]> = [
  ["canvas", canonicalSvg.replace('fill="#ffffff"', 'fill="#f8fafc"'), /canvas background|non-standard color/],
  ["ink", canonicalSvg.replace('stroke="#000000" stroke-width="2"', 'stroke="#ff0000" stroke-width="2"'), /non-standard color|stroke must/],
  ["font", canonicalSvg.replace('font-family="Microsoft YaHei, 微软雅黑, sans-serif"', 'font-family="Arial, sans-serif"'), /FONT_STYLE/],
  ["font-size", canonicalSvg.replace('font-size="16"', 'font-size="15"'), /font-size must be 16/],
  ["label-frame", canonicalSvg.replace('<text data-edge-label="edge-a"', '<g data-edge-label="edge-a"><rect x="80" y="50" width="40" height="20" fill="none" stroke="#000000" stroke-width="2" /><text').replace("</text>\n</svg>", "</text></g>\n</svg>"), /LABEL_STYLE/],
  ["global-decoration", canonicalSvg.replace('</svg>', '<g data-note="global-note"></g></svg>'), /global legends and note layers/],
  ["marker-size", canonicalSvg.replace('markerWidth="10"', 'markerWidth="8"'), /marker must use 10x10/],
  ["arrow-size", canonicalSvg.replace('M170 75 L180 80 L170 85', 'M172 76 L180 80 L172 84'), /arrow edge-a must be 10x10/],
];
for (const [name, svg, expected] of visualFailures) {
  assert.ok(diagramVisualStyleErrors(svg).some((error) => expected.test(error)), name);
}

assert.equal(measureDiagramText("中文", 16), 32);
assert.equal(DIAGRAM_LAYOUT_METRICS.frameLineHeight, 24);

const structuralGroupSvg = canonicalSvg.replace(
  '  <g data-node="node-a"',
  '  <rect id="group-lane" data-group="lane" data-group-role="exclusive" data-group-style-role="structural" x="10" y="10" width="180" height="100" fill="none" stroke="#666666" stroke-width="2" />\n  <text data-group-title="lane" data-group-style-role="structural" x="34" y="30" font-family="Microsoft YaHei, 微软雅黑, sans-serif" font-size="16" fill="#666666">阶段</text>\n  <g data-node="node-a"',
);
assert.deepEqual(diagramVisualStyleErrors(structuralGroupSvg), []);
const structuralGroupFailures: Array<[string, string, RegExp]> = [
  ["gray-node", structuralGroupSvg.replace('x="20" y="20" width="60" height="30" fill="none" stroke="#000000"', 'x="20" y="20" width="60" height="30" fill="none" stroke="#666666"'), /non-standard color|stroke must/],
  ["gray-edge", structuralGroupSvg.replace('d="M20 80 L180 80" fill="none" stroke="#000000"', 'd="M20 80 L180 80" fill="none" stroke="#666666"'), /non-standard color|stroke must/],
  ["light-gray", structuralGroupSvg.replace('stroke="#666666"', 'stroke="#999999"'), /non-standard color|stroke must/],
  ["missing-group-role", structuralGroupSvg.replace('data-group-role="exclusive" ', ''), /GROUP_STYLE/],
  ["missing-title-role", structuralGroupSvg.replace('data-group-title="lane" data-group-style-role="structural"', 'data-group-title="lane"'), /GROUP_STYLE|FONT_STYLE/],
];
for (const [name, svg, expected] of structuralGroupFailures) {
  assert.ok(diagramVisualStyleErrors(svg).some((error) => expected.test(error)), name);
}

assert.equal(edgeLabelPlacementError("horizontal", [[0, 0], [100, 0]], { text: "完成", x: 50, y: -20, fontSize: 14 }), null);
assert.equal(edgeLabelPlacementError("vertical", [[0, 0], [0, 100]], { text: "完成", x: -20, y: 50, fontSize: 14 }), null);
assert.match(edgeLabelPlacementError("covered", [[0, 0], [100, 0]], { text: "完成", x: 50, y: 0, fontSize: 14 }) || "", /LABEL_PLACEMENT/);

const withLegendIds = baseContract();
withLegendIds.diagrams[0].legend_ids = ["legacy-legend"];
assert.throws(() => parseExpectedContract(withLegendIds, "diagram"), /legend_ids must be empty/);
const withAnnotationIds = baseContract();
withAnnotationIds.diagrams[0].annotation_ids = ["legacy-note"];
assert.throws(() => parseExpectedContract(withAnnotationIds, "diagram"), /annotation_ids must be empty/);

const withActualGeometry = baseContract();
(withActualGeometry.diagrams[0].nodes[0] as Record<string, unknown>).x = 10;
assert.throws(() => parseExpectedContract(withActualGeometry, "diagram"), /actual geometry/);

const withIncompleteException = baseContract();
withIncompleteException.diagrams[0].route_contract.exceptions = [{
  type: "crossing",
  object: { kind: "edge-pair", ids: ["edge-a", "edge-a"] },
  business_reason: "",
  geometric_reason: "避让",
  scope: { diagram_id: "diagram", applies_to: ["browser"], condition: "仅适用于该图" },
  visual_evidence: { required: true, refs: [] },
}];
assert.throws(() => parseExpectedContract(withIncompleteException, "diagram"), /business_reason|object/);

console.log("diagram contract protocol tests passed");

assert.deepEqual(routeDirectionTokens([[0, 0], [20, 0], [20, 10], [40, 10]]), ["right", "down", "right"]);
assert.deepEqual(routeIntentErrors({ edgeId: "edge-a", kind: "manhattan", bendCount: 1, labelRequired: true, arrowTarget: "node-b:left", labelText: "完成", topology: { orthogonal: true, segmentCount: 2, directions: ["right", "down"] } }, [[0, 0], [20, 0], [20, 10]], true, "node-b:right", "错误"), [
  "ROUTE_ARROW_TARGET_DIFF: route edge-a arrowTarget is node-b:right, expected node-b:left",
  "ROUTE_LABEL_DIFF: route edge-a label is \"错误\", expected \"完成\"",
]);
assert.ok(routeIntentErrors({ edgeId: "edge-diagonal", kind: "manhattan", bendCount: 1, labelRequired: false, topology: { orthogonal: true } }, [[0, 0], [20, 10]], false).some((error) => error.startsWith("NON_MANHATTAN:")));

const sourceBacked = baseContract();
sourceBacked.diagrams[0].source_graph = {
  nodes: [
    { source_id: "A", display_id: "node-a", label: "开始", shape: "rect" },
    { source_id: "B", display_id: "node-b", label: "完成", shape: "rect" },
  ],
  relations: [{ source_ordinal: 1, from_source_id: "A", to_source_id: "B", display_edge_id: "edge-a", kind: "directed" }],
  reading_paths: [{ id: "happy-path", node_ids: ["node-a", "node-b"], edge_ids: ["edge-a"], required_labels: [] }],
};
assert.deepEqual(parseExpectedContract(sourceBacked, "diagram").sourceGraph?.readingPaths[0].edgeIds, ["edge-a"]);
const invalidSourceProjection = baseContract();
invalidSourceProjection.diagrams[0].source_graph = {
  nodes: [
    { source_id: "A", display_id: "node-a", label: "开始", shape: "rect" },
    { source_id: "B", display_id: "node-b", label: "完成", shape: "rect" },
  ],
  relations: [{ source_ordinal: 1, from_source_id: "A", to_source_id: "B", display_edge_id: "edge-a", kind: "dashed" }],
};
assert.throws(() => parseExpectedContract(invalidSourceProjection, "diagram"), /kind does not match expected edge/);
