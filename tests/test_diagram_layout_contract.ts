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

const invalidPrimary = contract();
invalidPrimary.diagrams[0].route_contract.primary_flow.edge_ids = ["edge-no"];
assert.throws(() => parseExpectedContract(invalidPrimary, "flow"), /does not connect adjacent primary nodes/);

const legacyBranch = contract();
delete legacyBranch.diagrams[0].route_contract.primary_flow;
legacyBranch.diagrams[0].route_contract.branch_groups = [{ target_ids: ["yes", "no"], direction: "TB", tolerance: 24 }];
const legacyParsed = parseExpectedContract(legacyBranch, "flow");
assert.deepEqual(legacyParsed.routeContract.branchGroups[0], { targetIds: ["yes", "no"], direction: "TB", tolerance: 24 });

console.log("diagram layout contract tests passed");
