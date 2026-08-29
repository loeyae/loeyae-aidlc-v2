import assert from "node:assert/strict";
import { parseExpectedContract } from "../core/tools/diagram-contract.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function contract() {
  return {
    version: "1",
    type: "diagram-expected-contract",
    source: { kind: "approved-source", ref: "flow.md", revision: "revision-1", digest: digest("0") },
    generator: { name: "layout-contract-test", version: "1.0.0", config_summary: "layout contract fixture", config_digest: digest("1"), source_refs: ["flow.md"] },
    diagrams: [{
      id: "flow",
      diagram_type: "flowchart",
      intent: "验证主干和分支契约",
      nodes: [{ id: "decision", shape: "diamond" }, { id: "yes", shape: "rect" }, { id: "no", shape: "rect" }],
      edges: [
        { id: "edge-yes", from: "decision", to: "yes", from_port: "right", to_port: "top", kind: "directed" },
        { id: "edge-no", from: "decision", to: "no", from_port: "left", to_port: "top", kind: "directed" },
      ],
      groups: [],
      legend_ids: [],
      annotation_ids: [],
      route_contract: {
        direction: "TB",
        primary_flow: {
          node_ids: ["decision", "yes"],
          edge_ids: ["edge-yes"],
          reason: "业务主流程选择通过分支",
        },
        edge_intents: [
          { edge_id: "edge-yes", kind: "branch", bend_count: 1, label_required: true },
          { edge_id: "edge-no", kind: "branch", bend_count: 1, label_required: true },
        ],
        loop_lanes: [],
        merge_nodes: [],
        branch_groups: [{
          id: "decision-group",
          target_ids: ["yes", "no"],
          direction: "TB",
          tolerance: 24,
          decision_node_id: "decision",
          edge_ids: ["edge-yes", "edge-no"],
          depth: 0,
          mode: "local-lane",
          reason: "两个结果在同一业务层展开",
        }],
        geometry_profile: {
          version: "1",
          entity_gap: 24,
          port_gap: 36,
          obstacle_gap: 12,
          lane_gap: 48,
          axis_spacing: { reference_shape: "rect", reference_width: 160, reference_height: 72, reference_long_side: 160, reference_short_side: 72, lr_minimum_gap: 80, tb_minimum_gap: 72 },
          shape_base_sizes: {
            rect: { min_width: 160, min_height: 72, boundary_model: "rectangle" },
            diamond: { min_width: 180, min_height: 120, boundary_model: "diamond" },
          },
        },
        branch_layout_plan: {
          strategy: "primary-flow-then-longest-branch",
          frozen_order: ["primary-flow", "branch-decision"],
          baseline_gap: 48,
          groups: [{
            id: "branch-decision",
            decision_node_id: "decision",
            edge_ids: ["edge-yes", "edge-no"],
            target_ids: ["yes", "no"],
            branch_order: ["edge-yes", "edge-no"],
            layout_candidate_edge_id: "edge-yes",
            primary_edge_id: "edge-yes",
            depth: 0,
            mode: "local-lane",
            branch_gap: 48,
          }],
        },
        exceptions: [],
      },
    }],
  };
}

const parsed = parseExpectedContract(contract(), "flow");
assert.deepEqual(parsed.routeContract.primaryFlow, {
  nodeIds: ["decision", "yes"],
  edgeIds: ["edge-yes"],
  reason: "业务主流程选择通过分支",
});
assert.deepEqual(parsed.routeContract.branchGroups[0], {
  id: "decision-group",
  targetIds: ["yes", "no"],
  direction: "TB",
  tolerance: 24,
  decisionNodeId: "decision",
  edgeIds: ["edge-yes", "edge-no"],
  depth: 0,
  mode: "local-lane",
  reason: "两个结果在同一业务层展开",
});
assert.deepEqual(parsed.routeContract.geometryProfile, {
  version: "1",
  entityGap: 24,
  portGap: 36,
  obstacleGap: 12,
  laneGap: 48,
  shapeBaseSizes: {
    rect: { minWidth: 160, minHeight: 72, boundaryModel: "rectangle" },
    diamond: { minWidth: 180, minHeight: 120, boundaryModel: "diamond" },
  },
  axisSpacing: { referenceShape: "rect", referenceWidth: 160, referenceHeight: 72, referenceLongSide: 160, referenceShortSide: 72, lrMinimumGap: 80, tbMinimumGap: 72 },
});
assert.deepEqual(parsed.routeContract.branchLayoutPlan, {
  strategy: "primary-flow-then-longest-branch",
  frozenOrder: ["primary-flow", "branch-decision"],
  baselineGap: 48,
  groups: [{
    id: "branch-decision",
    decisionNodeId: "decision",
    edgeIds: ["edge-yes", "edge-no"],
    targetIds: ["yes", "no"],
    branchOrder: ["edge-yes", "edge-no"],
    layoutCandidateEdgeId: "edge-yes",
    primaryEdgeId: "edge-yes",
    depth: 0,
    mode: "local-lane",
    branchGap: 48,
  }],
});

const invalidGeometry = contract();
invalidGeometry.diagrams[0].route_contract.geometry_profile.entity_gap = -1;
assert.throws(() => parseExpectedContract(invalidGeometry, "flow"), /entity_gap must be a finite number/);
const invalidAxisSpacing = contract();
invalidAxisSpacing.diagrams[0].route_contract.geometry_profile.axis_spacing.reference_shape = "diamond";
assert.throws(() => parseExpectedContract(invalidAxisSpacing, "flow"), /reference_shape must be rect/);
const invalidBranchPlan = contract();
invalidBranchPlan.diagrams[0].route_contract.branch_layout_plan.groups[0].branch_order = ["edge-yes", "edge-yes"];
assert.throws(() => parseExpectedContract(invalidBranchPlan, "flow"), /branch_order must (?:be a permutation|not contain duplicate IDs)/);

const invalidPrimary = contract();
invalidPrimary.diagrams[0].route_contract.primary_flow.edge_ids = ["edge-no"];
assert.throws(() => parseExpectedContract(invalidPrimary, "flow"), /does not connect adjacent primary nodes/);

const legacyBranch = contract();
delete legacyBranch.diagrams[0].route_contract.primary_flow;
legacyBranch.diagrams[0].route_contract.branch_groups = [{ target_ids: ["yes", "no"], direction: "TB", tolerance: 24 }];
const legacyParsed = parseExpectedContract(legacyBranch, "flow");
assert.deepEqual(legacyParsed.routeContract.branchGroups[0], { targetIds: ["yes", "no"], direction: "TB", tolerance: 24 });

console.log("diagram layout contract tests passed");
