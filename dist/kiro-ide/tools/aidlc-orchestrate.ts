#!/usr/bin/env bun
/**
 * aidlc-orchestrate.ts — The deterministic workflow engine.
 *
 * Subcommands:
 *   next [args...]    — Read state + stage graph, return ONE typed directive (JSON)
 *   continue <token>  — Internal steering transport (load-steering chain)
 *   report [flags]    — Record stage outcome, advance state machine
 *   park              — Park workflow at current inter-stage boundary
 *
 * State file: <project>/docs/aidlc/aidlc-state.json
 * Stage graph: <engine>/core/tools/data/stage-graph.json
 *
 * This tool is DETERMINISTIC: same state → same directive.
 * `next` NEVER mutates state — only `report` and `park` write.
 *
 * Gate model: requires (准入) + produces + sensors (准出) guarantee completeness.
 * Approval remains blocking only for machine-unverifiable decisions declared
 * with `approval: block`; all other stages auto-advance after gates pass.
 */

import { randomBytes } from "crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "fs";
import { join, dirname, resolve, relative, isAbsolute, sep } from "path";
import { fileURLToPath } from "url";
import { readEnrollment, verifyApprovalToken, verifyRecord } from "./aidlc-trust";
import { readSourceRevision } from "./aidlc-revision";
import {
  createInitialState,
  loadWorkflowState,
  saveWorkflowState,
  type HistoryEntry,
  type WorkflowState,
} from "./aidlc-state";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = resolve(__dirname, "..");
const GRAPH_PATH = join(__dirname, "data", "stage-graph.json");

// State lives in the user's project; realpath prevents lexical containment bypasses.
const PROJECT_ROOT = realpathSync(process.cwd());

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StageNode {
  slug: string;
  number: string;
  name: string;
  phase: string;
  execution: "ALWAYS" | "CONDITIONAL";
  lead_agent: string;
  support_agents: string[];
  mode: string;
  scopes: string[];
  requires: string[];
  scope_waived_requires: string[];
  consumes: string[];
  produces: string[];
  sensors: string[];
  traceability: "required" | "not_applicable";
  completion_contract: "gated" | "instruction_only";
  condition: string;
  approval: "block" | "confirm" | "notify";
  file: string;
}

interface StageGraph {
  version: string;
  stages: StageNode[];
  stage_count: number;
}

interface Directive {
  kind: "load-steering" | "run-stage" | "ask" | "print" | "error" | "done" | "parked";
  stage?: string;
  stage_file?: string;
  name?: string;
  number?: string;
  phase?: string;
  lead_agent?: string;
  support_agents?: string[];
  mode?: string;
  gate?: boolean;
  consumes?: string[];
  produces?: string[];
  sensors?: string[];
  message?: string;
  rules_content?: string[];
  [key: string]: unknown;
}

interface ConditionContext {
  has_legacy_code: boolean;
  has_ui_requirements: boolean;
  has_reverse_output: boolean;
  multi_module: boolean;
  has_nfr_needs: boolean;
  has_infra_needs: boolean;
  has_test_case_sources: boolean;
  has_contract_dependencies: boolean;
  has_subagent_support: boolean;
  is_loeyae_boot: boolean;
  context_compacted: boolean;
}

const VALID_SCOPES = new Set([
  "feature",
  "enterprise",
  "mvp",
  "classic",
  "express",
  "workshop",
  "bugfix",
  "refactor",
  "poc",
]);

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

const SUBCOMMANDS = ["next", "continue", "report", "park"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const VALID_RESULTS = ["completed", "approved", "rejected", "revised"] as const;
type StageResult = (typeof VALID_RESULTS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadGraph(): StageGraph {
  if (!existsSync(GRAPH_PATH)) {
    throw new Error(`Stage graph not found at ${GRAPH_PATH}. Run 'aidlc-graph.ts compile' first.`);
  }
  return JSON.parse(readFileSync(GRAPH_PATH, "utf-8"));
}

function loadState(): WorkflowState | null {
  return loadWorkflowState(PROJECT_ROOT);
}

function saveState(state: WorkflowState): void {
  saveWorkflowState(PROJECT_ROOT, state);
}

/**
 * Filter stages by scope: a stage executes if its scopes array includes
 * the workflow's active scope, OR if its execution is ALWAYS.
 */
function getExecutableStages(graph: StageGraph, scope: string): StageNode[] {
  return graph.stages.filter(
    (s) => s.execution === "ALWAYS" || s.scopes.includes(scope)
  );
}

/**
 * Check if a stage's requires dependencies are all satisfied.
 * Only checks dependencies that are in the executable stages list —
 * a requires pointing to a stage that's not in scope is auto-satisfied
 * (the scope intentionally skips that prerequisite).
 */
function checkRequires(
  stage: StageNode,
  completedSlugs: string[],
  skippedSlugs: string[],
  executableSlugs: Set<string>
): string[] {
  if (!stage.requires || stage.requires.length === 0) return [];
  const done = new Set([...completedSlugs, ...skippedSlugs]);
  return stage.requires.filter((dep) => executableSlugs.has(dep) && !done.has(dep));
}

function assertProjectPath(path: string): string {
  const candidate = resolve(path);
  const rel = relative(PROJECT_ROOT, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`artifact path escapes project root: ${path}`);
  }
  if (existsSync(candidate)) {
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink()) throw new Error(`artifact path is a symbolic link: ${path}`);
    const real = realpathSync(candidate);
    const realRel = relative(PROJECT_ROOT, real);
    if (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
      throw new Error(`artifact path resolves outside project root: ${path}`);
    }
  }
  return candidate;
}

function collectFiles(path: string): string[] {
  const safe = assertProjectPath(path);
  if (!existsSync(safe)) return [];
  const stat = lstatSync(safe);
  if (stat.isSymbolicLink()) throw new Error(`artifact path is a symbolic link: ${safe}`);
  if (stat.isFile()) return [safe];
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of readdirSync(safe)) {
    if (entry.startsWith(".")) continue;
    files.push(...collectFiles(join(safe, entry)));
  }
  return files;
}

function resolveProducePaths(pattern: string): string[] {
  const marker = pattern.match(/\{[^}]+\}/);
  if (marker && marker.index !== undefined) {
    const prefix = pattern.slice(0, marker.index);
    const suffix = pattern.slice(marker.index + marker[0].length);
    const base = join(PROJECT_ROOT, prefix);
    if (!existsSync(base) || !statSync(base).isDirectory()) return [];

    const paths: string[] = [];
    for (const entry of readdirSync(base)) {
      if (entry.startsWith(".")) continue;
      if (!suffix.startsWith("/") && !entry.endsWith(suffix)) continue;
      const candidate = suffix.startsWith("/")
        ? join(base, entry, suffix)
        : join(base, entry);
      paths.push(...collectFiles(candidate));
    }
    return paths;
  }

  const target = join(PROJECT_ROOT, pattern);
  if (!pattern.includes("*")) return collectFiles(target);

  const wildcardIndex = pattern.search(/[\\*]/);
  const slashIndex = pattern.lastIndexOf("/", wildcardIndex);
  const base = join(PROJECT_ROOT, slashIndex >= 0 ? pattern.slice(0, slashIndex) : ".");
  if (!existsSync(base)) return [];
  const expression = new RegExp(`^${pattern.slice(slashIndex + 1).replace(/[.+^${}()|[\\]\\\\]/g, "\\\\$&").replace(/\\*/g, ".*")}$`);
  return collectFiles(base).filter((path) => expression.test(path.slice(join(PROJECT_ROOT, slashIndex >= 0 ? pattern.slice(0, slashIndex) : ".").length + 1)));
}

/**
 * Check if produces files exist (including directories and dynamic unit paths).
 */
const MIN_ARTIFACT_BYTES = 16;

function checkProduces(stage: StageNode): string[] {
  if (!stage.produces || stage.produces.length === 0) return [];
  const missing: string[] = [];
  for (const pattern of stage.produces) {
    const paths = resolveProducePaths(pattern);
    if (paths.length === 0) {
      missing.push(pattern);
      continue;
    }

    if (pattern.endsWith("/") || paths.some((path) => statSync(path).isDirectory())) {
      const hasSubstantiveFile = paths.some((path) => statSync(path).size >= MIN_ARTIFACT_BYTES);
      if (!hasSubstantiveFile) missing.push(pattern);
      continue;
    }

    if (paths.some((path) => statSync(path).size < MIN_ARTIFACT_BYTES)) missing.push(pattern);
  }
  return missing;
}

function checkConsumes(stage: StageNode, state: WorkflowState, graph: StageGraph): string[] {
  const failures: string[] = [];
  for (const pattern of stage.consumes || []) {
    let paths: string[] = [];
    try {
      paths = resolveProducePaths(pattern);
    } catch (error) {
      failures.push(`${pattern}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (paths.length === 0 || paths.some((path) => lstatSync(path).isFile() && lstatSync(path).size < MIN_ARTIFACT_BYTES)) {
      failures.push(`${pattern}: missing or smaller than ${MIN_ARTIFACT_BYTES} bytes`);
      continue;
    }
    const producers = graph.stages.filter((candidate) => (candidate.produces || []).includes(pattern));
    if (producers.length === 0) {
      failures.push(`${pattern}: no stage declares this canonical produce`);
      continue;
    }
    if (!producers.some((producer) => state.completed_stages.includes(producer.slug))) {
      failures.push(`${pattern}: producer not completed (${producers.map((producer) => producer.slug).join(", ")})`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Sensors — 准出 quality gates (machine-verifiable checks)
// ---------------------------------------------------------------------------

interface SensorResult {
  sensor: string;
  passed: boolean;
  message: string;
}

type Evidence = Record<string, unknown>;

/** Maximum evidence file size: 512 KB. Prevents unbounded JSON injection. */
const MAX_EVIDENCE_BYTES = 512 * 1024;

/** Maximum evidence staleness: 24 hours. Older evidence is rejected. */
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

function evidencePath(stage: StageNode, sensor: string): string {
  return join(PROJECT_ROOT, ".aidlc", "evidence", stage.slug, `${sensor}.json`);
}

function loadEvidence(stage: StageNode, sensor: string): { value?: Evidence; failure?: SensorResult } {
  const path = evidencePath(stage, sensor);
  if (!existsSync(path)) {
    return {
      failure: {
        sensor,
        passed: false,
        message: `Evidence not found: ${path}. Run the controlled evidence producer first.`,
      },
    };
  }

  try {
    const stat = statSync(path);
    if (stat.size === 0) {
      throw new Error("evidence file is empty");
    }
    if (stat.size > MAX_EVIDENCE_BYTES) {
      throw new Error(`evidence file exceeds ${MAX_EVIDENCE_BYTES} bytes (actual: ${stat.size})`);
    }

    const raw = readFileSync(path, "utf-8");
    const value = JSON.parse(raw) as Evidence;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("evidence must be a JSON object");
    }
    if (value.evidence_version !== "1") {
      throw new Error('evidence_version must be "1"');
    }

    // Timestamp freshness check
    if (typeof value.timestamp !== "string" || value.timestamp.length === 0) {
      throw new Error("evidence must include a non-empty ISO timestamp field");
    }
    const evidenceTime = new Date(value.timestamp as string).getTime();
    if (Number.isNaN(evidenceTime)) {
      throw new Error("evidence timestamp is not a valid ISO date");
    }
    const age = Date.now() - evidenceTime;
    if (age > MAX_EVIDENCE_AGE_MS) {
      throw new Error(`evidence is stale (${Math.round(age / 3600000)}h old, max 24h). Re-run the producer.`);
    }
    if (age < -60000) {
      throw new Error("evidence timestamp is in the future — clock skew or tampered");
    }

    return { value };
  } catch (error) {
    return {
      failure: {
        sensor,
        passed: false,
        message: `Invalid evidence at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

function validateEvidence(
  stage: StageNode,
  sensor: string,
  required: (value: Evidence) => string[],
): SensorResult | null {
  const loaded = loadEvidence(stage, sensor);
  if (loaded.failure) return loaded.failure;
  const evidence = loaded.value as Evidence;
  const errors = required(evidence);

  const integrityError = verifyRecord(evidence);
  if (integrityError) errors.push(`integrity: ${integrityError}`);

  const producer = asRecord(evidence.producer);
  if (!producer) {
    errors.push("producer object is required for controlled evidence provenance");
  } else {
    if (producer.name !== "loeyae-aidlc-evidence") errors.push('producer.name must be "loeyae-aidlc-evidence"');
    if (producer.mode !== "controlled") errors.push('producer.mode must be "controlled"');
    if (!asNonEmptyString(producer.execution_id)) errors.push("producer.execution_id is required");
  }

  const sourceRevision = asRecord(evidence.source_revision);
  if (!sourceRevision) {
    errors.push("source_revision object is required");
  } else {
    const commit = asNonEmptyString(sourceRevision.commit);
    if (!commit) errors.push("source_revision.commit is required");
    const activeRevision = readSourceRevision(PROJECT_ROOT);
    if (commit && commit !== activeRevision.commit) errors.push(`source_revision.commit ${commit} does not match current HEAD ${activeRevision.commit}`);
    if (sourceRevision.dirty !== null && typeof sourceRevision.dirty !== "boolean") errors.push("source_revision.dirty must be boolean or null");
    if (sourceRevision.dirty !== activeRevision.dirty) errors.push("source_revision.dirty no longer matches the current worktree");
    if (!/^[a-f0-9]{64}$/.test(String(sourceRevision.worktree_digest || ""))) {
      errors.push("source_revision.worktree_digest must be a SHA-256 digest");
    } else if (sourceRevision.worktree_digest !== activeRevision.worktree_digest) {
      errors.push("source_revision.worktree_digest no longer matches the current worktree");
    }
  }

  if (sensor !== "build-test-evidence") {
    const checker = asRecord(evidence.checker);
    if (!checker) {
      errors.push("checker object is required for semantic evidence");
    } else {
      if (checker.id !== `builtin:${sensor}`) errors.push(`checker.id must be builtin:${sensor}`);
      if (checker.sensor !== sensor) errors.push(`checker.sensor must be ${sensor}`);
      if (!/^[a-f0-9]{64}$/.test(String(checker.argv_digest || ""))) errors.push("checker.argv_digest must be a SHA-256 digest");
      if (asNumber(checker.exit_code) !== 0 || checker.status !== "passed") errors.push("checker execution must have passed with exit_code 0");
    }
  }

  if (errors.length > 0) {
    return {
      sensor,
      passed: false,
      message: `Evidence rejected at ${evidencePath(stage, sensor)}: ${errors.join("; ")}`,
    };
  }
  return null;
}

function asRecord(value: unknown): Evidence | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Evidence : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asPositiveInt(value: unknown): number | null {
  const n = asNumber(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const DIAGRAM_FINAL_STATUSES = new Set(["PASS", "STATIC_PASS", "UNVERIFIED", "NEEDS_CAPABILITY", "FAIL"]);

function diagramFinalStatus(evidence: Evidence): { status: string; legacy: boolean } {
  if (typeof evidence.final_status === "string") return { status: evidence.final_status, legacy: false };
  if (evidence.delivery_status === "SOURCE_READY") return { status: "STATIC_PASS", legacy: true };
  if (evidence.provider_status === "unavailable") return { status: "NEEDS_CAPABILITY", legacy: true };
  if (evidence.status === "passed" && evidence.provider_status === "passed" && evidence.render_status === "passed") return { status: "PASS", legacy: true };
  if (evidence.status === "passed" && ["unverified", "not_required"].includes(String(evidence.provider_status)) && evidence.geometry_status === "passed") return { status: "STATIC_PASS", legacy: true };
  return { status: "UNVERIFIED", legacy: true };
}

function producedText(path: string): string | null {
  try {
    const content = readFileSync(path);
    if (content.includes(0)) return null;
    return content.toString("utf-8");
  } catch {
    return null;
  }
}

function artifactLabel(path: string): string {
  return relative(PROJECT_ROOT, path) || path;
}

function isEvidenceArtifact(path: string): boolean {
  return artifactLabel(path).startsWith(".aidlc/evidence/");
}

/**
 * Run sensors defined on a stage. Each sensor is a named check.
 * Built-in sensors:
 *   - 'no-todo': grep produces files for TODO/FIXME/HACK
 *   - 'build-success': check if .aidlc-build-ok marker exists
 *   - 'test-pass': check if .aidlc-test-ok marker exists
 *   - 'traceability': check that produces files reference a requirement ID
 *
 * Returns list of failed sensor results.
 */
async function checkSensors(stage: StageNode, state: WorkflowState): Promise<SensorResult[]> {
  if (!stage.sensors || stage.sensors.length === 0) return [];

  const failures: SensorResult[] = [];

  for (const sensor of stage.sensors) {
    switch (sensor) {
      case "no-todo": {
        const todoFiles: string[] = [];
        const unreadableFiles: string[] = [];
        for (const pattern of stage.produces || []) {
          for (const filePath of resolveProducePaths(pattern)) {
            const content = producedText(filePath);
            if (content === null) {
              unreadableFiles.push(artifactLabel(filePath));
              continue;
            }
            if (/(?:^|\n)\s*(?:(?:\/\/|#|<!--|\*|-)\s*)?\b(?:TODO|FIXME|HACK)\b\s*(?::|\(|\[|$)/im.test(content)) {
              todoFiles.push(artifactLabel(filePath));
            }
          }
        }
        if (todoFiles.length > 0 || unreadableFiles.length > 0) {
          const details = [];
          if (todoFiles.length > 0) details.push(`TODO/FIXME/HACK in: ${todoFiles.join(", ")}`);
          if (unreadableFiles.length > 0) details.push(`unreadable produced files: ${unreadableFiles.join(", ")}`);
          failures.push({
            sensor: "no-todo",
            passed: false,
            message: details.join("; "),
          });
        }
        break;
      }

      case "build-success": {
        const markerPath = join(PROJECT_ROOT, ".aidlc-build-ok");
        if (!existsSync(markerPath)) {
          failures.push({
            sensor: "build-success",
            passed: false,
            message: "Build marker .aidlc-build-ok not found. Run a successful build first.",
          });
        }
        break;
      }

      case "test-pass": {
        const markerPath = join(PROJECT_ROOT, ".aidlc-test-ok");
        if (!existsSync(markerPath)) {
          failures.push({
            sensor: "test-pass",
            passed: false,
            message: "Test marker .aidlc-test-ok not found. Run tests successfully first.",
          });
        }
        break;
      }

      case "traceability": {
        if (stage.traceability === "not_applicable") break;

        const untraced: string[] = [];
        const unreadableFiles: string[] = [];
        const targets = [...new Set((stage.produces || [])
          .flatMap((pattern) => resolveProducePaths(pattern))
          .filter((filePath) => !isEvidenceArtifact(filePath)))];

        if (targets.length === 0) {
          failures.push({
            sensor: "traceability",
            passed: false,
            message: "No traceability-applicable produced artifact found; declare traceability: not_applicable only for evidence-only stages.",
          });
          break;
        }

        for (const filePath of targets) {
          const content = producedText(filePath);
          if (content === null) {
            unreadableFiles.push(artifactLabel(filePath));
            continue;
          }
          const requirementPattern = /\b(REQ-[A-Z0-9][A-Z0-9_-]*|R-[0-9]+)\b/gi;
          const matches = content.match(requirementPattern) || [];
          const semanticBody = content.replace(requirementPattern, "").replace(/[#*_`>\-\s]/g, "");
          if (matches.length === 0 || semanticBody.length < 20) {
            untraced.push(artifactLabel(filePath));
          }
        }
        if (untraced.length > 0 || unreadableFiles.length > 0) {
          const details = [];
          if (untraced.length > 0) details.push(`No requirement ID (REQ-xxx or R-xxx) found in: ${untraced.join(", ")}`);
          if (unreadableFiles.length > 0) details.push(`unreadable produced files: ${unreadableFiles.join(", ")}`);
          failures.push({
            sensor: "traceability",
            passed: false,
            message: details.join("; "),
          });
        }
        break;
      }

      case "build-test-evidence": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');

          // Commands validation — each command is provenance-bound without persisting secret-bearing argv.
          const commands = Array.isArray(evidence.commands) ? evidence.commands : [];
          if (commands.length === 0) errors.push("commands must contain at least one executed command");
          for (let i = 0; i < commands.length; i++) {
            const record = asRecord(commands[i]);
            if (!record) {
              errors.push(`commands[${i}] must be an object`);
              continue;
            }
            if (!/^[a-f0-9]{64}$/.test(String(record.argv_digest || ""))) errors.push(`commands[${i}].argv_digest must be a SHA-256 digest`);
            if (asNumber(record.exit_code) !== 0) errors.push(`commands[${i}].exit_code must be 0 (got ${record.exit_code})`);
            if (record.status !== "passed") errors.push(`commands[${i}].status must be "passed"`);
            if (typeof record.duration_ms !== "number") errors.push(`commands[${i}].duration_ms must be a number`);
          }

          // Tests summary — must have total > 0, failed = 0, passed > 0
          const tests = asRecord(evidence.tests);
          if (!tests) {
            errors.push("tests object is required");
          } else {
            if (asPositiveInt(tests.total) === null || (tests.total as number) < 1) errors.push("tests.total must be >= 1");
            if (asPositiveInt(tests.passed) === null || (tests.passed as number) < 1) errors.push("tests.passed must be >= 1");
            if (asNumber(tests.failed) !== 0) errors.push("tests.failed must be 0");
          }

          // Static/security checks
          const checks = asRecord(evidence.checks);
          if (!checks) {
            errors.push("checks object is required (lint, type-check, security scan results)");
          } else {
            if (checks.status !== "passed") errors.push('checks.status must be "passed"');
          }

          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "review-evidence": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          if (evidence.spec_axis !== "passed") errors.push('spec_axis must be "passed" (design conformance)');
          if (evidence.standards_axis !== "passed") errors.push('standards_axis must be "passed" (coding standards)');
          if (asNumber(evidence.issues_open) !== 0) errors.push("issues_open must be 0 (all findings resolved)");

          // Reviewer identity required
          if (!asNonEmptyString(evidence.reviewer)) errors.push("reviewer must identify who/what performed the review");

          // Files reviewed must be non-empty
          const filesReviewed = asStringArray(evidence.files_reviewed);
          if (!filesReviewed || filesReviewed.length === 0) errors.push("files_reviewed must list at least one file");

          // Issues found + resolved counts must be consistent
          const issuesFound = asPositiveInt(evidence.issues_found);
          const issuesResolved = asPositiveInt(evidence.issues_resolved);
          if (issuesFound === null) errors.push("issues_found must be a non-negative integer");
          if (issuesResolved === null) errors.push("issues_resolved must be a non-negative integer");
          if (issuesFound !== null && issuesResolved !== null && issuesResolved < issuesFound) {
            errors.push("issues_resolved must be >= issues_found (all issues must be addressed)");
          }

          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "test-quality": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          if (evidence.green_seen !== true) errors.push("green_seen must be true (tests passing observed)");
          if (asNumber(evidence.tests_failed) !== 0) errors.push("tests_failed must be 0");

          // Total tests must be positive
          const testsTotal = asPositiveInt(evidence.tests_total);
          if (testsTotal === null || testsTotal < 1) errors.push("tests_total must be >= 1");

          // TDD red-green cycle evidence
          if (evidence.red_seen !== true && typeof evidence.red_exemption !== "string") {
            errors.push("red_seen must be true or red_exemption must explain an approved exemption");
          }

          // UC-D traceability: mapping from use cases to test methods
          if (evidence.traceability_complete !== true) errors.push("traceability_complete must be true");
          const ucMapping = evidence.uc_mapping;
          if (!Array.isArray(ucMapping) || ucMapping.length === 0) {
            errors.push("uc_mapping must be a non-empty array mapping use cases to test methods");
          } else {
            for (let i = 0; i < ucMapping.length; i++) {
              const entry = asRecord(ucMapping[i]);
              if (!entry) {
                errors.push(`uc_mapping[${i}] must be an object`);
                continue;
              }
              if (!asNonEmptyString(entry.use_case)) errors.push(`uc_mapping[${i}].use_case is required`);
              const tests = asStringArray(entry.test_methods);
              if (!tests || tests.length === 0) errors.push(`uc_mapping[${i}].test_methods must list at least one test`);
            }
          }

          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "contract-baseline": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "verified") errors.push('status must be "verified"');
          if (!asNonEmptyString(evidence.contract_id)) errors.push("contract_id is required (non-empty string)");
          if (!asNonEmptyString(evidence.owner)) errors.push("owner is required (non-empty string)");
          if (evidence.validation_status !== "passed") errors.push('validation_status must be "passed"');

          // Contract type and version
          if (!asNonEmptyString(evidence.contract_type)) errors.push("contract_type is required (api/event/schema/proto)");

          // Consumers must acknowledge the baseline
          const consumers = asStringArray(evidence.consumers);
          if (!consumers || consumers.length === 0) errors.push("consumers must list at least one dependent");

          // Schema hash for integrity — allows detecting unauthorized changes
          if (!asNonEmptyString(evidence.schema_hash)) errors.push("schema_hash is required for integrity verification");

          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "functional-design-completeness": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          if (evidence.data_source_validation !== "passed") errors.push('data_source_validation must be "passed"');
          if (evidence.ambiguities_resolved !== true) errors.push("ambiguities_resolved must be true");
          if (asNumber(evidence.unresolved_blockers) !== 0) errors.push("unresolved_blockers must be 0");

          // Must enumerate covered use cases
          const useCases = asStringArray(evidence.use_cases_covered);
          if (!useCases || useCases.length === 0) errors.push("use_cases_covered must list at least one covered use case");

          // Interface completeness — every public interface must be specified
          if (asPositiveInt(evidence.interfaces_specified) === null || (evidence.interfaces_specified as number) < 1) {
            errors.push("interfaces_specified must be >= 1");
          }

          // Error handling coverage
          if (evidence.error_handling_defined !== true) errors.push("error_handling_defined must be true");

          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "nfr-coverage": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          const covered = asPositiveInt(evidence.requirements_covered);
          if (covered === null || covered < 1) errors.push("requirements_covered must be at least 1");
          if (asNumber(evidence.unresolved) !== 0) errors.push("unresolved must be 0");

          // Each NFR must have an acceptance criterion and measurement method
          const nfrs = evidence.nfr_items;
          if (!Array.isArray(nfrs) || nfrs.length === 0) {
            errors.push("nfr_items must list each NFR with its acceptance criterion");
          } else {
            for (let i = 0; i < nfrs.length; i++) {
              const item = asRecord(nfrs[i]);
              if (!item) {
                errors.push(`nfr_items[${i}] must be an object`);
                continue;
              }
              if (!asNonEmptyString(item.id)) errors.push(`nfr_items[${i}].id is required`);
              if (!asNonEmptyString(item.category)) errors.push(`nfr_items[${i}].category is required (performance/security/reliability/...)`);
              if (!asNonEmptyString(item.acceptance_criterion)) errors.push(`nfr_items[${i}].acceptance_criterion is required`);
              if (item.verified !== true) errors.push(`nfr_items[${i}].verified must be true`);
            }
          }

          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "infrastructure-completeness": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          const requiredSections = ["deployment", "resources", "migration", "rollback", "runtime_dependencies"];
          const sections = asStringArray(evidence.sections);
          if (!sections) {
            errors.push("sections must be a string array");
          } else {
            const missing = requiredSections.filter((section) => !sections.includes(section));
            if (missing.length > 0) errors.push(`sections missing: ${missing.join(", ")}`);
          }
          if (asNumber(evidence.unresolved) !== 0) errors.push("unresolved must be 0");

          // Each resource must be named and provisioned
          const resources = evidence.resources_enumerated;
          if (!Array.isArray(resources) || resources.length === 0) {
            errors.push("resources_enumerated must list at least one infrastructure resource");
          } else {
            for (let i = 0; i < resources.length; i++) {
              const res = asRecord(resources[i]);
              if (!res) {
                errors.push(`resources_enumerated[${i}] must be an object`);
                continue;
              }
              if (!asNonEmptyString(res.name)) errors.push(`resources_enumerated[${i}].name is required`);
              if (!asNonEmptyString(res.type)) errors.push(`resources_enumerated[${i}].type is required`);
              if (res.provisioned !== true) errors.push(`resources_enumerated[${i}].provisioned must be true`);
            }
          }

          // Rollback strategy must be defined
          if (!asNonEmptyString(evidence.rollback_strategy)) errors.push("rollback_strategy is required");

          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "implementation-report": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          if (evidence.summary_complete !== true) errors.push("summary_complete must be true");

          // Evidence references — must point to real sensor evidence files
          const references = asStringArray(evidence.evidence_references);
          if (!references || references.length === 0) {
            errors.push("evidence_references must not be empty (list prior sensor evidence files)");
          } else {
            for (const ref of references) {
              const refPath = join(PROJECT_ROOT, ref);
              if (!existsSync(refPath)) {
                errors.push(`evidence_references: file not found: ${ref}`);
              }
            }
          }

          // Must confirm all prior construction sensors passed
          if (evidence.all_gates_passed !== true) errors.push("all_gates_passed must be true");

          // Must record scope and stage counts
          if (!asNonEmptyString(evidence.scope)) errors.push("scope is required");
          if (asPositiveInt(evidence.stages_completed) === null || (evidence.stages_completed as number) < 1) {
            errors.push("stages_completed must be >= 1");
          }

          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "prd-completeness": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          if (!asNonEmptyString(evidence.prd_path)) errors.push("prd_path is required");
          const sections = asStringArray(evidence.required_sections);
          if (!sections || sections.length < 6) errors.push("required_sections must list at least 6 PRD sections");
          if (asPositiveInt(evidence.functional_requirements) === null || (evidence.functional_requirements as number) < 1) errors.push("functional_requirements must be >= 1");
          if (evidence.acceptance_criteria_complete !== true) errors.push("acceptance_criteria_complete must be true");
          if (evidence.non_goals_complete !== true) errors.push("non_goals_complete must be true");
          if (evidence.pending_questions_indexed !== true) errors.push("pending_questions_indexed must be true");
          if (evidence.source_index_complete !== true) errors.push("source_index_complete must be true");
          if (evidence.clarification_consistency !== "passed") errors.push('clarification_consistency must be "passed"');
          if (!["passed", "not_applicable"].includes(String(evidence.business_flow_validation))) errors.push('business_flow_validation must be "passed" or "not_applicable"');
          if (asNumber(evidence.unresolved_blockers) !== 0) errors.push("unresolved_blockers must be 0");
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "diagram-contract": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed" (sensor envelope)');
          const final = diagramFinalStatus(evidence);
          if (!DIAGRAM_FINAL_STATUSES.has(final.status)) errors.push('final_status must be PASS, STATIC_PASS, UNVERIFIED, NEEDS_CAPABILITY or FAIL');
          if (evidence.source_format !== "svg") errors.push('source_format must be "svg"');
          const diagrams = asPositiveInt(evidence.diagrams_checked);
          if (diagrams === null || diagrams < 1) errors.push("diagrams_checked must be >= 1");
          if (evidence.ids_unique !== true) errors.push("ids_unique must be true");
          if (evidence.ports_valid !== true) errors.push("ports_valid must be true");
          if (evidence.direction_consistent !== true) errors.push("direction_consistent must be true");
          if (evidence.legend_valid !== true) errors.push("legend_valid must be true");
          if (evidence.groups_valid !== true) errors.push("groups_valid must be true");
          if (evidence.viewbox_valid !== true) errors.push("viewbox_valid must be true");
          if (!["passed", "unverified", "not_required", "unavailable", "failed"].includes(String(evidence.provider_status))) errors.push('provider_status must be "passed", "unverified", "not_required", "unavailable" or "failed"');
          if (typeof evidence.target_operation_required !== "boolean") errors.push("target_operation_required must be boolean");
          if (evidence.fr_mapping_complete !== true) errors.push("fr_mapping_complete must be true");
          if (evidence.design_notes_valid !== true) errors.push("design_notes_valid must be true");
          if (evidence.migration_status !== "passed") errors.push('migration_status must be "passed"');
          if (evidence.port_paths_valid !== true) errors.push("port_paths_valid must be true");

          const requiredTrueFields = [
            "layout_contract_valid", "main_flow_valid", "loop_lanes_valid", "decision_exit_valid", "annotation_mapping_valid",
          ];
          for (const field of requiredTrueFields) if (evidence[field] !== true) errors.push(`${field} must be true`);
          const requiredPassedFields = [
            "geometry_status", "render_preflight_status", "edge_intersection_status", "collinear_overlap_status",
            "target_port_direction_status", "target_port_approach_status", "routing_minimality_status", "side_switch_status",
            "visible_arrow_mapping_status",
          ];
          for (const field of requiredPassedFields) if (evidence[field] !== "passed") errors.push(`${field} must be "passed"`);
          if (!["passed", "not_applicable"].includes(String(evidence.change_impact_review_status))) errors.push('change_impact_review_status must be "passed" or "not_applicable"');
          if (!['passed', 'unverified'].includes(String(evidence.render_status))) errors.push('render_status must be "passed" or "unverified"');
          const structuralStatusFields = ["structural_occlusion_status", "structural_frame_style_status", "structural_node_fill_status", "structural_layer_order_status", "structural_mask_status", "structural_mask_coverage_status"];
          for (const field of structuralStatusFields) if (!["passed", "not_applicable"].includes(String(evidence[field]))) errors.push(`${field} must be "passed" or "not_applicable"`);
          for (const field of ["structural_node_intersections", "structural_edge_intersections", "structural_label_intersections", "structural_arrow_intersections"]) if (!Array.isArray(evidence[field])) errors.push(`${field} must be an array`);
          const structuralVisualEvidence = asRecord(evidence.structural_visual_evidence);
          if (!structuralVisualEvidence || typeof structuralVisualEvidence.required !== "boolean" || !Array.isArray(structuralVisualEvidence.screenshots) || !Array.isArray(structuralVisualEvidence.snapshots) || typeof structuralVisualEvidence.pixel_verified !== "boolean") errors.push("structural_visual_evidence must contain required, screenshots, snapshots and pixel_verified");
          if (asNumber(evidence.unresolved) !== 0) errors.push("unresolved must be 0");
          const gateStatuses = asRecord(evidence.gate_statuses);
          if (!final.legacy && !gateStatuses) errors.push("gate_statuses is required for the new diagram contract producer");
          if (gateStatuses) {
            if (gateStatuses.structure !== "STRUCTURE_PASS") errors.push("gate_statuses.structure must be STRUCTURE_PASS");
            if (gateStatuses.route_contract !== "ROUTE_CONTRACT_PASS") errors.push("gate_statuses.route_contract must be ROUTE_CONTRACT_PASS");
            if (gateStatuses.geometry !== "GEOMETRY_PASS") errors.push("gate_statuses.geometry must be GEOMETRY_PASS");
            if (!["VISUAL_PASS", "UNVERIFIED", "FAIL"].includes(String(gateStatuses.visual))) errors.push("gate_statuses.visual must be VISUAL_PASS, UNVERIFIED or FAIL");
            if (final.status === "PASS" && gateStatuses.visual !== "VISUAL_PASS") errors.push("PASS requires gate_statuses.visual=VISUAL_PASS");
            if (final.status === "PASS" && gateStatuses.overall !== "OVERALL_PASS") errors.push("PASS requires gate_statuses.overall=OVERALL_PASS");
            if (final.status === "STATIC_PASS" && gateStatuses.overall !== "STATIC_PASS") errors.push("STATIC_PASS requires gate_statuses.overall=STATIC_PASS");
          }
          if (!final.legacy) {
            if (!["passed", "unverified"].includes(String(evidence.expected_contract_status))) errors.push('expected_contract_status must be "passed" or "unverified"');
            if (!["passed", "unverified"].includes(String(evidence.generation_status))) errors.push('generation_status must be "passed" or "unverified"');
          }
          if (final.status === "PASS") {
            if (evidence.target_operation_required !== true) errors.push("PASS requires target_operation_required=true");
            if (evidence.provider_status !== "passed") errors.push("PASS requires provider_status=passed");
            if (evidence.render_status !== "passed" || evidence.browser_visual_status !== "passed") errors.push("PASS requires latest browser visual evidence");
            if (!final.legacy && (evidence.expected_contract_status !== "passed" || evidence.generation_status !== "passed")) errors.push("PASS requires expected contract and generator closure");
            const views = asRecord(asRecord(evidence.provider_validation)?.views);
            for (const view of ["normal", "fit", "zoom"]) {
              const entry = views ? asRecord(views[view]) : null;
              if (!entry || entry.status !== "passed" || !asNonEmptyString(entry.screenshot_path) || !asNonEmptyString(entry.snapshot_path)) errors.push(`PASS requires latest ${view} screenshot and snapshot evidence`);
            }
          } else if (final.status === "STATIC_PASS") {
            if (evidence.target_operation_required === true) errors.push("STATIC_PASS cannot satisfy a required browser operation");
            if (!final.legacy && (evidence.expected_contract_status !== "passed" || evidence.generation_status !== "passed")) errors.push("STATIC_PASS requires expected contract and generator closure");
            if (evidence.provider_status === "passed") errors.push("STATIC_PASS cannot claim provider passed");
          } else if (final.status === "UNVERIFIED") {
            errors.push("final_status=UNVERIFIED is not a completed diagram gate");
          } else if (final.status === "NEEDS_CAPABILITY") {
            errors.push("final_status=NEEDS_CAPABILITY requires the requested provider capability");
          } else if (final.status === "FAIL") {
            errors.push("final_status=FAIL contains blocking diagram findings");
          }
          if (evidence.target_operation_required === true && final.status !== "PASS") errors.push("required browser operation must finish with final_status=PASS");
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "design-intent-coverage": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          if (evidence.coverage_complete !== true) errors.push("coverage_complete must be true");
          if (asNumber(evidence.uncovered) !== 0) errors.push("uncovered must be 0");
          const markers = asPositiveInt(evidence.intent_markers_found);
          if (markers === null) errors.push("intent_markers_found must be a non-negative integer");
          if (markers === 0 && !asNonEmptyString(evidence.skip_reason)) errors.push("skip_reason is required when no intent markers exist");
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "ui-design-alignment": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (!["passed", "not_applicable"].includes(String(evidence.status))) errors.push('status must be "passed" or "not_applicable"');
          if (evidence.status === "not_applicable") return errors;
          if (!["html-mock", "figma"].includes(String(evidence.design_mode))) errors.push('design_mode must be "html-mock" or "figma"');
          for (const field of ["styles_aligned", "conditional_visibility_aligned", "platform_constraints_respected"]) if (evidence[field] !== true) errors.push(`${field} must be true`);
          if (asNumber(evidence.unmapped_elements) !== 0) errors.push("unmapped_elements must be 0");
          if (asNumber(evidence.extra_elements) !== 0) errors.push("extra_elements must be 0");
          if (asPositiveInt(evidence.pages_checked) === null || (evidence.pages_checked as number) < 1) errors.push("pages_checked must be >= 1");
          if (asPositiveInt(evidence.elements_checked) === null || (evidence.elements_checked as number) < 1) errors.push("elements_checked must be >= 1");
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "frontend-platform-spec": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          const layout = asStringArray(evidence.layout_primitives);
          const components = asStringArray(evidence.component_mapping);
          const css = asStringArray(evidence.css_constraints);
          if (!layout || layout.length < 3) errors.push("layout_primitives must contain at least 3 entries");
          if (!components || components.length < 5) errors.push("component_mapping must contain at least 5 entries");
          if (!css || css.length < 3) errors.push("css_constraints must contain at least 3 entries");
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "framework-compliance": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          if (evidence.skills_loaded !== true) errors.push("skills_loaded must be true");
          if (asPositiveInt(evidence.checks_total) === null || (evidence.checks_total as number) < 1) errors.push("checks_total must be >= 1");
          if (asNumber(evidence.checks_failed) !== 0) errors.push("checks_failed must be 0");
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "subagent-evidence": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          const agents = asStringArray(evidence.agents);
          if (!agents || agents.length === 0) errors.push("agents must list at least one executed agent");
          if (asPositiveInt(evidence.tasks_completed) === null || (evidence.tasks_completed as number) < 1) errors.push("tasks_completed must be >= 1");
          if (asNumber(evidence.failures) !== 0) errors.push("failures must be 0");
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "template-completeness": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          const templates = asStringArray(evidence.templates);
          if (!templates || templates.length === 0) errors.push("templates must list generated templates");
          if (asNumber(evidence.unresolved) !== 0) errors.push("unresolved must be 0");
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "recovery-evidence": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          if (evidence.state_restored !== true) errors.push("state_restored must be true");
          if (evidence.handoff_recorded !== true) errors.push("handoff_recorded must be true");
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "doc-cascade": {
        // Verify document cascade: current stage's produces should have
        // prior chain documents existing
        const skipped = new Set(state.skipped_stages);
        const cascadeDependencies: Record<string, Array<[string, string]>> = {
          "functional-design": [["application-design", "docs/aidlc/inception/application-design.md"], ["units-generation", "docs/aidlc/inception/units.md"]],
          "nfr-design": [["nfr-requirements", "docs/aidlc/construction/nfr-requirements.md"]],
          "code-generation": [["functional-design", "docs/aidlc/construction/functional-design.md"]],
          "build-and-test": [["code-review", "docs/aidlc/construction/code-review.md"]],
          "implementation-report": [["build-and-test", "docs/aidlc/construction/build-test-report.md"]],
          "operations": [["implementation-report", "docs/aidlc/construction/implementation-report.md"]],
        };
        const requiredDocs = (cascadeDependencies[stage.slug] || [])
          .filter(([dependency]) => !skipped.has(dependency))
          .map(([, document]) => document);
        const missingDocs = requiredDocs.filter((d) => !existsSync(join(PROJECT_ROOT, d)));
        if (missingDocs.length > 0) {
          failures.push({
            sensor: "doc-cascade",
            passed: false,
            message: `Document cascade broken — missing upstream docs: ${missingDocs.join(", ")}`,
          });
        }
        break;
      }

      case "reviewer-required": {
        // The review stage must produce a non-empty review record itself.
        const reviewProduces = (stage.produces || []).filter((pattern) => !pattern.endsWith("/"));
        const missingReview = reviewProduces.filter((pattern) => {
          const resolved = resolveProducePaths(pattern);
          return resolved.length === 0 || resolved.some((path) => statSync(path).size === 0);
        });
        if (reviewProduces.length === 0 || missingReview.length > 0) {
          failures.push({
            sensor: "reviewer-required",
            passed: false,
            message: missingReview.length > 0
              ? `Review record is missing or empty: ${missingReview.join(", ")}`
              : "reviewer-required requires a file produce containing the review record.",
          });
        }
        break;
      }

      default:
        // Unknown sensor — warn but don't fail
        failures.push({
          sensor,
          passed: false,
          message: `Unknown sensor "${sensor}" — cannot evaluate. Register it or remove from stage.`,
        });
        break;
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Condition evaluation — conditional stage execution
// ---------------------------------------------------------------------------

/**
 * Build condition context by inspecting project state.
 */
function buildConditionContext(): ConditionContext {
  // has_legacy_code: src/ has >10 files pre-existing
  let has_legacy_code = false;
  const srcDir = join(PROJECT_ROOT, "src");
  if (existsSync(srcDir)) {
    try {
      const fileCount = countFilesRecursive(srcDir);
      has_legacy_code = fileCount > 10;
    } catch { /* inaccessible, treat as no legacy */ }
  }

  // has_ui_requirements: user-stories.md contains 'UI' or '界面'
  let has_ui_requirements = false;
  const userStoriesPath = join(PROJECT_ROOT, "docs", "aidlc", "inception", "user-stories.md");
  if (existsSync(userStoriesPath)) {
    try {
      const content = readFileSync(userStoriesPath, "utf-8");
      has_ui_requirements = /\bUI\b|界面/.test(content);
    } catch { /* unreadable */ }
  }

  // has_reverse_output: reverse-engineering.md exists
  const reverseEngineeringPath = join(PROJECT_ROOT, "docs", "aidlc", "inception", "reverse-engineering.md");
  const has_reverse_output = existsSync(reverseEngineeringPath);

  // multi_module is derived only from upstream facts; never from units-generation's own output.
  let multi_module = false;
  const workspaceFactsPath = join(PROJECT_ROOT, ".aidlc", "workspace-facts.json");
  const moduleDivisionPath = join(PROJECT_ROOT, "docs", "aidlc", "ideation", "module-division.md");
  if (existsSync(workspaceFactsPath)) {
    try {
      const facts = JSON.parse(readFileSync(workspaceFactsPath, "utf-8")) as Record<string, unknown>;
      multi_module = Array.isArray(facts.modules) && facts.modules.length > 1;
    } catch { /* invalid facts are ignored and upstream document detection is used */ }
  }
  if (!multi_module && existsSync(moduleDivisionPath)) {
    try {
      const content = readFileSync(moduleDivisionPath, "utf-8");
      const moduleHeadings = content.match(/^##\s+(?!摘要|概述|Summary)/gim);
      multi_module = (moduleHeadings?.length ?? 0) > 1;
    } catch { /* unreadable */ }
  }
  if (!multi_module) {
    try {
      const packageJsonPath = join(PROJECT_ROOT, "package.json");
      if (existsSync(packageJsonPath)) {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
        multi_module = Array.isArray(pkg.workspaces) || (pkg.workspaces !== null && typeof pkg.workspaces === "object");
      }
    } catch { /* invalid package metadata */ }
  }

  const contextDocs = [
    join(PROJECT_ROOT, "docs", "aidlc", "inception", "requirements.md"),
    join(PROJECT_ROOT, "docs", "aidlc", "inception", "application-design.md"),
    join(PROJECT_ROOT, "docs", "aidlc", "inception", "workflow-plan.md"),
  ];
  const contextText = contextDocs
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf-8"))
    .join("\n");
  const has_nfr_needs = /NFR|非功能|性能|安全|可用性|可靠性|恢复|扩展性/i.test(contextText);
  const has_infra_needs = /基础设施|infrastructure|部署|容器|Kubernetes|Docker|Nacos|数据库|缓存|消息队列|分布式|外部系统/i.test(contextText);
  const has_test_case_sources = existsSync(join(PROJECT_ROOT, "docs", "aidlc", "inception", "application-design.md")) && (
    existsSync(join(PROJECT_ROOT, "docs", "aidlc", "inception", "user-stories.md")) || has_nfr_needs || has_infra_needs
  );

  // has_contract_dependencies: design references shared contract, API contract, or inter-module interface
  const has_contract_dependencies = /共享契约|shared.?contract|API.?contract|接口契约|proto|protobuf|OpenAPI|swagger/i.test(contextText);

  // has_subagent_support: workflow plan mentions subagent or parallel execution
  const workflowPlanPath = join(PROJECT_ROOT, "docs", "aidlc", "inception", "workflow-plan.md");
  let has_subagent_support = false;
  if (existsSync(workflowPlanPath)) {
    try {
      const wpContent = readFileSync(workflowPlanPath, "utf-8");
      has_subagent_support = /subagent|sub-agent|parallel|并行|mob/i.test(wpContent);
    } catch { /* unreadable */ }
  }

  // is_loeyae_boot: pom.xml or build.gradle references loeyae-boot framework
  let is_loeyae_boot = false;
  const pomPath = join(PROJECT_ROOT, "pom.xml");
  const gradlePath = join(PROJECT_ROOT, "build.gradle");
  if (existsSync(pomPath)) {
    try {
      is_loeyae_boot = /loeyae-boot|loeyae\.boot/i.test(readFileSync(pomPath, "utf-8"));
    } catch { /* unreadable */ }
  } else if (existsSync(gradlePath)) {
    try {
      is_loeyae_boot = /loeyae-boot|loeyae\.boot/i.test(readFileSync(gradlePath, "utf-8"));
    } catch { /* unreadable */ }
  }

  // context_compacted: state indicates context window compaction occurred (marker file)
  const context_compacted = existsSync(join(PROJECT_ROOT, ".aidlc", "context-compacted"));

  return {
    has_legacy_code,
    has_ui_requirements,
    has_reverse_output,
    multi_module,
    has_nfr_needs,
    has_infra_needs,
    has_test_case_sources,
    has_contract_dependencies,
    has_subagent_support,
    is_loeyae_boot,
    context_compacted,
  };
}

/**
 * Count files recursively in a directory (non-hidden files only).
 */
function countFilesRecursive(dir: string): number {
  let count = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFilesRecursive(fullPath);
    } else if (entry.isFile()) {
      count++;
    }
  }
  return count;
}

/**
 * Evaluate a condition string against the context.
 * Supported conditions (exact match):
 *   - 'has_legacy_code'
 *   - 'has_ui_requirements'
 *   - '!has_reverse_output' (negated)
 *   - 'multi_module'
 *   - '' (empty string — always true)
 */
function evaluateCondition(condition: string, context: ConditionContext): boolean | undefined {
  if (!condition || condition.trim() === "") return true;

  const trimmed = condition.trim();
  const negated = trimmed.startsWith("!");
  const name = negated ? trimmed.slice(1) : trimmed;
  if (!(name in context)) return undefined;

  const value = (context as unknown as Record<string, boolean>)[name];
  return negated ? !value : value;
}

/**
 * Find the next stage to execute: first executable stage whose
 * dependencies are all satisfied, condition evaluates to true,
 * and not yet completed or skipped.
 */
function findNextStage(
  executableStages: StageNode[],
  completedSlugs: string[],
  skippedSlugs: string[],
  state: WorkflowState
): {
  stage: StageNode | null;
  blocked?: { stage: StageNode; unsatisfied: string[] };
  conditionError?: { stage: StageNode; condition: string };
  skippedByCondition?: { stage: StageNode; reason: string }[];
} {
  const done = new Set([...completedSlugs, ...skippedSlugs]);
  const executableSlugs = new Set(executableStages.map((s) => s.slug));
  const conditionContext = buildConditionContext();
  const conditionSkips: { stage: StageNode; reason: string }[] = [];

  for (const s of executableStages) {
    if (done.has(s.slug)) continue;

    // Evaluate condition — if false, auto-skip
    if (s.condition && s.condition.trim() !== "") {
      const conditionResult = evaluateCondition(s.condition, conditionContext);
      if (conditionResult === undefined) {
        return { stage: null, conditionError: { stage: s, condition: s.condition }, skippedByCondition: conditionSkips.length > 0 ? conditionSkips : undefined };
      }
      if (!conditionResult) {
        conditionSkips.push({ stage: s, reason: "condition not met" });
        // Add to skipped in state (caller must persist)
        state.skipped_stages.push(s.slug);
        state.history.push({
          stage: s.slug,
          result: "condition_skipped",
          timestamp: new Date().toISOString(),
          user_input: `Auto-skipped: condition "${s.condition}" evaluated to false`,
        });
        done.add(s.slug);
        continue;
      }
    }

    // Check requires dependencies (only those in scope)
    const effectiveSkipped = [
      ...skippedSlugs,
      ...conditionSkips.map((item) => item.stage.slug),
    ];
    const unsatisfied = checkRequires(s, completedSlugs, effectiveSkipped, executableSlugs);
    if (unsatisfied.length > 0) {
      return { stage: null, blocked: { stage: s, unsatisfied }, skippedByCondition: conditionSkips.length > 0 ? conditionSkips : undefined };
    }

    return { stage: s, skippedByCondition: conditionSkips.length > 0 ? conditionSkips : undefined };
  }

  return { stage: null, skippedByCondition: conditionSkips.length > 0 ? conditionSkips : undefined };
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      flags[key] = val;
    } else {
      // Positional args become "text"
      flags.text = (flags.text ? flags.text + " " : "") + args[i];
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// next — compute the next directive without mutating state
// ---------------------------------------------------------------------------

async function handleNext(args: string[]): Promise<Directive> {
  const graph = loadGraph();
  const flags = parseFlags(args);

  // Check for --resume flag
  const isResume = "resume" in flags;

  // Check for --scope flag (initializes a new workflow)
  const scopeFlag = flags.scope;
  if (scopeFlag && !VALID_SCOPES.has(scopeFlag)) {
    return {
      kind: "error",
      message: `Unknown scope "${scopeFlag}". Valid scopes: ${[...VALID_SCOPES].join(", ")}`,
    };
  }

  // Check for --status flag
  if ("status" in flags) {
    const state = loadState();
    if (!state) {
      return { kind: "print", message: "No active workflow. Start with: aidlc-orchestrate next --scope <scope> \"<description>\"" };
    }
    const exec = getExecutableStages(graph, state.scope);
    const remaining = exec.filter((s) => !state.completed_stages.includes(s.slug) && !state.skipped_stages.includes(s.slug));
    return {
      kind: "print",
      message: `📊 Workflow Status\n` +
        `  Scope: ${state.scope} | Phase: ${state.current_phase} | Status: ${state.status}\n` +
        `  Current stage: ${state.current_stage || "(none)"}\n` +
        `  Completed: ${state.completed_stages.length}/${exec.length} stages\n` +
        `  Skipped: ${state.skipped_stages.length}\n` +
        `  Remaining: ${remaining.length} (${remaining.map((s) => s.slug).join(", ")})`,
    };
  }

  // Load or create state
  let state = loadState();

  if (!state) {
    // No workflow exists — need scope to initialize
    if (!scopeFlag) {
      return {
        kind: "ask",
        question: "No active workflow found. Which scope should this workflow use?",
        options: ["feature", "enterprise", "mvp", "classic", "express", "workshop", "bugfix", "refactor", "poc"],
        ask_type: "scope-selection",
      } as unknown as Directive;
    }
    // Initialize a new workflow, or resume an interrupted first commit that
    // already created a pending project enrollment.
    const enrollment = readEnrollment(PROJECT_ROOT);
    const pendingWorkflowId = enrollment?.status === "pending" ? enrollment.workflow_id : undefined;
    state = createInitialState(scopeFlag, "2.1.5", pendingWorkflowId);
    saveState(state);
    return {
      kind: "print",
      message: `✅ Workflow initialized with scope: ${scopeFlag}\n` +
        `  Executable stages: ${getExecutableStages(graph, scopeFlag).length}/${graph.stage_count}\n` +
        `  Run 'next' again to get the first stage directive.`,
    };
  }

  // Parked workflow — resume or report parked
  if (state.status === "parked") {
    if (!isResume) {
      return {
        kind: "parked",
        stage: state.current_stage,
        message: `Workflow is parked at stage "${state.current_stage}". Pass --resume to continue.`,
      };
    }
    // Resume: clear parked status
    state.status = "running";
    saveState(state);
  }

  // Done workflow
  if (state.status === "done") {
    return { kind: "done", message: "Workflow is already complete." };
  }

  // Find next executable stage (with condition evaluation)
  const executableStages = getExecutableStages(graph, state.scope);
  const { stage: nextStage, blocked, conditionError, skippedByCondition } = findNextStage(executableStages, state.completed_stages, state.skipped_stages, state);

  // Persist any condition-based skips
  if (skippedByCondition && skippedByCondition.length > 0) {
    saveState(state);
  }

  if (conditionError) {
    return {
      kind: "error",
      message: `🚫 Unknown stage condition "${conditionError.condition}" on "${conditionError.stage.slug}". Register the condition in the engine before continuing.`,
    };
  }

  if (blocked) {
    // Stage exists but dependencies not met — report blocker
    return {
      kind: "error",
      message: `🚫 Stage "${blocked.stage.slug}" (${blocked.stage.name}) is blocked.\n` +
        `  Unsatisfied requires: ${blocked.unsatisfied.join(", ")}\n` +
        `  These stages must be completed first.` +
        (skippedByCondition && skippedByCondition.length > 0
          ? `\n  ⏭️ Auto-skipped by condition: ${skippedByCondition.map((s) => s.stage.slug).join(", ")}`
          : ""),
    };
  }

  if (!nextStage) {
    // All stages done
    state.status = "done";
    state.current_stage = "";
    saveState(state);
    return {
      kind: "done",
      message: `🎉 All ${state.completed_stages.length} stages complete. Workflow finished.`,
    };
  }

  const consumeFailures = checkConsumes(nextStage, state, graph);
  if (consumeFailures.length > 0) {
    return {
      kind: "error",
      message: `🚫 Stage "${nextStage.slug}" is missing canonical consumed artifacts:\n${consumeFailures.map((failure) => `  ❌ ${failure}`).join("\n")}`,
    };
  }

  state.current_stage = nextStage.slug;
  state.current_phase = nextStage.phase;
  const gate = nextStage.approval === "block";
  if (gate && !state.approval_challenges[nextStage.slug]) {
    state.approval_challenges[nextStage.slug] = `${Date.now()}.${randomBytes(24).toString("hex")}`;
  }
  saveState(state);

  return {
    kind: "run-stage",
    stage: nextStage.slug,
    stage_file: join("core", nextStage.file),
    name: nextStage.name,
    number: nextStage.number,
    phase: nextStage.phase,
    lead_agent: nextStage.lead_agent,
    support_agents: nextStage.support_agents,
    mode: nextStage.mode,
    gate,
    approval: nextStage.approval,
    completion_contract: nextStage.completion_contract,
    approval_challenge: gate ? state.approval_challenges[nextStage.slug] : undefined,
    consumes: nextStage.consumes,
    produces: nextStage.produces,
    sensors: nextStage.sensors,
  };
}

// ---------------------------------------------------------------------------
// report — validate and record a stage outcome
// ---------------------------------------------------------------------------

async function handleReport(args: string[]): Promise<Directive> {
  const flags = parseFlags(args);
  const stageSlug = flags.stage;
  const result = flags.result as StageResult;
  const userInput = flags["user-input"];
  const approvalTokenValue = flags["approval-token"] || process.env.AIDLC_APPROVAL_TOKEN;

  // Validate required fields
  if (!stageSlug) {
    return { kind: "error", message: "report requires --stage <slug>" };
  }
  if (!result) {
    return { kind: "error", message: "report requires --result <outcome>. Valid: " + VALID_RESULTS.join(", ") };
  }
  if (!VALID_RESULTS.includes(result)) {
    return { kind: "error", message: `Invalid result "${result}". Valid: ${VALID_RESULTS.join(", ")}` };
  }

  // Load state
  const state = loadState();
  if (!state) {
    return { kind: "error", message: "No active workflow. Cannot report." };
  }
  if (state.status !== "running") {
    return { kind: "error", message: `Workflow is ${state.status}, not running. Cannot report.` };
  }

  // Validate stage matches current
  if (state.current_stage !== stageSlug) {
    return {
      kind: "error",
      message: `Stage mismatch: current is "${state.current_stage}", but report is for "${stageSlug}". ` +
        `Cannot report on a stage that is not the active one.`,
    };
  }

  const graph = loadGraph();
  const stageNode = graph.stages.find((stage) => stage.slug === stageSlug);
  if (!stageNode) {
    return { kind: "error", message: `Unknown stage "${stageSlug}".` };
  }
  if (result === "completed" && stageNode.approval === "block") {
    return { kind: "error", message: `Stage "${stageSlug}" requires trusted approval. Supply the host-issued one-time token with --result approved --approval-token <token>.` };
  }
  if (result === "approved") {
    if (stageNode.approval !== "block") {
      return { kind: "error", message: `Stage "${stageSlug}" is not an approval gate and cannot use --result approved.` };
    }
    const challenge = state.approval_challenges[stageSlug];
    if (!challenge) return { kind: "error", message: `No active approval challenge for stage "${stageSlug}". Run next to obtain one.` };
    const issuedAt = Number(challenge.split(".", 1)[0]);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 15 * 60 * 1000 || issuedAt > Date.now() + 60 * 1000) {
      delete state.approval_challenges[stageSlug];
      saveState(state);
      return { kind: "error", message: `Approval challenge for stage "${stageSlug}" expired. Run next to obtain a new challenge.` };
    }
    if (!approvalTokenValue) return { kind: "error", message: `Stage "${stageSlug}" requires --approval-token from a trusted human approval channel.` };
    if (!verifyApprovalToken(state.workflow_id, stageSlug, challenge, approvalTokenValue)) {
      return { kind: "error", message: `Invalid or stale approval token for stage "${stageSlug}".` };
    }
  }
  if (stageNode.completion_contract === "instruction_only" && result === "completed" && flags["instruction-ack"] !== stageSlug) {
    return {
      kind: "error",
      message: `Stage "${stageSlug}" is instruction-only and cannot be auto-completed by a lifecycle Hook. After executing its body, report again with --instruction-ack ${stageSlug}.`,
    };
  }

  // Record history entry
  const entry: HistoryEntry = {
    stage: stageSlug,
    result,
    timestamp: new Date().toISOString(),
  };
  if (userInput) entry.user_input = userInput;

  // --- P0 Gate: Validate consumes and produces before allowing completion ---
  if (result === "completed" || result === "approved") {
      const consumeFailures = checkConsumes(stageNode, state, graph);
      if (consumeFailures.length > 0) {
        return {
          kind: "error",
          message: `🚫 Cannot complete stage "${stageSlug}" — canonical consumed artifacts are no longer valid:\n` +
            consumeFailures.map((failure) => `  ❌ ${failure}`).join("\n"),
        };
      }

      // Check produces (准出 — artifact existence)
      const missingProduces = checkProduces(stageNode);
      if (missingProduces.length > 0) {
        return {
          kind: "error",
          message: `🚫 Cannot complete stage "${stageSlug}" — required produces not found:\n` +
            missingProduces.map((p) => `  ❌ ${p}`).join("\n") +
            `\n\nGenerate these artifacts first, then report again.`,
        };
      }

      // Check sensors (准出 — quality gates)
      const sensorFailures = await checkSensors(stageNode, state);
      if (sensorFailures.length > 0) {
        return {
          kind: "error",
          message: `🚫 Cannot complete stage "${stageSlug}" — sensor checks failed:\n` +
            sensorFailures.map((f) => `  ❌ [${f.sensor}] ${f.message}`).join("\n") +
            `\n\nFix sensor failures, then report again.`,
        };
      }
  }

  state.history.push(entry);

  // Process result — auto-advance after all applicable gates pass
  switch (result) {
    case "completed":
    case "approved":
      state.completed_stages.push(stageSlug);
      state.current_stage = "";
      if (result === "approved") delete state.approval_challenges[stageSlug];
      break;

    case "rejected":
      break;

    case "revised":
      break;
  }

  saveState(state);

  // Return confirmation
  switch (result) {
    case "completed":
    case "approved":
      return {
        kind: "print",
        message: `✅ Stage "${stageSlug}" ${result}. Run 'next' for the next stage.`,
      };
    case "rejected":
      return {
        kind: "print",
        message: `🔄 Stage "${stageSlug}" rejected. Revise and report --result revised, then re-report --result completed.`,
      };
    case "revised":
      return {
        kind: "print",
        message: `📝 Stage "${stageSlug}" revised. Report --result completed when ready.`,
      };
  }
}

// ---------------------------------------------------------------------------
// park — save workflow for later resume
// ---------------------------------------------------------------------------

async function handlePark(): Promise<Directive> {
  const state = loadState();
  if (!state) {
    return { kind: "error", message: "No active workflow to park." };
  }
  if (state.status !== "running") {
    return { kind: "error", message: `Workflow is ${state.status}, not running. Cannot park.` };
  }

  state.status = "parked";
  saveState(state);

  return {
    kind: "parked",
    stage: state.current_stage,
    message: `Workflow parked at stage "${state.current_stage}". Resume with 'next --resume'.`,
  };
}

// ---------------------------------------------------------------------------
// continue — steering chain transport (placeholder for rule loading)
// ---------------------------------------------------------------------------

async function handleContinue(token: string): Promise<Directive> {
  // In v2, load-steering chains are simplified:
  // The agent loads stage files directly. This is a passthrough.
  return {
    kind: "print",
    message: `[Engine] Continue token "${token}" acknowledged. Agent should load the stage file directly.`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseSubcommand(args: string[]): { cmd: Subcommand; rest: string[] } {
  const cmd = args[0] as Subcommand;
  if (!SUBCOMMANDS.includes(cmd)) {
    console.error(
      JSON.stringify({
        kind: "error",
        message: `Unknown subcommand: ${args[0]}. Use: ${SUBCOMMANDS.join(", ")}`,
      })
    );
    process.exit(1);
  }
  return { cmd, rest: args.slice(1) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      JSON.stringify({
        kind: "error",
        message: "Usage: aidlc-orchestrate.ts <next|continue|report|park> [args...]",
      })
    );
    process.exit(1);
  }

  const { cmd, rest } = parseSubcommand(args);

  let directive: Directive;
  switch (cmd) {
    case "next":
      directive = await handleNext(rest);
      break;
    case "report":
      directive = await handleReport(rest);
      break;
    case "park":
      directive = await handlePark();
      break;
    case "continue":
      directive = await handleContinue(rest[0] || "");
      break;
  }

  console.log(JSON.stringify(directive, null, 2));
  if (directive.kind === "error") process.exitCode = 2;
}

main().catch((error) => {
  console.error(JSON.stringify({
    kind: "error",
    message: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(2);
});
