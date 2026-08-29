import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { analyzeAndChooseLayout, type FlowEdgeInput, type FlowNodeInput, type PrimaryFlowInput } from "../core/tools/diagram-layout-analysis.js";
import { DIAGRAM_GEOMETRY_PROFILE, calculateDiagramAxisSpacing, calculateDiagramNodeSize, diagramShapeProfile } from "../core/tools/diagram-visual-style.js";

const here = dirname(fileURLToPath(import.meta.url));

type FixtureNode = { id: string; shape?: string; label?: string | string[] };
type FixtureEdge = { id: string; from: string; to: string; kind?: string; label?: string };

function graph(nodes: FixtureNode[], edges: FixtureEdge[], options: Parameters<typeof analyzeAndChooseLayout>[2] = {}) {
  return analyzeAndChooseLayout(nodes as FlowNodeInput[], edges as FlowEdgeInput[], options);
}

function edge(id: string, from: string, to: string): FixtureEdge {
  return { id, from, to, kind: "directed" };
}

const linear = graph(
  [{ id: "a", label: "开始" }, { id: "b", label: "处理" }, { id: "c", label: "完成" }],
  [edge("e1", "a", "b"), edge("e2", "b", "c")],
);
assert.equal(linear.analysis.nodeCount, 3);
assert.equal(linear.analysis.edgeCount, 2);
assert.deepEqual(linear.analysis.entryNodeIds, ["a"]);
assert.deepEqual(linear.analysis.exitNodeIds, ["c"]);
assert.equal(linear.decision.strategy, "LR_SINGLE_ROW");
assert.equal(linear.decision.direction, "LR");
assert.equal(linear.analysis.branchLayoutPlan.status, "needs-context");
assert.equal(linear.analysis.branchLayoutPlan.baselineGap, DIAGRAM_GEOMETRY_PROFILE.laneGap);
assert.deepEqual(linear.analysis.axisSpacing, calculateDiagramAxisSpacing(160));
assert.deepEqual(calculateDiagramAxisSpacing(240, 400), {
  referenceShape: "rect",
  referenceWidth: 240,
  referenceHeight: 400,
  referenceLongSide: 400,
  referenceShortSide: 240,
  lrMinimumGap: 200,
  tbMinimumGap: 400,
});
assert.equal(diagramShapeProfile("diamond").boundaryModel, "diamond");
assert.deepEqual(calculateDiagramNodeSize("diamond", "判断"), { width: 180, height: 120 });

const shallowBranch = graph(
  [{ id: "a" }, { id: "decision", shape: "diamond" }, { id: "yes" }, { id: "no" }],
  [edge("e1", "a", "decision"), edge("e2", "decision", "yes"), edge("e3", "decision", "no")],
);
assert.equal(shallowBranch.analysis.branchGroupCount, 1);
assert.equal(shallowBranch.analysis.maxBranchDepth, 0);
assert.equal(shallowBranch.analysis.maxParallelBranchCount, 2);
assert.equal(shallowBranch.decision.strategy, "LR_COMPACT_BRANCH");
assert.equal(shallowBranch.decision.direction, "LR");

const nestedBranch = graph(
  [{ id: "a" }, { id: "decision", shape: "diamond" }, { id: "left", shape: "diamond" }, { id: "right" }, { id: "left-yes" }, { id: "left-no" }],
  [edge("e1", "a", "decision"), edge("e2", "decision", "left"), edge("e3", "decision", "right"), edge("e4", "left", "left-yes"), edge("e5", "left", "left-no")],
);
assert.equal(nestedBranch.analysis.branchGroupCount, 2);
assert.equal(nestedBranch.analysis.maxBranchDepth, 1);
assert.equal(nestedBranch.decision.strategy, "TB_MAIN_AXIS");
assert.equal(nestedBranch.decision.direction, "TB");
assert.ok(nestedBranch.decision.reasons.includes("nested-branch-requires-tb"));

const feedback = graph(
  [{ id: "a" }, { id: "decision", shape: "diamond" }, { id: "done" }],
  [edge("e1", "a", "decision"), edge("e2", "decision", "done"), edge("retry", "decision", "a")],
  { feedbackEdgeIds: ["retry"] },
);
assert.deepEqual(feedback.analysis.feedbackEdgeIds, ["retry"]);
assert.equal(feedback.decision.strategy, "TB_MAIN_AXIS");
assert.equal(feedback.decision.direction, "TB");
assert.ok(feedback.decision.reasons.includes("feedback-requires-tb"));

const multipleEntry = graph(
  [{ id: "a" }, { id: "b" }, { id: "c" }],
  [edge("e1", "a", "c"), edge("e2", "b", "c")],
);
assert.equal(multipleEntry.analysis.entryNodeIds.length, 2);
assert.equal(multipleEntry.decision.strategy, "NEEDS_CONTEXT");
assert.equal(multipleEntry.decision.direction, null);

const expectedPath = join(here, "fixtures", "diagram-009", "diagram-009.expected.json");
const sidecarPath = join(here, "fixtures", "diagram-009", "diagram-009.diagram.json");
const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as {
  diagrams: [{ id: string; nodes: Array<{ id: string; shape?: string }>; edges: Array<{ id: string; from: string; to: string; kind?: string }>; route_contract: { loop_lanes?: Array<{ edge_ids: string[] }>; primary_flow?: { node_ids: string[]; edge_ids: string[]; reason: string } } }];
};
const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as {
  diagrams: [{ nodes: Array<{ id: string; label?: string | string[] }>; edges: Array<{ id: string; label?: { text?: string | string[] } }>; designNotes?: { layout?: { primaryFlow?: { nodeIds: string[]; edgeIds: string[]; reason: string } } } }];
};
const expectedDiagram = expected.diagrams[0];
const sidecarDiagram = sidecar.diagrams[0];
const expectedRouteContract = expectedDiagram.route_contract as any;
assert.equal(expectedRouteContract.geometry_profile.version, DIAGRAM_GEOMETRY_PROFILE.version);
assert.equal(expectedRouteContract.geometry_profile.entity_gap, DIAGRAM_GEOMETRY_PROFILE.entityGap);
assert.equal(expectedRouteContract.geometry_profile.port_gap, DIAGRAM_GEOMETRY_PROFILE.portGap);
assert.equal(expectedRouteContract.geometry_profile.obstacle_gap, DIAGRAM_GEOMETRY_PROFILE.obstacleGap);
assert.equal(expectedRouteContract.geometry_profile.lane_gap, DIAGRAM_GEOMETRY_PROFILE.laneGap);
assert.deepEqual(expectedRouteContract.geometry_profile.axis_spacing, { reference_shape: "rect", reference_width: 400, reference_height: 120, reference_long_side: 400, reference_short_side: 120, lr_minimum_gap: 200, tb_minimum_gap: 120 });
assert.equal(Object.keys(expectedRouteContract.geometry_profile.shape_base_sizes).length, 7);
const sidecarLayout = sidecarDiagram.designNotes?.layout as any;
assert.equal(sidecarLayout.geometryProfile.entityGap, DIAGRAM_GEOMETRY_PROFILE.entityGap);
assert.equal(sidecarLayout.geometryProfile.portGap, DIAGRAM_GEOMETRY_PROFILE.portGap);
assert.equal(sidecarLayout.geometryProfile.obstacleGap, DIAGRAM_GEOMETRY_PROFILE.obstacleGap);
assert.equal(sidecarLayout.geometryProfile.laneGap, DIAGRAM_GEOMETRY_PROFILE.laneGap);
assert.deepEqual(sidecarLayout.geometryProfile.axisSpacing, { referenceShape: "rect", referenceWidth: 400, referenceHeight: 120, referenceLongSide: 400, referenceShortSide: 120, lrMinimumGap: 200, tbMinimumGap: 120 });
const labels = new Map(sidecarDiagram.nodes.map((node) => [node.id, node.label]));
const edgeLabels = new Map(sidecarDiagram.edges.map((current) => [current.id, current.label?.text]));
const primaryNodeIds = [
  "open-store", "switch-pickup", "select-store", "browse-products", "add-cart", "cart-checkout", "minimum-order",
  "product-validation", "checkout", "pickup-time", "coupon", "amount-confirmation", "reserve-order", "initiate-payment",
  "alcohol-check", "payment-success", "deduct-inventory", "order-detail", "fulfillment-progress", "order-preparing",
  "store-accept", "picking-result", "waiting-pickup", "pickup-notification", "pickup-on-time", "present-voucher", "handoff", "completed",
];
const edgeByPair = new Map(expectedDiagram.edges.map((current) => [`${current.from}->${current.to}`, current.id]));
const primaryFlow: PrimaryFlowInput = {
  nodeIds: primaryNodeIds,
  edgeIds: primaryNodeIds.slice(0, -1).map((from, index) => {
    const id = edgeByPair.get(`${from}->${primaryNodeIds[index + 1]}`);
    assert.ok(id, `missing primary edge for ${from}`);
    return id;
  }),
  reason: "来源 Mermaid 的正常履约主路径",
};
assert.deepEqual(expectedDiagram.route_contract.primary_flow, {
  node_ids: primaryFlow.nodeIds,
  edge_ids: primaryFlow.edgeIds,
  reason: primaryFlow.reason,
});
assert.deepEqual(sidecarDiagram.designNotes?.layout?.primaryFlow, {
  nodeIds: primaryFlow.nodeIds,
  edgeIds: primaryFlow.edgeIds,
  reason: primaryFlow.reason,
});
const diagram009 = analyzeAndChooseLayout(
  expectedDiagram.nodes.map((node) => ({ id: node.id, shape: node.shape, label: labels.get(node.id) })),
  expectedDiagram.edges.map((current) => ({ id: current.id, from: current.from, to: current.to, kind: current.kind, label: edgeLabels.get(current.id) })),
  {
    feedbackEdgeIds: expectedDiagram.route_contract.loop_lanes?.flatMap((lane) => lane.edge_ids) ?? [],
    primaryFlow,
  },
);
assert.equal(diagram009.analysis.nodeCount, 50);
assert.equal(diagram009.analysis.edgeCount, 57);
assert.equal(diagram009.analysis.decisionNodeIds.length, 10);
assert.equal(diagram009.analysis.primaryFlowStatus, "provided");
assert.equal(diagram009.analysis.branchGroupCount, 10);
assert.equal(diagram009.decision.strategy, "TB_MAIN_AXIS");
assert.equal(diagram009.decision.direction, "TB");
assert.ok(diagram009.decision.reasons.includes("feedback-requires-tb"));
assert.ok(diagram009.decision.reasons.includes("nested-branch-requires-tb"));
assert.equal(diagram009.analysis.branchLayoutPlan.status, "planned");
assert.equal(diagram009.analysis.branchLayoutPlan.strategy, "primary-flow-then-longest-branch");
assert.equal(diagram009.analysis.branchLayoutPlan.baselineGap, DIAGRAM_GEOMETRY_PROFILE.laneGap);
assert.deepEqual(diagram009.analysis.branchLayoutPlan.frozenOrder, [
  "primary-flow",
  ...diagram009.analysis.branchLayoutPlan.groups.map((group) => group.id),
]);
assert.equal(new Set(diagram009.analysis.branchLayoutPlan.groups.map((group) => group.id)).size, diagram009.analysis.branchLayoutPlan.groups.length);
for (const group of diagram009.analysis.branchLayoutPlan.groups) {
  assert.ok(group.edgeIds.length >= 2);
  assert.equal(new Set(group.branchOrder).size, group.edgeIds.length);
  assert.deepEqual([...group.branchOrder].sort(), [...group.edgeIds].sort());
  assert.ok(group.layoutCandidateEdgeId && group.edgeIds.includes(group.layoutCandidateEdgeId));
  assert.ok(group.primaryEdgeId && group.edgeIds.includes(group.primaryEdgeId));
  assert.equal(group.branchGap, DIAGRAM_GEOMETRY_PROFILE.laneGap);
}
assert.equal(expectedRouteContract.branch_layout_plan.strategy, diagram009.analysis.branchLayoutPlan.strategy);
assert.equal(sidecarLayout.branchLayoutPlan.strategy, diagram009.analysis.branchLayoutPlan.strategy);
assert.equal(sidecarLayout.branchLayoutPlan.baselineGap, DIAGRAM_GEOMETRY_PROFILE.laneGap);
assert.equal(sidecarLayout.branchLayoutPlan.groups.length, 10);

const report = {
  diagramId: expectedDiagram.id,
  analysis: {
    nodeCount: diagram009.analysis.nodeCount,
    edgeCount: diagram009.analysis.edgeCount,
    connectedComponentCount: diagram009.analysis.connectedComponentCount,
    entryNodeIds: diagram009.analysis.entryNodeIds,
    exitNodeIds: diagram009.analysis.exitNodeIds,
    decisionNodeIds: diagram009.analysis.decisionNodeIds,
    mergeNodeIds: diagram009.analysis.mergeNodeIds,
    feedbackEdgeIds: diagram009.analysis.feedbackEdgeIds,
    branchGroupCount: diagram009.analysis.branchGroupCount,
    branchPathCount: diagram009.analysis.branchPathCount,
    maxBranchDepth: diagram009.analysis.maxBranchDepth,
    maxParallelBranchCount: diagram009.analysis.maxParallelBranchCount,
    hasCycle: diagram009.analysis.hasCycle,
    primaryFlowStatus: diagram009.analysis.primaryFlowStatus,
    estimatedWidth: diagram009.analysis.estimatedWidth,
    estimatedHeight: diagram009.analysis.estimatedHeight,
    estimatedLinearWidth: diagram009.analysis.estimatedLinearWidth,
    estimatedLinearHeight: diagram009.analysis.estimatedLinearHeight,
    availableWidth: diagram009.analysis.availableWidth,
  },
  branchGroups: diagram009.analysis.branchGroups.map((group) => ({
    decisionNodeId: group.decisionNodeId,
    edgeIds: group.edgeIds,
    pathCount: group.paths.length,
    branchDepth: group.branchDepth,
    mergeNodeId: group.mergeNodeId,
    terminalNodeIds: [...new Set(group.paths.flatMap((path) => path.terminalNodeIds))].sort(),
    cycleDetected: group.paths.some((path) => path.cycleDetected),
  })),
  decision: diagram009.decision,
  branchLayoutPlan: diagram009.analysis.branchLayoutPlan,
};
console.log(JSON.stringify(report, null, 2));
console.log("diagram layout analysis tests passed");
