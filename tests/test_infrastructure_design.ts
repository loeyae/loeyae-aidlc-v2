import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { infrastructureResources, infrastructureResourceErrors } from "../core/tools/aidlc-infrastructure";
import { createInitialState, saveWorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const scratchParent = join(repository, ".multica", "tmp");
mkdirSync(scratchParent, { recursive: true });
const root = mkdtempSync(join(scratchParent, "infra-test-"));
let passed = 0;
let binding: string | undefined;
function test(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
function write(path: string, content: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
const planned = { name: "merchant-db", type: "MySQL", provisioning_status: "before-deploy", owner: "environment owner", required_before: "deploy", verification: "Confirm target schema, grants and migration/rollback in the target environment", source_refs: ["config/database.yml"] };
const document = (resources: unknown[]) => ({ path: "infrastructure-design.md", content: `deployment resources migration rollback runtime dependencies\n\n数据库未开通；服务只是源码声明；缓存不可据此宣称就绪。\n\n\`\`\`infrastructure-resources\n${JSON.stringify({ schema_version: 1, resources })}\n\`\`\`\n` });
const produce = (resources: unknown[], stage = "infrastructure-design") => infrastructureResources(root, [document(resources)], stage);
function cli(args: string[]) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("AIDLC_")) delete env[key];
  if (binding) env.AIDLC_SESSION_BINDING = binding;
  const result = spawnSync(process.execPath, [process.env.AIDLC_TSX || createRequire(import.meta.url).resolve("tsx/cli"), join(repository, "bin/cli.ts"), ...args], { cwd: root, env, encoding: "utf8" });
  return { code: result.status, out: `${result.stdout}\n${result.stderr}`, json: () => JSON.parse(result.stdout) };
}
try {
  write("config/database.yml", "database: merchant\n");
  test("designPreservesUnprovisioned", () => {
    const evidence = produce([planned]);
    assert.equal(evidence.assessment_scope, "design");
    assert.equal((evidence.resources_enumerated as any[])[0].provisioned, false);
    assert.deepEqual(infrastructureResourceErrors(evidence, "infrastructure-design"), []);
  });
  test("proseCannotConfirmProvisioning", () => {
    for (const prose of ["数据库未配置", "not provisioned", "existing service true", "无资源已创建"]) {
      assert.throws(() => infrastructureResources(root, [{ path: "deployment.md", content: prose }], "infrastructure-design"), /explicit infrastructure-resources inventory/);
    }
  });
  test("missingPlanFails", () => {
    for (const field of ["owner", "verification", "required_before"]) {
      assert.throws(() => produce([{ ...planned, [field]: "" }]), /needs before-deploy/);
    }
    assert.throws(() => produce([{ ...planned, provisioning_status: "declared" }]), /needs before-deploy/);
  });
  test("provisionedNeedsEvidence", () => {
    assert.throws(() => produce([{ ...planned, provisioning_status: "provisioned" }]), /target_environment/);
    write("evidence/environment.md", "Target: test merchant. Environment owner confirmed schema and grants. Change ENV-123.\n");
    const resource = { ...planned, provisioning_status: "provisioned", target_environment: "test", provisioning_evidence: ["evidence/environment.md"] };
    const result = produce([resource], "operations");
    assert.equal((result.resources_enumerated as any[])[0].provisioned, true);
    assert.deepEqual(infrastructureResourceErrors(result, "operations"), []);
    assert.throws(() => produce([{ ...resource, provisioning_evidence: ["missing.md"] }]), /ENOENT/);
  });
  test("deploymentRejectsDesignEvidence", () => {
    const result = produce([planned]);
    assert.ok(infrastructureResourceErrors(result, "operations").some(e => e.includes("assessment_scope")));
    assert.throws(() => produce([planned], "operations"), /provisioned must be true/);
    assert.ok(infrastructureResourceErrors({ ...result, assessment_scope: "provisioning" }, "operations").some(e => e.includes("provisioned must be true")));
    const contradictory = structuredClone(result);
    (contradictory.resources_enumerated as any[])[0].provisioned = true;
    assert.ok(infrastructureResourceErrors(contradictory, "infrastructure-design").some(e => e.includes("contradicts")));
  });
  test("invalidInventoryFails", () => {
    assert.throws(() => produce([]), /non-empty/);
    assert.throws(() => produce([planned, planned]), /duplicate/);
    assert.throws(() => produce([{ ...planned, provisioning_status: "true" }]), /invalid provisioning_status/);
    assert.throws(() => produce([{ ...planned, source_refs: [] }]), /source_refs/);
    assert.throws(() => produce([{ ...planned, source_refs: ["../outside.md"] }]), /project-relative/);
    assert.throws(() => produce([{ ...planned, source_refs: ["missing.yml"] }]), /ENOENT/);
    // No former slice(0, 50): the last resource must be validated too.
    const many = Array.from({ length: 51 }, (_, i) => ({ ...planned, name: `db-${i}` }));
    assert.equal((produce(many).resources_enumerated as any[]).length, 51);
    assert.throws(() => produce([...many, { ...planned, name: "bad", owner: "" }]), /needs before-deploy/);
  });
  test("legacyProvisionedGate", () => {
    assert.deepEqual(infrastructureResourceErrors({ resources_enumerated: [{ name: "db", type: "MySQL", provisioned: true }] }, "infrastructure-design"), []);
    assert.ok(infrastructureResourceErrors({ resources_enumerated: [{ name: "db", type: "MySQL", provisioned: false }] }, "infrastructure-design").length);
  });
  test("referencedInputChangeInvalidatesGate", () => {
    const evidence = produce([planned]);
    write("config/database.yml", "database: changed\n");
    assert.ok(infrastructureResourceErrors(evidence, "infrastructure-design", root).some(e => e.includes("changed")));
    write("config/database.yml", "database: merchant\n");
  });
  test("cliScopeAndProducer", () => {
    const unitRoot = "docs/aidlc/modules/m1/construction/u1";
    write("docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [{ module_id: "m1", name: "merchant", service_id: "merchant" }] }));
    write("docs/aidlc/modules/m1/inception/unit-manifest.json", JSON.stringify({ schema_version: 1, module_id: "m1", units: [{ unit_id: "u1", name: "selection", service_id: "merchant", conditional_stages: ["functional-design", "infrastructure-design"] }] }));
    write(`${unitRoot}/infrastructure-design.md`, document([planned]).content);
    write("docs/aidlc/modules/m2/construction/u2/deployment.md", "TODO unrelated database service\n");
    const state = createInitialState("feature", "4.22.10", "infra-fixture", [], "infra fixture");
    Object.assign(state, { current_phase: "construction", current_stage: "infrastructure-design", current_stage_instance: "infrastructure-design@module:m1@unit:u1", current_module: "m1", current_unit: "u1", completed_stage_instances: ["units-generation@module:m1"] });
    const prerequisites = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
    state.completed_stages = [...prerequisites, "units-generation"];
    state.completed_stage_instances.push(...prerequisites);
    saveWorkflowState(root, state);
    const instance = "infrastructure-design@module:m1@unit:u1";
    const inspected = cli(["module", "inspect", "--stage-instance", instance]);
    assert.equal(inspected.code, 0, inspected.out);
    const bound = cli(["module", "bind", "--stage-instance", instance, "--owner", "test", "--session-id", "infra-fixture", "--expect", inspected.json().expected]);
    assert.equal(bound.code, 0, bound.out);
    binding = JSON.stringify(bound.json().binding);
    const checked = cli(["check", "--sensor", "infrastructure-completeness", "--module", "m1", "--unit", "u1"]);
    assert.equal(checked.code, 0, checked.out);
    assert.equal(checked.json().resources_enumerated[0].provisioned, false);
    const produced = cli(["evidence", "run", "--stage", "infrastructure-design", "--sensor", "infrastructure-completeness", "--module", "m1", "--unit", "u1"]);
    assert.equal(produced.code, 0, produced.out);
    const evidence = JSON.parse(readFileSync(join(root, ".aidlc/evidence/infrastructure-design/m1/u1/infrastructure-completeness.json"), "utf8"));
    assert.equal(evidence.assessment_scope, "design");
    assert.equal(evidence.resources_enumerated[0].provisioned, false);
    assert.equal(evidence.producer.mode, "controlled");
    assert.equal(evidence.checker.exit_code, 0);
    const probe = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("tsx/cli"), join(repository, "tests/gate_probe.ts"), instance, "sensors", "infrastructure-completeness"], { cwd: root, env: { ...process.env, AIDLC_SESSION_BINDING: binding }, encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stdout + probe.stderr);
    assert.deepEqual(JSON.parse(probe.stdout).failures, []);
  });
  console.log(`${passed} infrastructure contract tests passed`);
} finally { rmSync(root, { recursive: true, force: true }); }
