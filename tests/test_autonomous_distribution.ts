/** Execute the selected shipped Harness, not just byte-compare its sources. Run after build. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createAutonomyFixture } from "./helpers/autonomy-fixture";
import { createInitialState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { AUTONOMOUS_EXECUTION_PROTOCOL } from "../core/tools/aidlc-rule-load-plan";
const repository = resolve(import.meta.dirname, ".."),
  dist = join(repository, "dist/codex/.agents/skills/loeyae-aidlc"),
  scratch = mkdtempSync(join(tmpdir(), "aidlc-distribution-mode-")),
  env = { ...process.env };
let count = 0;
const observations: any[] = [];
function test(name: string, fn: () => void) {
  fn();
  count++;
  console.log("PASS " + name);
}
function run(root: string, shipped: boolean, args: string[], bound = true) {
  const entry = shipped
      ? join(dist, "tools/aidlc-orchestrate.ts")
      : join(repository, "core/tools/aidlc-orchestrate.ts"),
    r = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), entry, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, ...(!bound ? { AIDLC_SESSION_BINDING: "" } : {}) },
    });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
}
try {
  const f = createAutonomyFixture(scratch, "adopted-shipped");
  f.freeze();
  test("Codex shipped protocol and runtime exports match the selected mode contract", () => {
    assert.deepEqual(
      readFileSync(join(dist, AUTONOMOUS_EXECUTION_PROTOCOL.replace(/^core\//, ""))),
      readFileSync(join(repository, AUTONOMOUS_EXECUTION_PROTOCOL)),
    );
    assert(existsSync(join(dist, "runtime/host-kernel.cjs")));
    assert(existsSync(join(dist, "runtime/host-model-input.mjs")));
    assert(existsSync(join(dist, "runtime/host-progress.cjs")));
    assert(existsSync(join(dist, "runtime/host-recovery.mjs")));
    assert(existsSync(join(dist, "tools/aidlc-run-recovery.ts")));
  });
  const runtime = await import(pathToFileURL(join(dist, "runtime/aidlc-codex-host.mjs")).href);
  assert.equal(typeof runtime.coreResponse, "function");
  assert.equal(typeof runtime.driveBatch, "function");
  assert.equal(typeof runtime.supervisedTurn, "function");
  test("shipped autonomous preview and rule plan preserve source semantics without mutation", () => {
    const state = readFileSync(join(f.root, "aidlc/active/aidlc-state.md")),
      audit = readFileSync(join(f.root, "aidlc/active/audit.md"));
    const a = run(f.root, false, ["next", "--preview"]),
      b = run(f.root, true, ["next", "--preview"]);
    assert.deepEqual(b.autonomous_execution, a.autonomous_execution);
    assert.equal(b.autonomous_execution.execution_authorized, false);
    assert.equal(b.autonomy_scope.snapshot.scope_digest, a.autonomy_scope.snapshot.scope_digest);
    const rules = run(f.root, true, ["state", "rules"]);
    assert.deepEqual(rules.rule_load_plan, run(f.root, false, ["state", "rules"]).rule_load_plan);
    assert.deepEqual(rules.rule_load_plan.supplemental_protocols, [AUTONOMOUS_EXECUTION_PROTOCOL]);
    assert.deepEqual(readFileSync(join(f.root, "aidlc/active/aidlc-state.md")), state);
    assert.deepEqual(readFileSync(join(f.root, "aidlc/active/audit.md")), audit);
    observations.push({
      mode: "adopted",
      guidance: b.autonomous_execution,
      protocols: rules.rule_load_plan.supplemental_protocols,
      readonly: true,
    });
  });
  const legacy = join(scratch, "unadopted-shipped");
  delete process.env.AIDLC_SESSION_BINDING;
  mkdirSync(legacy);
  saveWorkflowState(
    legacy,
    createInitialState("express", undefined, "legacy-shipped", [], "Distribution compatibility"),
  );
  test("shipped unadopted routes have no autonomous fields or new authority requirements", () => {
    const state = readFileSync(join(legacy, "aidlc/active/aidlc-state.md"));
    const a = run(legacy, false, ["next", "--preview"], false),
      b = run(legacy, true, ["next", "--preview"], false);
    assert.equal(b.kind, a.kind);
    assert.deepEqual(b.next_stage, a.next_stage);
    assert.equal(b.autonomous_execution, undefined);
    assert.equal(b.autonomous_admission, undefined);
    assert.equal(run(legacy, true, ["state", "rules"], false).rule_load_plan.supplemental_protocols, undefined);
    assert.deepEqual(readFileSync(join(legacy, "aidlc/active/aidlc-state.md")), state);
    for (const p of [".git/aidlc/autonomy", ".aidlc/autonomy/grants", ".aidlc/evidence/autonomous-admission"])
      assert.equal(existsSync(join(legacy, p)), false);
    observations.push({ mode: "unadopted", route: b.kind, new_authority_created: false, readonly: true });
  });
  const out = resolve(process.env.AIDLC_EVAL_DIR || "docs/evals/autonomy/p1-09");
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "distribution-smoke.json"),
    JSON.stringify(
      { kind: "actual-selected-distribution-cli-smoke", harness: "codex", observations, business_verified: false },
      null,
      2,
    ) + "\n",
  );
  console.log(`Autonomous distribution: ${count} scenarios passed; actual shipped Codex CLI, no native model run`);
} finally {
  if (env.AIDLC_SESSION_BINDING === undefined) delete process.env.AIDLC_SESSION_BINDING;
  else process.env.AIDLC_SESSION_BINDING = env.AIDLC_SESSION_BINDING;
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir()));
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
