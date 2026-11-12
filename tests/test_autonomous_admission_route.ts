/** Native CLI route regression: no speculative state write before first implementation. */
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createAutonomyFixture } from "./helpers/autonomy-fixture";
import { renderLightWorkflowState } from "../core/tools/aidlc-light-state";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
const scratch = mkdtempSync(join(tmpdir(), "aidlc-admission-route-")), inherited = process.env.AIDLC_SESSION_BINDING;
try {
  const f = createAutonomyFixture(scratch, "native-route"); f.freeze();
  const graph = JSON.parse(readFileSync(join(import.meta.dirname, "../core/tools/data/stage-graph.json"), "utf8"));
  const state = f.current(), prefix = graph.stages.slice(0, graph.stages.findIndex((s: any) => s.slug === "tdd"));
  state.completed_stage_instances = prefix.map((s: any) => s.axis === "project" ? s.slug : `${s.slug}@module:orders${s.axis === "unit" ? "@unit:publish" : ""}`);
  state.completed_stages = prefix.map((s: any) => s.slug); state.current_stage = "tdd"; state.current_module = "orders"; state.current_unit = "publish";
  const path = join(f.root, "aidlc/active/aidlc-state.md"); writeFileSync(path, renderLightWorkflowState(state));
  const preview = JSON.parse(f.cli(["next", "--preview", "--module", "orders", "--unit", "publish"]).stdout);
  assert.equal(preview.next_stage.stage, "tdd"); assert.equal(preview.next_stage_status, "planned"); assert.equal(preview.autonomous_admission.admission_result, "not-ready");
  const binding = bindSession(f.root, { instance: "tdd@module:orders@unit:publish", owner: "agent", session: "test-session", expected: claimToken(undefined) }).binding; process.env.AIDLC_SESSION_BINDING = JSON.stringify(binding);
  const before = readFileSync(path, "utf8"), audit = readFileSync(join(f.root, "aidlc/active/audit.md"), "utf8");
  const result = f.cli(["next", "--module", "orders", "--unit", "publish"]); const directive = JSON.parse(result.stdout.trim() || result.stderr.trim());
  assert.equal(directive.kind, "error", result.stdout + result.stderr); assert.match(directive.message, /ADMISSION_NOT_READY/);
  assert.equal(readFileSync(path, "utf8"), before); assert.equal(readFileSync(join(f.root, "aidlc/active/audit.md"), "utf8"), audit);
  console.log("PASS native next blocks first TDD implementation before consumes, claim/context or state/audit publication");
} finally {
  if (inherited === undefined) delete process.env.AIDLC_SESSION_BINDING; else process.env.AIDLC_SESSION_BINDING = inherited;
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir())); assert.ok(scratch.startsWith(join(tmpdir(), "aidlc-admission-route-"))); rmSync(scratch, { recursive: true, force: true });
}
