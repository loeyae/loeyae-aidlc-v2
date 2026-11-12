import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createAdmissionFixture } from "./autonomy-admission-fixture";
import { autonomyDigest } from "../../core/tools/aidlc-autonomy-files";
import { assertAutonomyDependencyAccess, autonomyImplementationCandidate, capabilityVersion, projectAutonomyDependencies } from "../../core/tools/aidlc-autonomy-dependencies";
import { admissionProjection, previewAutonomousAdmission } from "../../core/tools/aidlc-autonomous-admission";
import { bindSession, claimToken, captureScopeSession, releaseSession } from "../../core/tools/aidlc-session";
import { checkCurrentExecutionGrant } from "../../core/tools/aidlc-execution-grant";
import { createInitialState, saveWorkflowState, renderLightWorkflowState, withSessionPublication } from "../../core/tools/aidlc-light-state";
import { evidenceScopeForInstance, saveRegistry } from "../../core/tools/aidlc-workflow-layout";
import { readSourceRevision } from "../../core/tools/aidlc-revision";
import { semanticCheckerDigest } from "../../core/tools/aidlc-checker-identity";
type Row = Record<string, any>;
const repository = resolve(import.meta.dirname, "../..");
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const put = (root: string, path: string, value: unknown) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value)); };
const fence = (records: Row[]) => "```aidlc-autonomy\n" + JSON.stringify({ schema: "aidlc.autonomy-source/v1", records }) + "\n```\n";
export function createDependencyFixture(scratch: string, name: string, options: { draft?: boolean; consume?: boolean; verify?: boolean; split?: boolean; type?: string; checkpoint?: string; mutate?: (d: Row) => void; shared?: string } = {}) {
  let data: Row;
  const f = createAdmissionFixture(scratch, name, (plan, f) => {
    const unitPath = "docs/aidlc/modules/orders/inception/unit-manifest.json", units = JSON.parse(readFileSync(join(f.root, unitPath), "utf8"));
    const backend: Row = { unit_id: "backend", name: "Backend", service_id: "orders", autonomy_version: "1", req_refs: ["REQ-001"], conditional_stages: ["functional-design", "shared-contract-baseline"], evidence_inputs: { version: 1, paths: ["src/backend"], shared_paths: ["src/shared"], depends_on_units: [] } };
    units.units[0].autonomy_version = "1"; units.units[0].evidence_inputs = { version: 1, paths: ["src/publish"], shared_paths: ["src/shared"], depends_on_units: [] }; units.units.push(backend);
    f.unitRef.definition_digest = autonomyDigest(units.units[0]);
    const provider = { ...f.unitRef, unit_id: "backend", definition_digest: autonomyDigest(backend) };
    put(f.root, "src/backend/api.schema", "owner: backend\nconsumers: publish\nversion: 1\nschema: PublishRequest\n"); put(f.root, "src/publish/view.ts", "export const view = 'fixture';\n"); put(f.root, "src/shared/types.ts", "export type ID = string;\n");
    const artifact = { repository_id: "project", path: "src/backend/api.schema", digest_mode: "raw-file", digest: hash(readFileSync(join(f.root, "src/backend/api.schema"))) };
    const cap = { provider_ref: provider, capability_id: "publish-api", version_digest: capabilityVersion("publish-api", [artifact]) };
    const capability = { ...f.common("capability", "publish-api"), capability_id: "publish-api", provider_ref: provider, version_digest: cap.version_digest, artifact_refs: [artifact] };
    const extension = (ref: Row, capabilities: Row[]) => ({ ...f.common("unit-extension", ref.unit_id + "-definition"), unit_ref: ref, behavior_refs: [f.item("REQ-001")], acceptance_refs: [f.item("AC-001")], capability_refs: capabilities, integration_checks: [], ui_owner_refs: [],
      write_scope: { private_paths: [`src/${ref.unit_id}`, `tests/${ref.unit_id}`, `docs/aidlc/modules/orders/construction/${ref.unit_id}`], shared_writes: [{ path: "src/shared", owner_unit_ref: provider, coordination: options.shared || "single-writer" }] } });
    const front = extension(f.unitRef, []), back = extension(provider, [cap]), type = options.type || "contract";
    const edge = { ...f.common("dependency", "dep-a"), dependency_id: "dep-a", provider, consumer: f.unitRef, type, capability_ref: cap, consumer_checkpoint: options.checkpoint || "code-generation", required_state: ({ contract: "contract_ready", implementation: "capability_verified", runtime: "runtime_ready" } as Row)[type], readiness_evidence: [], stub_policy: "denied" as any };
    data = { plan, f, unitPath, units, provider, front, back, capability, cap, edge, artifact, edges: [edge], extraCapabilities: [] };
    if (options.split) {
      const parent = f.current(), module = createInitialState("feature", undefined, randomUUID(), [], "Fixture module"), integration = createInitialState("feature", undefined, randomUUID(), [], "Fixture integration");
      Object.assign(module, { workflow_kind: "module", module_id: "orders", parent_workflow_id: parent.workflow_id }); module.completed_stage_instances.push("units-generation@module:orders");
      Object.assign(integration, { workflow_kind: "integration", parent_workflow_id: parent.workflow_id });
      saveWorkflowState(f.root, module, { kind: "module", module_id: "orders" }); saveWorkflowState(f.root, integration, { kind: "integration" });
      saveRegistry(f.root, { version: "1", global_workflow_id: parent.workflow_id, split_from_workflow_id: parent.workflow_id, split_at: new Date().toISOString(), updated_at: new Date().toISOString(), modules: [{ module_id: "orders", workflow_id: module.workflow_id, state_path: "aidlc/active/modules/orders/aidlc-state.md", status: "running", current_stage: "-", inception_done: false, construction_done: false, owner: "-" }], integration: { workflow_id: integration.workflow_id, state_path: "aidlc/active/integration/aidlc-state.md", status: "running", current_stage: "-", barrier_ready: false, blocking: [] }, shared_contracts: [], cross_module_requires: [] });
      Object.assign(f.unitRef.workflow_ref, { workflow_id: module.workflow_id, owner_kind: "module", module_id: "orders" });
    }
    options.mutate?.(data);
    f.unitRef.definition_digest = autonomyDigest(units.units[0]); provider.definition_digest = autonomyDigest(units.units[1]);
    put(f.root, unitPath, units);
    put(f.root, "docs/aidlc/modules/orders/inception/application-design/unit-of-work.md", fence([front, back, capability, ...data.extraCapabilities]));
    const dependencyPath = "docs/aidlc/modules/orders/inception/application-design/unit-of-work-dependency.md"; put(f.root, dependencyPath, fence(data.edges));
    f.batch.units.push({ unit_ref: provider, role: options.consume ? "consume" : options.verify ? "verify" : "implement", expected_capabilities: data.backendExpected || [cap], evidence_refs: [] });
    f.batch.dependency_refs = data.edges.map((e: Row) => ({ ...f.ref(e, dependencyPath), item_id: e.dependency_id })); f.batch.consumer_closure = [{ consumer_ref: f.unitRef, required_checks: ["ready"] }];
    if (options.verify || data.edges.length > 1) f.batch.consumer_closure.push({ consumer_ref: provider, required_checks: ["recoverable"] });
    // Native provider proofs can precede batch adoption. Explicit autonomy_version
    // projects only batch bookkeeping, so its own EvidenceRef is not a source cycle.
    const freeze = f.freeze;
    f.freeze = () => {
      put(f.root, "docs/aidlc/ideation/scenario-module-mapping.md", fence([f.batch]));
      if (options.consume || options.verify) {
        const state = f.current(); state.completed_stage_instances.push("units-generation@module:orders"); put(f.root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(state));
        const binding = bindSession(f.root, { instance: "shared-contract-baseline@module:orders@unit:backend", owner: "agent", session: "test-session", expected: claimToken(undefined) }).binding; process.env.AIDLC_SESSION_BINDING = JSON.stringify(binding);
        data.provider_binding = binding;
        const p = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "core/tools/aidlc-evidence.ts"), "run", "--stage", "shared-contract-baseline", "--module", "orders", "--unit", "backend", "--sensor", "contract-baseline"], { cwd: f.root, encoding: "utf8", timeout: 30000, env: process.env }); assert.equal(p.status, 0, p.stderr + p.stdout);
        const path = ".aidlc/evidence/shared-contract-baseline/orders/backend/contract-baseline.json";
        if (options.consume) f.batch.units[1].evidence_refs = [{ sensor: "contract-baseline", stage_instance: binding.stage_instance, path, digest: hash(readFileSync(join(f.root, path))), workflow_id: state.workflow_id, batch_id: "publish" }];
        const done = f.current(); done.completed_stage_instances.push(binding.stage_instance); put(f.root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(done));
      }
      return freeze();
    };
  },{draft:options.draft});
  const bindings: Row = data!.provider_binding ? { [data!.provider_binding.stage_instance]: data!.provider_binding } : {};
  const bind = (unit: string, stage = "code-generation") => { const state = f.current(); if (!state.completed_stage_instances.includes("units-generation@module:orders")) { state.completed_stage_instances.push("units-generation@module:orders"); put(f.root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(state)); } const instance = `${stage}@module:orders@unit:${unit}`; if (bindings[instance]) process.env.AIDLC_SESSION_BINDING = JSON.stringify(bindings[instance]); const existing = f.current().active_instances[instance]; const binding = bindSession(f.root, { instance, owner: "agent", session: "test-session", expected: claimToken(existing) }).binding; bindings[instance] = binding; process.env.AIDLC_SESSION_BINDING = JSON.stringify(binding); return binding; };
  const seed = (type: string) => {
    const previous = process.env.AIDLC_SESSION_BINDING;
    const run = (stage: string, sensor: string) => { bind("backend", stage); const p = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "core/tools/aidlc-evidence.ts"), "run", "--stage", stage, "--module", "orders", "--unit", "backend", "--sensor", sensor], { cwd: f.root, encoding: "utf8", timeout: 30000, env: process.env }); assert.equal(p.status, 0, p.stderr + p.stdout); const state = f.current(); state.completed_stage_instances.push(stage + "@module:orders@unit:backend"); put(f.root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(state)); };
    if (type === "contract") run("shared-contract-baseline", "contract-baseline");
    else {
      const cases = "docs/aidlc/modules/orders/inception/application-design/test-cases";
      put(f.root, cases + "/_index.md", "# UC-D index\n- UC-D-001 | status: ready | source_ref: REQ-001\n");
      put(f.root, cases + "/UC-D-001.md", "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-001\n---\n# UC-D-001\n");
      put(f.root, ".aidlc/evidence/test-case-derivation/orders/test-case-derivation.json", { status: "required", ucd_total: 1, ready_ucd: 1, ucd_ids: ["UC-D-001"], ucd_units: { "UC-D-001": ["backend"] }, ucd_modes: { "UC-D-001": "new" }, index: cases + "/_index.md" });
      const observation = { phase: "GREEN", status: "passed", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: 0, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["src/backend/observe.cjs"] }] };
      put(f.root, "src/backend/observe.cjs", "require('node:assert/strict').equal(1+1,2); console.log(" + JSON.stringify(JSON.stringify(observation)) + ");\n");
      put(f.root, ".aidlc/commands/code-generation.json", { version: "1", stage: "code-generation", commands: [{ id: "green", role: "green", argv: ["node", "src/backend/observe.cjs"] }] });
      put(f.root, "docs/aidlc/modules/orders/construction/backend/code-review.md", "Spec Axis: passed\nStandards Axis: passed\nreviewer: fixture reviewer\nissues_found: 0\nissues_resolved: 0\nissues_open: 0\nfiles_reviewed: [\"src/backend/api.schema\", \"src/backend/observe.cjs\", \"src/shared/types.ts\"]\n");
      run("code-generation", "green-test-evidence"); run("code-review", "review-evidence");
    }
    if (previous === undefined) delete process.env.AIDLC_SESSION_BINDING; else process.env.AIDLC_SESSION_BINDING = previous;
  };
  return { ...f, data: data!, bindings, bind, seed };
}
