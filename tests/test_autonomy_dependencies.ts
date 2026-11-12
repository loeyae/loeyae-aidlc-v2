import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createDependencyFixture } from "./helpers/autonomy-dependency-fixture";
import { autonomyDigest } from "../core/tools/aidlc-autonomy-files";
import { assertAutonomyDependencyAccess, autonomyImplementationCandidate, capabilityVersion, projectAutonomyDependencies } from "../core/tools/aidlc-autonomy-dependencies";
import { admissionProjection, previewAutonomousAdmission } from "../core/tools/aidlc-autonomous-admission";
import { bindSession, claimToken, captureScopeSession, releaseSession } from "../core/tools/aidlc-session";
import { checkCurrentExecutionGrant } from "../core/tools/aidlc-execution-grant";
import { createInitialState, saveWorkflowState, renderLightWorkflowState, withSessionPublication } from "../core/tools/aidlc-light-state";
import { evidenceScopeForInstance, saveRegistry } from "../core/tools/aidlc-workflow-layout";
import { readSourceRevision } from "../core/tools/aidlc-revision";
import { semanticCheckerDigest } from "../core/tools/aidlc-checker-identity";
type Row = Record<string, any>;
const scratch = mkdtempSync(join(tmpdir(), "aidlc-dependencies-")), inherited = { ...process.env }, repository = resolve(import.meta.dirname, "..");
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const put = (root: string, path: string, value: unknown) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value)); };
const fence = (records: Row[]) => "```aidlc-autonomy\n" + JSON.stringify({ schema: "aidlc.autonomy-source/v1", records }) + "\n```\n";
const fixture = (name: string, options: Parameters<typeof createDependencyFixture>[2] = {}) => createDependencyFixture(scratch, name, options);

let count = 0;
async function test(name: string, fn: () => unknown) { if (process.env.AIDLC_DEPENDENCY_TEST_FILTER && !name.includes(process.env.AIDLC_DEPENDENCY_TEST_FILTER)) return; await fn(); count++; console.log(`PASS ${name}`); }
try {
  await test("multi-unit admission validates staged definitions without declaring future contract/runtime readiness", async () => {
    const f = fixture("planned"); await f.issue(); const p = projectAutonomyDependencies(f.root); assert.equal(p.admission_ready, true); assert.equal(p.dependencies[0].readiness, "pending"); assert.equal(f.run().admission_result, "ready");
    const binding = f.bind("publish"); assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/publish/new.ts"), /requires contract_ready/); assert.throws(() => captureScopeSession(f.root, { stage: "code-generation", module_id: "orders", unit_id: "publish" }), /requires contract_ready/); assert.throws(() => withSessionPublication(f.root, { kind: "global" }, binding.stage_instance, () => put(f.root, "unexpected", "bad")), /requires contract_ready/); assert.equal(existsSync(join(f.root, "unexpected")), false);
  });
  await test("controlled contract readiness unlocks frontend implementation without claiming backend behavior", async () => {
    const f = fixture("contract-ready"); await f.issue(); f.run(); f.seed("contract");
    const state=f.current();state.current_stage="shared-contract-baseline";state.current_stage_instance="shared-contract-baseline@module:orders@unit:backend";state.current_module="orders";state.current_unit="backend";put(f.root,"aidlc/active/aidlc-state.md",renderLightWorkflowState(state));
    const probe=spawnSync(process.execPath,[join(repository,"node_modules/tsx/dist/cli.mjs"),join(repository,"tests/mars249_sensor_runner.ts"),"contract-baseline","--select-stage"],{cwd:f.root,encoding:"utf8",env:process.env,timeout:60000});assert.equal(probe.status,0,probe.stdout+probe.stderr);const checked=JSON.parse(probe.stdout);assert.deepEqual(checked.failures,[],JSON.stringify(checked.failures));assert.equal(checked.plan.revalidate.length,0,JSON.stringify(checked.plan));assert.equal(checked.plan.verify.length,1);
    f.bind("publish"); checkCurrentExecutionGrant(f.root, ["code-write"], "src/publish/new.ts"); assert.equal(projectAutonomyDependencies(f.root).dependencies[0].readiness, "contract_ready");
  });
  await test("implementation waits for whole-unit GREEN and review, and never requires project C8", async () => {
    const f = fixture("implementation", { type: "implementation" }); await f.issue(); f.run(); f.bind("publish"); assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/publish/a.ts"), /capability_verified/); f.seed("implementation"); checkCurrentExecutionGrant(f.root, ["code-write"], "src/publish/a.ts"); assert.equal(f.current().completed_stage_instances.includes("build-and-test"), false);
  });
  await test("runtime is a later actual integration barrier; contract and GREEN do not satisfy it", async () => {
    const f = fixture("runtime", { type: "runtime", checkpoint: "build-and-test" }); await f.issue(); f.run(); f.seed("implementation"); const binding = f.bind("publish"); checkCurrentExecutionGrant(f.root, ["code-write"], "src/publish/a.ts"); assert.throws(() => assertAutonomyDependencyAccess(f.root, binding, ["validation-execute"], undefined, "build-and-test"), /runtime_ready/);
  });
  await test("consume uses pinned real native contract evidence and cannot be rewritten as implement", async () => {
    const f = fixture("consume", { consume: true }); await f.issue(); const p = projectAutonomyDependencies(f.root); assert.equal(p.dependencies[0].readiness, "contract_ready"); assert.equal(f.run().admission_result, "ready"); f.bind("backend"); assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/backend/a.ts"), /does not authorize implementation/); assert.equal(autonomyImplementationCandidate(f.root, "code-generation", "orders", "backend"), false);
  });
  await test("unit write ownership rejects sibling/private and single-writer shared paths", async () => {
    const f = fixture("write-scope"); await f.issue(); f.run(); f.seed("contract"); f.bind("publish");
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/backend/a.ts"), /outside unit write_scope/); assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/shared/types.ts"), /another writer/);
  });
  await test("shared changes invalidate dependent native evidence; private consumer inputs include transitive provider inputs", () => {
    const f = fixture("shared-drift", { type: "implementation" }); const instance = "code-generation@module:orders@unit:publish", scope = evidenceScopeForInstance(f.root, instance), before = readSourceRevision(f.root, scope).scope_digest;
    assert.equal(scope.exclude("src/backend/api.schema"), false); put(f.root, "src/shared/types.ts", "changed\n"); assert.notEqual(readSourceRevision(f.root, evidenceScopeForInstance(f.root, instance)).scope_digest, before);
  });
  const invalid: [string, (d: Row) => void, RegExp][] = [
    ["unknown checkpoint", d => d.edge.consumer_checkpoint = "imaginary-phase", /unknown consumer checkpoint/],
    ["capability version mismatch", d => d.capability.version_digest = "b".repeat(64), /version mismatch/],
    ["forged version", d => { d.cap.version_digest = "b".repeat(64); d.capability.version_digest = d.cap.version_digest; }, /bind actual artifacts/],
    ["missing behavior", d => d.front.behavior_refs = [], /behavior_refs/],
    ["missing acceptance ownership", d => d.front.acceptance_refs = [], /acceptance_refs/],
    ["unsupported extension field", d => d.front.passed = true, /unsupported fields/],
    ["private overlap", d => d.front.write_scope.private_paths = ["src/backend"], /write overlap/],
    ["unsafe path", d => d.front.write_scope.private_paths = ["../escape"], /unsafe path/],
    ["missing shared input", d => d.units.units[0].evidence_inputs.shared_paths = [], /missing from evidence_inputs/],
    ["conflicting shared owner", d => d.front.write_scope.shared_writes[0].owner_unit_ref = d.f.unitRef, /conflicting shared ownership/],
    ["missing capability definition", d => d.capability.capability_id = "other", /one capability definition/],
    ["stub unapproved check", d => d.edge.stub_policy = { check_ids: ["not-real"], contract_ref: d.cap }, /stub only permits/],
  ];
  for (const [name, mutate, pattern] of invalid) await test(`reject ${name}`, () => { const f = fixture(`invalid-${count}`, { mutate }); assert.throws(() => projectAutonomyDependencies(f.root), pattern); });
  await test("plain passed JSON is not controlled readiness evidence", () => {
    const f = fixture("forged-evidence"), state = f.current(); state.completed_stage_instances.push("shared-contract-baseline@module:orders@unit:backend"); put(f.root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(state)); const path = ".aidlc/evidence/shared-contract-baseline/orders/backend/contract-baseline.json"; put(f.root, path, { status: "verified", validation_status: "passed" }); const p = projectAutonomyDependencies(f.root); assert.equal(p.dependencies[0].readiness, "pending"); assert.match(p.dependencies[0].reason, /provenance/);
  });
  console.log(`Autonomy dependencies: ${count} scenarios passed; seeded rows are protocol fixtures, consume-contract uses an actual native producer`);
} finally {
  for (const key of ["AIDLC_SESSION_BINDING", "AIDLC_EXECUTION_GRANT", "AIDLC_AUTONOMY_HOST"]) if (inherited[key] === undefined) delete process.env[key]; else process.env[key] = inherited[key];
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir())); assert.ok(scratch.startsWith(join(tmpdir(), "aidlc-dependencies-"))); rmSync(scratch, { recursive: true, force: true });
}
