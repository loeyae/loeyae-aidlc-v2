import assert from "node:assert/strict";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { retireExecutionCheckpoint } from "../core/tools/aidlc-retire-execution";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
import { fixture, snapshot, cli, write } from "./mars244_fixture";
const instance = "subagent-execution@module:shop@unit:api";
for (const split of [false, true]) for (const status of ["running", "completed", "parked", "legacy"]) {
  delete process.env.AIDLC_SESSION_BINDING;
  const f = fixture(instance, split);
  try {
    if (status === "parked") f.state.status = "parked";
    if (status === "legacy") delete f.state.current_stage_instance;
    if (status === "completed") f.state.completed_stage_instances.push(instance);
    f.state.history.push({ stage: "code-generation", instance_id: "code-generation@module:shop@unit:api", result: "not_completed", timestamp: new Date().toISOString() });
    f.persist();
    write(f.root, ".aidlc/subagents/old.json", { status: "failed", module_id: "other" });
    write(f.root, ".aidlc/evidence/subagent-execution/shop/api/subagent-evidence.json", { status: "passed" });
    const before = snapshot(f.root);
    retireExecutionCheckpoint(f.root, instance, "user:MARS-244", true);
    assert.deepEqual(snapshot(f.root), before, "migration preview is read-only");
    const a = bindSession(f.root, { instance, owner: "owner", session: "A", expected: claimToken(undefined) });
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(a.binding);
    const b = bindSession(f.root, { instance, owner: "owner", session: "B", expected: claimToken(a.claim), humanInstructionRef: "user:transfer" });
    const prior = snapshot(f.root);
    assert.throws(() => retireExecutionCheckpoint(f.root, instance, "user:MARS-244"), /transferred|conflicts/);
    assert.deepEqual(snapshot(f.root), prior);
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(b.binding);
    assert.throws(() => retireExecutionCheckpoint(f.root, instance, ""), /human instruction/);
    const migration = cli(f.root, ["orchestrate", "upgrade", "--retire-execution", "--instance", instance, "--human-instruction-ref", "user:MARS-244"]);
    assert.equal(migration.status, 0, migration.stdout + migration.stderr);
    const after = snapshot(f.root);
    for (const [p, bytes] of Object.entries(prior)) {
      if (p === f.statePath || p === f.statePath.replace("aidlc-state.md", "audit.md")) continue;
      assert.equal(after[p], bytes, `unrelated or historical file changed: ${p}`);
    }
    const state = loadWorkflowState(f.root, split ? { kind: "module", module_id: "shop" } : { kind: "global" })!;
    assert.equal(state.current_stage_instance, undefined);
    assert.equal(state.status, status === "parked" ? "parked" : "running");
    assert.ok(state.history.some(row => row.result === "execution_retired"));
    assert.equal(state.completed_stage_instances.includes("code-generation@module:shop@unit:api"), false);
    assert.equal(state.active_instances[instance], undefined);
    assert.ok(readFileSync(join(f.root, f.statePath.replace("aidlc-state.md", "audit.md")), "utf8").includes("EXECUTION_CHECKPOINT_RETIRED"));
    assert.ok(existsSync(join(f.root, ".aidlc/subagents/old.json")));
    // The first real stage is still bindable; migration has granted no quality waiver.
    delete process.env.AIDLC_SESSION_BINDING;
    const next = bindSession(f.root, { instance: "code-generation@module:shop@unit:api", owner: "owner", session: "C", expected: claimToken(undefined) });
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(next.binding);
    if (!split) {
      const report = cli(f.root, ["orchestrate", "report", "--stage", "code-generation", "--module", "shop", "--unit", "api", "--result", "completed"]);
      assert.notEqual(report.status, 0, "missing real stage evidence must still block report");
    }
  } finally { delete process.env.AIDLC_SESSION_BINDING; rmSync(f.root, { recursive: true, force: true }); }
}
console.log("MARS-244 migration passed: single/split, pending/completed/parked, stale session rejection, history and sibling bytes preserved, real report still blocked");
