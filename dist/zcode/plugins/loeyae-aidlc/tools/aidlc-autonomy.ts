/** P1-01: explicit scope adoption and read-only validation. No execution authority. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, win32 } from "node:path";
import { readModuleManifest, readUnitManifest, unitManifestPath, moduleManifestPath } from "./aidlc-execution-context";
import { GLOBAL_WORKFLOW, loadWorkflowState, saveWorkflowState, sessionBinding, assertSessionClaim, type WorkflowState } from "./aidlc-light-state";
import { loadWorkflowParts } from "./aidlc-workflow-layout";
import { assertAutonomySnapshot, type AutonomyBatchSnapshot } from "./aidlc-autonomy-state";
import { dependencyRecords, unitExtensionPath } from "./aidlc-dependency-inputs";
import { markdownSourceLines } from "./aidlc-document-parser";

import { object, string, id, digest, revision, array, unique, safeFile, records, inputRef, ENVELOPE, BATCH_FIELDS, SOURCES, canonicalAutonomyJson, autonomyDigest } from "./aidlc-autonomy-files";
export { canonicalAutonomyJson, autonomyDigest } from "./aidlc-autonomy-files";

type Row = Record<string, unknown>;
function fail(message: string, code = "AUTONOMY_SCHEMA_INVALID"): never { throw new Error(`${code}: ${message}`); }
export interface AutonomyInputRef {
  repository_id: "project"; path: string; digest: string; digest_mode: "raw-file" | "json-record-v1";
  selector?: { record_type: string; record_id: string };
}
export interface AutonomyUnitRef {
  workflow_ref: { workflow_id: string; owner_kind: "global" | "module"; module_id?: string };
  module_id: string; unit_id: string; definition_digest: string;
}
export interface AutonomyScopeProjection {
  enabled: boolean;
  validation_level: "scope-only";
  execution_authorized: false;
  gates_evaluated: false;
  snapshot?: AutonomyBatchSnapshot;
  acceptance_refs?: Row[];
  ui_refs?: Row[];
  goal?: string;
  scenario_refs?: Row[];
  dependency_refs?: Row[];
  units?: { unit_ref: AutonomyUnitRef; role: string; expected_capabilities: Row[]; evidence_refs: Row[] }[];
  consumer_closure?: Row[];
  baseline_inputs?: AutonomyInputRef[];
  policy_ref?: Row;
  validation_matrix_ref?: AutonomyInputRef;
  integration_owner?: string;
  delivery_artifacts?: Row[];
  pending_validation: string[];
  dependency_definition_refs?: AutonomyInputRef[];
}

export class ScopeReader {
  fingerprints = new Map<string, string>();
  resolving = new Set<string>();
  constructor(readonly root: string, readonly state: WorkflowState) {}
  resolve(value: unknown): { ref: AutonomyInputRef; text: string; record?: Row } {
    const ref = inputRef(value), file = safeFile(this.root, ref.path);
    const key = `${ref.path}:${ref.digest_mode}:${ref.selector?.record_type || ""}:${ref.selector?.record_id || ""}`;
    if (this.resolving.has(key) || this.resolving.size >= 64) fail(`cyclic or overdeep input reference ${key}`);
    this.resolving.add(key);
    try {
      const bytes = readFileSync(file), text = bytes.toString("utf8");
      const record = ref.selector ? records(this.root, ref.path).find(row => row.record_type === ref.selector!.record_type && row.record_id === ref.selector!.record_id) : undefined;
      if (ref.selector && !record) fail(`missing record ${key}`);
      const actual = record ? autonomyDigest(record) : createHash("sha256").update(bytes).digest("hex");
      if (actual !== ref.digest) fail(`input digest changed: ${key}`, "BATCH_SCOPE_CHANGED");
      if (record) {
        if (record.workflow_id !== this.state.workflow_id) fail(`record belongs to another workflow: ${key}`);
        for (const nested of record.inputs as unknown[]) this.resolve(nested);
      }
      this.fingerprints.set(key, actual);
      return { ref, text, ...(record ? { record } : {}) };
    } finally { this.resolving.delete(key); }
  }
  inputs(value: unknown, label: string): void {
    const refs = unique(array(value, label, true).map(inputRef), ref => `${ref.path}:${ref.digest_mode}:${ref.selector?.record_type || ""}:${ref.selector?.record_id || ""}`, label);
    for (const ref of refs) this.resolve(ref);
  }
  item(value: unknown): Row {
    const row = object(value, "SourceItemRef", ["repository_id", "path", "digest", "digest_mode", "selector", "item_id"]);
    const itemId = string(row.item_id, "item_id"), { item_id: _, ...ref } = row;
    const resolved = this.resolve(ref);
    const escaped = itemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const definition = new RegExp(`^\\s*(?:#{1,6}\\s+|[-*+]\\s+|\\d+[.)]\\s+|\\|\\s*)(?:\\*\\*|\x60)?${escaped}(?=[\\s|*\x60:：]|$)`, "i");
    const defined = resolved.record ? resolved.record.record_id === itemId
      : markdownSourceLines(resolved.text).lines.some(line => !line.opaque && definition.test(line.text));
    if (!defined) fail(`item is not defined at ${resolved.ref.path}: ${itemId}`);
    return row;
  }
  items(value: unknown, label: string, nonempty = false): Row[] {
    return unique(array(value, label, nonempty).map(item => this.item(item)), row => `${row.path}:${row.item_id}`, label);
  }
  unit(value: unknown): AutonomyUnitRef {
    const row = object(value, "UnitRef", ["workflow_ref", "module_id", "unit_id", "definition_digest"]);
    const moduleId = id(row.module_id, "module_id"), unitId = id(row.unit_id, "unit_id");
    const owner = object(row.workflow_ref, "workflow_ref", ["workflow_id", "owner_kind", "module_id"]);
    const loaded = loadWorkflowParts(this.root);
    const expected = loaded.split ? loaded.parts.get(`module:${moduleId}`)?.state : this.state;
    if (!expected || owner.workflow_id !== expected.workflow_id || owner.owner_kind !== (loaded.split ? "module" : "global")
      || (loaded.split ? owner.module_id !== moduleId : owner.module_id !== undefined)) fail(`UnitRef workflow ownership mismatch: ${moduleId}/${unitId}`);
    safeFile(this.root, "docs/aidlc/ideation/module-manifest.json");
    const module = readModuleManifest(this.root).find(module => module.module_id === moduleId);
    if (!module) fail(`unknown module ${moduleId}`);
    const unitPath = relative(this.root, unitManifestPath(this.root, moduleId)).replace(/\\/g, "/");
    safeFile(this.root, unitPath);
    const units = readUnitManifest(this.root, moduleId);
    if (!units.some(unit => unit.unit_id === unitId)) fail(`unknown unit ${moduleId}/${unitId}`);
    const raw = JSON.parse(readFileSync(unitManifestPath(this.root, moduleId), "utf8")).units.find((unit: Row) => unit.unit_id === unitId);
    if (autonomyDigest(raw) !== digest(row.definition_digest, "unit definition digest")) fail(`unit definition changed: ${moduleId}/${unitId}`, "BATCH_SCOPE_CHANGED");
    const definitionModule = relative(this.root, moduleManifestPath(this.root)).replace(/\\/g, "/");
    this.fingerprints.set(`${definitionModule}:${moduleId}`, autonomyDigest(module));
    this.fingerprints.set(`${unitPath}:${unitId}`, autonomyDigest(raw));
    return row as unknown as AutonomyUnitRef;
  }
  evidence(value: unknown, workflowId: string): void {
    const row = object(value, "EvidenceRef", ["sensor", "stage_instance", "path", "digest", "workflow_id", "batch_id"]);
    for (const key of ["sensor", "stage_instance", "workflow_id"]) string(row[key], key);
    if (row.workflow_id !== workflowId) fail("consume evidence belongs to another workflow");
    if (row.batch_id !== undefined) id(row.batch_id, "evidence batch_id");
    const bytes = readFileSync(safeFile(this.root, string(row.path, "evidence path")));
    if (createHash("sha256").update(bytes).digest("hex") !== digest(row.digest, "evidence digest")) fail("consume evidence content changed", "BATCH_SCOPE_CHANGED");
    this.fingerprints.set(`evidence:${row.path}`, row.digest as string);
    // Provenance, readiness and freshness are deliberately NOT certified by P1-01.
  }
  provider(value: unknown): AutonomyUnitRef | Row {
    const row = object(value, "provider"); if (row.external_id === undefined) return this.unit(value);
    object(value, "ExternalRef", ["external_id", "owner", "contract_ref", "version_ref"]); id(row.external_id, "external_id"); string(row.owner, "external owner"); this.resolve(row.contract_ref); this.resolve(row.version_ref); return row;
  }
  dependency(value: unknown): { consumer: AutonomyUnitRef; provider: AutonomyUnitRef | Row } {
    const edge = object(value, "dependency", [...ENVELOPE, "dependency_id", "provider", "consumer", "type", "capability_ref", "consumer_checkpoint", "required_state", "readiness_evidence", "stub_policy"]);
    if (edge.workflow_id !== this.state.workflow_id) fail("dependency belongs to another workflow");
    if (edge.dependency_id !== edge.record_id || !["contract", "implementation", "runtime"].includes(String(edge.type))) fail("invalid dependency identity/type");
    const states: Record<string, string> = { contract: "contract_ready", implementation: "capability_verified", runtime: "runtime_ready" };
    if (edge.required_state !== states[String(edge.type)]) fail("dependency required_state does not match type");
    this.inputs(edge.inputs, "dependency inputs");
    const consumer = this.unit(edge.consumer), provider = this.provider(edge.provider);
    string(edge.consumer_checkpoint, "consumer_checkpoint");
    for (const ref of array(edge.readiness_evidence, "readiness_evidence")) this.evidence(ref, (ref as Row).sensor === "runtime-observation" || "external_id" in provider ? this.state.workflow_id : (provider as AutonomyUnitRef).workflow_ref.workflow_id);
    const cap = object(edge.capability_ref, "dependency capability", ["provider_ref", "capability_id", "version_digest"]);
    id(cap.capability_id, "capability_id"); digest(cap.version_digest, "capability version");
    if (canonicalAutonomyJson(this.provider(cap.provider_ref)) !== canonicalAutonomyJson(provider)) fail("dependency capability provider mismatch");
    if (edge.stub_policy !== "denied") {
      const stub = object(edge.stub_policy, "stub_policy", ["check_ids", "contract_ref"]); unique(array(stub.check_ids, "stub check IDs", true).map(v => string(v, "check ID")), v => v, "stub check IDs");
      if (canonicalAutonomyJson(stub.contract_ref) !== canonicalAutonomyJson(cap)) fail("stub contract reference mismatch");
    }
    return { consumer, provider };
  }
}

/** Shared, bounded source validation for later autonomy contracts; no authority is granted. */
export const autonomySource = { object, string, id, digest, revision, array, unique, records, safeFile, envelope: ENVELOPE };

function unitKey(unit: AutonomyUnitRef | Row): string { return "external_id" in unit ? `external:${unit.external_id}` : `${unit.module_id}/${unit.unit_id}`; }
function batchSource(root: string): string {
  const present = SOURCES.filter(path => existsSync(join(root, path)) && readFileSync(safeFile(root, path), "utf8").includes("aidlc-autonomy")
    && records(root, path).some(row => row.record_type === "batch"));
  if (present.length !== 1) fail("batch must have one canonical source: scenario-module-mapping.md or docs/aidlc/handoff.md");
  return present[0];
}

export function readAutonomyBatch(root: string, state: WorkflowState, batchId: string): AutonomyScopeProjection {
  id(batchId, "batch id");
  const source = batchSource(root), rows = records(root, source);
  const batches = rows.filter(row => row.record_type === "batch");
  if (batches.length !== 1 || batches[0].record_id !== batchId) fail("P1 requires exactly one selected batch per workflow");
  const batch = object(batches[0], "batch", BATCH_FIELDS), reader = new ScopeReader(root, state);
  if (batch.workflow_id !== state.workflow_id || batch.batch_id !== batchId || batch.revision !== batch.scope_revision) fail("batch identity/revision mismatch");
  const scopeRevision = revision(batch.scope_revision, "scope_revision");
  string(batch.goal, "batch goal"); id(batch.integration_owner, "integration_owner");
  if (batch.supersedes !== undefined) fail("P1-01 does not silently adopt revised/superseding batch scope; use a new workflow");
  reader.inputs(batch.inputs, "batch inputs");
  reader.inputs(batch.baseline_inputs, "baseline_inputs");
  const scenarios = reader.items(batch.scenario_refs, "scenario_refs", true);
  const acceptance = reader.items(batch.acceptance_refs, "acceptance_refs", true);
  const ui = reader.items(batch.ui_refs, "ui_refs");
  const policy = object(batch.policy_ref, "PolicyRef", ["repository_id", "path", "digest", "digest_mode", "selector", "policy_id", "policy_revision"]);
  const { policy_id, policy_revision, ...policyInput } = policy;
  const policyRecord = reader.resolve(policyInput).record;
  if (!policyRecord || policyRecord.record_type !== "policy" || policyRecord.record_id !== policy_id || policyRecord.policy_id !== policy_id || policyRecord.revision !== policy_revision || policyRecord.policy_revision !== policyRecord.revision) fail("policy reference identity/revision mismatch");
  const matrix = reader.resolve(batch.validation_matrix_ref).record;
  if (matrix?.record_type !== "validation-matrix") fail("validation_matrix_ref must identify a matrix record");
  const checkIds = new Set(unique(array(matrix.checks, "matrix checks", true).map(value => typeof value === "string" ? string(value, "check id") : string(object(value, "matrix check").check_id, "check id")), value => value, "matrix checks"));
  const units = unique(array(batch.units, "units", true).map(value => {
    const row = object(value, "BatchUnit", ["unit_ref", "role", "expected_capabilities", "evidence_refs"]);
    const unit = reader.unit(row.unit_ref);
    if (!["implement", "consume", "verify"].includes(String(row.role))) fail("unsupported batch unit role");
    const capabilities = unique(array(row.expected_capabilities, "expected_capabilities").map(value => object(value, "expected capability", ["provider_ref", "capability_id", "version_digest"])), cap => String(cap.capability_id), "expected_capabilities");
    for (const capability of capabilities) {
      const cap = object(capability, "expected capability", ["provider_ref", "capability_id", "version_digest"]);
      if (unitKey(reader.unit(cap.provider_ref)) !== unitKey(unit)) fail("capability provider must match its batch unit");
      id(cap.capability_id, "capability_id"); digest(cap.version_digest, "capability version");
    }
    const evidence = array(row.evidence_refs ?? [], "evidence_refs", row.role === "consume");
    if (row.role === "consume" && capabilities.length === 0) fail("consume must bind a versioned capability and evidence");
    for (const ref of evidence) reader.evidence(ref, unit.workflow_ref.workflow_id);
    return { unit_ref: unit, role: row.role as string, expected_capabilities: capabilities, evidence_refs: evidence as Row[] };
  }), row => unitKey(row.unit_ref), "batch units");
  if (!units.some(row => row.role === "implement")) fail("batch needs an implement unit");
  const selected = new Set(units.map(row => unitKey(row.unit_ref)));
  const dependencies = reader.items(batch.dependency_refs, "dependency_refs");
  for (const ref of dependencies) {
    const { item_id: _, ...input } = ref;
    const edge = reader.resolve(input).record;
    if (edge?.record_type !== "dependency") fail("dependency_refs must select dependency records");
    const { consumer, provider } = reader.dependency(edge);
    if (!selected.has(unitKey(consumer)) || !("external_id" in provider) && !selected.has(unitKey(provider))) fail("declared dependency is outside batch unit closure", "DEPENDENCY_NOT_READY");
  }
  const declared = new Set(dependencies.map(row => `${row.path}:${row.item_id}`));
  const affectedConsumers = new Set<string>();
  const changedProviders = new Set(units.filter(row => row.role === "implement").map(row => unitKey(row.unit_ref)));
  for (const moduleId of readModuleManifest(root).map(module => module.module_id)) {
    const dependencyPath = `docs/aidlc/modules/${moduleId}/inception/application-design/unit-of-work-dependency.md`;
    if (!existsSync(join(root, dependencyPath))) continue;
    const text = readFileSync(safeFile(root, dependencyPath), "utf8");
    if (!text.includes("aidlc-autonomy")) continue;
    for (const edge of records(root, dependencyPath).filter(row => row.record_type === "dependency")) {
      const consumerRef = object(edge.consumer, "dependency consumer"), providerRef = object(edge.provider, "dependency provider");
      if (!selected.has(`${consumerRef.module_id}/${consumerRef.unit_id}`) && !changedProviders.has(`${providerRef.module_id}/${providerRef.unit_id}`)) continue;
      const { consumer, provider } = reader.dependency(edge);
      if (selected.has(unitKey(consumer)) || changedProviders.has(unitKey(provider))) {
        reader.fingerprints.set(`dependency:${dependencyPath}:${edge.record_id}`, autonomyDigest(edge));
      }
      if (changedProviders.has(unitKey(provider))) affectedConsumers.add(unitKey(consumer));
      if (selected.has(unitKey(consumer)) && (!("external_id" in provider) && !selected.has(unitKey(provider)) || !declared.has(`${dependencyPath}:${edge.record_id}`))) {
        fail(`missing dependency closure: ${unitKey(consumer)} -> ${unitKey(provider)}`, "DEPENDENCY_NOT_READY");
      }
    }
  }
  // Input dependencies cannot disappear merely because the execution edge list is empty.
  for (const row of units) for (const dependency of readUnitManifest(root, row.unit_ref.module_id).find(unit => unit.unit_id === row.unit_ref.unit_id)!.evidence_inputs?.depends_on_units || []) {
    if (!selected.has(`${row.unit_ref.module_id}/${dependency}`)) fail(`missing input dependency ${dependency}`, "DEPENDENCY_NOT_READY");
  }
  const consumers = unique(array(batch.consumer_closure, "consumer_closure").map(value => {
    const row = object(value, "ConsumerCheck", ["consumer_ref", "required_checks", "exclusion_reason"]);
    const consumer = reader.unit(row.consumer_ref);
    const checks = array(row.required_checks, "required_checks");
    unique(checks.map(check => string(check, "check id")), value => value, "required_checks");
    if (checks.some(check => !checkIds.has(check as string))) fail("consumer references an unknown matrix check");
    if (row.exclusion_reason !== undefined) { string(row.exclusion_reason, "exclusion_reason"); if (checks.length) fail("excluded consumer must not claim required checks"); }
    else { if (!checks.length) fail("consumer needs checks or an exclusion reason"); if (!selected.has(unitKey(consumer))) fail("missing verify consumer in batch closure", "DEPENDENCY_NOT_READY"); }
    return row;
  }), row => unitKey(row.consumer_ref as unknown as AutonomyUnitRef), "consumer_closure");
  const recordedConsumers = new Set(consumers.map(row => unitKey(row.consumer_ref as unknown as AutonomyUnitRef)));
  for (const consumer of affectedConsumers) if (!recordedConsumers.has(consumer)) fail(`missing affected consumer closure: ${consumer}`, "DEPENDENCY_NOT_READY");
  const artifacts = unique(array(batch.delivery_artifacts, "delivery_artifacts", true).map(value => {
    const row = object(value, "delivery artifact", ["artifact_id", "kind", "required", "source_ref", "target_path", "purpose"]);
    id(row.artifact_id, "artifact id");
    if (!["candidate", "run-instructions", "evidence-index", "decision-index", "other"].includes(String(row.kind)) || typeof row.required !== "boolean") fail("invalid delivery artifact kind/required");
    if ((row.source_ref === undefined) === (row.target_path === undefined)) fail("artifact requires exactly one source_ref or target_path");
    if (row.source_ref !== undefined) reader.resolve(row.source_ref);
    if (row.target_path !== undefined) { const label = string(row.target_path, "target_path"); if (isAbsolute(label) || win32.isAbsolute(label) || /[\\:]/.test(label) || label.split("/").some(p => !p || p === "." || p === "..")) fail("unsafe artifact target path"); }
    if (row.kind === "other") string(row.purpose, "artifact purpose");
    return row;
  }), row => String(row.artifact_id), "delivery_artifacts");
  const dependencyDefinitions: AutonomyInputRef[] = [];
  for (const moduleId of new Set(units.map(u => u.unit_ref.module_id))) for (const record of dependencyRecords(root, unitExtensionPath(moduleId)).filter(r => ["unit-extension", "capability"].includes(r.record_type))) {
    const ref: AutonomyInputRef = { repository_id: "project", path: unitExtensionPath(moduleId), digest_mode: "json-record-v1", selector: { record_type: record.record_type, record_id: record.record_id }, digest: autonomyDigest(record) };
    reader.resolve(ref); dependencyDefinitions.push(ref);
  }
  const snapshot: AutonomyBatchSnapshot = { version: "1", batch_id: batchId, scope_revision: scopeRevision, source_path: source,
    record_digest: autonomyDigest(batch), scope_digest: autonomyDigest({ batch, inputs: [...reader.fingerprints].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) }) };
  return { enabled: false, validation_level: "scope-only", execution_authorized: false, gates_evaluated: false, snapshot,
    goal: batch.goal as string, scenario_refs: scenarios, dependency_refs: dependencies, dependency_definition_refs: dependencyDefinitions,
    acceptance_refs: acceptance, ui_refs: ui, units, consumer_closure: consumers,
    baseline_inputs: batch.baseline_inputs as AutonomyInputRef[], policy_ref: policy,
    validation_matrix_ref: batch.validation_matrix_ref as AutonomyInputRef, integration_owner: batch.integration_owner as string, delivery_artifacts: artifacts,
    pending_validation: ["policy-semantics", "execution-grant", "dependency-readiness-and-provenance", "ui-applicability", "runtime-and-acceptance-gates"] };
}

export function projectAutonomyScope(root: string, state = loadWorkflowState(root)): AutonomyScopeProjection {
  if (!state) fail("no active workflow");
  if (state.autonomy_contract_version === undefined) return { enabled: false, validation_level: "scope-only", execution_authorized: false, gates_evaluated: false, pending_validation: [] };
  assertAutonomySnapshot(state.autonomy_batch);
  const projection = readAutonomyBatch(root, state, state.autonomy_batch.batch_id);
  if (canonicalAutonomyJson(projection.snapshot) !== canonicalAutonomyJson(state.autonomy_batch)) fail("adopted batch scope changed; restore its inputs or use an explicit new workflow", "BATCH_SCOPE_CHANGED");
  return { ...projection, enabled: true };
}

export function adoptAutonomyBatch(root: string, batchId: string, expectedRevision: number, preview = false): AutonomyScopeProjection {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail("--expect must be a non-negative safe state revision");
  const state = loadWorkflowState(root);
  if (!state || state.workflow_kind === "module" || state.workflow_kind === "integration") fail("adopt requires the global workflow");
  if (state.revision !== expectedRevision) fail("workflow revision changed; reread before adopting", "BATCH_SCOPE_CHANGED");
  if (state.autonomy_contract_version !== undefined) {
    if (state.autonomy_batch?.batch_id !== batchId) fail("another batch is already adopted", "BATCH_SCOPE_CHANGED");
    return projectAutonomyScope(root, state); // Idempotent read, no duplicate audit.
  }
  const projection = readAutonomyBatch(root, state, batchId);
  if (preview) return projection;
  const binding = sessionBinding();
  if (!binding || binding.stage_instance.includes("@module:")) fail("adoption requires the exact global project-stage session binding");
  assertSessionClaim(root, state, binding.stage_instance, binding);
  state.autonomy_contract_version = "1";
  state.autonomy_batch = projection.snapshot!;
  saveWorkflowState(root, state, GLOBAL_WORKFLOW, { autonomyWrite: true, beforeCommit: () => {
    const current = readAutonomyBatch(root, state, batchId);
    if (canonicalAutonomyJson(current.snapshot) !== canonicalAutonomyJson(projection.snapshot)) fail("inputs changed before adoption commit", "BATCH_SCOPE_CHANGED");
  } });
  return { ...projection, enabled: true };
}

export function autonomyDirective(root: string, args: string[]): { kind: "print"; autonomy_scope: AutonomyScopeProjection; message: string } {
  const [action, ...rest] = args;
  if (!["inspect", "adopt"].includes(action)) fail("usage: orchestrate autonomy inspect | adopt --batch <id> --expect <revision> [--preview]");
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!["--batch", "--expect", "--preview"].includes(arg) || Object.hasOwn(flags, arg)) fail(`unsupported/duplicate autonomy option ${arg}`);
    if (arg === "--preview") flags[arg] = "true";
    else { if (!rest[i + 1] || rest[i + 1].startsWith("--")) fail(`${arg} requires a value`); flags[arg] = rest[++i]; }
  }
  if (action === "inspect" && rest.length) fail("autonomy inspect takes no options");
  if (action === "adopt" && (!flags["--batch"] || !/^(0|[1-9]\d*)$/.test(flags["--expect"] || ""))) fail("adopt requires --batch and --expect");
  const projection = action === "inspect" ? projectAutonomyScope(root) : adoptAutonomyBatch(root, flags["--batch"], Number(flags["--expect"]), "--preview" in flags);
  return { kind: "print", autonomy_scope: projection, message: "Scope validation only. No grant, readiness, stage completion or quality gate is authorized by adoption." };
}
