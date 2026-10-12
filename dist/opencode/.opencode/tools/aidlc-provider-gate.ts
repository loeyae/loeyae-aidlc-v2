import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  PROVIDER_FALLBACK_POLICY_V1,
  PROVIDER_SCHEMA,
  type CapabilityExpression,
  type EvidenceStatus,
  type GateDecisionV1_1,
  type JsonValue,
  type ProviderDiagnosticCode,
  type ProviderEvidenceV1_1,
  type ProviderFallbackRecord,
  type ProviderPlanNode,
  type ProviderPlanV1_1,
  type ProviderRuleResultStatus,
  type ProviderScope,
  type ProviderSourceRevision,
  type ProviderWaiver,
  type RuleCheckStatus,
  type Sha256Digest,
} from "./aidlc-provider-types.js";
import {
  canonicalProviderJson,
  readProjectProviders,
  sha256ProviderDigest,
} from "./aidlc-project-provider.js";
import {
  defaultResolutionPolicy,
  recomputePlanDigest,
  recomputePlanId,
  resolveProjectProviderPlan,
  type ProviderResolutionPolicy,
} from "./aidlc-provider-resolver.js";
import {
  LocalProviderEvidenceStore,
  assessProviderEvidence,
  localProviderArtifactSigner,
  providerEvidenceDigest,
  type ProviderArtifactSigner,
  type ProviderEvidenceAssessment,
  type ProviderEvidenceStore,
} from "./aidlc-provider-evidence.js";
import {
  loadFrozenProviderPlan,
  readCurrentProviderSourceRevision,
} from "./aidlc-provider-runner.js";
import { readLockedProviderRulePolicies } from "./aidlc-provider-git.js";

export const PROVIDER_GATE_ROOT = ".aidlc/provider-gates";
const GATE_ID = /^gate-[0-9a-f]{32}$/;
const MAX_GATE_BYTES = 16 * 1024 * 1024;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const EXTENSION_NAMESPACE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;

export class ProviderGateError extends Error {
  readonly diagnostic: ProviderDiagnosticCode;

  constructor(diagnostic: ProviderDiagnosticCode, message: string) {
    super(`${diagnostic}: ${message}`);
    this.name = "ProviderGateError";
    this.diagnostic = diagnostic;
  }
}

function fail(diagnostic: ProviderDiagnosticCode, message: string): never {
  throw new ProviderGateError(diagnostic, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) if (!allowed.has(field)) fail("PROVIDER_EVIDENCE_REVOKED", `${label} has unknown field ${field}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(value)) fail("PROVIDER_EVIDENCE_REVOKED", `${label} must be a non-empty string`);
  return value;
}

function digest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("PROVIDER_EVIDENCE_REVOKED", `${label} must be a SHA-256 digest`);
  return value as Sha256Digest;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !UTC.test(value) || !Number.isFinite(Date.parse(value))) fail("PROVIDER_EVIDENCE_REVOKED", `${label} must be UTC RFC 3339`);
  return value;
}

function validateExtensions(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) fail("PROVIDER_EVIDENCE_REVOKED", `${label} must be an object`);
  for (const [namespace, extension] of Object.entries(value)) {
    if (!EXTENSION_NAMESPACE.test(namespace) || !isRecord(extension)) fail("PROVIDER_EVIDENCE_REVOKED", `${label}.${namespace} must be a namespaced JSON object`);
  }
}

function same(left: unknown, right: unknown): boolean {
  return canonicalProviderJson(left) === canonicalProviderJson(right);
}

function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

export interface ProviderGatePolicy {
  readonly allowWaivers: boolean;
  readonly waiverAllowedStages: readonly string[];
  readonly waivableRuleIds: readonly string[];
  readonly allowFallback: boolean;
  readonly fallbackAllowedStages: readonly string[];
}

export const DEFAULT_PROVIDER_GATE_POLICY: ProviderGatePolicy = {
  allowWaivers: false,
  waiverAllowedStages: [],
  waivableRuleIds: [],
  allowFallback: false,
  fallbackAllowedStages: [],
};

interface GateDiagnostic {
  readonly code: ProviderDiagnosticCode;
  readonly message: string;
}

function diagnostic(list: GateDiagnostic[], code: ProviderDiagnosticCode, message: string): void {
  if (!list.some((entry) => entry.code === code && entry.message === message)) list.push({ code, message });
}

function stageAllowed(stages: readonly string[], stage: string): boolean {
  return stages.includes("*") || stages.includes(stage);
}

function expressionSatisfied(expression: CapabilityExpression, satisfied: ReadonlySet<string>): boolean {
  if ("capability" in expression) return satisfied.has(expression.capability);
  if ("all_of" in expression) return expression.all_of.every((item) => expressionSatisfied(item, satisfied));
  if ("any_of" in expression) return expression.any_of.some((item) => expressionSatisfied(item, satisfied));
  if ("at_least" in expression) return expression.at_least.of.filter((item) => expressionSatisfied(item, satisfied)).length >= expression.at_least.count;
  if ("exactly_one" in expression) return expression.exactly_one.filter((item) => expressionSatisfied(item, satisfied)).length === 1;
  return false;
}

function validateWaiverShape(value: ProviderWaiver): void {
  if (!isRecord(value)) fail("PROVIDER_WAIVER_INVALID", "waiver must be an object");
  exact(value, ["waiver_id", "approval_ref", "reason", "scope", "evidence_id", "rule_ids", "issued_at", "expires_at", "rerun_required_by"], "waiver");
  for (const field of ["waiver_id", "approval_ref", "reason", "evidence_id"] as const) text(value[field], `waiver.${field}`);
  if (!Array.isArray(value.rule_ids) || value.rule_ids.length === 0 || value.rule_ids.some((ruleId) => typeof ruleId !== "string" || !ruleId.trim()) || new Set(value.rule_ids).size !== value.rule_ids.length) fail("PROVIDER_WAIVER_INVALID", "waiver.rule_ids must be a non-empty unique string array");
  if (!isRecord(value.scope) || typeof value.scope.stage !== "string") fail("PROVIDER_WAIVER_INVALID", "waiver.scope is invalid");
  timestamp(value.issued_at, "waiver.issued_at");
  timestamp(value.expires_at, "waiver.expires_at");
  timestamp(value.rerun_required_by, "waiver.rerun_required_by");
}

function validateFallbackShape(value: ProviderFallbackRecord): void {
  if (!isRecord(value)) fail("PROVIDER_FALLBACK_NOT_ALLOWED", "fallback must be an object");
  exact(value, ["from_node_id", "to_node_id", "trigger_diagnostic", "policy_ref", "approval_ref"], "fallback");
  for (const field of ["from_node_id", "to_node_id", "trigger_diagnostic", "policy_ref"] as const) text(value[field], `fallback.${field}`);
  if (value.approval_ref !== undefined) text(value.approval_ref, "fallback.approval_ref");
}

function acceptedAssessmentForNode(
  assessment: ProviderEvidenceAssessment,
  plan: ProviderPlanV1_1,
  node: ProviderPlanNode,
  lockByInstance: ReadonlyMap<string, ReturnType<typeof readProjectProviders>["lock"]["providers"][number]>,
  diagnostics: GateDiagnostic[],
): boolean {
  const evidence = assessment.evidence;
  if (assessment.state !== "accepted") {
    diagnostic(diagnostics, assessment.diagnostic ?? "PROVIDER_GATE_EVIDENCE_MISSING", `${node.node_id}: ${assessment.reason || `Evidence state is ${assessment.state}`}`);
    return false;
  }
  const lock = lockByInstance.get(node.provider_instance_id);
  if (!lock
    || evidence.plan.node_id !== node.node_id
    || evidence.provider_instance.instance_id !== node.provider_instance_id
    || evidence.provider_instance.provider_id !== lock.id
    || evidence.provider_instance.commit_oid !== lock.source.commit_oid
    || evidence.provider_instance.manifest_digest !== lock.manifest.digest
    || evidence.provider_instance.config_digest !== lock.project_config_digest
    || evidence.provider_instance.project_lock_digest !== plan.project_lock_digest) {
    diagnostic(diagnostics, "PROVIDER_EVIDENCE_STALE", `Evidence ${evidence.evidence_id} does not match Plan node ${node.node_id} and its current lock`);
    return false;
  }
  return true;
}

interface RuleEvaluationResult {
  readonly evaluations: GateDecisionV1_1["rule_evaluations"];
  readonly validWaivers: ProviderWaiver[];
  readonly satisfies: boolean;
  readonly usedWaiver: boolean;
}

function evaluateRules(
  evidence: ProviderEvidenceV1_1,
  waivers: readonly ProviderWaiver[],
  policy: ProviderGatePolicy,
  manifestWaivableRuleIds: ReadonlySet<string>,
  now: Date,
  diagnostics: GateDiagnostic[],
): RuleEvaluationResult {
  const evaluations: Array<{
    evidence_id: string;
    rule_id: string;
    original_status: ProviderRuleResultStatus;
    status: RuleCheckStatus;
    waiver_id?: string;
  }> = [];
  const validWaivers: ProviderWaiver[] = [];
  const used = new Set<string>();
  let satisfies = evidence.invocation.result_status === "passed" || evidence.invocation.result_status === "failed";
  let usedWaiver = false;

  if (evidence.invocation.result_status === "deferred") {
    diagnostic(diagnostics, "PROVIDER_DEFERRED_NOT_ALLOWED", `Evidence ${evidence.evidence_id} is deferred and cannot pass directly`);
    satisfies = false;
  } else if (evidence.invocation.result_status === "error" || evidence.invocation.result_status === "cancelled") {
    diagnostic(diagnostics, "PROVIDER_GATE_EVIDENCE_MISSING", `Evidence ${evidence.evidence_id} has non-passing invocation status ${evidence.invocation.result_status}`);
    satisfies = false;
  }

  for (const check of evidence.checks) {
    if (check.status !== "failed") {
      evaluations.push({ evidence_id: evidence.evidence_id, rule_id: check.rule_id, original_status: check.status, status: check.status });
      continue;
    }
    const candidates = waivers.filter((waiver) => waiver.evidence_id === evidence.evidence_id && waiver.rule_ids.includes(check.rule_id));
    let accepted: ProviderWaiver | undefined;
    for (const waiver of candidates) {
      try {
        validateWaiverShape(waiver);
        const validTime = Date.parse(waiver.issued_at) <= now.getTime()
          && Date.parse(waiver.expires_at) > now.getTime()
          && Date.parse(waiver.rerun_required_by) > now.getTime()
          && Date.parse(waiver.expires_at) > Date.parse(waiver.issued_at);
        if (!policy.allowWaivers || !stageAllowed(policy.waiverAllowedStages, evidence.scope.stage)
          || !policy.waivableRuleIds.includes(check.rule_id) || !manifestWaivableRuleIds.has(check.rule_id) || !same(waiver.scope, evidence.scope)
          || !validTime || !waiver.approval_ref.trim()) continue;
        accepted = waiver;
        break;
      } catch {
        // A malformed candidate remains unaccepted and causes the failed rule to block.
      }
    }
    if (accepted) {
      used.add(accepted.waiver_id);
      if (!validWaivers.some((waiver) => waiver.waiver_id === accepted!.waiver_id)) validWaivers.push(accepted);
      evaluations.push({ evidence_id: evidence.evidence_id, rule_id: check.rule_id, original_status: "failed", status: "waived", waiver_id: accepted.waiver_id });
      usedWaiver = true;
    } else {
      evaluations.push({ evidence_id: evidence.evidence_id, rule_id: check.rule_id, original_status: "failed", status: "failed" });
      diagnostic(diagnostics, "PROVIDER_WAIVER_INVALID", `Rule ${check.rule_id} failed in ${evidence.evidence_id} without a valid human-approved waiver`);
      satisfies = false;
    }
  }
  for (const waiver of waivers.filter((candidate) => candidate.evidence_id === evidence.evidence_id)) {
    if (!used.has(waiver.waiver_id)) diagnostic(diagnostics, "PROVIDER_WAIVER_INVALID", `Waiver ${waiver.waiver_id} is invalid, out of scope, expired, or does not bind a failed rule`);
  }
  return { evaluations, validWaivers, satisfies, usedWaiver };
}

function validFallback(
  record: ProviderFallbackRecord,
  plan: ProviderPlanV1_1,
  policy: ProviderGatePolicy,
  diagnostics: GateDiagnostic[],
): { readonly from: ProviderPlanNode; readonly to: ProviderPlanNode } | undefined {
  try { validateFallbackShape(record); } catch (error) {
    diagnostic(diagnostics, "PROVIDER_FALLBACK_NOT_ALLOWED", error instanceof Error ? error.message : String(error));
    return undefined;
  }
  const from = plan.nodes.find((node) => node.node_id === record.from_node_id);
  const to = plan.nodes.find((node) => node.node_id === record.to_node_id);
  const eligible = (PROVIDER_FALLBACK_POLICY_V1.eligible_diagnostics as readonly string[]).includes(record.trigger_diagnostic);
  const forbidden = (PROVIDER_FALLBACK_POLICY_V1.never_for_diagnostics as readonly string[]).includes(record.trigger_diagnostic);
  if (!from || !to || !from.fallback_node_ids.includes(to.node_id) || from.capability_id !== to.capability_id
    || !policy.allowFallback || !stageAllowed(policy.fallbackAllowedStages, plan.scope.stage)
    || !eligible || forbidden || plan.approval?.status !== "approved") {
    diagnostic(diagnostics, "PROVIDER_FALLBACK_NOT_ALLOWED", `Fallback ${record.from_node_id} -> ${record.to_node_id} is not admitted by the locked Plan, Core policy and stage policy`);
    return undefined;
  }
  return { from, to };
}

export interface EvaluateProviderGateOptions {
  readonly plan: string | ProviderPlanV1_1;
  readonly evidence: readonly (string | ProviderEvidenceV1_1)[];
  readonly waivers?: readonly ProviderWaiver[];
  readonly fallbacks?: readonly ProviderFallbackRecord[];
  readonly policy?: ProviderGatePolicy;
  readonly signer?: ProviderArtifactSigner;
  readonly evidenceStore?: ProviderEvidenceStore;
  readonly gateStore?: ProviderGateStore;
  readonly now?: Date;
  readonly revokedEvidenceIds?: ReadonlySet<string>;
  readonly revokedCommitOids?: ReadonlySet<string>;
}

export interface EvaluateProviderGateResult {
  readonly decision: GateDecisionV1_1;
  readonly path: string;
  readonly diagnostics: readonly GateDiagnostic[];
}

function gateSigningPayload(decision: Omit<GateDecisionV1_1, "signature"> | GateDecisionV1_1): string {
  const { signature: _signature, ...unsigned } = decision as GateDecisionV1_1;
  void _signature;
  return canonicalProviderJson(unsigned as unknown as JsonValue);
}

export function gateDecisionDigest(decision: GateDecisionV1_1): Sha256Digest {
  return sha256ProviderDigest(decision);
}

/** Aggregate current accepted Evidence and sign an immutable Core GateDecision. */
export function evaluateProviderGate(project: string, options: EvaluateProviderGateOptions): EvaluateProviderGateResult {
  const projectRoot = realpathSync(resolve(project));
  const plan = typeof options.plan === "string" ? loadFrozenProviderPlan(projectRoot, options.plan) : options.plan;
  if (recomputePlanId(plan) !== plan.plan_id || recomputePlanDigest(plan) !== plan.plan_digest) fail("PROVIDER_PLAN_STALE", "Gate Plan identity or digest is invalid");
  const state = readProjectProviders(projectRoot, false);
  const currentRevision = readCurrentProviderSourceRevision(projectRoot);
  if (state.lock.lock_digest !== plan.project_lock_digest || !same(currentRevision, plan.source_revision)) fail("PROVIDER_PLAN_STALE", "Gate Plan does not bind the current lock and source revision");
  if (plan.approval?.status === "pending") fail("PROVIDER_PERMISSION_DENIED", "Gate cannot evaluate a pending Provider Plan");

  const now = options.now ?? new Date();
  const policy = options.policy ?? DEFAULT_PROVIDER_GATE_POLICY;
  const signer = options.signer ?? localProviderArtifactSigner(projectRoot, true);
  const evidenceStore = options.evidenceStore ?? new LocalProviderEvidenceStore(projectRoot);
  const diagnostics: GateDiagnostic[] = [];
  const assessments: ProviderEvidenceAssessment[] = [];
  for (const candidate of options.evidence) {
    const evidence = typeof candidate === "string" ? evidenceStore.get(candidate) : candidate;
    const assessment = assessProviderEvidence(evidence, signer, {
      plan: { plan_id: plan.plan_id, plan_digest: plan.plan_digest },
      projectLockDigest: plan.project_lock_digest,
      scope: plan.scope,
      sourceRevision: plan.source_revision,
      now,
      revokedEvidenceIds: options.revokedEvidenceIds,
      revokedCommitOids: options.revokedCommitOids,
    });
    if (assessments.some((entry) => entry.evidence.evidence_id === assessment.evidence.evidence_id)) fail("PROVIDER_EVIDENCE_REVOKED", `duplicate Evidence ${assessment.evidence.evidence_id}`);
    assessments.push(assessment);
  }

  const lockByInstance = new Map(state.lock.providers.map((entry) => [entry.instance_id, entry]));
  const byNode = new Map<string, ProviderEvidenceAssessment>();
  for (const assessment of assessments) {
    const node = plan.nodes.find((candidate) => candidate.node_id === assessment.evidence.plan.node_id);
    if (!node) fail("PROVIDER_EVIDENCE_STALE", `Evidence ${assessment.evidence.evidence_id} names a node outside Plan ${plan.plan_id}`);
    if (byNode.has(node.node_id)) fail("PROVIDER_EVIDENCE_REVOKED", `multiple Evidence envelopes claim Plan node ${node.node_id}`);
    byNode.set(node.node_id, assessment);
  }

  const evaluations: GateDecisionV1_1["rule_evaluations"][number][] = [];
  const validWaivers: ProviderWaiver[] = [];
  const satisfiedNodes = new Set<string>();
  let usedWaiver = false;
  for (const node of plan.nodes.filter((candidate) => candidate.state === "selected")) {
    const assessment = byNode.get(node.node_id);
    if (!assessment) continue;
    if (!acceptedAssessmentForNode(assessment, plan, node, lockByInstance, diagnostics)) continue;
    const lock = lockByInstance.get(node.provider_instance_id);
    const manifestWaivableRuleIds = new Set(lock
      ? readLockedProviderRulePolicies(projectRoot, lock).filter((rule) => rule.waivable).map((rule) => rule.id)
      : []);
    const rules = evaluateRules(assessment.evidence, options.waivers ?? [], policy, manifestWaivableRuleIds, now, diagnostics);
    evaluations.push(...rules.evaluations);
    for (const waiver of rules.validWaivers) if (!validWaivers.some((entry) => entry.waiver_id === waiver.waiver_id)) validWaivers.push(waiver);
    usedWaiver ||= rules.usedWaiver;
    if (rules.satisfies) satisfiedNodes.add(node.node_id);
  }

  const validFallbacks: ProviderFallbackRecord[] = [];
  for (const record of options.fallbacks ?? []) {
    const nodes = validFallback(record, plan, policy, diagnostics);
    if (!nodes) continue;
    if (!satisfiedNodes.has(nodes.to.node_id)) {
      diagnostic(diagnostics, "PROVIDER_GATE_EVIDENCE_MISSING", `Fallback target ${nodes.to.node_id} has no passing current Evidence`);
      continue;
    }
    validFallbacks.push(record);
    satisfiedNodes.add(nodes.from.node_id);
  }

  for (const node of plan.nodes.filter((candidate) => candidate.required)) {
    if (!satisfiedNodes.has(node.node_id)) diagnostic(diagnostics, "PROVIDER_GATE_EVIDENCE_MISSING", `Required Plan node ${node.node_id} has no passing accepted Evidence`);
    for (const dependency of node.dependencies) {
      if (!satisfiedNodes.has(dependency)) diagnostic(diagnostics, "PROVIDER_GATE_EVIDENCE_MISSING", `Required dependency ${dependency} of ${node.node_id} has no passing accepted Evidence`);
    }
  }
  const satisfiedCapabilities = new Set(plan.nodes.filter((node) => satisfiedNodes.has(node.node_id)).map((node) => node.capability_id));
  if (!expressionSatisfied(plan.capability_expression, satisfiedCapabilities)) diagnostic(diagnostics, "PROVIDER_GATE_EVIDENCE_MISSING", "Accepted Evidence does not satisfy the Plan capability expression");

  const passing = diagnostics.length === 0;
  const status = passing ? (usedWaiver ? "passed_with_waiver" as const : "passed" as const) : "blocked" as const;
  const evidenceRefs = assessments
    .map((assessment) => ({ evidence_id: assessment.evidence.evidence_id, digest: assessment.digest, state: assessment.state }))
    .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
  const issuedAt = now.toISOString();
  const core = {
    schema: PROVIDER_SCHEMA.gateDecision,
    status,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    project_lock_digest: plan.project_lock_digest,
    policy_digest: plan.policy_digest,
    scope: plan.scope,
    source_revision: plan.source_revision,
    evidence: evidenceRefs,
    rule_evaluations: [...evaluations].sort((left, right) => `${left.evidence_id}\0${left.rule_id}`.localeCompare(`${right.evidence_id}\0${right.rule_id}`)),
    fallbacks: validFallbacks,
    waivers: validWaivers,
    issued_at: issuedAt,
    issuer: "aidlc-core" as const,
    ...(diagnostics.length > 0 ? { extensions: { "io.loeyae": { diagnostics: diagnostics as unknown as JsonValue } } } : {}),
  };
  const decisionId = `gate-${sha256ProviderDigest(core).slice("sha256:".length, "sha256:".length + 32)}`;
  const unsigned: Omit<GateDecisionV1_1, "signature"> = { decision_id: decisionId, ...core };
  const decision: GateDecisionV1_1 = {
    ...unsigned,
    signature: { algorithm: signer.algorithm, key_id: signer.keyId, value: signer.sign(gateSigningPayload(unsigned)) },
  };
  const gateStore = options.gateStore ?? new LocalProviderGateStore(projectRoot);
  return { decision, path: gateStore.put(decision), diagnostics };
}

export function verifyGateDecisionSignature(decision: GateDecisionV1_1, signer: ProviderArtifactSigner): void {
  if (!signer.verify(gateSigningPayload(decision), decision.signature)) fail("PROVIDER_EVIDENCE_REVOKED", `GateDecision ${decision.decision_id} signature is invalid or not issued by this Core`);
}

function validateScope(value: unknown, label: string): void {
  if (!isRecord(value)) fail("PROVIDER_EVIDENCE_REVOKED", `${label} must be an object`);
  exact(value, ["project_id", "module_id", "unit_id", "stage"], label);
  text(value.stage, `${label}.stage`);
  for (const field of ["project_id", "module_id", "unit_id"] as const) if (value[field] !== undefined) text(value[field], `${label}.${field}`);
}

function validateSourceRevision(value: unknown, label: string): void {
  if (!isRecord(value)) fail("PROVIDER_EVIDENCE_REVOKED", `${label} must be an object`);
  exact(value, ["commit", "worktree_digest", "repos"], label);
  text(value.commit, `${label}.commit`);
  digest(value.worktree_digest, `${label}.worktree_digest`);
  if (value.repos !== undefined) {
    if (!isRecord(value.repos)) fail("PROVIDER_EVIDENCE_REVOKED", `${label}.repos must be an object`);
    for (const [key, candidate] of Object.entries(value.repos)) {
      text(key, `${label}.repos key`);
      if (!isRecord(candidate)) fail("PROVIDER_EVIDENCE_REVOKED", `${label}.repos.${key} must be an object`);
      exact(candidate, ["commit", "worktree_digest"], `${label}.repos.${key}`);
      text(candidate.commit, `${label}.repos.${key}.commit`);
      digest(candidate.worktree_digest, `${label}.repos.${key}.worktree_digest`);
    }
  }
}

/** Strict Gate parser; signature/current Evidence verification is intentionally separate. */
export function parseGateDecision(value: unknown): GateDecisionV1_1 {
  if (!isRecord(value)) fail("PROVIDER_EVIDENCE_REVOKED", "GateDecision must be an object");
  exact(value, ["schema", "decision_id", "status", "plan_id", "plan_digest", "project_lock_digest", "policy_digest", "scope", "source_revision", "evidence", "rule_evaluations", "fallbacks", "waivers", "issued_at", "issuer", "signature", "extensions"], "GateDecision");
  if (value.schema !== PROVIDER_SCHEMA.gateDecision) fail("PROVIDER_SCHEMA_INCOMPATIBLE", `GateDecision schema must be ${PROVIDER_SCHEMA.gateDecision}`);
  if (typeof value.decision_id !== "string" || !GATE_ID.test(value.decision_id)) fail("PROVIDER_EVIDENCE_REVOKED", "GateDecision decision_id is invalid");
  if (value.status !== "passed" && value.status !== "passed_with_waiver" && value.status !== "blocked") fail("PROVIDER_EVIDENCE_REVOKED", "GateDecision status is invalid");
  text(value.plan_id, "GateDecision plan_id");
  for (const field of ["plan_digest", "project_lock_digest", "policy_digest"] as const) digest(value[field], `GateDecision ${field}`);
  validateScope(value.scope, "GateDecision scope");
  validateSourceRevision(value.source_revision, "GateDecision source_revision");
  if (!Array.isArray(value.evidence)) fail("PROVIDER_EVIDENCE_REVOKED", "GateDecision evidence must be an array");
  value.evidence.forEach((candidate, index) => {
    if (!isRecord(candidate)) fail("PROVIDER_EVIDENCE_REVOKED", `GateDecision evidence[${index}] must be an object`);
    exact(candidate, ["evidence_id", "digest", "state"], `GateDecision evidence[${index}]`);
    text(candidate.evidence_id, `GateDecision evidence[${index}].evidence_id`);
    digest(candidate.digest, `GateDecision evidence[${index}].digest`);
    if (!(["accepted", "stale", "expired", "revoked"] as readonly unknown[]).includes(candidate.state)) fail("PROVIDER_EVIDENCE_REVOKED", `GateDecision evidence[${index}].state is invalid`);
  });
  if (!Array.isArray(value.rule_evaluations)) fail("PROVIDER_EVIDENCE_REVOKED", "GateDecision rule_evaluations must be an array");
  value.rule_evaluations.forEach((candidate, index) => {
    if (!isRecord(candidate)) fail("PROVIDER_EVIDENCE_REVOKED", `GateDecision rule_evaluations[${index}] must be an object`);
    exact(candidate, ["evidence_id", "rule_id", "original_status", "status", "waiver_id"], `GateDecision rule_evaluations[${index}]`);
    text(candidate.evidence_id, `GateDecision rule_evaluations[${index}].evidence_id`);
    text(candidate.rule_id, `GateDecision rule_evaluations[${index}].rule_id`);
    if (!(["passed", "failed", "not_applicable"] as readonly unknown[]).includes(candidate.original_status)) fail("PROVIDER_EVIDENCE_REVOKED", `GateDecision rule_evaluations[${index}].original_status is invalid`);
    if (!(["passed", "failed", "not_applicable", "waived"] as readonly unknown[]).includes(candidate.status)) fail("PROVIDER_EVIDENCE_REVOKED", `GateDecision rule_evaluations[${index}].status is invalid`);
    if (candidate.status === "waived") text(candidate.waiver_id, `GateDecision rule_evaluations[${index}].waiver_id`);
    else if (candidate.waiver_id !== undefined) fail("PROVIDER_EVIDENCE_REVOKED", `GateDecision rule_evaluations[${index}] has an unexpected waiver_id`);
  });
  if (!Array.isArray(value.fallbacks)) fail("PROVIDER_EVIDENCE_REVOKED", "GateDecision fallbacks must be an array");
  value.fallbacks.forEach((candidate) => validateFallbackShape(candidate as ProviderFallbackRecord));
  if (!Array.isArray(value.waivers)) fail("PROVIDER_EVIDENCE_REVOKED", "GateDecision waivers must be an array");
  value.waivers.forEach((candidate) => validateWaiverShape(candidate as ProviderWaiver));
  timestamp(value.issued_at, "GateDecision issued_at");
  if (value.issuer !== "aidlc-core") fail("PROVIDER_EVIDENCE_REVOKED", "GateDecision issuer must be aidlc-core");
  if (!isRecord(value.signature)) fail("PROVIDER_EVIDENCE_REVOKED", "GateDecision signature must be an object");
  exact(value.signature, ["algorithm", "key_id", "value"], "GateDecision signature");
  for (const field of ["algorithm", "key_id", "value"] as const) text(value.signature[field], `GateDecision signature.${field}`);
  validateExtensions(value.extensions, "GateDecision extensions");
  if (value.status === "passed" && value.rule_evaluations.some((entry) => isRecord(entry) && entry.status === "waived")) fail("PROVIDER_EVIDENCE_REVOKED", "GateDecision with waived rules must be passed_with_waiver");
  if (value.status === "passed_with_waiver" && !value.rule_evaluations.some((entry) => isRecord(entry) && entry.status === "waived")) fail("PROVIDER_EVIDENCE_REVOKED", "passed_with_waiver GateDecision must include a waived rule");
  return value as unknown as GateDecisionV1_1;
}

export interface ProviderGateStore {
  put(decision: GateDecisionV1_1): string;
  get(reference: string): GateDecisionV1_1;
}

export class LocalProviderGateStore implements ProviderGateStore {
  private readonly projectRoot: string;
  private readonly root: string;

  constructor(project: string) {
    this.projectRoot = realpathSync(resolve(project));
    this.root = resolve(this.projectRoot, PROVIDER_GATE_ROOT);
    const rel = relative(this.projectRoot, this.root);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("PROVIDER_PERMISSION_DENIED", "Provider Gate store escapes project root");
    const aidlc = resolve(this.projectRoot, ".aidlc");
    if (!existsSync(aidlc)) mkdirSync(aidlc, { mode: 0o700 });
    if (!lstatSync(aidlc).isDirectory() || lstatSync(aidlc).isSymbolicLink()) fail("PROVIDER_PERMISSION_DENIED", ".aidlc must be a regular directory");
    if (!existsSync(this.root)) mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (!lstatSync(this.root).isDirectory() || lstatSync(this.root).isSymbolicLink()) fail("PROVIDER_PERMISSION_DENIED", "Provider Gate store must be a regular directory");
  }

  put(decision: GateDecisionV1_1): string {
    const parsed = parseGateDecision(decision);
    const path = resolve(this.root, `${parsed.decision_id}.json`);
    const content = `${canonicalProviderJson(parsed as unknown as JsonValue)}\n`;
    if (existsSync(path)) {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || readFileSync(path, "utf8") !== content) fail("PROVIDER_EVIDENCE_REVOKED", `immutable GateDecision ${parsed.decision_id} already exists with different content`);
    } else atomicWrite(path, content);
    return relative(this.projectRoot, path).replace(/\\/g, "/");
  }

  get(reference: string): GateDecisionV1_1 {
    const normalized = reference.trim().replace(/\\/g, "/");
    const path = GATE_ID.test(normalized) ? resolve(this.root, `${normalized}.json`) : resolve(this.projectRoot, normalized);
    const rel = relative(this.root, path);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("PROVIDER_PERMISSION_DENIED", "GateDecision reference escapes the Core Gate store");
    if (!existsSync(path)) fail("PROVIDER_GATE_EVIDENCE_MISSING", `GateDecision does not exist: ${reference}`);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_GATE_BYTES) fail("PROVIDER_EVIDENCE_REVOKED", `GateDecision is not a small regular file: ${reference}`);
    let value: unknown;
    try { value = JSON.parse(readFileSync(path, "utf8")) as unknown; } catch { fail("PROVIDER_EVIDENCE_REVOKED", `GateDecision is invalid JSON: ${reference}`); }
    return parseGateDecision(value);
  }
}

export interface VerifyGateForReportOptions {
  readonly scope: ProviderScope;
  readonly sourceRevision?: ProviderSourceRevision;
  readonly resolutionPolicy?: ProviderResolutionPolicy;
  readonly signer?: ProviderArtifactSigner;
  readonly evidenceStore?: ProviderEvidenceStore;
  readonly gateStore?: ProviderGateStore;
  readonly now?: Date;
  /** Migration-only: verify a current signed blocked decision for shadow reconciliation; never authorizes Provider-enforced report. */
  readonly allowBlockedForShadow?: boolean;
}

/** Re-verify the signed decision, current Plan/lock/profile/policy/revision and every referenced Evidence at report time. */
export function verifyGateDecisionForReport(project: string, reference: string, options: VerifyGateForReportOptions): GateDecisionV1_1 {
  const projectRoot = realpathSync(resolve(project));
  const signer = options.signer ?? localProviderArtifactSigner(projectRoot, false);
  const gateStore = options.gateStore ?? new LocalProviderGateStore(projectRoot);
  const decision = gateStore.get(reference);
  verifyGateDecisionSignature(decision, signer);
  if (decision.status === "blocked" && options.allowBlockedForShadow !== true) fail("PROVIDER_GATE_EVIDENCE_MISSING", `GateDecision ${decision.decision_id} is blocked`);
  if (!same(decision.scope, options.scope)) fail("PROVIDER_PLAN_STALE", "GateDecision scope does not match the reported stage/module/unit");
  const sourceRevision = options.sourceRevision ?? readCurrentProviderSourceRevision(projectRoot);
  if (!same(decision.source_revision, sourceRevision)) fail("PROVIDER_PLAN_STALE", "GateDecision source revision is stale");
  const state = readProjectProviders(projectRoot, false);
  if (decision.project_lock_digest !== state.lock.lock_digest) fail("PROVIDER_PLAN_STALE", "GateDecision project lock is stale");
  const plan = loadFrozenProviderPlan(projectRoot, decision.plan_id);
  if (plan.plan_digest !== decision.plan_digest || plan.project_lock_digest !== decision.project_lock_digest || plan.policy_digest !== decision.policy_digest || !same(plan.scope, decision.scope) || !same(plan.source_revision, decision.source_revision)) {
    fail("PROVIDER_PLAN_STALE", "GateDecision does not bind its immutable Provider Plan exactly");
  }

  const resolutionPolicy = options.resolutionPolicy ?? defaultResolutionPolicy({ policy_id: `aidlc.orchestrate-stage/${options.scope.stage}` });
  const currentPlan = resolveProjectProviderPlan(projectRoot, {
    scope: plan.scope,
    source_revision: sourceRevision,
    policy: resolutionPolicy,
    capability_expression: plan.capability_expression,
    ...(plan.approval?.approval_ref ? { approval_ref: plan.approval.approval_ref } : {}),
  }).plan;
  if (currentPlan.plan_id !== plan.plan_id || currentPlan.plan_digest !== plan.plan_digest) fail("PROVIDER_PLAN_STALE", "Provider Plan Profile, policy, lock, bindings or approval changed before report");

  const evidenceStore = options.evidenceStore ?? new LocalProviderEvidenceStore(projectRoot);
  for (const referenceEntry of decision.evidence) {
    if (referenceEntry.state !== "accepted") fail("PROVIDER_GATE_EVIDENCE_MISSING", `GateDecision references non-accepted Evidence ${referenceEntry.evidence_id}`);
    const evidence = evidenceStore.get(referenceEntry.evidence_id);
    const assessment = assessProviderEvidence(evidence, signer, {
      plan: { plan_id: plan.plan_id, plan_digest: plan.plan_digest },
      projectLockDigest: plan.project_lock_digest,
      scope: plan.scope,
      sourceRevision,
      now: options.now,
    });
    if (assessment.state !== "accepted" || providerEvidenceDigest(evidence) !== referenceEntry.digest) fail(assessment.diagnostic ?? "PROVIDER_EVIDENCE_STALE", `GateDecision Evidence ${referenceEntry.evidence_id} is no longer valid`);
  }
  const requiredNodes = plan.nodes.filter((node) => node.required);
  if (requiredNodes.length > 0 && decision.evidence.length === 0) fail("PROVIDER_GATE_EVIDENCE_MISSING", "GateDecision has no Evidence for required Plan nodes");
  return decision;
}
