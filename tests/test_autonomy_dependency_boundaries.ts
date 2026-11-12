import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createDependencyFixture } from "./helpers/autonomy-dependency-fixture";
import { assertAutonomyDependencyAccess, autonomyDependenciesDirective, projectAutonomyDependencies, capabilityVersion } from "../core/tools/aidlc-autonomy-dependencies";
import { projectAutonomyScope } from "../core/tools/aidlc-autonomy";
import { dependencyPath, withinDependencyPath, overlappingDependencyPaths } from "../core/tools/aidlc-dependency-inputs";
import { checkCurrentExecutionGrant } from "../core/tools/aidlc-execution-grant";
import { releaseSession, claimToken } from "../core/tools/aidlc-session";
import { renderLightWorkflowState } from "../core/tools/aidlc-light-state";
import { evidenceScopeForInstance } from "../core/tools/aidlc-workflow-layout";
import { readSourceRevision } from "../core/tools/aidlc-revision";
type Row = Record<string, any>;
const scratch = mkdtempSync(join(tmpdir(), "aidlc-dependency-boundaries-")), inherited = { ...process.env };
const fixture = (name: string, options: Parameters<typeof createDependencyFixture>[2] = {}) => createDependencyFixture(scratch, name, options);
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
let count = 0;
async function test(name: string, fn: () => unknown) { if (process.env.AIDLC_DEPENDENCY_TEST_FILTER && !name.includes(process.env.AIDLC_DEPENDENCY_TEST_FILTER)) return; await fn(); count++; console.log(`PASS ${name}`); }
function reverse(d: Row, type: string, checkpoint: string) {
  const cap = { provider_ref: d.f.unitRef, capability_id: "front-api", version_digest: capabilityVersion("front-api", [d.artifact]) };
  d.front.capability_refs.push(cap); d.extraCapabilities.push({ ...d.f.common("capability", "front-api"), capability_id: "front-api", provider_ref: d.f.unitRef, version_digest: cap.version_digest, artifact_refs: [d.artifact] });
  d.edges.push({ ...d.f.common("dependency", "dep-b"), dependency_id: "dep-b", provider: d.f.unitRef, consumer: d.provider, type, capability_ref: cap, consumer_checkpoint: checkpoint, required_state: type === "implementation" ? "capability_verified" : "runtime_ready", readiness_evidence: [], stub_policy: "denied" });
}
try {
  await test("Windows path ownership compares physical case-insensitive identities", () => {
    assert.equal(withinDependencyPath("SRC/Shared/file.ts", "src/shared"), process.platform === "win32");
    assert.equal(overlappingDependencyPaths("Src/Shared", "src/shared/types.ts"), process.platform === "win32");
    if (process.platform === "win32") assert.throws(() => dependencyPath(scratch, ".GIT/config"), /unsafe path/);
  });
  await test("handoff batch bookkeeping avoids evidence self-reference and retains policy/prose", () => {
    const f = fixture("handoff-projection"), path = join(f.root, "docs/aidlc/handoff.md"), instance = "code-generation@module:orders@unit:backend";
    const source = { schema: "aidlc.autonomy-source/v1", records: [f.policy, f.matrix, f.batch] };
    const write = () => writeFileSync(path, "# Handoff\n\n" + "```aidlc-autonomy\n" + JSON.stringify(source) + "\n```\n"); write();
    const before = readSourceRevision(f.root, evidenceScopeForInstance(f.root, instance)).scope_digest;
    f.batch.goal = "Changed bookkeeping"; write(); assert.equal(readSourceRevision(f.root, evidenceScopeForInstance(f.root, instance)).scope_digest, before);
    f.policy.policy_revision++; write(); assert.notEqual(readSourceRevision(f.root, evidenceScopeForInstance(f.root, instance)).scope_digest, before);
  });
  await test("private write scope cannot subsume a shared owner boundary", () => {
    const f = fixture("private-shared", { mutate: d => d.front.write_scope.private_paths = ["src"] }); assert.throws(() => projectAutonomyDependencies(f.root), /private.shared write overlap|exclusive write overlap/);
  });
  await test("external runtime is explicit and cannot acquire readiness from local proofs", () => {
    const f = fixture("external", { type: "runtime", checkpoint: "build-and-test", mutate: d => {
      const external = { external_id: "remote-publish", owner: "external-team", contract_ref: d.artifact, version_ref: d.artifact };
      d.edge.provider = external; d.edge.capability_ref = { ...d.cap, provider_ref: external };
      d.extraCapabilities.push({ ...d.capability, record_id: "external-api", capability_id: "external-api", provider_ref: external, version_digest: capabilityVersion("external-api", [d.artifact]) });
      d.edge.capability_ref.capability_id = "external-api"; d.edge.capability_ref.version_digest = d.extraCapabilities[0].version_digest;
    } });
    const plan = projectAutonomyDependencies(f.root); assert.equal(plan.dependencies[0].readiness, "unverified"); assert.equal(plan.dependencies[0].planned_in_batch, false); assert.equal(plan.admission_ready, true);
  });
  await test("same-phase implementation cycle is rejected", () => {
    const f = fixture("cycle", { type: "implementation", mutate: d => reverse(d, "implementation", "code-generation") }); assert.throws(() => projectAutonomyDependencies(f.root), /dependency cycle/);
  });
  await test("late runtime cycles do not block contract-first coding and never become runtime_ready", () => {
    const f = fixture("late", { type: "runtime", checkpoint: "build-and-test", mutate: d => reverse(d, "runtime", "build-and-test") }), p = projectAutonomyDependencies(f.root);
    assert.equal(p.admission_ready, true); assert.ok(p.dependencies.every(d => d.readiness === "unverified")); assert.ok(p.dependency_frontier.filter(f => f.checkpoint === "code-generation").every(f => f.dependencies_ready));
  });
  await test("input dependency cycle is rejected separately from execution edges", () => {
    const f = fixture("input-cycle", { mutate: d => { d.units.units[0].evidence_inputs.depends_on_units = ["backend"]; d.units.units[1].evidence_inputs.depends_on_units = ["publish"]; } }); assert.throws(() => projectAutonomyDependencies(f.root), /evidence-input dependency cycle/);
  });
  await test("missing input ownership keeps native module scope with serial execution", () => {
    const f = fixture("module-fallback", { mutate: d => { delete d.units.units[0].evidence_inputs; delete d.units.units[1].evidence_inputs; } }), p = projectAutonomyDependencies(f.root); assert.ok(p.units.every(u => u.evidence_scope === "module")); assert.equal(p.serial_execution_required, true);
  });
  await test("native input paths outside module ownership cannot narrow evidence", () => {
    const f = fixture("outside-input", { mutate: d => d.units.units[0].evidence_inputs.paths = ["elsewhere"] }); assert.throws(() => projectAutonomyDependencies(f.root), /outside its module roots/);
  });
  await test("explicit definition marker cannot be silently inferred from documents", () => {
    const f = fixture("marker", { mutate: d => delete d.units.units[0].autonomy_version }); assert.throws(() => projectAutonomyDependencies(f.root), /autonomy_version/);
  });
  await test("contract provider must have a reachable native declaration stage", () => {
    const f = fixture("unreachable", { mutate: d => d.units.units[1].conditional_stages = [] }); assert.throws(() => projectAutonomyDependencies(f.root), /cannot execute shared-contract-baseline/);
  });
  await test("a real native contract survives unrelated implementation changes and fails on shared-input changes", async () => {
    const f = fixture("contract-scope"); await f.issue(); f.run(); f.seed("contract"); f.bind("publish");
    writeFileSync(join(f.root, "src/backend/business.ts"), "export const value = 2;\n"); checkCurrentExecutionGrant(f.root, ["code-write"], "src/publish/view.ts");
    writeFileSync(join(f.root, "src/shared/types.ts"), "export type ID = number;\n"); assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/publish/view.ts"), /contract_ready/);
  });
  await test("serialized shared writing requires explicit release of the other participant", async () => {
    const f = fixture("serialized", { shared: "serialized" }); await f.issue(); f.run(); f.seed("contract"); const front = f.bind("publish");
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/shared/types.ts"), /serialized shared writer/);
    const instance = "shared-contract-baseline@module:orders@unit:backend"; process.env.AIDLC_SESSION_BINDING = JSON.stringify(f.bindings[instance]); releaseSession(f.root, instance, claimToken(f.current().active_instances[instance]));
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(front); checkCurrentExecutionGrant(f.root, ["code-write"], "src/shared/types.ts");
  });
  await test("local stub is limited to its bound check and cannot pass final integration", async () => {
    const f = fixture("stub", { type: "implementation", checkpoint: "recoverable", mutate: d => { d.f.matrix.checks = [{ check_id: "recoverable", kind: "local" }, "ready"]; d.edge.stub_policy = { check_ids: ["recoverable"], contract_ref: d.cap }; } });
    await f.issue(); f.run(); f.seed("contract"); const binding = f.bind("publish"); assertAutonomyDependencyAccess(f.root, binding, ["validation-execute"], undefined, "recoverable");
    assert.throws(() => assertAutonomyDependencyAccess(f.root, binding, ["validation-execute"], undefined, "build-and-test"), /capability_verified/); assert.equal(projectAutonomyDependencies(f.root).dependencies[0].readiness, "pending");
    assert.equal(autonomyDependenciesDirective(f.root, ["check", "--checkpoint", "recoverable"]).kind, "print");
  });
  await test("consume contract evidence cannot satisfy an implementation dependency", () => {
    const f = fixture("consume-type", { consume: true, type: "implementation" }); assert.throws(() => projectAutonomyDependencies(f.root), /consumed provider cannot satisfy/);
  });
  await test("verify keeps real check IDs and no write authority or fake verification", async () => {
    const f = fixture("verify", { verify: true }); await f.issue(); assert.equal(f.run().admission_result, "ready"); const p = projectAutonomyDependencies(f.root), unit = p.units.find(u => u.role === "verify")!;
    assert.deepEqual(unit.required_checks, ["recoverable"]); assert.equal(unit.verification_status, "pending"); f.bind("backend"); assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/backend/new.ts"), /does not authorize implementation/);
  });
  await test("split workflow references preserve the module's actual ownership", async () => {
    const f = fixture("split", { split: true }); await f.issue(); assert.equal(f.run().admission_result, "ready"); const p = projectAutonomyDependencies(f.root);
    assert.ok(p.units.every(u => u.unit_ref.workflow_ref.owner_kind === "module")); f.bind("backend", "shared-contract-baseline"); checkCurrentExecutionGrant(f.root, ["code-write"], "src/backend/declaration.ts");
  });
  await test("batch-only bookkeeping does not bind provider code evidence, while prose and authority still do", () => {
    const f = fixture("projection"), path = join(f.root, "docs/aidlc/ideation/scenario-module-mapping.md"), instance = "code-generation@module:orders@unit:backend", before = readSourceRevision(f.root, evidenceScopeForInstance(f.root, instance)).scope_digest;
    let text = readFileSync(path, "utf8"); const old = f.batch.goal; text = text.replace(old, "A changed goal"); writeFileSync(path, text);
    assert.equal(readSourceRevision(f.root, evidenceScopeForInstance(f.root, instance)).scope_digest, before); assert.throws(() => projectAutonomyScope(f.root), /BATCH_SCOPE_CHANGED/);
    writeFileSync(path, text + "\nChanged business explanation\n"); assert.notEqual(readSourceRevision(f.root, evidenceScopeForInstance(f.root, instance)).scope_digest, before);
  });
  await test("empty behavior is not an authoring exemption", () => {
    const f = fixture("no-behavior", { mutate: d => d.front.behavior_refs = [] }); assert.throws(() => projectAutonomyDependencies(f.root), /trusted I13/);
  });
  await test("exhausting native stages does not mark batch or project completed", async () => {
    const f = fixture("exhaustion"); await f.issue(); f.run(); const state = f.current(), graph = JSON.parse(readFileSync(join(import.meta.dirname, "../core/tools/data/stage-graph.json"), "utf8"));
    state.completed_stage_instances = graph.stages.flatMap((s: Row) => s.axis === "project" ? [s.slug] : s.axis === "unit" ? ["publish", "backend"].map(u => `${s.slug}@module:orders@unit:${u}`) : [`${s.slug}@module:orders`]); state.completed_stages = graph.stages.map((s: Row) => s.slug);
    const path = join(f.root, "aidlc/active/aidlc-state.md"); writeFileSync(path, renderLightWorkflowState(state)); const before = readFileSync(path, "utf8"), audit = readFileSync(join(f.root, "aidlc/active/audit.md"), "utf8");
    const cli = f.cli(["next"]); const result = JSON.parse(cli.stdout || cli.stderr); assert.equal(result.execution_status, "scope-exhausted", cli.stdout + cli.stderr); assert.equal(result.workflow_completed, false); assert.equal(result.batch_completed, false);
    assert.equal(readFileSync(path, "utf8"), before); assert.equal(readFileSync(join(f.root, "aidlc/active/audit.md"), "utf8"), audit);
  });
  console.log(`Autonomy dependency boundaries: ${count} scenarios passed`);
} finally {
  for (const k of ["AIDLC_SESSION_BINDING", "AIDLC_EXECUTION_GRANT", "AIDLC_AUTONOMY_HOST"]) if (inherited[k] === undefined) delete process.env[k]; else process.env[k] = inherited[k];
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir())); assert.ok(scratch.startsWith(join(tmpdir(), "aidlc-dependency-boundaries-"))); rmSync(scratch, { recursive: true, force: true });
}
