/**
 * Read-only evidence reuse and validation scheduling for MARS-161 Phase 5.
 *
 * This is deliberately a plan, not an evidence authority.  It never marks a
 * stage complete, writes evidence, or changes the gate implementation.  A
 * later report still invokes the engine's normal sensor checks.
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { ExecutionProfile } from "./aidlc-execution-profile";
import { evidenceRelativePath, type ExecutionAxis } from "./aidlc-execution-context";
import { commitAncestryErrors, type SourceRevision } from "./aidlc-revision";
import type { RuleLoadPlan } from "./aidlc-rule-load-plan";
import { buildRuleLoadPlan } from "./aidlc-rule-load-plan";
import type { StageGraph, StageNode } from "./aidlc-orchestrate";

export type EvidencePlanProfileProvenance =
  | "persisted_execution_profile"
  | "legacy_standard_default";

export type EvidenceReuseDisposition = "reuse" | "verify" | "revalidate";

export type EvidenceReuseReason =
  | "valid_reusable_evidence"
  | "mandatory_gate_verification"
  | "mandatory_refresh"
  | "missing_evidence"
  | "invalid_evidence"
  | "stale_evidence"
  | "future_evidence"
  | "incompatible_scope"
  | "target_not_available";

export interface EvidenceMetadata {
  readonly path: string;
  readonly timestamp: string;
  readonly source_scope: string;
  readonly producer: "controlled";
}

export interface EvidenceValidationPlanEntry {
  readonly stage_slug: string;
  readonly sensor: string;
  /** Evidence belongs to a selected gate and must be verified before passing it. */
  readonly mandatory: boolean;
  /** Fresh evidence is required for transition-sensitive sensor kinds. */
  readonly mandatory_refresh: boolean;
  readonly disposition: EvidenceReuseDisposition;
  readonly reason: EvidenceReuseReason;
  readonly evidence?: EvidenceMetadata;
}

export interface EvidenceReusePlan {
  readonly version: "1";
  readonly strategy: "read_only_evidence_reuse_and_validation_schedule";
  readonly scope: string;
  readonly evidence_scope: string;
  readonly profile: {
    readonly level: ExecutionProfile["level"];
    readonly provenance: EvidencePlanProfileProvenance;
  };
  /** Phase-4 selected stage rules from which this plan was derived. */
  readonly selected_rule_stages: readonly string[];
  readonly entries: readonly EvidenceValidationPlanEntry[];
  readonly reuse: readonly EvidenceValidationPlanEntry[];
  readonly verify: readonly EvidenceValidationPlanEntry[];
  readonly revalidate: readonly EvidenceValidationPlanEntry[];
}

export interface BuildEvidenceReusePlanInput {
  readonly projectRoot: string;
  readonly scope: string;
  readonly selectedOptionalStages?: readonly string[];
  readonly executionProfile?: ExecutionProfile;
  /** A run-stage hand-off supplies its instance-owned evidence scope. */
  readonly evidenceScope?: string;
  /** Exact hand-off instance. Without one this is schedule-only: no evidence is reusable. */
  readonly target?: { readonly stage_slug: string; readonly instance_id: string; readonly axis: ExecutionAxis; readonly module_id?: string; readonly unit_id?: string };
  /** Current provenance of target, calculated by the engine at dispatch time. */
  readonly expectedSourceRevision?: SourceRevision;
  /** Injected for deterministic tests and reproducible plan rendering. */
  readonly now: string;
  /** Reuse the already-computed Phase-4 plan when one exists. */
  readonly ruleLoadPlan?: RuleLoadPlan;
}

const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

// These evidence types encode a transition observation.  Reusing them for a
// later transition is unsafe even when the file itself is fresh.
const MANDATORY_REFRESH_SENSORS = new Set<string>([
  "red-test-evidence",
  "green-test-evidence",
  "baseline-test-evidence",
  "build-test-evidence",
]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relativePortable(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

function profileForPlan(profile: ExecutionProfile | undefined): EvidenceReusePlan["profile"] {
  return profile === undefined
    ? { level: "standard", provenance: "legacy_standard_default" }
    : { level: profile.level, provenance: "persisted_execution_profile" };
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day && hour < 24 && minute < 60 && second < 60 && Number.isFinite(Date.parse(value));
}

interface CandidateResult {
  readonly metadata?: EvidenceMetadata;
  readonly failure?: Exclude<EvidenceReuseReason, "mandatory_refresh" | "mandatory_gate_verification" | "valid_reusable_evidence">;
}

function candidateForSensor(
  projectRoot: string,
  stage: StageNode,
  sensor: string,
  evidenceScope: string,
  nowMs: number,
  target: BuildEvidenceReusePlanInput["target"],
  expected: SourceRevision | undefined,
): CandidateResult {
  if (!target || target.stage_slug !== stage.slug || !expected) return { failure: "target_not_available" };
  const label = evidenceRelativePath(stage.slug, sensor, target.axis, target);
  const path = resolve(projectRoot, label);
  const root = realpathSync(projectRoot);
  if (!path.startsWith(`${root}${sep}`) || !existsSync(path)) return { failure: "missing_evidence" };
  try {
      // Exact path only: never scan another module/unit's evidence. Reject
      // symlinks and every symlinked ancestor before parsing untrusted JSON.
      let cursor = path;
      while (cursor.startsWith(root)) { if (lstatSync(cursor).isSymbolicLink()) return { failure: "invalid_evidence" }; if (cursor === root) break; cursor = resolve(cursor, ".."); }
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isRecord(value) || value.evidence_version !== "1" || !isIsoDate(value.timestamp)) {
        return { failure: "invalid_evidence" };
      }
      const producer = isRecord(value.producer) ? value.producer : undefined;
      const sourceRevision = isRecord(value.source_revision) ? value.source_revision : undefined;
      if (producer?.name !== "loeyae-aidlc-evidence" || producer.mode !== "controlled" || typeof producer.execution_id !== "string" || producer.execution_id.length === 0 || sourceRevision === undefined) return { failure: "invalid_evidence" };
      if (value.stage_instance !== target.instance_id || value.module_id !== (target.module_id ?? null) || value.unit_id !== (target.unit_id ?? null)) return { failure: "invalid_evidence" };
      const sourceScope = typeof sourceRevision.scope === "string" ? sourceRevision.scope : "worktree";
      if (sourceScope !== evidenceScope) return { failure: "incompatible_scope" };
      if (!/^[a-f0-9]{64}$/.test(String(sourceRevision.worktree_digest))) return { failure: "invalid_evidence" };
      if (sourceScope === "worktree") {
        for (const key of ["commit", "dirty", "worktree_digest", "scope", "scope_digest"] as const) if (sourceRevision[key] !== expected[key]) return { failure: "invalid_evidence" };
        if (JSON.stringify(sourceRevision.repos ?? {}) !== JSON.stringify(expected.repos ?? {})) return { failure: "invalid_evidence" };
      } else {
        if (typeof sourceRevision.commit !== "string" || commitAncestryErrors(root, sourceRevision.commit, expected.commit).length
          || !/^[a-f0-9]{64}$/.test(String(sourceRevision.scope_digest)) || sourceRevision.scope_digest !== expected.scope_digest) return { failure: "invalid_evidence" };
        const repos = isRecord(sourceRevision.repos) ? sourceRevision.repos : {};
        if (JSON.stringify(Object.keys(repos).sort()) !== JSON.stringify(Object.keys(expected.repos || {}).sort())) return { failure: "invalid_evidence" };
        for (const [key, current] of Object.entries(expected.repos || {})) {
          const recorded = isRecord(repos[key]) ? repos[key] : {};
          if (typeof recorded.commit !== "string" || commitAncestryErrors(join(root, key), recorded.commit, current.commit).length) return { failure: "invalid_evidence" };
        }
      }
      const checker = isRecord(value.checker) ? value.checker : undefined;
      if (checker?.id !== `builtin:${sensor}` || checker.sensor !== sensor || checker.status !== "passed" || checker.exit_code !== 0 || typeof checker.argv_digest !== "string" || !/^[a-f0-9]{64}$/.test(checker.argv_digest)) return { failure: "invalid_evidence" };
      const timestamp = value.timestamp;
      const age = nowMs - Date.parse(timestamp);
      if (age > MAX_EVIDENCE_AGE_MS) return { failure: "stale_evidence" };
      if (age < -60_000) return { failure: "future_evidence" };
      return {
        metadata: {
          path: relativePortable(projectRoot, path),
          timestamp,
          source_scope: sourceScope,
          producer: "controlled",
        },
      };
    } catch { return { failure: "invalid_evidence" }; }
  } catch { return { failure: "invalid_evidence" }; }
}

function isMandatory(stage: StageNode, _rulePlan: RuleLoadPlan): boolean {
  // Phase 4's `mandatory` means the instruction must remain selected; it also
  // includes informational sensor-bearing rules. Phase 5's stronger meaning
  // is a gate that cannot be reused blindly.
  return stage.completion_contract === "gated" || stage.approval === "block";
}

function selectedStages(graph: StageGraph, rulePlan: RuleLoadPlan): StageNode[] {
  const bySlug = new Map(graph.stages.map((stage) => [stage.slug, stage]));
  return rulePlan.selected.map((entry) => {
    const stage = bySlug.get(entry.slug);
    if (stage === undefined) throw new Error(`Evidence reuse plan cannot resolve Phase-4 selected stage "${entry.slug}"`);
    return stage;
  });
}

/**
 * Build an advisory evidence schedule from the Phase-4 selected rule plan.
 * Every selected sensor gets an entry.  It cannot remove a sensor or approve
 * evidence; callers must continue through the normal report/gate pipeline.
 */
export function buildEvidenceReusePlan(graph: StageGraph, input: BuildEvidenceReusePlanInput): EvidenceReusePlan {
  if (!graph || !Array.isArray(graph.stages)) throw new TypeError("Evidence reuse plan requires a graph with a stages array");
  if (typeof input.projectRoot !== "string" || input.projectRoot.length === 0) throw new TypeError("Evidence reuse plan projectRoot must be non-empty");
  if (typeof input.scope !== "string" || input.scope.length === 0) throw new TypeError("Evidence reuse plan scope must be non-empty");
  if (!isIsoDate(input.now)) throw new TypeError("Evidence reuse plan now must be a valid ISO timestamp");
  const root = resolve(input.projectRoot);
  const evidenceScope = input.evidenceScope ?? "worktree";
  if (typeof evidenceScope !== "string" || evidenceScope.length === 0) throw new TypeError("Evidence reuse plan evidenceScope must be non-empty");

  const rulePlan = input.ruleLoadPlan ?? buildRuleLoadPlan(graph, {
    scope: input.scope,
    selectedOptionalStages: input.selectedOptionalStages,
    executionProfile: input.executionProfile,
  });
  const stages = selectedStages(graph, rulePlan);
  const nowMs = Date.parse(input.now);
  const entries: EvidenceValidationPlanEntry[] = [];

  for (const stage of stages) {
    for (const sensor of [...stage.sensors].sort()) {
      const mandatory = isMandatory(stage, rulePlan);
      const mandatoryRefresh = MANDATORY_REFRESH_SENSORS.has(sensor);
      const candidate = candidateForSensor(root, stage, sensor, evidenceScope, nowMs, input.target, input.expectedSourceRevision);
      if (mandatoryRefresh) {
        entries.push({ stage_slug: stage.slug, sensor, mandatory, mandatory_refresh: true, disposition: "revalidate", reason: "mandatory_refresh", ...(candidate.metadata ? { evidence: candidate.metadata } : {}) });
      } else if (candidate.metadata !== undefined) {
        entries.push({
          stage_slug: stage.slug,
          sensor,
          mandatory,
          mandatory_refresh: false,
          disposition: mandatory ? "verify" : "reuse",
          reason: mandatory ? "mandatory_gate_verification" : "valid_reusable_evidence",
          evidence: candidate.metadata,
        });
      } else {
        entries.push({
          stage_slug: stage.slug,
          sensor,
          mandatory,
          mandatory_refresh: false,
          disposition: "revalidate",
          reason: candidate.failure ?? "invalid_evidence",
        });
      }
    }
  }

  return {
    version: "1",
    strategy: "read_only_evidence_reuse_and_validation_schedule",
    scope: input.scope,
    evidence_scope: evidenceScope,
    profile: profileForPlan(input.executionProfile),
    selected_rule_stages: rulePlan.selected.map((entry) => entry.slug),
    entries,
    reuse: entries.filter((entry) => entry.disposition === "reuse"),
    verify: entries.filter((entry) => entry.disposition === "verify"),
    revalidate: entries.filter((entry) => entry.disposition === "revalidate"),
  };
}
