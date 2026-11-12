/** P1-02: source-bound policies and delegated decisions. Never an execution grant. */
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { autonomyDigest, autonomySource as v, canonicalAutonomyJson, projectAutonomyScope, ScopeReader, type AutonomyScopeProjection, type AutonomyUnitRef } from "./aidlc-autonomy";
import { loadWorkflowState, sessionBinding, withSessionPublication, type WorkflowState } from "./aidlc-light-state";
import { loadWorkflowParts } from "./aidlc-workflow-layout";
import { operationPath } from "./aidlc-operation-journal";
import { readModuleManifest } from "./aidlc-execution-context";
import { DECISION_PROPOSAL_ROOT } from './aidlc-execution-inputs';

type Row = Record<string, unknown>;
const HANDOFF = "docs/aidlc/handoff.md";
const ROOT_POLICIES = ["docs/aidlc/inception/development-handoff.md", HANDOFF];
const POLICY_FIELDS = [...v.envelope, "policy_id", "policy_revision", "scope_refs", "hard_constraints", "source_precedence", "delegated_categories", "fallback_rules", "allowed_change_classes", "escalation_conditions", "validation_requirements", "authority_ref"];
const DECISION_FIELDS = [...v.envelope, "decision_id", "policy_ref", "policy_clause", "question", "source_refs", "chosen_option", "rationale", "affected_refs", "effective_revision", "implementation_refs", "validation_refs", "adjustment_plan", "recorded_by", "human_review", "unit_ref", "change_class", "action"];
export const DECISION_VALIDATION_FIELDS = ["check_id", "sensor", "stage_instance", "path", "digest", "workflow_id", "batch_id"] as const;
const KINDS = ["missing-detail", "existing-convention", "compatible-internal-change", "explicit-conflict", "out-of-scope"];
const CLASSES = ["implementation-refinement", "baseline-defect-fix", "behavior-preserving-refactor"];
const json = canonicalAutonomyJson;
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function fail(message: string): never { throw new Error(`AUTONOMY_POLICY_INVALID: ${message}`); }
function refKey(value: Row): string { return `${value.repository_id}:${value.path}:${json(value.selector || null)}:${value.item_id}`; }
function keys(refs: Row[]): Set<string> { return new Set(refs.map(refKey)); }
function contains(all: Row[], required: Row[]): boolean { const set = keys(all); return required.every(ref => set.has(refKey(ref))); }
function intersects(a: Row[], b: Row[]): boolean { const set = keys(a); return b.some(ref => set.has(refKey(ref))); }
function strings(value: unknown, label: string, nonempty = false): string[] {
  return v.unique(v.array(value, label, nonempty).map(item => v.string(item, label)), item => item, label);
}
function authority(value: unknown, scope: AutonomyScopeProjection): Row {
  const row = v.object(value, "AuthorityRef", ["source_kind", "source_locator", "source_digest", "scope_summary", "actor_locator"]);
  if (!["host-user-message", "host-approval", "operator-instruction"].includes(String(row.source_kind))) fail("authority must identify a host human input, never a document/Agent/Provider");
  v.string(row.source_locator, "authority locator"); v.string(row.actor_locator, "authority actor"); v.digest(row.source_digest, "authority digest");
  if (row.scope_summary !== `${scope.snapshot!.batch_id}/${scope.snapshot!.scope_revision}`) fail("authority scope_summary must exactly identify batch_id/scope_revision");
  return row; // Host attests authenticity; this validates the reference, not human identity.
}
function timestamp(value: unknown): string {
  const text = v.string(value, "review timestamp");
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text.replace(/Z$/, text.includes(".") ? "Z" : ".000Z")) fail("review timestamp must be an actual UTC RFC3339 timestamp");
  return text;
}
function condition(value: unknown, reader: ScopeReader): Row {
  const row = v.object(value, "Condition", ["kind", "refs", "expected"]);
  if (!KINDS.includes(String(row.kind)) || !Object.hasOwn(row, "expected")) fail("condition needs a known kind and expected value");
  const scalar = (item: unknown) => item === null || ["string", "boolean"].includes(typeof item) || typeof item === "number" && Number.isFinite(item);
  if (!(scalar(row.expected) || Array.isArray(row.expected) && row.expected.every(scalar))) fail("condition expected must be a JSON scalar or scalar array");
  reader.items(row.refs, "condition refs", true);
  return row;
}

interface PolicyContext { state: WorkflowState; scope: AutonomyScopeProjection; policy: Row; reader: ScopeReader; checks: Set<string>; clauses: Map<string, Row>; }
function policyContext(root: string, draftScope?: AutonomyScopeProjection): PolicyContext {
  const state = loadWorkflowState(root);
  if (!state) fail("no active workflow");
  const scope = draftScope || projectAutonomyScope(root, state);
  if (!scope.enabled && !draftScope) fail("explicit batch adoption is required");
  const reader = new ScopeReader(root, state), ref = scope.policy_ref!;
  const policySources = [...ROOT_POLICIES, ...readModuleManifest(root).map(module => `docs/aidlc/modules/${module.module_id}/inception/development-handoff.md`)];
  if (!policySources.includes(String(ref.path))) fail("policy must live in canonical development-handoff.md or handoff.md");
  const locations = policySources.filter(path => existsSync(join(root, path)) && readFileSync(v.safeFile(root, path), "utf8").includes("aidlc-autonomy")
    && v.records(root, path).some(row => row.record_type === "policy" && row.workflow_id === state.workflow_id));
  if (locations.length !== 1 || locations[0] !== ref.path) fail("policy needs exactly one authoritative location");
  const { policy_id, policy_revision, ...input } = ref;
  const policy = v.object(reader.resolve(input).record, "AutonomyPolicy", POLICY_FIELDS);
  if (policy.policy_id !== policy_id || policy.record_id !== policy_id || policy.policy_revision !== policy_revision || policy.revision !== policy_revision) fail("policy identity/revision mismatch");
  reader.inputs(policy.inputs, "policy inputs");
  const scopes = v.unique(v.array(policy.scope_refs, "policy scope_refs", true).map(item => {
    const row = v.object(item, "policy scope", ["batch_id", "scope_revision"]); v.id(row.batch_id, "batch id"); v.revision(row.scope_revision, "scope revision"); return row;
  }), json, "policy scope_refs");
  if (scopes.length !== 1 || scopes[0].batch_id !== scope.snapshot!.batch_id || scopes[0].scope_revision !== scope.snapshot!.scope_revision) fail("P1 policy must bind exactly the adopted batch revision");
  authority(policy.authority_ref, scope);
  const hard = reader.items(policy.hard_constraints, "hard_constraints", true), validation = reader.items(policy.validation_requirements, "validation_requirements", true);
  if (!contains(validation, scope.acceptance_refs!) || !contains(hard, scope.ui_refs!)) fail("policy must preserve every batch AC and UI reference");
  const matrix = reader.resolve(scope.validation_matrix_ref).record!;
  const checks = new Set((matrix.checks as unknown[]).map(item => typeof item === "string" ? item : String(v.object(item, "check").check_id)));
  const classes = strings(policy.allowed_change_classes, "allowed_change_classes", true);
  if (classes.some(item => !CLASSES.includes(item))) fail("semantic/scope changes are not delegated change classes");
  const precedence = v.unique(v.array(policy.source_precedence, "source_precedence").map(item => {
    const rule = v.object(item, "SourceRule", ["rule_id", "scope_items", "preferred", "supersedes", "authority_ref"]);
    v.id(rule.rule_id, "source rule id"); reader.items(rule.scope_items, "source rule scope", true); authority(rule.authority_ref, scope);
    reader.resolve(rule.preferred); const replaced = v.array(rule.supersedes, "supersedes", true); for (const ref of replaced) reader.resolve(ref);
    if (replaced.some(ref => json(ref) === json(rule.preferred))) fail("source rule cannot supersede its own preferred input");
    return rule;
  }), rule => String(rule.rule_id), "source_precedence");
  for (let i = 0; i < precedence.length; i++) for (const other of precedence.slice(i + 1)) {
    if (intersects(precedence[i].scope_items as Row[], other.scope_items as Row[]) && json(precedence[i].preferred) !== json(other.preferred)) fail("conflicting source precedence for the same scope");
  }
  const clauses = new Map<string, Row>();
  for (const item of v.array(policy.delegated_categories, "delegated_categories")) {
    const rule = v.object(item, "CategoryRule", ["category_id", "when", "allowed_actions", "forbidden_changes"]);
    const name = `category:${v.id(rule.category_id, "category id")}`; if (clauses.has(name)) fail("duplicate category id");
    condition(rule.when, reader); strings(rule.allowed_actions, "allowed_actions", true); reader.items(rule.forbidden_changes, "forbidden_changes"); clauses.set(name, rule);
  }
  for (const item of v.array(policy.fallback_rules, "fallback_rules")) {
    const rule = v.object(item, "FallbackRule", ["rule_id", "when", "default_behavior", "constraints", "required_checks"]);
    const name = `fallback:${v.id(rule.rule_id, "fallback id")}`; if (clauses.has(name)) fail("duplicate fallback id");
    condition(rule.when, reader); v.string(rule.default_behavior, "default_behavior"); reader.items(rule.constraints, "fallback constraints", true);
    const required = strings(rule.required_checks, "required_checks", true); if (required.some(check => !checks.has(check))) fail("fallback references an unknown validation check");
    clauses.set(name, rule);
  }
  const fallbacks = [...clauses].filter(([name]) => name.startsWith("fallback:")).map(([, rule]) => rule);
  for (let i = 0; i < fallbacks.length; i++) for (const other of fallbacks.slice(i + 1)) {
    const a = fallbacks[i].when as Row, b = other.when as Row;
    if (a.kind === b.kind && intersects(a.refs as Row[], b.refs as Row[]) && (json(a.expected) !== json(b.expected) || fallbacks[i].default_behavior !== other.default_behavior)) fail("overlapping fallbacks have incompatible outcomes; explicit policy repair is required");
  }
  for (const item of v.array(policy.escalation_conditions, "escalation_conditions")) condition(item, reader);
  return { state, scope, policy, reader, checks, clauses };
}

export interface DelegatedDecisionResult {
  decision_id: string; revision: number; effective_revision: number; policy_clause: string;
  chosen_option: string; unit_ref: AutonomyUnitRef; human_review: Row;
  implementation_refs: unknown[]; validation_refs: unknown[];
  record_status: "incomplete" | "recorded-not-verified" | "rework-required";
  completion_blockers: string[];
}
export interface AutonomyDecisionProjection {
  enabled: boolean; validation_level: "policy-and-decision-records"; execution_authorized: false;
  effective_revision: number;
  engineering_verification: "not_evaluated"; policy?: Row;
  decisions: DelegatedDecisionResult[]; human_review_summary: Record<string, number>;
  completion_blockers: string[]; handoff_digest: string; write_contract?: Row;
}
function review(value: unknown, context: PolicyContext): Row {
  const row = v.object(value, "human_review", ["status", "reviewer", "authority_ref", "reviewed_at", "replacement_ref", "change_ref"]);
  if (!["pending", "accepted", "change-requested", "rejected"].includes(String(row.status))) fail("unknown human review status");
  if (row.status === "pending") { if (Object.keys(row).length !== 1) fail("pending human review cannot invent a reviewer or approval"); }
  else {
    v.string(row.reviewer, "reviewer"); const source = authority(row.authority_ref, context.scope); timestamp(row.reviewed_at);
    if (source.actor_locator !== row.reviewer) fail("reviewer does not match authority actor");
    const approval = context.policy.authority_ref as Row;
    if (source.source_locator === approval.source_locator || source.source_digest === approval.source_digest) fail("human review needs its own actual input, not the policy approval reference");
    if (row.status === "accepted" && (row.replacement_ref !== undefined || row.change_ref !== undefined)) fail("accepted review must not include replacement/change requests");
    if (["change-requested", "rejected"].includes(String(row.status)) && row.replacement_ref === undefined && row.change_ref === undefined) fail("changed/rejected review requires a replacement or change reference");
    for (const ref of [row.replacement_ref, row.change_ref]) if (ref !== undefined) context.reader.resolve(ref);
  }
  return row;
}
function validateDecision(value: unknown, context: PolicyContext): DelegatedDecisionResult {
  const d = v.object(value, "DelegatedDecision", DECISION_FIELDS), { reader, scope, policy, clauses } = context;
  if (d.schema !== "aidlc.autonomy/v1" || d.record_type !== "decision" || d.workflow_id !== context.state.workflow_id || d.record_id !== d.decision_id) fail("decision identity/schema mismatch");
  v.id(d.decision_id, "decision id"); v.revision(d.revision, "decision revision"); v.revision(d.effective_revision, "effective_revision");
  if (d.created_at !== undefined) timestamp(d.created_at);
  reader.inputs(d.inputs, "decision inputs");
  if (json(d.policy_ref) !== json(scope.policy_ref)) fail("decision policy reference changed");
  const clauseName = v.string(d.policy_clause, "policy_clause"), clause = clauses.get(clauseName);
  if (!clause) fail("decision must match a real delegated policy clause");
  const when = clause.when as Row;
  if (["explicit-conflict", "out-of-scope"].includes(String(when.kind))) fail("explicit conflict/scope change cannot be delegated");
  for (const field of ["question", "chosen_option", "rationale", "adjustment_plan", "recorded_by", "action"]) v.string(d[field], field);
  if (!(policy.allowed_change_classes as string[]).includes(String(d.change_class))) fail("decision change class is not delegated");
  if (clauseName.startsWith("fallback:")) { if (d.chosen_option !== clause.default_behavior || d.action !== clause.default_behavior) fail("decision must use the authorized fallback outcome"); }
  else if (!(clause.allowed_actions as string[]).includes(String(d.action))) fail("decision action is not delegated");
  const sources = reader.items(d.source_refs, "decision source_refs", true), affected = reader.items(d.affected_refs, "affected_refs", true);
  const protectedRefs = [...policy.hard_constraints as Row[], ...policy.validation_requirements as Row[], ...(clause.forbidden_changes as Row[] || []), ...(clause.constraints as Row[] || [])];
  if (intersects(affected, protectedRefs)) fail("decision cannot reverse explicit/hard/validation constraints");
  if (!contains(when.refs as Row[], affected)) fail("decision affects items outside its authorized refinement slots");
  if (!contains(sources, [...when.refs as Row[], ...policy.hard_constraints as Row[], ...policy.validation_requirements as Row[], ...clause.constraints as Row[] || []])) fail("decision omits governing source/constraint references");
  for (const rule of policy.escalation_conditions as Row[]) if (rule.kind === when.kind && intersects(rule.refs as Row[], affected) && json(rule.expected) === json(when.expected)) fail("decision matches an escalation condition");
  const unit = reader.unit(d.unit_ref);
  if (!scope.units!.some(row => json(row.unit_ref) === json(unit) && row.role === "implement")) fail("decision must belong to an implement unit in the batch");
  const implementation = v.unique(v.array(d.implementation_refs, "implementation_refs"), json, "implementation_refs");
  for (const ref of implementation) reader.resolve(ref);
  const validation = v.unique(v.array(d.validation_refs, "validation_refs").map(value => {
    const row = v.object(value, "decision validation", [...DECISION_VALIDATION_FIELDS]);
    if (!context.checks.has(v.string(row.check_id, "validation check")) || row.batch_id !== scope.snapshot!.batch_id) fail("validation must bind a real batch check");
    const { check_id: _, ...evidence } = row; reader.evidence(evidence, row.sensor === "runtime-observation" ? context.state.workflow_id : unit.workflow_ref.workflow_id); return row;
  }), row => String(row.check_id), "validation_refs");
  const human = review(d.human_review, context), blockers: string[] = [];
  if (!implementation.length) blockers.push("implementation-missing");
  if (!validation.length) blockers.push("validation-missing");
  for (const check of clause.required_checks as string[] || []) if (!validation.some(row => row.check_id === check)) blockers.push(`validation-check-missing:${check}`);
  const rework = ["change-requested", "rejected"].includes(String(human.status));
  if (rework) blockers.push("human-review-requires-incremental-rework");
  return { decision_id: String(d.decision_id), revision: d.revision as number, effective_revision: d.effective_revision as number, policy_clause: clauseName, chosen_option: String(d.chosen_option), unit_ref: unit, human_review: human,
    implementation_refs: implementation, validation_refs: validation, record_status: rework ? "rework-required" : blockers.length ? "incomplete" : "recorded-not-verified", completion_blockers: blockers };
}
function handoffRows(root: string): Row[] {
  if (!existsSync(join(root, HANDOFF))) return [];
  return readFileSync(v.safeFile(root, HANDOFF), "utf8").includes("aidlc-autonomy") ? v.records(root, HANDOFF) : [];
}
export function autonomyHandoffDigest(root: string): string { return existsSync(join(root, HANDOFF)) ? hash(readFileSync(v.safeFile(root, HANDOFF))) : "absent"; }
function decisionWriteContract(context: PolicyContext, records: Row[], expected: string): Row {
  return {
    schema: "aidlc.decision-write-contract/v1", template_only: true, execution_authorized: false,
    handoff_path: HANDOFF, expected_handoff_digest: expected,
    proposal_directory: `${DECISION_PROPOSAL_ROOT}/${context.state.workflow_id}`,
    proposal_rule: 'Use <record_id>.json in proposal_directory for a new delegated record; updates use their exact proposal_path. Publication still validates policy, unit, revision, evidence and CAS.',
    record_command: ["orchestrate", "autonomy", "record", "--input", "<proposal.json>", "--expect", expected],
    record_fields: [...DECISION_FIELDS], validation_ref_fields: [...DECISION_VALIDATION_FIELDS],
    implementation_ref_fields: ["repository_id", "path", "digest_mode", "digest"],
    digest_rule: "SHA-256 of raw file bytes returned by the gateway read; never the signed receipt body digest. Native and runtime validation refs are flat, not nested evidence_ref or ordinary InputRef objects.",
    allowed_check_ids: [...context.checks].sort(),
    updates: records.map(row => {
      const clause = context.clauses.get(String(row.policy_clause))!, required = clause.required_checks as string[] || [];
      return { decision_id: row.decision_id, proposal_path: `${DECISION_PROPOSAL_ROOT}/${context.state.workflow_id}/${row.record_id}.json`, required_check_ids: required,
        editable_fields: ["revision", "implementation_refs", "validation_refs", "recorded_by"],
        proposal: { ...JSON.parse(json(row)), revision: Number(row.revision) + 1 },
        runtime_validation_templates: (required.length ? required : [...context.checks].sort().slice(0, 1)).map(check_id => ({ check_id, sensor: "runtime-observation", stage_instance: null, path: null, digest: null, workflow_id: context.state.workflow_id, batch_id: context.scope.snapshot!.batch_id })) };
    }),
  };
}

/** Host-owned staging may write only a Core-derived path for its exact implement unit. */
export function assertDecisionProposalTarget(root: string, path: string, value?: unknown): void {
  const binding=sessionBinding(), context=policyContext(root);
  const prefix=`${DECISION_PROPOSAL_ROOT}/${context.state.workflow_id}/`,id=path.startsWith(prefix)?path.slice(prefix.length).replace(/\.json$/,''):'';
  if(!/^[a-z0-9][a-z0-9-]*$/.test(id)||path!==`${prefix}${id}.json`||value!==undefined&&(value as Row)?.record_id!==id) fail('proposal target must match its workflow and record_id');
  const existing=handoffRows(root).find(r=>r.record_type==='decision'&&r.record_id===id);
  const unit=existing?.unit_ref as Row|undefined || context.scope.units?.find(u=>u.role==='implement'&&binding?.stage_instance.endsWith(`@module:${u.unit_ref.module_id}@unit:${u.unit_ref.unit_id}`))?.unit_ref as unknown as Row|undefined;
  const workflow=unit?.workflow_ref as Row|undefined;
  if(!binding||!unit||workflow?.workflow_id!==binding.workflow_id||
     !binding.stage_instance.endsWith(`@module:${unit.module_id}@unit:${unit.unit_id}`)) fail('proposal target must belong to the exact current implement unit');
}
function projection(root: string, context: PolicyContext, rows: Row[]): AutonomyDecisionProjection {
  const records = rows.filter(row => row.record_type === "decision"), decisions = records.map(row => validateDecision(row, context));
  for (let i = 0; i < decisions.length; i++) for (let j = i + 1; j < decisions.length; j++) {
    if (intersects(records[i].affected_refs as Row[], records[j].affected_refs as Row[]) && decisions[i].chosen_option !== decisions[j].chosen_option) fail("incompatible decisions overlap the same refinement slot");
  }
  const revisions = decisions.map(d => d.effective_revision).sort((a, b) => a - b);
  if (revisions.some((value, index) => value !== index + 1)) fail("decision effective revisions must form a unique contiguous refinement history");
  const counts = Object.fromEntries(["pending", "accepted", "change-requested", "rejected"].map(status => [status, decisions.filter(d => d.human_review.status === status).length]));
  return { enabled: true, validation_level: "policy-and-decision-records", execution_authorized: false, effective_revision: revisions.at(-1) || 0, engineering_verification: "not_evaluated", policy: context.policy, decisions,
    human_review_summary: counts, completion_blockers: decisions.flatMap(d => d.completion_blockers.map(reason => `${d.decision_id}:${reason}`)), handoff_digest: autonomyHandoffDigest(root), write_contract: decisionWriteContract(context, records, autonomyHandoffDigest(root)) };
}
export function projectAutonomyDecisions(root: string, draftScope?: AutonomyScopeProjection): AutonomyDecisionProjection {
  const state = loadWorkflowState(root);
  if (!state?.autonomy_contract_version && !draftScope) return { enabled: false, validation_level: "policy-and-decision-records", execution_authorized: false, effective_revision: 0, engineering_verification: "not_evaluated", decisions: [], human_review_summary: {}, completion_blockers: [], handoff_digest: "not-read" };
  return projection(root, policyContext(root, draftScope), handoffRows(root));
}

/** Replace only the authoring fence; surrounding narrative is not a progress ledger. */
function updatedHandoff(root: string, rows: Row[]): string {
  const original = existsSync(join(root, HANDOFF)) ? readFileSync(v.safeFile(root, HANDOFF), "utf8") : "# AI-DLC Handoff\n";
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const content = ["```aidlc-autonomy", JSON.stringify({ schema: "aidlc.autonomy-source/v1", records: rows }, null, 2).replace(/\n/g, eol), "```", ""].join(eol);
  const MarkdownIt = createRequire(import.meta.url)("markdown-it");
  const fences = new MarkdownIt().parse(original, {}).filter((token: { type: string; info: string }) => token.type === "fence" && token.info.trim() === "aidlc-autonomy");
  if (!fences.length) return original + (original.endsWith(eol) ? eol : eol + eol) + content;
  if (fences.length !== 1) fail("handoff requires one autonomy fence");
  const lines = original.split(/(?<=\n)/), [start, end] = fences[0].map;
  return lines.slice(0, start).join("") + content + lines.slice(end).join("");
}
function assertAppendableHandoff(root: string, context: PolicyContext, decisions: Row[]): void {
  const visited = new Set<string>();
  const proposed = decisions.at(-1)!;
  const scan = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) scan(item); return; }
    if (!value || typeof value !== "object") return;
    const row = value as Row;
    if (row.path === HANDOFF && (row.digest_mode === "raw-file" || row.sensor !== undefined)) fail("handoff is frozen as raw-file/evidence; decision append cannot invalidate its own references");
    if (row.repository_id === "project" && typeof row.path === "string" && row.digest_mode) {
      if (row.digest_mode === "json-record-v1") {
        const selector = row.selector as Row;
        if (row.path === HANDOFF && selector.record_type === "decision" && selector.record_id === proposed.record_id && row.digest !== autonomyDigest(proposed)) fail("decision update would invalidate a pinned decision reference");
        const key = `${row.path}:${json(row.selector)}`;
        if (!visited.has(key)) {
          visited.add(key);
          scan(context.reader.resolve({ repository_id: row.repository_id, path: row.path, digest: row.digest, digest_mode: row.digest_mode, selector: row.selector }).record);
        }
      }
    }
    for (const child of Object.values(row)) scan(child);
  };
  scan(v.records(root, context.scope.snapshot!.source_path).find(row => row.record_type === "batch"));
  scan(decisions);
}
export function recordDelegatedDecision(root: string, value: unknown, expected: string, preview = false): AutonomyDecisionProjection {
  if (expected !== "absent") v.digest(expected, "expected handoff digest");
  const prepare = () => {
    if (autonomyHandoffDigest(root) !== expected) fail("handoff changed; reread its digest before recording");
    const context = policyContext(root), rows = handoffRows(root), d = v.object(value, "decision", DECISION_FIELDS);
    assertAppendableHandoff(root, context, [...rows, d]);
    const result = validateDecision(d, context), prior = rows.find(row => row.record_type === "decision" && row.record_id === d.record_id);
    if (prior && json(prior) === json(d)) return { context, rows, result, unchanged: true };
    if (prior) {
      if (d.revision !== (prior.revision as number) + 1) fail("decision update requires the next revision");
      const mutable = new Set(["revision", "implementation_refs", "validation_refs", "human_review", "recorded_by"]);
      for (const field of new Set([...Object.keys(prior), ...Object.keys(d)])) if (!mutable.has(field) && json(prior[field] ?? null) !== json(d[field] ?? null)) fail(`decision update cannot change ${field}; use an explicitly authorized new scope/policy`);
      const old = prior.human_review as Row, next = d.human_review as Row;
      if (old.status !== "pending" && json(old) !== json(next)) fail("a recorded human review cannot be reversed by an Agent update");
    } else {
      const nextEffective = Math.max(0, ...rows.filter(row => row.record_type === "decision").map(row => row.effective_revision as number)) + 1;
      if (d.revision !== 1 || d.effective_revision !== nextEffective || (d.human_review as Row).status !== "pending") fail("new delegated decisions start at revision 1, the next effective_revision and human_review pending");
    }
    const next = [...rows.filter(row => !(row.record_type === "decision" && row.record_id === d.record_id)), d];
    projection(root, context, next); // Validate conflicts before any write.
    return { context, rows: next, result, unchanged: false };
  };
  const prepared = prepare();
  if (!prepared.unchanged && Buffer.byteLength(updatedHandoff(root, prepared.rows), "utf8") > 2 * 1024 * 1024) fail("decision would exceed the bounded handoff size");
  if (preview || prepared.unchanged) return projection(root, prepared.context, prepared.rows);
  const binding = sessionBinding(); if (!binding) fail("decision publication needs an exact live session binding");
  const owner = [...loadWorkflowParts(root).parts.values()].find(part => part.state.workflow_id === binding.workflow_id);
  if (!owner || owner.ref.kind === "integration") fail("decision publisher must own its implement workflow");
  const module = /@module:([a-z0-9-]+)/.exec(binding.stage_instance)?.[1];
  if (module && module !== prepared.result.unit_ref.module_id) fail("decision publisher does not own the affected module");
  if (prepared.result.unit_ref.workflow_ref.workflow_id !== binding.workflow_id || binding.stage_instance.includes("@unit:") && !binding.stage_instance.endsWith(`@unit:${prepared.result.unit_ref.unit_id}`)) fail("decision publisher does not own the affected unit");
  if ((value as Row).recorded_by !== `${binding.owner}/${binding.session_id}`) fail("recorded_by must match the publishing owner/session");
  return withSessionPublication(root, owner.ref, binding.stage_instance, () => {
    const path = operationPath(root, HANDOFF); mkdirSync(dirname(path), { recursive: true });
    const lockPath = operationPath(root, `${HANDOFF}.lock`), lock = openSync(lockPath, "wx", 0o600);
    const temporary = operationPath(root, `${HANDOFF}.tmp-${process.pid}`);
    try {
      const current = prepare();
      const output = updatedHandoff(root, current.rows);
      if (Buffer.byteLength(output, "utf8") > 2 * 1024 * 1024) fail("decision would exceed the bounded handoff size");
      const fd = openSync(temporary, "wx", 0o600);
      try { writeFileSync(fd, output, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
      // Recheck all frozen inputs and external file CAS immediately before publication.
      projection(root, policyContext(root), current.rows); if (autonomyHandoffDigest(root) !== expected) fail("handoff changed before commit");
      renameSync(temporary, path);
      return projection(root, current.context, current.rows);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); closeSync(lock); unlinkSync(lockPath); }
  }, binding, "decision-record");
}

export function autonomyPolicyDirective(root: string, args: string[]): { kind: "print"; autonomy_decisions: AutonomyDecisionProjection; message: string } {
  const [action, ...rest] = args;
  if (action === "policy" || action === "decisions") {
    if (rest.length) fail(`${action} takes no options`);
    return { kind: "print", autonomy_decisions: projectAutonomyDecisions(root), message: "Policy/decision records only; pending human review is separate from missing implementation, validation and controlled engineering gates." };
  }
  if (action !== "record") fail("expected autonomy policy | decisions | record --input <json> --expect <handoff-sha256|absent> [--preview]");
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]; if (!["--input", "--expect", "--preview"].includes(key) || Object.hasOwn(flags, key)) fail("unknown/duplicate decision option");
    if (key === "--preview") flags[key] = "true";
    else { if (!rest[i + 1] || rest[i + 1].startsWith("--")) fail(`${key} requires a value`); flags[key] = rest[++i]; }
  }
  if (!flags["--input"] || !flags["--expect"]) fail("decision record requires --input and --expect");
  const value: unknown = JSON.parse(readFileSync(v.safeFile(root, flags["--input"]), "utf8"));
  if(loadWorkflowState(root)?.execution_grant_ref) assertDecisionProposalTarget(root,flags['--input'],value);
  return { kind: "print", autonomy_decisions: recordDelegatedDecision(root, value, flags["--expect"], "--preview" in flags), message: "Decision recorded/previewed. This is not human approval, execution authority or verified delivery." };
}
