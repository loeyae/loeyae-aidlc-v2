import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { adoptAutonomyBatch, autonomyDigest, projectAutonomyScope, readAutonomyBatch } from "../core/tools/aidlc-autonomy";
import { createInitialState, loadWorkflowState, parseLightWorkflowState, renderLightWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { saveRegistry } from "../core/tools/aidlc-workflow-layout";

type Row = Record<string, any>;
const repository = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "aidlc-autonomy-scope-"));
const inheritedBinding = process.env.AIDLC_SESSION_BINDING;
delete process.env.AIDLC_SESSION_BINDING;
const rawHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const sourcePath = "docs/aidlc/ideation/scenario-module-mapping.md";
const handoffPath = "docs/aidlc/handoff.md";
const sourceText = "# SCENARIO-001 Publish\n\n## REQ-001 Publish ready orders\n\n## AC-001 Ready publishes\n\n## AC-002 Draft is rejected\n\n## PAGE-001 Publish page\n";
let scenarios = 0;
function test(name: string, action: () => void) { action(); scenarios++; console.log(`PASS ${name}`); }
function put(root: string, label: string, text: string) { const path = join(root, label); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text, "utf8"); }
function fence(records: Row[]): string { return "```aidlc-autonomy\n" + JSON.stringify({ schema: "aidlc.autonomy-source/v1", records }) + "\n```\n"; }
function tree(root: string, prefix = ""): Record<string, string> {
  return Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const label = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? Object.entries(tree(root, label)) : [[label, rawHash(readFileSync(join(root, label)))]];
  }));
}
function fixture(name: string) {
  delete process.env.AIDLC_SESSION_BINDING;
  const root = join(scratch, name); mkdirSync(root);
  const state = createInitialState("feature", undefined, `workflow-${name}`, [], "P1-01 scope validation");
  saveWorkflowState(root, state);
  const inputPath = "docs/aidlc/modules/orders/inception/requirements.md";
  put(root, inputPath, sourceText);
  const input = { repository_id: "project", path: inputPath, digest: rawHash(sourceText), digest_mode: "raw-file" };
  const item = (item_id: string) => ({ ...input, item_id });
  const module = { module_id: "orders", name: "Orders", service_id: "orders", paths: ["src"] };
  const units = ["a", "b"].map(unit_id => ({ unit_id, name: unit_id, service_id: "orders", conditional_stages: [], req_refs: ["REQ-001"] }));
  put(root, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [module] }));
  const unitPath = "docs/aidlc/modules/orders/inception/unit-manifest.json";
  put(root, unitPath, JSON.stringify({ schema_version: 1, module_id: "orders", units }));
  const unit = (index: number): Row => ({ workflow_ref: { workflow_id: state.workflow_id, owner_kind: "global" }, module_id: "orders", unit_id: units[index].unit_id, definition_digest: autonomyDigest(units[index]) });
  const common = (record_type: string, record_id: string): Row => ({ schema: "aidlc.autonomy/v1", record_type, record_id, workflow_id: state.workflow_id, revision: 1, inputs: [input] });
  // Source records only: these deliberately do not assert a grant or passing evidence.
  const policy = { ...common("policy", "policy-a"), policy_id: "policy-a", policy_revision: 1,
    scope_refs: [{ batch_id: "publish", scope_revision: 1 }], hard_constraints: [item("REQ-001"), item("PAGE-001")], validation_requirements: [item("AC-001"), item("AC-002")],
    source_precedence: [], delegated_categories: [], fallback_rules: [], allowed_change_classes: ["implementation-refinement"], escalation_conditions: [],
    authority_ref: { source_kind: "host-user-message", source_locator: "fixture-host://policy/1", source_digest: "a".repeat(64), scope_summary: "publish/1", actor_locator: "fixture-product-owner" } };
  const matrix = { ...common("validation-matrix", "matrix-a"), checks: ["ready", "draft"] };
  const ref = (record: Row): Row => ({ repository_id: "project", path: handoffPath, digest: autonomyDigest(record), digest_mode: "json-record-v1", selector: { record_type: record.record_type, record_id: record.record_id } });
  put(root, handoffPath, fence([policy, matrix]));
  const batch: Row = { ...common("batch", "publish"), batch_id: "publish", scope_revision: 1, goal: "Deliver publish", scenario_refs: [item("SCENARIO-001")], acceptance_refs: [item("AC-001"), item("AC-002")], ui_refs: [item("PAGE-001")],
    units: [{ unit_ref: unit(0), role: "implement", expected_capabilities: [] }], dependency_refs: [], consumer_closure: [], baseline_inputs: [input],
    policy_ref: { ...ref(policy), policy_id: "policy-a", policy_revision: 1 }, integration_owner: "coordinator", validation_matrix_ref: ref(matrix),
    delivery_artifacts: [{ artifact_id: "candidate", kind: "candidate", required: true, target_path: "delivery/candidate.txt" }] };
  const write = () => put(root, sourcePath, fence([batch])); write();
  const current = () => loadWorkflowState(root)!;
  const scope = () => readAutonomyBatch(root, current(), "publish");
  const bind = (session = "scope-test") => {
    delete process.env.AIDLC_SESSION_BINDING;
    const result = bindSession(root, { instance: "workspace-detection", owner: "tester", session, expected: claimToken(current().active_instances["workspace-detection"]) });
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(result.binding);
    return result.binding;
  };
  const cli = (args: string[]) => spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "bin/cli.ts"), "orchestrate", ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, AIDLC_SESSION_BINDING: process.env.AIDLC_SESSION_BINDING || "" }, timeout: 30_000,
  });
  return { root, current, batch, write, scope, bind, unit, units, unitPath, common, input, item, policy, matrix, cli };
}
try {
  test("legacy state roundtrip and inspect never opt in from source files", () => {
    const f = fixture("legacy"); const before = tree(f.root);
    assert.deepEqual(projectAutonomyScope(f.root).pending_validation, []);
    assert.equal(projectAutonomyScope(f.root).enabled, false);
    const rendered = renderLightWorkflowState(f.current());
    assert.ok(!rendered.includes("Autonomy Contract Version"));
    assert.equal(renderLightWorkflowState(parseLightWorkflowState(rendered)), rendered);
    assert.deepEqual(tree(f.root), before);
  });
  test("scope resolves a batch beside policy-only handoff, without granting readiness", () => {
    const f = fixture("projection"); const before = tree(f.root), scope = f.scope();
    assert.equal(scope.validation_level, "scope-only"); assert.equal(scope.execution_authorized, false); assert.equal(scope.gates_evaluated, false);
    assert.deepEqual(scope.acceptance_refs!.map(row => row.item_id), ["AC-001", "AC-002"]);
    assert.equal(scope.units![0].role, "implement"); assert.ok(scope.pending_validation.includes("policy-semantics"));
    assert.equal(scope.delivery_artifacts![0].artifact_id, "candidate"); assert.equal(scope.integration_owner, "coordinator");
    assert.deepEqual(tree(f.root), before);
  });
  test("adoption preview requires no session and writes no state/audit/files", () => {
    const f = fixture("preview"); delete process.env.AIDLC_SESSION_BINDING; const before = tree(f.root);
    assert.equal(adoptAutonomyBatch(f.root, "publish", f.current().revision, true).enabled, false);
    const result = f.cli(["autonomy", "adopt", "--batch", "publish", "--expect", String(f.current().revision), "--preview"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).autonomy_scope.enabled, false);
    assert.deepEqual(tree(f.root), before);
  });
  test("adoption requires a live exact global claim, CAS and immutable scope", () => {
    const f = fixture("adoption"); delete process.env.AIDLC_SESSION_BINDING;
    const before = tree(f.root); assert.throws(() => adoptAutonomyBatch(f.root, "publish", f.current().revision), /binding/); assert.deepEqual(tree(f.root), before);
    f.bind(); const revision = f.current().revision;
    assert.throws(() => adoptAutonomyBatch(f.root, "publish", revision - 1), /revision changed/);
    const selected = adoptAutonomyBatch(f.root, "publish", revision); assert.equal(selected.enabled, true);
    const state = f.current(); assert.equal(state.revision, revision + 1); assert.equal(state.autonomy_contract_version, "1");
    assert.deepEqual(state.autonomy_batch, selected.snapshot);
    assert.ok(readFileSync(join(f.root, "aidlc/active/audit.md"), "utf8").includes(`- Autonomy Scope Digest: ${selected.snapshot!.scope_digest}`));
    const adoptedTree = tree(f.root); assert.equal(projectAutonomyScope(f.root).enabled, true);
    assert.equal(adoptAutonomyBatch(f.root, "publish", state.revision).enabled, true); assert.deepEqual(tree(f.root), adoptedTree);
    state.autonomy_batch!.scope_revision = 2;
    assert.throws(() => saveWorkflowState(f.root, state), /BATCH_SCOPE_CHANGED/); assert.deepEqual(tree(f.root), adoptedTree);
  });
  test("CLI inspect preserves bytes; next preview rejects a changed frozen denominator", () => {
    const f = fixture("cli"); f.bind();
    const result = f.cli(["autonomy", "adopt", "--batch", "publish", "--expect", String(f.current().revision)]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const before = tree(f.root), inspection = f.cli(["autonomy", "inspect"]);
    assert.equal(inspection.status, 0, inspection.stdout + inspection.stderr); assert.equal(JSON.parse(inspection.stdout).autonomy_scope.enabled, true);
    assert.deepEqual(tree(f.root), before);
    const unchanged = f.cli(["next", "--preview"]);
    assert.equal(unchanged.status, 0, unchanged.stdout + unchanged.stderr); assert.equal(JSON.parse(unchanged.stdout).autonomy_scope.enabled, true); assert.deepEqual(tree(f.root), before);
    const split = f.cli(["split", "--from", f.current().workflow_id]);
    assert.notEqual(split.status, 0); assert.match(split.stdout + split.stderr, /UnitRef ownership/); assert.deepEqual(tree(f.root), before);
    f.batch.acceptance_refs.pop(); f.write(); const changed = tree(f.root);
    const preview = f.cli(["next", "--preview"]);
    assert.notEqual(preview.status, 0); assert.match(preview.stdout + preview.stderr, /BATCH_SCOPE_CHANGED/);
    assert.deepEqual(tree(f.root), changed);
    const report = f.cli(["report", "--stage", "workspace-detection", "--result", "completed"]);
    assert.notEqual(report.status, 0); assert.match(report.stdout + report.stderr, /BATCH_SCOPE_CHANGED/); assert.deepEqual(tree(f.root), changed);
  });
  const invalids: [string, (f: ReturnType<typeof fixture>) => void, RegExp][] = [
    ["unknown field", f => { f.batch.authorized = true; }, /unsupported fields/],
    ["unsupported source schema", f => { put(f.root, sourcePath, fence([f.batch]).replace("aidlc.autonomy-source/v1", "aidlc.autonomy-source/v9")); }, /unsupported source schema/],
    ["revision mismatch", f => { f.batch.scope_revision = 2; }, /revision mismatch/],
    ["unsafe revision", f => { f.batch.scope_revision = f.batch.revision = Number.MAX_SAFE_INTEGER + 1; }, /safe integer/],
    ["foreign workflow", f => { f.batch.workflow_id = "someone-else"; }, /identity/],
    ["duplicate acceptances", f => { f.batch.acceptance_refs.push(f.batch.acceptance_refs[0]); }, /duplicates/],
    ["missing acceptance definition", f => { f.batch.acceptance_refs[0].item_id = "AC-999"; }, /not defined/],
    ["incidental references are not definitions", f => { const text = sourceText.replace("## AC-001 Ready publishes", "Mention AC-001 only"); put(f.root, f.input.path, text); const h = rawHash(text); f.batch.inputs[0].digest = h; }, /digest changed|not defined/],
    ["foreign repository", f => { f.batch.inputs[0].repository_id = "external"; }, /project repository only/],
    ["path traversal", f => { f.batch.inputs[0].path = "../outside.md"; }, /unsafe input/],
    ["drive path", f => { f.batch.inputs[0].path = "C:/outside.md"; }, /unsafe input/],
    ["digest drift", f => { f.batch.inputs[0].digest = "0".repeat(64); }, /digest changed/],
    ["unknown unit", f => { f.batch.units[0].unit_ref.unit_id = "missing"; }, /unknown unit/],
    ["wrong unit workflow", f => { f.batch.units[0].unit_ref.workflow_ref.workflow_id = "foreign"; }, /workflow ownership/],
    ["unit digest drift", f => { f.batch.units[0].unit_ref.definition_digest = "0".repeat(64); }, /unit definition changed/],
    ["duplicate units", f => { f.batch.units.push(f.batch.units[0]); }, /duplicates/],
    ["duplicate baseline refs", f => { f.batch.baseline_inputs.push(f.batch.baseline_inputs[0]); }, /duplicates/],
    ["duplicate matrix checks", f => { f.matrix.checks.push("ready"); put(f.root, handoffPath, fence([f.policy, f.matrix])); f.batch.validation_matrix_ref.digest = autonomyDigest(f.matrix); }, /duplicates/],
    ["invalid role", f => { f.batch.units[0].role = "done"; }, /unsupported.*role/],
    ["consume lacks version/evidence", f => { f.batch.units.push({ unit_ref: f.unit(1), role: "consume", expected_capabilities: [] }); }, /nonempty|versioned/],
    ["missing input dependency closure", f => { const changed = { ...f.units[0], evidence_inputs: { version: 1, paths: ["src/a"], shared_paths: [], depends_on_units: ["b"] } }; f.units[0] = changed; put(f.root, f.unitPath, JSON.stringify({ schema_version: 1, module_id: "orders", units: f.units })); f.batch.units[0].unit_ref.definition_digest = autonomyDigest(changed); }, /missing input dependency/],
    ["unsafe output", f => { f.batch.delivery_artifacts[0].target_path = "../../out"; }, /unsafe artifact/],
    ["consumer has no checks or exclusion", f => { f.batch.consumer_closure = [{ consumer_ref: f.unit(1), required_checks: [] }]; }, /needs checks/],
    ["policy revision mismatch", f => { f.batch.policy_ref.policy_revision = 7; }, /policy reference/],
  ];
  for (const [name, change, expected] of invalids) test(`reject ${name}`, () => {
    delete process.env.AIDLC_SESSION_BINDING; const f = fixture(`invalid-${scenarios}`); change(f);
    if (name !== "unsupported source schema") f.write();
    const before = tree(f.root); assert.throws(f.scope, expected); assert.deepEqual(tree(f.root), before);
  });
  test("duplicate canonical batches and duplicate/unclosed fences fail", () => {
    const f = fixture("fences"); put(f.root, handoffPath, fence([f.policy, f.matrix, f.batch])); assert.throws(f.scope, /one canonical source/);
    put(f.root, handoffPath, fence([f.policy, f.matrix])); put(f.root, sourcePath, fence([f.batch, f.batch])); assert.throws(f.scope, /duplicates/);
    put(f.root, sourcePath, fence([f.batch]) + fence([f.batch])); assert.throws(f.scope, /exactly one/);
    put(f.root, sourcePath, fence([f.batch]).slice(0, -4)); assert.throws(f.scope, /unclosed/);
  });
  test("lightweight workflows can select the sole batch in handoff", () => {
    const f = fixture("handoff"); put(f.root, sourcePath, "# Scenarios\n"); put(f.root, handoffPath, fence([f.policy, f.matrix, f.batch]));
    const before = tree(f.root); assert.equal(f.scope().snapshot!.source_path, handoffPath); assert.deepEqual(tree(f.root), before);
  });
  test("symlink input cannot escape the project", () => {
    const f = fixture("link"), target = join(scratch, "outside"); mkdirSync(target); put(target, "source.md", sourceText);
    symlinkSync(target, join(f.root, "linked"), process.platform === "win32" ? "junction" : "dir");
    f.batch.inputs[0].path = "linked/source.md"; f.write(); assert.throws(f.scope, /linked input/);
  });
  test("unsupported adopted state versions and malformed snapshots fail closed", () => {
    const f = fixture("state"); f.bind(); adoptAutonomyBatch(f.root, "publish", f.current().revision);
    const text = renderLightWorkflowState(f.current());
    assert.throws(() => parseLightWorkflowState(text.replace("Autonomy Contract Version: 1", "Autonomy Contract Version: 2")), /unsupported/);
    assert.throws(() => parseLightWorkflowState(text.replace('"scope_revision":1', '"scope_revision":0')), /snapshot/);
  });
  test("invalid CLI options reject without mutation", () => {
    const f = fixture("options"); delete process.env.AIDLC_SESSION_BINDING; const before = tree(f.root);
    for (const args of [["autonomy", "inspect", "--batch", "publish"], ["autonomy", "adopt", "--preview"], ["autonomy", "adopt", "--batch", "publish", "--expect", "-1", "--preview"], ["autonomy", "adopt", "--batch", "publish", "--expect", "1", "--preview", "--preview"]]) {
      const result = f.cli(args); assert.notEqual(result.status, 0, result.stdout + result.stderr);
    }
    assert.deepEqual(tree(f.root), before);
  });
  test("legacy preview ignores malformed unadopted source metadata", () => {
    const f = fixture("legacy-broken"); put(f.root, sourcePath, "```aidlc-autonomy\n{invalid}\n```\n");
    const before = tree(f.root), preview = f.cli(["next", "--preview"]);
    assert.equal(preview.status, 0, preview.stdout + preview.stderr);
    assert.equal(projectAutonomyScope(f.root).enabled, false); assert.deepEqual(tree(f.root), before);
  });
  test("split UnitRefs bind the real module workflow and preserve global adoption ownership", () => {
    const f = fixture("split"), global = f.current();
    const module = createInitialState("feature", undefined, "workflow-split-orders", [], "Orders scope");
    module.workflow_kind = "module"; module.module_id = "orders"; module.parent_workflow_id = global.workflow_id;
    const integration = createInitialState("feature", undefined, "workflow-split-integration", [], "Integration scope");
    integration.workflow_kind = "integration"; integration.parent_workflow_id = global.workflow_id;
    saveWorkflowState(f.root, module, { kind: "module", module_id: "orders" });
    saveWorkflowState(f.root, integration, { kind: "integration" });
    saveRegistry(f.root, { version: "1", global_workflow_id: global.workflow_id, split_from_workflow_id: global.workflow_id, split_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      modules: [{ module_id: "orders", workflow_id: module.workflow_id, state_path: "aidlc/active/modules/orders/aidlc-state.md", status: "running", current_stage: "-", inception_done: false, construction_done: false, owner: "-" }],
      integration: { workflow_id: integration.workflow_id, state_path: "aidlc/active/integration/aidlc-state.md", status: "running", current_stage: "-", barrier_ready: false, blocking: [] }, shared_contracts: [], cross_module_requires: [] });
    assert.throws(f.scope, /workflow ownership mismatch/);
    f.batch.units[0].unit_ref.workflow_ref = { workflow_id: module.workflow_id, owner_kind: "module", module_id: "orders" }; f.write();
    assert.equal(f.scope().units![0].unit_ref.workflow_ref.workflow_id, module.workflow_id);
    const beforeModule = readFileSync(join(f.root, "aidlc/active/modules/orders/aidlc-state.md"), "utf8");
    f.bind(); adoptAutonomyBatch(f.root, "publish", f.current().revision);
    assert.equal(f.current().autonomy_contract_version, "1");
    assert.equal(readFileSync(join(f.root, "aidlc/active/modules/orders/aidlc-state.md"), "utf8"), beforeModule);
  });
  test("positive consume and verify closure remains explicitly unverified", () => {
    const f = fixture("roles"); f.units.push({ ...f.units[1], unit_id: "c", name: "c" });
    put(f.root, f.unitPath, JSON.stringify({ schema_version: 1, module_id: "orders", units: f.units }));
    const proof = "fixture version binding only, not controlled readiness evidence\n";
    put(f.root, "fixtures/version.txt", proof);
    const evidence = { sensor: "contract-baseline", stage_instance: "shared-contract-baseline@module:orders@unit:b", path: "fixtures/version.txt", digest: rawHash(proof), workflow_id: f.current().workflow_id };
    f.batch.units.push({ unit_ref: f.unit(1), role: "consume", expected_capabilities: [{ provider_ref: f.unit(1), capability_id: "publish-api", version_digest: "a".repeat(64) }], evidence_refs: [evidence] });
    f.batch.units.push({ unit_ref: f.unit(2), role: "verify", expected_capabilities: [] });
    f.batch.consumer_closure.push({ consumer_ref: f.unit(2), required_checks: ["draft"] }); f.write();
    const before = tree(f.root), projection = f.scope(); assert.deepEqual(projection.units!.map(unit => unit.role), ["implement", "consume", "verify"]);
    assert.equal(projection.gates_evaluated, false); assert.ok(projection.pending_validation.includes("dependency-readiness-and-provenance")); assert.deepEqual(tree(f.root), before);
    evidence.workflow_id = "foreign"; f.write(); assert.throws(f.scope, /another workflow/);
  });
  test("execution dependency closure cannot omit a provider or edge", () => {
    const f = fixture("edges"), path = "docs/aidlc/modules/orders/inception/application-design/unit-of-work-dependency.md";
    const edge = { ...f.common("dependency", "edge-a"), dependency_id: "edge-a", provider: f.unit(1), consumer: f.unit(0), type: "contract", consumer_checkpoint: "code-generation", required_state: "contract_ready", capability_ref: { provider_ref: f.unit(1), capability_id: "publish-api", version_digest: "a".repeat(64) }, readiness_evidence: [], stub_policy: "denied" };
    put(f.root, path, fence([edge])); assert.throws(f.scope, /missing dependency closure/);
    f.batch.units.push({ unit_ref: f.unit(1), role: "implement", expected_capabilities: [] }); f.write(); assert.throws(f.scope, /missing dependency closure/);
    f.batch.dependency_refs = [{ repository_id: "project", path, digest: autonomyDigest(edge), digest_mode: "json-record-v1", selector: { record_type: "dependency", record_id: "edge-a" }, item_id: "edge-a" }]; f.write();
    assert.throws(f.scope, /missing affected consumer/);
    f.batch.consumer_closure = [{ consumer_ref: f.unit(0), required_checks: ["ready"] }]; f.write();
    assert.equal(f.scope().dependency_refs!.length, 1);
    edge.required_state = "runtime_ready"; put(f.root, path, fence([edge])); f.batch.dependency_refs[0].digest = autonomyDigest(edge); f.write(); assert.throws(f.scope, /required_state/);
  });
  test("downstream consumers need explicit validation or reasoned exclusion", () => {
    const f = fixture("downstream"), path = "docs/aidlc/modules/orders/inception/application-design/unit-of-work-dependency.md";
    const edge = { ...f.common("dependency", "edge-downstream"), dependency_id: "edge-downstream", provider: f.unit(0), consumer: f.unit(1), type: "contract", consumer_checkpoint: "code-generation", required_state: "contract_ready", capability_ref: { provider_ref: f.unit(0), capability_id: "publish-api", version_digest: "a".repeat(64) }, readiness_evidence: [], stub_policy: "denied" };
    put(f.root, path, fence([edge])); assert.throws(f.scope, /missing affected consumer/);
    f.batch.consumer_closure = [{ consumer_ref: f.unit(1), required_checks: [], exclusion_reason: "No runtime contract change; this batch changes documentation only" }]; f.write();
    assert.equal(f.scope().consumer_closure!.length, 1);
    f.batch.consumer_closure[0].required_checks.push("ready"); f.write(); assert.throws(f.scope, /excluded consumer/);
    f.batch.consumer_closure[0].required_checks = []; f.write();
    put(f.root, path, fence([{ ...edge, authorized: true }])); assert.throws(f.scope, /unsupported fields/);
  });
  test("consumer closure requires selected verify scope and real matrix check IDs", () => {
    const f = fixture("consumers"); f.batch.consumer_closure.push({ consumer_ref: f.unit(1), required_checks: ["draft"] }); f.write(); assert.throws(f.scope, /missing verify consumer/);
    f.batch.units.push({ unit_ref: f.unit(1), role: "verify", expected_capabilities: [] }); f.write(); assert.equal(f.scope().consumer_closure!.length, 1);
    f.batch.consumer_closure[0].required_checks = ["nonexistent"]; f.write(); assert.throws(f.scope, /unknown matrix check/);
  });
  test("reverse closure finds consumers registered in another module", () => {
    const f = fixture("cross-module"), modulePath = "docs/aidlc/ideation/module-manifest.json";
    const manifest = JSON.parse(readFileSync(join(f.root, modulePath), "utf8"));
    manifest.modules.push({ module_id: "checkout", name: "Checkout", service_id: "checkout", paths: ["checkout"] }); put(f.root, modulePath, JSON.stringify(manifest));
    const unit = { unit_id: "cart", name: "Cart", service_id: "checkout", conditional_stages: [], req_refs: ["REQ-001"] };
    put(f.root, "docs/aidlc/modules/checkout/inception/unit-manifest.json", JSON.stringify({ schema_version: 1, module_id: "checkout", units: [unit] }));
    const consumer = { workflow_ref: { workflow_id: f.current().workflow_id, owner_kind: "global" }, module_id: "checkout", unit_id: "cart", definition_digest: autonomyDigest(unit) };
    const path = "docs/aidlc/modules/checkout/inception/application-design/unit-of-work-dependency.md";
    const edge = { ...f.common("dependency", "cross-edge"), dependency_id: "cross-edge", provider: f.unit(0), consumer, type: "contract", consumer_checkpoint: "code-generation", required_state: "contract_ready", capability_ref: { provider_ref: f.unit(0), capability_id: "publish-api", version_digest: "a".repeat(64) }, readiness_evidence: [], stub_policy: "denied" };
    put(f.root, path, fence([edge])); assert.throws(f.scope, /missing affected consumer closure: checkout\/cart/);
    f.batch.consumer_closure = [{ consumer_ref: consumer, required_checks: ["ready"] }];
    f.batch.units.push({ unit_ref: consumer, role: "verify", expected_capabilities: [] });
    f.batch.dependency_refs = [{ repository_id: "project", path, digest: autonomyDigest(edge), digest_mode: "json-record-v1", selector: { record_type: "dependency", record_id: "cross-edge" }, item_id: "cross-edge" }]; f.write();
    assert.equal(f.scope().units!.length, 2);
  });
  test("unrelated record append and JSON object key order do not invalidate frozen scope", () => {
    const f = fixture("stable"); f.bind(); adoptAutonomyBatch(f.root, "publish", f.current().revision);
    const snapshot = f.current().autonomy_batch;
    put(f.root, handoffPath, fence([f.policy, f.matrix, { ...f.common("decision", "decision-a"), question: "fixture only" }]));
    put(f.root, sourcePath, fence([Object.fromEntries(Object.entries(f.batch).reverse())]));
    assert.deepEqual(projectAutonomyScope(f.root).snapshot, snapshot);
    put(f.root, f.input.path, sourceText + "\nChanged approved input\n"); const changed = tree(f.root);
    assert.throws(() => projectAutonomyScope(f.root), /BATCH_SCOPE_CHANGED/); assert.deepEqual(tree(f.root), changed);
  });
  test("expired and foreign session bindings cannot adopt", () => {
    const f = fixture("claims"), binding = f.bind();
    process.env.AIDLC_SESSION_BINDING = JSON.stringify({ ...binding, session_id: "foreign" });
    const before = tree(f.root); assert.throws(() => adoptAutonomyBatch(f.root, "publish", f.current().revision), /session binding conflicts/); assert.deepEqual(tree(f.root), before);
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(binding);
    const state = f.current(); state.active_instances["workspace-detection"].expires_at = "2020-01-01T00:00:00Z";
    put(f.root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(state));
    assert.throws(() => adoptAutonomyBatch(f.root, "publish", state.revision), /claim expired/);
  });
  test("preview rejects unsupported flags, duplicate marker and nested fake definitions", () => {
    const f = fixture("strict");
    f.batch.acceptance_refs[0].item_id = "AC-001-prefix"; f.write(); assert.throws(f.scope, /not defined/);
    f.batch.acceptance_refs[0].item_id = "AC-001"; f.write(); f.bind(); adoptAutonomyBatch(f.root, "publish", f.current().revision);
    const text = renderLightWorkflowState(f.current());
    assert.throws(() => parseLightWorkflowState(text.replace("- Autonomy Contract Version: 1", "- Autonomy Contract Version: 1\n- Autonomy Contract Version: 1")), /duplicate/);
    assert.throws(() => parseLightWorkflowState(text.replace("- Scope: feature", "- Workflow Kind: module\n- Module: orders\n- Parent Workflow ID: parent\n- Scope: feature")), /global workflow/);
  });
  console.log(`Autonomy scope: ${scenarios} scenarios passed`);
} finally {
  if (inheritedBinding === undefined) delete process.env.AIDLC_SESSION_BINDING; else process.env.AIDLC_SESSION_BINDING = inheritedBinding;
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir()), "cleanup must stay within the temporary root");
  assert.ok(scratch.startsWith(join(tmpdir(), "aidlc-autonomy-scope-")), "cleanup must target this test's allocated directory");
  rmSync(scratch, { recursive: true, force: true });
}
