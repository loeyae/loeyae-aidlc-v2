import assert from "node:assert/strict";
import { parseExpectedContract, routeBendCount } from "../core/tools/diagram-contract.js";

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
