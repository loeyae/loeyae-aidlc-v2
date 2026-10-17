import assert from "node:assert/strict";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadGraph, normalizeExecutionGraph } from "../core/tools/aidlc-orchestrate";
import { validateGraph } from "../core/tools/aidlc-graph";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { createInitialState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { fixture, cli, repository, write } from "./mars244_fixture";
const graph = loadGraph();
assert.equal(graph.stage_count, 38);
assert.equal(graph.stages.some(stage => stage.slug === "subagent-execution" || stage.sensors.includes("subagent-evidence")), false);
assert.deepEqual(validateGraph(graph), []);
const legacyGraph = structuredClone(graph);
legacyGraph.stages.push({ ...legacyGraph.stages.find(s => s.slug === "code-generation")!, slug:"subagent-execution",sensors:["subagent-evidence"] });
Object.assign(legacyGraph.stages[0], {lead_agent:"old",support_agents:["old"],mode:"mob",reviewer_agent:"old"});
assert.deepEqual(normalizeExecutionGraph(legacyGraph),graph,"cached legacy graph execution metadata never drives new routing");
for (const stage of graph.stages) for (const field of ["mode", "lead_agent", "support_agents", "reviewer_agent"]) assert.equal(field in stage, false);
assert.ok(graph.stages.find(stage => stage.slug === "code-review")!.sensors.includes("reviewer-required"));
assert.ok(graph.stages.find(stage => stage.slug === "test-case-derivation")!.sensors.includes("test-case-derivation"));
const f = fixture();
try {
  delete process.env.AIDLC_SESSION_BINDING;
  // Separate initial fixture: no synthetic gate bypass is used to obtain this directive.
  const state = createInitialState("express", "4.21.0", undefined, [], "Single-session host execution");
  state.workflow_id = f.state.workflow_id;
  // Fixture administration only (replace the temporary initial state before binding).
  write(f.root, f.statePath, (await import("../core/tools/aidlc-light-state")).renderLightWorkflowState(state));
  const binding = bindSession(f.root, { instance: "workspace-detection", owner: "owner", session: "single", expected: claimToken(undefined) }).binding;
  const next = cli(f.root, ["orchestrate", "next"], JSON.stringify(binding));
  assert.equal(next.status, 0, next.stdout + next.stderr);
  const directive = JSON.parse(next.stdout);
  assert.equal(directive.kind, "run-stage");
  for(const key of ["agent_execution", "lead_agent", "support_agents", "mode", "reviewer_agent"]) assert.equal(key in directive, false);
  assert.deepEqual(directive.execution_policy.required.sensors, directive.sensors);
  assert.deepEqual(directive.execution_policy.required.requires, directive.requires);
  assert.doesNotMatch(directive.handoff_prompt, /dispatch|persona|isolated|结构化结果|conductor-only/);
  assert.equal(existsSync(join(f.root,".aidlc/subagents")), false);
  // Arbitrary host logs never affect the stage contract, positively or negatively.
  for(const status of ["failed", "completed"]) {
    write(f.root,".aidlc/subagents/other.json", { status, module_id:"other" });
    const repeated = cli(f.root, ["orchestrate", "next"], JSON.stringify(binding));
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(JSON.parse(repeated.stdout).sensors, directive.sensors);
  }
  const retired = cli(f.root, ["agent", "plan", "--stage", "code-review"]);
  assert.notEqual(retired.status, 0); assert.match(retired.stderr, /retired/);
  assert.doesNotMatch(readFileSync(join(repository,"core/tools/aidlc-semantic-checks.ts"),"utf8"), /subagentEvidence|\.aidlc\/subagents/);
} finally { delete process.env.AIDLC_SESSION_BINDING; rmSync(f.root, { recursive: true, force: true }); }
console.log("MARS-244 graph/directive boundary passed: host-owned execution, top-level flow contract, review/I13 retained, logs ignored");
