import { currentObservations } from "./aidlc-observation-inputs";
/** P1-05: staged dependency consumption, conservative unit completion and write ownership.
 * No supervisor and no authoring-status promotion into runtime evidence. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { projectAutonomyScope, ScopeReader, type AutonomyUnitRef, type AutonomyScopeProjection } from "./aidlc-autonomy";
import { array, autonomyDigest as digest, canonicalAutonomyJson as json, ENVELOPE, id, object, safeFile, string, unique } from "./aidlc-autonomy-files";
import { assertSessionClaim, loadWorkflowState, sessionBinding, type SessionBinding } from "./aidlc-light-state";
import { evidenceScopeForInstance, loadWorkflowParts } from "./aidlc-workflow-layout";
import { readModuleManifest, readUnitManifest, unitUcdIds } from "./aidlc-execution-context";
import { assertControlledI13 } from "./aidlc-i13-applicability";
import { evidenceTimeError, reviewIssueErrors } from "./aidlc-evidence-policy";
import { semanticCheckerIdentityErrors } from "./aidlc-checker-identity";
import { autonomyDependencyInputs, dependencyClaimConflict, dependencyPath, dependencyRecords, overlappingDependencyPaths as overlap, unitDependencyKey as key, unitDependencyPath, unitExtensionPath, withinDependencyPath as within } from "./aidlc-dependency-inputs";
import { checkExecutionGrant, type GrantOperation } from "./aidlc-grant-store";
import { riskRequiredStages, selectExecutableStages } from "./aidlc-stage-selection";

type Row = Record<string, any>;
const same = (a: unknown, b: unknown) => json(a) === json(b);
const hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");
const ENTRY = ["shared-contract-baseline", "tdd", "code-generation"];
const ORDER = ["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design", "ui-implementation-bridge", "shared-contract-baseline", "tdd", "code-generation", "code-review", "build-and-test", "implementation-report"];
const stageGraph = (): any[] => JSON.parse(readFileSync(new URL("./data/stage-graph.json", import.meta.url), "utf8")).stages;
function fail(message: string): never { throw new Error(`DEPENDENCY_NOT_READY: ${message}`); }
export function capabilityVersion(capabilityId: string, artifacts: unknown[]): string { return digest({ capability_id: capabilityId, artifact_refs: artifacts }); }
export interface DependencyProjection {
  enabled: boolean; validation_level: "dependency-and-write-scope"; execution_authorized: false; business_verified: false;
  admission_ready: boolean; units: Row[]; dependencies: Row[]; definition_refs: Row[]; evidence_refs: Row[]; serial_execution_required: boolean;
  dependency_frontier: Row[];
}
function sourceRef(path: string, record: Row): Row { return { repository_id: "project", path, digest_mode: "json-record-v1", selector: { record_type: record.record_type, record_id: record.record_id }, digest: digest(record) }; }
function cycle(graph: Map<string, string[]>, label: string): void {
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (node: string) => { if (visiting.has(node)) fail(`${label} cycle at ${node}`); if (visited.has(node)) return; visiting.add(node); for (const next of graph.get(node) || []) visit(next); visiting.delete(node); visited.add(node); };
  for (const node of graph.keys()) visit(node);
}
function nativeGate(root: string, module: string, unit: string, stage: string, sensor: string): void {
  const tsx = createRequire(import.meta.url).resolve("tsx/cli"), checker = fileURLToPath(new URL("./aidlc-dependency-checker.ts", import.meta.url));
  const native = spawnSync(process.execPath, [tsx, checker, module, unit, stage, sensor], { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, shell: false, windowsHide: true });
  if (native.error || native.status !== 0) fail(`native ${sensor} gate rejected: ${native.stderr || native.stdout || native.error}`);
}
function readEvidence(root: string, provider: AutonomyUnitRef, sensor: string, stage: string, refs: Row[], artifacts: Row[]): Row {
  const instance = `${stage}@module:${provider.module_id}@unit:${provider.unit_id}`;
  const path = `.aidlc/evidence/${stage}/${provider.module_id}/${provider.unit_id}/${sensor}.json`;
  const pinned = refs.find(r => r.sensor === sensor);
  if (pinned && (pinned.path !== path || pinned.stage_instance !== instance || pinned.workflow_id !== provider.workflow_ref.workflow_id)) fail(`evidence scope mismatch for ${key(provider)} ${sensor}`);
  const bytes = readFileSync(safeFile(root, path)); if (pinned && pinned.digest !== hash(bytes)) fail(`pinned evidence changed: ${path}`);
  const e = JSON.parse(bytes.toString("utf8")), c = e.checker, p = e.producer;
  if (e.evidence_version !== "1" || (e.workflow_id ?? p?.workflow_id) !== provider.workflow_ref.workflow_id || e.module_id !== provider.module_id || e.unit_id !== provider.unit_id || e.stage_instance !== instance || p?.name !== "loeyae-aidlc-evidence" || p.mode !== "controlled" || !p.execution_id || c?.id !== `builtin:${sensor}` || c.sensor !== sensor || c.status !== "passed" || c.exit_code !== 0 || !/^[a-f0-9]{64}$/.test(String(c.argv_digest))) fail(`controlled provenance invalid: ${path}`);
  if (evidenceTimeError(e, sensor)) fail(`evidence expired/clock invalid: ${path}`);
  if (c.identity_version !== undefined && semanticCheckerIdentityErrors(c).length) fail(`checker changed: ${path}`);
  if (!e.source_revision || typeof e.source_revision !== "object") fail(`evidence source revision missing: ${path}`);
  // Native gates recheck current source, command/I13 bindings, checker identity and
  // the established downstream-report exception. Do not invent a second rule here.
  for (const artifact of artifacts) {
    // Every consumed version is a real immutable input, never a future output path.
    const current = hash(readFileSync(safeFile(root, artifact.path))); if (artifact.digest_mode !== "raw-file" || current !== artifact.digest) fail(`capability version input changed: ${artifact.path}`);
  }
  if (sensor === "contract-baseline") {
    if (e.status !== "verified" || e.validation_status !== "passed" || !e.contract_id || !e.schema_hash || !Array.isArray(e.consumers) || !e.consumers.length || c.identity_version === undefined || semanticCheckerIdentityErrors(c).length) fail(`contract baseline not verified: ${path}`);
  } else if (sensor === "green-test-evidence") {
    if (e.phase !== "GREEN" || e.status !== "passed" || e.tests_total <= 0 || e.tests_failed !== 0 || e.test_filter || e.observed_command?.exit_code !== 0) fail(`GREEN behavior verification missing: ${path}`);
  } else if (reviewIssueErrors(e).length || !["passed", "approved"].includes(e.status)) fail(`unit review not passed: ${path}`);
  nativeGate(root, provider.module_id, provider.unit_id, stage, sensor);
  if (hash(readFileSync(safeFile(root, path))) !== hash(bytes)) fail("provider evidence changed during native validation");
  return { path, digest: hash(bytes), workflow_id: provider.workflow_ref.workflow_id, stage_instance: instance, sensor };
}

export function projectAutonomyDependencies(root: string, options: { session_id?: string; validate_evidence?: boolean; preparation_only?: boolean; draft_scope?: AutonomyScopeProjection } = {}): DependencyProjection {
  const global = loadWorkflowState(root);
  const result: DependencyProjection = { enabled: Boolean(global?.autonomy_contract_version), validation_level: "dependency-and-write-scope", execution_authorized: false, business_verified: false, admission_ready: false, units: [], dependencies: [], definition_refs: [], evidence_refs: [], serial_execution_required: true, dependency_frontier: [] };
  if (!result.enabled && !options.draft_scope) return result;
  const scope = options.draft_scope || projectAutonomyScope(root, global!), reader = new ScopeReader(root, global!), parts = loadWorkflowParts(root), modules = readModuleManifest(root);
  const matrix = reader.resolve(scope.validation_matrix_ref).record!;
  const checkIds = new Set((matrix.checks as Row[]).map(c => typeof c === "string" ? c : c.check_id));
  const nodes = stageGraph(), stages = new Set(nodes.map((s: Row) => s.slug));
  const definitions = modules.flatMap(m => dependencyRecords(root, unitExtensionPath(m.module_id)).map(record => ({ path: unitExtensionPath(m.module_id), record })));
  const addDefinition = (path: string, record: Row) => { const ref = sourceRef(path, record); reader.resolve(ref); if (!result.definition_refs.some(r => same(r, ref))) result.definition_refs.push(ref); };
  for (const selected of scope.units!) {
    const ref = selected.unit_ref, unit = readUnitManifest(root, ref.module_id).find(u => u.unit_id === ref.unit_id)!;
    // Reuse native source ownership validation, including unselected siblings.
    evidenceScopeForInstance(root, `code-generation@module:${ref.module_id}@unit:${ref.unit_id}`);
    const matches = definitions.filter(d => d.record.record_type === "unit-extension" && key(d.record.unit_ref || {}) === key(ref));
    const complex = scope.units!.length > 1 || scope.dependency_refs!.length || parts.split || selected.expected_capabilities.length || unit.evidence_inputs?.shared_paths.length || unit.evidence_inputs?.depends_on_units.length;
    if (!matches.length && !complex) {
      result.units.push({ unit_ref: ref, role: selected.role, legacy_module_scope: true, private_paths: [], shared_writes: [], evidence_scope: "module", effective_inputs: modules.find(m => m.module_id === ref.module_id)?.paths || ["src"], capability_refs: selected.expected_capabilities }); continue;
    }
    if (matches.length !== 1) fail(`one canonical unit-extension required for ${key(ref)}`);
    if (unit.autonomy_version !== "1") fail(`unit ${key(ref)} requires explicit autonomy_version=1`);
    const { path, record } = matches[0], e = object(record, "unit-extension", [...ENVELOPE, "unit_ref", "behavior_refs", "acceptance_refs", "capability_refs", "write_scope", "integration_checks", "ui_owner_refs"]);
    if (!same(reader.unit(e.unit_ref), ref)) fail(`unit-extension identity changed: ${key(ref)}`);
    const behaviors = reader.items(e.behavior_refs, "behavior_refs"); const acceptance = reader.items(e.acceptance_refs, "acceptance_refs", true);
    if (!behaviors.length) {
      if (!unit.ucd_exemption) fail("empty behavior_refs requires trusted I13 applicability and unit exemption");
      const i13 = JSON.parse(readFileSync(safeFile(root, `.aidlc/evidence/test-case-derivation/${ref.module_id}/test-case-derivation.json`), "utf8"));
      assertControlledI13(root, i13, ref.module_id);
      const subset = unitUcdIds(i13, ref.unit_id); if (i13.status !== "not_applicable" && !(subset.scoped && subset.all.length === 0)) fail("unit still has executable behavior");
      if(options.validate_evidence!==false)nativeGate(root, ref.module_id, ref.unit_id, "test-case-derivation", "test-case-derivation");
    }
    reader.items(e.integration_checks, "integration_checks"); reader.items(e.ui_owner_refs, "ui_owner_refs");
    if (selected.role === "implement" && !acceptance.some(a => scope.acceptance_refs!.some(r => same(a, r)))) fail(`unit has no batch acceptance ownership: ${key(ref)}`);
    const w = object(e.write_scope, "write_scope", ["private_paths", "shared_writes"]);
    const privatePaths = unique(array(w.private_paths, "private_paths").map(p => dependencyPath(root, p)), p => p, "private paths");
    const shared = unique(array(w.shared_writes, "shared_writes").map(v => {
      const s = object(v, "shared writer", ["path", "owner_unit_ref", "coordination"]); dependencyPath(root, s.path); const owner = reader.unit(s.owner_unit_ref);
      const selectedOwner = scope.units!.find(u => same(u.unit_ref, owner));
      if (!selectedOwner || !["single-writer", "serialized"].includes(String(s.coordination)) || s.coordination === "serialized" && selectedOwner.role !== "implement") fail("shared writer must name a selected owner; serialized ownership requires implement");
      if (unit.evidence_inputs && !(unit.evidence_inputs.shared_paths || []).some(p => within(String(s.path), p))) fail(`shared write missing from evidence_inputs: ${s.path}`);
      return s;
    }), s => String(s.path), "shared paths");
    if (selected.role === "implement" && !privatePaths.length && !shared.some(s => same(s.owner_unit_ref, ref))) fail(`implement unit has no write responsibility: ${key(ref)}`);
    const capabilities = unique(array(e.capability_refs, "capability_refs").map(c => object(c, "CapabilityRef", ["provider_ref", "capability_id", "version_digest"])), c => String(c.capability_id), "capability refs");
    for (const c of capabilities) { if (!same(reader.unit(c.provider_ref), ref)) fail("capability owned by another unit"); id(c.capability_id, "capability_id"); string(c.version_digest, "version_digest"); }
    for (const expected of selected.expected_capabilities) if (!capabilities.some(c => same(c, expected))) fail(`expected capability missing from unit definition: ${key(ref)}`);
    addDefinition(path, record);
    const narrow = readUnitManifest(root, ref.module_id).every(u => u.evidence_inputs);
    result.units.push({ unit_ref: ref, role: selected.role, private_paths: privatePaths, shared_writes: shared, evidence_scope: narrow ? "declared-with-transitive-inputs" : "module", effective_inputs: [...new Set([...(narrow ? unit.evidence_inputs!.paths : modules.find(m => m.module_id === ref.module_id)?.paths || ["src"]), ...(unit.evidence_inputs?.shared_paths || []), ...autonomyDependencyInputs(root, ref.module_id, ref.unit_id)])], capability_refs: capabilities });
    if (selected.role === "verify") {
      const checks = scope.consumer_closure!.find(c => same(c.consumer_ref, ref));
      if (!checks || !Array.isArray(checks.required_checks) || !checks.required_checks.length) fail(`verify unit needs actual matrix checks: ${key(ref)}`);
      result.units.at(-1)!.required_checks = checks.required_checks; result.units.at(-1)!.verification_status = "pending";
    }
  }
  const capability = (ref: Row): Row => {
    const found = definitions.filter(d => d.record.record_type === "capability" && d.record.capability_id === ref.capability_id && same(d.record.provider_ref, ref.provider_ref));
    if (found.length !== 1) fail(`one capability definition required: ${ref.capability_id}`);
    const { path, record } = found[0], c = object(record, "capability definition", [...ENVELOPE, "capability_id", "provider_ref", "version_digest", "artifact_refs"]);
    if (c.record_id !== c.capability_id || c.version_digest !== ref.version_digest) fail(`capability version mismatch: ${ref.capability_id}`);
    const artifacts = array(c.artifact_refs, "artifact_refs", true).map(r => reader.resolve(r).ref);
    if (artifacts.some(r => r.digest_mode !== "raw-file") || capabilityVersion(String(c.capability_id), artifacts) !== c.version_digest) fail(`capability version does not bind actual artifacts: ${ref.capability_id}`);
    addDefinition(path, record); return { ...c, artifact_refs: artifacts };
  };
  const stateFor = (ref: AutonomyUnitRef) => [...parts.parts.values()].find(p => p.state.workflow_id === ref.workflow_ref.workflow_id)?.state;
  const ready = (provider: Row, type: string, refs: Row[], cap: Row, dependencyId?:string): { state: string; reason: string; refs: Row[] } => {
    if (options.validate_evidence === false) return { state: "unverified", reason: "definition inspection only", refs: [] };
    if (provider.external_id || type === "runtime") {
      try { const report=currentObservations(root,global!);const rows=report.observations.filter((o:Row)=>o.dependency_binding&&(!dependencyId||o.dependency_binding.dependency_id===dependencyId)&&same(o.dependency_binding.provider,provider)&&same(o.dependency_binding.capability_ref,cap.provider_ref?{provider_ref:cap.provider_ref,capability_id:cap.capability_id,version_digest:cap.version_digest}:cap));
        if(refs.some(r=>r.sensor==="runtime-observation"&&(r.path!==report.receipt_ref.path||r.digest!==hash(readFileSync(safeFile(root,report.receipt_ref.path))))))throw Error("pinned runtime proof differs");
        if(!rows.length||rows.some((o:Row)=>o.status!=="passed"))throw Error("actual runtime checks are missing/failed");
        return {state:type==="contract"?"contract_ready":type==="implementation"?"capability_verified":"runtime_ready",reason:"P1-07 signed actual HTTP assertions and version observation, bounded by candidate/environment/TTL",refs:[{path:report.receipt_ref.path,digest:hash(readFileSync(safeFile(root,report.receipt_ref.path))),workflow_id:report.workflow_id,stage_instance:report.producer.stage_instance,sensor:"runtime-observation"}]};
      } catch(error){return {state:"unverified",reason:"actual external/runtime observation requires P1-07 producer; "+String(error),refs:[]};}
    }
    try {
      const wf = stateFor(provider as AutonomyUnitRef); if (!wf) fail("provider workflow unavailable");
      const prefix = `@module:${provider.module_id}@unit:${provider.unit_id}`;
      const required = type === "contract" ? ["shared-contract-baseline"] : ["code-generation", "code-review"];
      if (!required.every(s => wf.completed_stage_instances.includes(s + prefix))) fail(`provider unit stages incomplete: ${required.join(",")}`);
      const evidence = type === "contract" ? [readEvidence(root, provider as AutonomyUnitRef, "contract-baseline", "shared-contract-baseline", refs, cap.artifact_refs)] : [readEvidence(root, provider as AutonomyUnitRef, "green-test-evidence", "code-generation", refs, cap.artifact_refs), readEvidence(root, provider as AutonomyUnitRef, "review-evidence", "code-review", refs, cap.artifact_refs)];
      return { state: type === "contract" ? "contract_ready" : "capability_verified", reason: type === "contract" ? "controlled shared declaration baseline only" : "conservative whole-unit GREEN and review; no independent capability frontier or project completion inferred", refs: evidence };
    } catch (error) { return { state: "pending", reason: String(error instanceof Error ? error.message : error), refs: [] }; }
  };
  for (const u of result.units) for (const ref of u.capability_refs) capability(ref);
  for (const selected of scope.units!.filter(u => u.role === "consume")) for (const ref of selected.expected_capabilities) {
    const cap = capability(ref), sensors = selected.evidence_refs.map(r => r.sensor);
    const type = sensors.includes("green-test-evidence") ? "implementation" : sensors.includes("contract-baseline") ? "contract" : "runtime";
    const r = ready(selected.unit_ref, type, selected.evidence_refs, cap); if (!["contract_ready", "capability_verified"].includes(r.state)) fail(`consume version not verified: ${key(selected.unit_ref)}: ${r.reason}`);
    result.evidence_refs.push(...r.refs);
  }
  const graph = new Map<string, string[]>(), inputGraph = new Map<string, string[]>();
  for (const u of result.units) {
    const k = key(u.unit_ref); inputGraph.set(k, (readUnitManifest(root, u.unit_ref.module_id).find(x => x.unit_id === u.unit_ref.unit_id)!.evidence_inputs?.depends_on_units || []).map(d => `${u.unit_ref.module_id}/${d}`));
    for (let i = 1; i < ORDER.length; i++) graph.set(`${k}@${ORDER[i]}`, [`${k}@${ORDER[i - 1]}`]);
    graph.set(`${k}@runtime-ready`, [`${k}@code-review`]);
  }
  for (const ref of scope.dependency_refs!) {
    const { item_id, ...input } = ref, edge = reader.resolve(input).record!; reader.dependency(edge);
    const checkpoint = string(edge.consumer_checkpoint, "consumer_checkpoint"); if (!stages.has(checkpoint) && !checkIds.has(checkpoint)) fail(`unknown consumer checkpoint ${checkpoint}`);
    const consumerState = stateFor(edge.consumer as AutonomyUnitRef)!, consumerUnit = readUnitManifest(root, String((edge.consumer as Row).module_id)).find(u => u.unit_id === (edge.consumer as Row).unit_id)!;
    const executable = selectExecutableStages<any>(nodes, consumerState.scope, consumerState.selected_optional_stages, consumerState.execution_profile);
    if (stages.has(checkpoint) && !executable.some(s => s.slug === checkpoint)) fail(`unreachable consumer checkpoint ${checkpoint}`);
    if (["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design", "shared-contract-baseline"].includes(checkpoint) && consumerUnit.conditional_stages && !consumerUnit.conditional_stages.includes(checkpoint as any) && !riskRequiredStages(consumerState.execution_profile).has(checkpoint)) fail(`unselected consumer checkpoint ${checkpoint}`);
    const cap = capability(edge.capability_ref as Row);
    const provider = edge.provider as Row, consumer = edge.consumer as Row, providerRole = result.units.find(u => same(u.unit_ref, provider))?.role;
    if (!provider.external_id && !result.units.find(u => same(u.unit_ref, provider))?.capability_refs.some((r: Row) => same(r, edge.capability_ref))) fail("dependency capability is not owned by the provider unit");
    let stub: Row | "denied" = "denied";
    if (edge.stub_policy !== "denied") {
      stub = object(edge.stub_policy, "stub_policy", ["check_ids", "contract_ref"]);
      const ids = unique(array(stub.check_ids, "stub checks", true).map(v => string(v, "stub check")), v => v, "stub checks");
      if (ids.some(id => !checkIds.has(id)) || !ids.every(id => (matrix.checks as Row[]).some(c => typeof c === "object" && c.check_id === id && c.kind === "local")) || !same(stub.contract_ref, edge.capability_ref)) fail("stub only permits explicit local matrix checks bound to this contract");
      capability(stub.contract_ref as Row);
    }
    const r = ready(provider, String(edge.type), edge.readiness_evidence as Row[], cap,String(edge.dependency_id));
    if (edge.type === "contract" && providerRole === "implement" && r.state !== "contract_ready") {
      const descriptor = readUnitManifest(root, provider.module_id).find(u => u.unit_id === provider.unit_id)!, providerState = stateFor(provider as AutonomyUnitRef)!;
      if (!selectExecutableStages<any>(nodes, providerState.scope, providerState.selected_optional_stages, providerState.execution_profile).some(s => s.slug === "shared-contract-baseline") || descriptor.conditional_stages && !descriptor.conditional_stages.includes("shared-contract-baseline")) fail("planned contract provider cannot execute shared-contract-baseline");
    }
    if (providerRole === "consume" && r.state !== edge.required_state) fail(`consumed provider cannot satisfy ${edge.dependency_id}: ${r.reason}`);
    const producerStage = edge.type === "contract" ? "shared-contract-baseline" : edge.type === "implementation" ? "code-review" : "runtime-ready";
    if (!provider.external_id) {
      const node = `${key(consumer)}@${checkpoint}`, upstream = `${key(provider)}@${producerStage}`; graph.set(node, [...graph.get(node) || [], upstream]);
    }
    if (edge.readiness_evidence && (edge.readiness_evidence as Row[]).length && r.state !== edge.required_state) fail(`declared readiness evidence invalid for ${edge.dependency_id}: ${r.reason}`);
    result.evidence_refs.push(...r.refs);
    result.dependencies.push({ dependency_id: edge.dependency_id, provider, consumer, type: edge.type, capability_ref: edge.capability_ref, consumer_checkpoint: checkpoint, required_state: edge.required_state, readiness: r.state, reason: r.reason, stub_policy: stub, local_stub_ready: stub !== "denied" && ready(provider, "contract", [], cap).state === "contract_ready", readiness_evidence: r.refs, planned_in_batch: providerRole === "implement" });
  }
  cycle(graph, "same-checkpoint dependency"); cycle(inputGraph, "evidence-input dependency");
  for (const unit of result.units) for (const path of unit.private_paths) for (const shared of result.units.flatMap(u => u.shared_writes)) if (overlap(path, shared.path)) fail(`private/shared write overlap: ${path} ${shared.path}`);
  for (const a of result.units) for (const b of result.units) if (key(a.unit_ref) < key(b.unit_ref)) {
    for (const p of a.private_paths) for (const q of b.private_paths) if (overlap(p, q)) fail(`exclusive write overlap: ${key(a.unit_ref)} ${key(b.unit_ref)} ${p} ${q}`);
    for (const p of a.shared_writes) for (const q of b.shared_writes) if (overlap(p.path, q.path) && (!same(p.owner_unit_ref, q.owner_unit_ref) || p.coordination !== q.coordination || p.path !== q.path)) fail(`conflicting shared ownership: ${p.path}`);
  }
  const session = options.session_id || sessionBinding()?.session_id;
  if(!options.draft_scope)for (const part of parts.parts.values()) for (const [instance, claim] of Object.entries(part.state.active_instances)) if (ENTRY.includes(instance.split("@")[0]) && claim.session_id !== session) {
    if (dependencyClaimConflict(root, result.units, instance)) fail(`WRITE_CONFLICT: ${instance}`);
  }
  const ranks = nodes.map(n => n.slug);
  result.admission_ready = result.dependencies.every(d => d.readiness === d.required_state || d.planned_in_batch || d.type === "runtime" && d.readiness_evidence.length === 0 && (ranks.indexOf(d.consumer_checkpoint) >= ranks.indexOf("build-and-test") || checkIds.has(d.consumer_checkpoint)));
  if (!result.admission_ready && !options.preparation_only) fail("unverified upstream outside the implement plan");
  for (const unit of result.units.filter(u => u.role === "implement")) for (const checkpoint of ENTRY) {
    const blocked = result.dependencies.filter(d => same(d.consumer, unit.unit_ref) && ranks.indexOf(d.consumer_checkpoint) >= 0 && ranks.indexOf(d.consumer_checkpoint) <= ranks.indexOf(checkpoint) && d.readiness !== d.required_state);
    result.dependency_frontier.push({ unit_ref: unit.unit_ref, checkpoint, dependencies_ready: blocked.length === 0, blocked_by: blocked.map(d => d.dependency_id), native_gates_evaluated: false, execution_authorized: false });
  }
  return result;
}

/** Re-evaluated at the actual consumer checkpoint, not merely at batch admission. */
export function assertAutonomyDependencyAccess(root: string, binding: SessionBinding | undefined, operations: readonly GrantOperation[], path?: string, checkpoint?: string): DependencyProjection | undefined {
  const global = loadWorkflowState(root); if (!global?.autonomy_contract_version) return;
  const stage = checkpoint || (operations.some(op => ["push", "protected-branch-write", "deploy"].includes(op)) ? "implementation-report" : binding?.stage_instance.split("@")[0]);
  if (!stage || !global.execution_grant_version && !ENTRY.includes(stage)) return;
  // A global preparation claim may collect signed dependency observations before
  // implementation admission. It cannot execute due consumers or business writes.
  const preparation = !!binding && !binding.stage_instance.includes("@") && !ORDER.includes(stage)
    && operations.every(op => op === "validation-execute" || op === "evidence-publish");
  const plan = projectAutonomyDependencies(root, { session_id: binding?.session_id, preparation_only: preparation });
  const module = /@module:([^@]+)/.exec(binding?.stage_instance || "")?.[1], unit = /@unit:([^@]+)/.exec(binding?.stage_instance || "")?.[1];
  const own = plan.units.find(u => key(u.unit_ref) === `${module}/${unit}`);
  if (own && own.role !== "implement" && ENTRY.includes(stage) && operations.some(op => op !== "decision-record")) fail("consume/verify units are not implementation work");
  if (operations.some(op => ["code-write", "test-write", "design-write"].includes(op)) && path !== undefined) {
    dependencyPath(root, path);
    if (!own && !path.startsWith("docs/aidlc/")) fail("business writes require an exact implement unit");
    if (own) {
      if (own.role !== "implement") fail("consume/verify unit is read-only");
      const shared = plan.units.flatMap(u => u.shared_writes).filter(s => within(path, s.path));
      if (shared.length) {
        if (shared.some(s => s.coordination === "single-writer" && !same(s.owner_unit_ref, own.unit_ref)) || !own.shared_writes.some((s: Row) => within(path, s.path))) fail(`shared path belongs to another writer: ${path}`);
        if (shared.some(s => s.coordination === "serialized")) for (const part of loadWorkflowParts(root).parts.values()) for (const instance of Object.keys(part.state.active_instances)) if (ENTRY.includes(instance.split("@")[0]) && instance.includes("@unit:") && !instance.endsWith(`@module:${module}@unit:${unit}`)) {
          const otherKey = `${/@module:([^@]+)/.exec(instance)?.[1]}/${/@unit:([^@]+)/.exec(instance)?.[1]}`, other = plan.units.find(u => key(u.unit_ref) === otherKey);
          if (!other || other.role === "implement" && other.shared_writes.some((s: Row) => within(path, s.path))) fail(`serialized shared writer must release competing claims: ${instance}`);
        }
      } else if (!own.legacy_module_scope && !own.private_paths.some((p: string) => within(path, p))) fail(`outside unit write_scope: ${path}`);
    }
  }
  const ranks = stageGraph().map(n => n.slug), current = ranks.indexOf(stage);
  for (const d of plan.dependencies) {
    const consumer = own ? same(d.consumer, own.unit_ref) : !module || d.consumer.module_id === module;
    const at = ranks.includes(d.consumer_checkpoint) ? ranks.indexOf(d.consumer_checkpoint) : ranks.indexOf("build-and-test"), due = current >= 0 ? current >= at : stage === d.consumer_checkpoint;
    if(consumer&&due&&d.readiness===d.required_state&&(d.type==="runtime"||d.provider.external_id)){
      const report=currentObservations(root,global);const probes=report.runtime_checks.filter((r:Row)=>r.dependency_id===d.dependency_id);
      if(!probes.length)fail("live runtime observation missing");
      const result=spawnSync(process.execPath,[createRequire(import.meta.url).resolve("tsx/cli"),fileURLToPath(new URL("./aidlc-observation-live.ts",import.meta.url))],{cwd:root,input:JSON.stringify(probes),encoding:"utf8",timeout:10000,maxBuffer:65536,shell:false,windowsHide:true});
      if(result.error||result.status!==0)fail("runtime_ready live version/health no longer current: "+result.stderr);
    }
    if (consumer && due && d.readiness !== d.required_state && !(d.stub_policy !== "denied" && d.stub_policy.check_ids.includes(stage) && d.local_stub_ready)) fail(`${d.dependency_id} at ${stage} requires ${d.required_state}; ${d.reason}`);
  }
  return plan;
}
export function autonomyImplementationCandidate(root: string, stage: string, module?: string, unit?: string): boolean {
  return autonomyImplementationFilter(root)(stage, module, unit);
}
export function autonomyImplementationFilter(root: string): (stage: string, module?: string, unit?: string) => boolean {
  const state = loadWorkflowState(root); if (!state?.autonomy_contract_version) return () => true;
  const scope = projectAutonomyScope(root, state), keys = new Set(scope.units!.filter(u => u.role === "implement").map(u => key(u.unit_ref)));
  return (stage, module, unit) => !unit || !ORDER.includes(stage) || keys.has(`${module}/${unit}`);
}
export function autonomyDependenciesDirective(root: string, args: string[]): Row {
  if (args.length === 3 && args[0] === "check" && args[1] === "--checkpoint") {
    const global = loadWorkflowState(root), binding = sessionBinding(), part = [...loadWorkflowParts(root).parts.values()].find(p => p.state.workflow_id === binding?.workflow_id);
    if (!global?.execution_grant_version || !binding || !part) fail("dependency consumption check requires the current grant and live binding");
    assertSessionClaim(root, part.state, binding.stage_instance, binding); checkExecutionGrant(root, global, binding, ["validation-execute"]);
    const scope = projectAutonomyScope(root, global), matrix = new ScopeReader(root, global).resolve(scope.validation_matrix_ref).record!;
    if (!stageGraph().some(n => n.slug === args[2]) && !(matrix.checks as Row[]).some(c => (typeof c === "string" ? c : c.check_id) === args[2])) fail("unknown consumer checkpoint");
    return { kind: "print", autonomy_dependencies: assertAutonomyDependencyAccess(root, binding, ["validation-execute"], undefined, args[2]), message: "This exact consumption checkpoint passed; it does not certify batch delivery." };
  }
  if (args.length && !(args.length === 1 && args[0] === "inspect")) fail("use autonomy dependencies [inspect]");
  return { kind: "print", autonomy_dependencies: projectAutonomyDependencies(root), message: "Staged consumption and write ownership only; planned/runtime/consumer verification is not batch completion." };
}
