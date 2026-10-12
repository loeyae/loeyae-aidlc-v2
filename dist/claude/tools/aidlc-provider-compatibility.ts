import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { evidenceRelativePath, stageInstanceId } from "./aidlc-execution-context.js";
import { evidenceSourceRevision } from "./aidlc-workflow-layout.js";
import {
  appendProviderLifecycleAudit,
  canonicalProviderJson,
  readProjectProviders,
} from "./aidlc-project-provider.js";
import { verifyLockedProviderCache } from "./aidlc-provider-git.js";
import { loadFrozenProviderPlan } from "./aidlc-provider-runner.js";
import {
  LocalProviderEvidenceStore,
  providerEvidenceDigest,
} from "./aidlc-provider-evidence.js";
import type {
  GateDecisionV1_1,
  JsonValue,
  ProviderEvidenceV1_1,
  ProviderResultCheck,
  ProviderScope,
} from "./aidlc-provider-types.js";

export const LOEYAE_COMPATIBILITY_CONFIG_PATH = ".aidlc/provider-compatibility.json";
export const LOEYAE_RECONCILIATION_ROOT = ".aidlc/provider-reconciliation/loeyae-compliance";
export const LOEYAE_COMPATIBILITY_STAGE = "loeyae-compliance";
export const IMPLEMENTATION_VALIDATION_CAPABILITY = "implementation-validation";
export const LOEYAE_BOOT_PROVIDER_ID = "framework.java-loeyae-boot";

export type LoeyaeCompatibilityMode = "legacy" | "shadow" | "enforce";

export interface LoeyaeCompatibilitySettings {
  readonly version: 1;
  readonly mode: LoeyaeCompatibilityMode;
  readonly provider_instance_id: string;
  readonly capability_id: typeof IMPLEMENTATION_VALIDATION_CAPABILITY;
}

export interface LoeyaeCompatibilityStatus extends LoeyaeCompatibilitySettings {
  readonly config_path: typeof LOEYAE_COMPATIBILITY_CONFIG_PATH;
  readonly configured: boolean;
  readonly authoritative: "legacy-framework-compliance" | "provider-gate";
  readonly provider_ready: boolean;
  readonly diagnostic?: string;
}

interface LegacyFrameworkCompliance {
  readonly status: "passed" | "failed";
  readonly skills_loaded: boolean;
  readonly checks_total: number;
  readonly checks_failed: number;
  readonly timestamp: string;
  readonly source_revision?: { readonly commit?: string };
}

export interface LoeyaeRuleDiagnostic {
  readonly rule_id: string;
  readonly status: ProviderResultCheck["status"];
  readonly severity: ProviderResultCheck["severity"];
  readonly message: string;
  readonly locations: readonly { readonly path: string; readonly line?: number; readonly column?: number }[];
}

export interface LoeyaeReconciliationDifference {
  readonly code: "LEGACY_NOT_READY" | "STATUS_MISMATCH" | "CHECK_TOTAL_MISMATCH" | "CHECK_FAILED_MISMATCH" | "SOURCE_REVISION_MISMATCH" | "PROVIDER_NO_APPLICABLE_RULES";
  readonly message: string;
  readonly legacy?: number | string | boolean;
  readonly provider?: number | string | boolean;
}

export interface LoeyaeReconciliationResult {
  readonly schema: "loeyae.provider-reconciliation/v1";
  readonly mode: LoeyaeCompatibilityMode;
  readonly authoritative: "legacy-framework-compliance" | "provider-gate";
  readonly context: {
    readonly invocationId: string;
    readonly gateDecisionId: string;
    readonly scope: ProviderScope;
    readonly sourceRevision: string;
    readonly providerCommit: string;
    readonly providerEvidenceId: string;
  };
  readonly status: "matched" | "mismatch";
  readonly legacy: { readonly status: string; readonly checks_total: number; readonly checks_failed: number; readonly evidence_path: string };
  readonly provider: { readonly status: string; readonly checks_total: number; readonly applicable: number; readonly failed: number; readonly evidence_path: string };
  readonly differences: readonly LoeyaeReconciliationDifference[];
  readonly rule_diagnostics: readonly LoeyaeRuleDiagnostic[];
  readonly diagnostics: readonly { readonly code: "RECONCILIATION_MATCH" | "RECONCILIATION_MISMATCH"; readonly message: string }[];
  readonly rollback: {
    readonly action: "retain-legacy" | "no-action";
    readonly preserveProviderResult: true;
    readonly preserveLegacyEvidence: true;
    readonly requiresNewProviderInvocation: true;
  };
  readonly generated_at: string;
}

export interface WrittenLoeyaeReconciliation {
  readonly result: LoeyaeReconciliationResult;
  readonly path: string;
  readonly markdown_path: string;
}

const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_LEGACY_EVIDENCE_BYTES = 512 * 1024;
const DEFAULT_SETTINGS: LoeyaeCompatibilitySettings = {
  version: 1,
  mode: "legacy",
  provider_instance_id: "loeyae-boot",
  capability_id: IMPLEMENTATION_VALIDATION_CAPABILITY,
};

function projectRoot(project: string): string {
  const candidate = resolve(project);
  if (!existsSync(candidate) || !lstatSync(candidate).isDirectory()) throw new Error(`project root does not exist: ${candidate}`);
  return realpathSync(candidate);
}

function safeProjectPath(root: string, relativePath: string): string {
  const target = resolve(root, ...relativePath.replace(/\\/g, "/").split("/"));
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`Provider compatibility path escapes project root: ${relativePath}`);
  return target;
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function parseSettings(value: unknown): LoeyaeCompatibilitySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${LOEYAE_COMPATIBILITY_CONFIG_PATH} must contain an object`);
  const record = value as Record<string, unknown>;
  const allowed = new Set(["version", "mode", "provider_instance_id", "capability_id"]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`${LOEYAE_COMPATIBILITY_CONFIG_PATH} has unknown field ${key}`);
  if (record.version !== 1) throw new Error(`${LOEYAE_COMPATIBILITY_CONFIG_PATH} version must be 1`);
  if (record.mode !== "legacy" && record.mode !== "shadow" && record.mode !== "enforce") throw new Error(`${LOEYAE_COMPATIBILITY_CONFIG_PATH} mode must be legacy, shadow, or enforce`);
  if (typeof record.provider_instance_id !== "string" || !IDENTIFIER.test(record.provider_instance_id)) throw new Error(`${LOEYAE_COMPATIBILITY_CONFIG_PATH} provider_instance_id is invalid`);
  if (record.capability_id !== IMPLEMENTATION_VALIDATION_CAPABILITY) throw new Error(`${LOEYAE_COMPATIBILITY_CONFIG_PATH} capability_id must be ${IMPLEMENTATION_VALIDATION_CAPABILITY}`);
  return record as unknown as LoeyaeCompatibilitySettings;
}

export function readLoeyaeCompatibilitySettings(project: string): LoeyaeCompatibilitySettings {
  const root = projectRoot(project);
  const path = safeProjectPath(root, LOEYAE_COMPATIBILITY_CONFIG_PATH);
  if (!existsSync(path)) return DEFAULT_SETTINGS;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG_BYTES) throw new Error(`${LOEYAE_COMPATIBILITY_CONFIG_PATH} must be a small regular non-symlink file`);
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")) as unknown; } catch (error) { throw new Error(`${LOEYAE_COMPATIBILITY_CONFIG_PATH} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  return parseSettings(value);
}

function providerReadiness(project: string, settings: LoeyaeCompatibilitySettings): { ready: boolean; diagnostic?: string } {
  if (settings.mode === "legacy") return { ready: true };
  try {
    const state = readProjectProviders(project, false);
    const intent = state.config.providers.find((candidate) => candidate.instance_id === settings.provider_instance_id);
    const lock = state.lock.providers.find((candidate) => candidate.instance_id === settings.provider_instance_id);
    if (!intent || !lock) return { ready: false, diagnostic: `Provider instance ${settings.provider_instance_id} is not installed` };
    if (!intent.enabled) return { ready: false, diagnostic: `Provider instance ${settings.provider_instance_id} is disabled` };
    if (intent.id !== LOEYAE_BOOT_PROVIDER_ID || lock.id !== LOEYAE_BOOT_PROVIDER_ID) return { ready: false, diagnostic: `Provider instance ${settings.provider_instance_id} must be ${LOEYAE_BOOT_PROVIDER_ID}` };
    const manifest = verifyLockedProviderCache(project, lock).manifest;
    if (!manifest.capabilities.includes(settings.capability_id)) return { ready: false, diagnostic: `locked Provider does not declare ${settings.capability_id}` };
    const bound = intent.bindings.some((binding) => binding.capabilities.includes(settings.capability_id)
      && (binding.stages.includes("*") || binding.stages.includes(LOEYAE_COMPATIBILITY_STAGE)));
    if (!bound) return { ready: false, diagnostic: `Provider binding must cover ${LOEYAE_COMPATIBILITY_STAGE}/${settings.capability_id}` };
    return { ready: true };
  } catch (error) {
    return { ready: false, diagnostic: error instanceof Error ? error.message : String(error) };
  }
}

export function getLoeyaeCompatibilityStatus(project: string): LoeyaeCompatibilityStatus {
  const root = projectRoot(project);
  const path = safeProjectPath(root, LOEYAE_COMPATIBILITY_CONFIG_PATH);
  const settings = readLoeyaeCompatibilitySettings(root);
  const readiness = providerReadiness(root, settings);
  return {
    ...settings,
    config_path: LOEYAE_COMPATIBILITY_CONFIG_PATH,
    configured: existsSync(path),
    authoritative: settings.mode === "enforce" ? "provider-gate" : "legacy-framework-compliance",
    provider_ready: readiness.ready,
    ...(readiness.diagnostic ? { diagnostic: readiness.diagnostic } : {}),
  };
}

export function setLoeyaeCompatibilityMode(project: string, mode: LoeyaeCompatibilityMode, instance?: string): LoeyaeCompatibilityStatus {
  const root = projectRoot(project);
  if (mode !== "legacy" && mode !== "shadow" && mode !== "enforce") throw new Error("--mode must be legacy, shadow, or enforce");
  const previous = readLoeyaeCompatibilitySettings(root);
  const next: LoeyaeCompatibilitySettings = {
    version: 1,
    mode,
    provider_instance_id: instance || previous.provider_instance_id,
    capability_id: IMPLEMENTATION_VALIDATION_CAPABILITY,
  };
  parseSettings(next);
  const readiness = providerReadiness(root, next);
  if (!readiness.ready) throw new Error(`Cannot enable Loeyae compatibility mode ${mode}: ${readiness.diagnostic}`);
  const path = safeProjectPath(root, LOEYAE_COMPATIBILITY_CONFIG_PATH);
  atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`);
  appendProviderLifecycleAudit(root, "LOEYAE_COMPLIANCE_MODE_SET", {
    "Previous Mode": previous.mode,
    Mode: next.mode,
    "Provider Instance": next.provider_instance_id,
    Capability: next.capability_id,
    "Rollback Preserves Evidence": true,
  });
  return getLoeyaeCompatibilityStatus(root);
}

export function loeyaeCompatibilityPolicyId(project: string, stage: string): string {
  if (stage !== LOEYAE_COMPATIBILITY_STAGE) return `aidlc.orchestrate-stage/${stage}`;
  return `aidlc.orchestrate-stage/${stage}/${readLoeyaeCompatibilitySettings(project).mode}`;
}

function legacyEvidencePath(root: string, scope: ProviderScope): { relative: string; absolute: string; instanceId: string } {
  if (!scope.module_id || !scope.unit_id) throw new Error("Loeyae compatibility requires module_id and unit_id scope");
  const relativePath = evidenceRelativePath(LOEYAE_COMPATIBILITY_STAGE, "framework-compliance", "unit", {
    module_id: scope.module_id,
    unit_id: scope.unit_id,
  }).replace(/\\/g, "/");
  return {
    relative: relativePath,
    absolute: safeProjectPath(root, relativePath),
    instanceId: stageInstanceId(LOEYAE_COMPATIBILITY_STAGE, "unit", { module_id: scope.module_id, unit_id: scope.unit_id }),
  };
}

function providerEvidenceForDecision(
  root: string,
  decision: GateDecisionV1_1,
  settings: LoeyaeCompatibilitySettings,
): { evidence: ProviderEvidenceV1_1; path: string } {
  const plan = loadFrozenProviderPlan(root, decision.plan_id);
  const nodes = new Map(plan.nodes.map((node) => [node.node_id, node]));
  const store = new LocalProviderEvidenceStore(root);
  const matches = decision.evidence.flatMap((entry) => {
    const evidence = store.get(entry.evidence_id);
    const node = nodes.get(evidence.plan.node_id);
    return evidence.provider_instance.instance_id === settings.provider_instance_id && node?.capability_id === settings.capability_id
      ? [{ evidence, path: `.aidlc/evidence/providers/${evidence.evidence_id}.json` }]
      : [];
  });
  if (matches.length !== 1) throw new Error(`GateDecision must reference exactly one ${settings.provider_instance_id}/${settings.capability_id} Evidence; found ${matches.length}`);
  return matches[0];
}

function providerCounts(evidence: ProviderEvidenceV1_1): { total: number; applicable: number; failed: number } {
  return {
    total: evidence.checks.length,
    applicable: evidence.checks.filter((check) => check.status !== "not_applicable").length,
    failed: evidence.checks.filter((check) => check.status === "failed").length,
  };
}

function legacyEvidence(root: string, scope: ProviderScope): { value: LegacyFrameworkCompliance; path: string } {
  const path = legacyEvidencePath(root, scope);
  if (!existsSync(path.absolute)) throw new Error(`legacy framework-compliance Evidence is missing: ${path.relative}`);
  const stat = lstatSync(path.absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_LEGACY_EVIDENCE_BYTES) throw new Error(`legacy framework-compliance Evidence must be a small regular non-symlink file: ${path.relative}`);
  let value: unknown;
  try { value = JSON.parse(readFileSync(path.absolute, "utf8")) as unknown; } catch (error) { throw new Error(`legacy framework-compliance Evidence is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("legacy framework-compliance Evidence must be an object");
  const record = value as Record<string, unknown>;
  return {
    value: {
      status: record.status === "failed" ? "failed" : "passed",
      skills_loaded: record.skills_loaded === true,
      checks_total: typeof record.checks_total === "number" ? record.checks_total : -1,
      checks_failed: typeof record.checks_failed === "number" ? record.checks_failed : -1,
      timestamp: typeof record.timestamp === "string" ? record.timestamp : "",
      source_revision: record.source_revision && typeof record.source_revision === "object" && !Array.isArray(record.source_revision)
        ? { commit: typeof (record.source_revision as Record<string, unknown>).commit === "string" ? String((record.source_revision as Record<string, unknown>).commit) : undefined }
        : undefined,
    },
    path: path.relative,
  };
}

/**
 * In enforce mode a new workflow may have no legacy Evidence. Project a compatibility
 * envelope from the current accepted Provider Evidence without overwriting an existing
 * legacy record. Existing records remain independent inputs to reconciliation.
 */
export function projectProviderEvidenceToLegacy(
  project: string,
  decision: GateDecisionV1_1,
): { created: boolean; path?: string; error?: string } {
  const root = projectRoot(project);
  const settings = readLoeyaeCompatibilitySettings(root);
  if (settings.mode !== "enforce") return { created: false };
  try {
    const legacy = legacyEvidencePath(root, decision.scope);
    if (existsSync(legacy.absolute)) return { created: false, path: legacy.relative };
    const provider = providerEvidenceForDecision(root, decision, settings);
    const counts = providerCounts(provider.evidence);
    if (provider.evidence.invocation.result_status !== "passed" || counts.failed !== 0 || counts.applicable < 1) {
      return { created: false, error: "Provider compatibility projection requires a passing Result with at least one applicable rule" };
    }
    const digest = providerEvidenceDigest(provider.evidence);
    const value = {
      status: "passed",
      skills_loaded: true,
      checks_total: counts.applicable,
      checks_failed: 0,
      compatibility_adapter: {
        mode: settings.mode,
        provider_evidence_id: provider.evidence.evidence_id,
        provider_evidence_digest: digest,
        provider_instance_id: settings.provider_instance_id,
        capability_id: settings.capability_id,
      },
      stage_instance: legacy.instanceId,
      module_id: decision.scope.module_id,
      unit_id: decision.scope.unit_id,
      evidence_version: "1",
      timestamp: decision.issued_at,
      producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: randomUUID() },
      source_revision: evidenceSourceRevision(root, legacy.instanceId),
      checker: {
        id: "builtin:framework-compliance",
        sensor: "framework-compliance",
        argv_digest: createHash("sha256").update(JSON.stringify(["provider-compatibility-projection", provider.evidence.evidence_id, digest])).digest("hex"),
        exit_code: 0,
        status: "passed",
      },
    };
    atomicWrite(legacy.absolute, `${JSON.stringify(value, null, 2)}\n`);
    return { created: true, path: legacy.relative };
  } catch (error) {
    return { created: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function ruleDiagnostics(evidence: ProviderEvidenceV1_1, includeAll: boolean): LoeyaeRuleDiagnostic[] {
  return evidence.checks
    .filter((check) => includeAll ? check.status !== "not_applicable" : check.status === "failed")
    .map((check) => ({
      rule_id: check.rule_id,
      status: check.status,
      severity: check.severity,
      message: check.message,
      locations: (check.locations ?? []).map((location) => ({ ...location })),
    }))
    .sort((left, right) => left.rule_id.localeCompare(right.rule_id));
}

function markdownReport(result: LoeyaeReconciliationResult): string {
  const lines = [
    "# Loeyae compliance Provider 双写对账",
    "",
    `- Mode: \`${result.mode}\``,
    `- Authoritative: \`${result.authoritative}\``,
    `- Status: **${result.status}**`,
    `- GateDecision: \`${result.context.gateDecisionId}\``,
    `- Provider Evidence: \`${result.context.providerEvidenceId}\``,
    `- Source revision: \`${result.context.sourceRevision}\``,
    "",
    "## 汇总差异",
    "",
  ];
  if (result.differences.length === 0) lines.push("- 无差异。", "");
  else {
    for (const difference of result.differences) lines.push(`- \`${difference.code}\`: ${difference.message}`);
    lines.push("");
  }
  lines.push("## Rule / 路径诊断", "", "| Rule ID | Status | Severity | Paths | Message |", "|---|---|---|---|---|");
  if (result.rule_diagnostics.length === 0) lines.push("| — | — | — | — | 无适用规则或无规则级结果 |", "");
  else {
    for (const rule of result.rule_diagnostics) {
      const paths = rule.locations.map((location) => `${location.path}${location.line ? `:${location.line}` : ""}`).join(", ") || "—";
      lines.push(`| \`${rule.rule_id}\` | ${rule.status} | ${rule.severity} | ${paths.replaceAll("|", "\\|")} | ${rule.message.replaceAll("|", "\\|")} |`);
    }
    lines.push("");
  }
  lines.push("## 回滚", "", `- Action: \`${result.rollback.action}\``, "- 旧 Evidence、Provider Evidence/Result 与本对账报告均只读保留；修复后必须新建 invocation。", "");
  return `${lines.join("\n")}\n`;
}

export function reconcileLoeyaeCompliance(
  project: string,
  decision: GateDecisionV1_1,
): WrittenLoeyaeReconciliation {
  const root = projectRoot(project);
  const settings = readLoeyaeCompatibilitySettings(root);
  if (settings.mode === "legacy") throw new Error("legacy mode does not run Provider reconciliation");
  const provider = providerEvidenceForDecision(root, decision, settings);
  const old = legacyEvidence(root, decision.scope);
  const counts = providerCounts(provider.evidence);
  const differences: LoeyaeReconciliationDifference[] = [];
  if (!old.value.skills_loaded || !Number.isFinite(Date.parse(old.value.timestamp)) || old.value.checks_total < 0 || old.value.checks_failed < 0) {
    differences.push({ code: "LEGACY_NOT_READY", message: "旧 framework-compliance 结果缺少可审计的 Skill 加载、计数或时间戳", legacy: old.value.skills_loaded });
  }
  const providerStatus = counts.failed === 0 && provider.evidence.invocation.result_status === "passed" ? "passed" : "failed";
  if (old.value.status !== providerStatus) differences.push({ code: "STATUS_MISMATCH", message: "旧汇总状态与 Provider 规则级状态不一致", legacy: old.value.status, provider: providerStatus });
  if (old.value.checks_total !== counts.applicable) differences.push({ code: "CHECK_TOTAL_MISMATCH", message: "旧 checks_total 与 Provider applicable 规则数不一致", legacy: old.value.checks_total, provider: counts.applicable });
  if (old.value.checks_failed !== counts.failed) differences.push({ code: "CHECK_FAILED_MISMATCH", message: "旧 checks_failed 与 Provider failed 规则数不一致", legacy: old.value.checks_failed, provider: counts.failed });
  if (old.value.source_revision?.commit !== provider.evidence.source_revision.commit) differences.push({ code: "SOURCE_REVISION_MISMATCH", message: "旧结果与 Provider Evidence 未绑定同一 source revision", legacy: old.value.source_revision?.commit || "missing", provider: provider.evidence.source_revision.commit });
  if (counts.applicable < 1) differences.push({ code: "PROVIDER_NO_APPLICABLE_RULES", message: "已识别 Loeyae Boot 变更，但 Provider 没有执行任何适用规则", provider: 0 });
  const status = differences.length === 0 ? "matched" as const : "mismatch" as const;
  const rules = ruleDiagnostics(provider.evidence, status === "mismatch");
  const result: LoeyaeReconciliationResult = {
    schema: "loeyae.provider-reconciliation/v1",
    mode: settings.mode,
    authoritative: settings.mode === "enforce" ? "provider-gate" : "legacy-framework-compliance",
    context: {
      invocationId: provider.evidence.invocation.invocation_id,
      gateDecisionId: decision.decision_id,
      scope: decision.scope,
      sourceRevision: provider.evidence.source_revision.commit,
      providerCommit: provider.evidence.provider_instance.commit_oid,
      providerEvidenceId: provider.evidence.evidence_id,
    },
    status,
    legacy: { status: old.value.status, checks_total: old.value.checks_total, checks_failed: old.value.checks_failed, evidence_path: old.path },
    provider: { status: provider.evidence.invocation.result_status, checks_total: counts.total, applicable: counts.applicable, failed: counts.failed, evidence_path: provider.path },
    differences,
    rule_diagnostics: rules,
    diagnostics: [{
      code: status === "matched" ? "RECONCILIATION_MATCH" : "RECONCILIATION_MISMATCH",
      message: status === "matched" ? "旧规则汇总与 Provider 规则级结果一致" : `${differences.length} 项差异已保留 Rule/路径级诊断`,
    }],
    rollback: {
      action: status === "matched" ? "no-action" : "retain-legacy",
      preserveProviderResult: true,
      preserveLegacyEvidence: true,
      requiresNewProviderInvocation: true,
    },
    generated_at: decision.issued_at,
  };
  const scopeParts = [decision.scope.module_id || "project", decision.scope.unit_id || "project"];
  const base = `${LOEYAE_RECONCILIATION_ROOT}/${scopeParts.join("/")}/${decision.decision_id}`;
  const jsonPath = `${base}.json`;
  const markdownPath = `${base}.md`;
  const jsonAbsolute = safeProjectPath(root, jsonPath);
  const markdownAbsolute = safeProjectPath(root, markdownPath);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const markdown = markdownReport(result);
  let created = false;
  for (const [path, content] of [[jsonAbsolute, json], [markdownAbsolute, markdown]] as const) {
    if (existsSync(path)) {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || readFileSync(path, "utf8") !== content) throw new Error(`immutable reconciliation artifact already differs: ${relative(root, path).replace(/\\/g, "/")}`);
    } else {
      atomicWrite(path, content);
      created = true;
    }
  }
  if (created) {
    appendProviderLifecycleAudit(root, "LOEYAE_COMPLIANCE_RECONCILED", {
      Mode: settings.mode,
      Status: result.status,
      "Provider Instance": settings.provider_instance_id,
      "Provider Evidence": result.context.providerEvidenceId,
      GateDecision: result.context.gateDecisionId,
      "JSON Report": jsonPath,
      "Rule Diagnostics": result.rule_diagnostics.length,
      "Rollback Action": result.rollback.action,
    });
  }
  return { result, path: jsonPath, markdown_path: markdownPath };
}

export function canonicalLoeyaeCompatibilitySettings(settings: LoeyaeCompatibilitySettings): string {
  return canonicalProviderJson(settings as unknown as JsonValue);
}
