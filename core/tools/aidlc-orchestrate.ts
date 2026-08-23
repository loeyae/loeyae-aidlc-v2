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

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = resolve(__dirname, "..");
const GRAPH_PATH = join(__dirname, "data", "stage-graph.json");

// State file lives in the user's project (CWD-relative)
const PROJECT_ROOT = process.cwd();
const STATE_DIR = join(PROJECT_ROOT, "docs", "aidlc");
const STATE_PATH = join(STATE_DIR, "aidlc-state.json");

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
  consumes: string[];
  produces: string[];
  sensors: string[];
  condition: string;
  approval: "block" | "confirm" | "notify";
  file: string;
}

interface StageGraph {
  version: string;
  compiled_at: string;
  stages: StageNode[];
  stage_count: number;
}

interface WorkflowState {
  version: string;
  scope: string;
  depth: string;
  current_phase: string;
  current_stage: string;
  status: "running" | "parked" | "done";
  completed_stages: string[];
  skipped_stages: string[];
  history: HistoryEntry[];
  created_at: string;
  updated_at: string;
}

interface HistoryEntry {
  stage: string;
  result: string;
  timestamp: string;
  user_input?: string;
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

const VALID_RESULTS = ["completed", "approved", "rejected", "revised", "skipped"] as const;
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
  if (!existsSync(STATE_PATH)) return null;
  return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
}

function saveState(state: WorkflowState): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
  state.updated_at = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function createInitialState(scope: string): WorkflowState {
  return {
    version: "2.0.0",
    scope,
    depth: "standard",
    current_phase: "ideation",
    current_stage: "",
    status: "running",
    completed_stages: [],
    skipped_stages: [],
    history: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
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

function checkDynamicProduce(pattern: string): boolean {
  const marker = pattern.match(/\{[^}]+\}/);
  if (!marker || marker.index === undefined) return false;

  const prefix = pattern.slice(0, marker.index);
  const suffix = pattern.slice(marker.index + marker[0].length);
  const base = join(PROJECT_ROOT, prefix);
  if (!existsSync(base) || !statSync(base).isDirectory()) return false;

  return readdirSync(base)
    .filter((entry) => !entry.startsWith("."))
    .some((entry) => {
      const candidate = suffix.startsWith("/")
        ? join(base, entry, suffix)
        : join(base, entry);
      if (!existsSync(candidate)) return false;
      if (!suffix.startsWith("/") && !entry.endsWith(suffix)) return false;
      if (statSync(candidate).isDirectory()) {
        return readdirSync(candidate).some((child) => !child.startsWith("."));
      }
      return statSync(candidate).size > 0;
    });
}

/**
 * Check if produces files exist (glob and dynamic unit paths resolved against PROJECT_ROOT).
 * Dynamic `{unit-name}` and `{unit-id}` paths require at least one real matching unit.
 */
function checkProduces(stage: StageNode): string[] {
  if (!stage.produces || stage.produces.length === 0) return [];
  const missing: string[] = [];
  for (const pattern of stage.produces) {
    if (pattern.includes("{") && !checkDynamicProduce(pattern)) {
      missing.push(pattern);
      continue;
    }

    const target = join(PROJECT_ROOT, pattern);
    if (!pattern.includes("{") && !existsSync(target)) {
      missing.push(pattern);
      continue;
    }
    if (pattern.includes("{")) continue;

    // A directory produce is valid only when it contains at least one
    // non-hidden entry. Existence alone would allow an empty placeholder.
    if (pattern.endsWith("/") || statSync(target).isDirectory()) {
      const entries = readdirSync(target).filter((entry) => !entry.startsWith("."));
      if (entries.length === 0) missing.push(pattern);
      continue;
    }

    if (statSync(target).size === 0) missing.push(pattern);
  }
  return missing;
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
  const errors = required(loaded.value as Evidence);
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
        // Grep produces files for TODO/FIXME/HACK
        const todoFiles: string[] = [];
        for (const pattern of stage.produces || []) {
          if (pattern.includes("*")) continue; // skip globs for simplicity
          const filePath = join(PROJECT_ROOT, pattern);
          if (existsSync(filePath)) {
            try {
              const content = readFileSync(filePath, "utf-8");
              if (/\b(TODO|FIXME|HACK)\b/.test(content)) {
                todoFiles.push(pattern);
              }
            } catch { /* unreadable file, skip */ }
          }
        }
        if (todoFiles.length > 0) {
          failures.push({
            sensor: "no-todo",
            passed: false,
            message: `Found TODO/FIXME/HACK in: ${todoFiles.join(", ")}`,
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
        // Check that produces files contain at least one requirement reference (REQ-xxx or R-xxx pattern)
        const untraced: string[] = [];
        for (const pattern of stage.produces || []) {
          if (pattern.includes("*")) continue;
          const filePath = join(PROJECT_ROOT, pattern);
          if (existsSync(filePath)) {
            try {
              const content = readFileSync(filePath, "utf-8");
              if (!/\b(REQ-\w+|R-\d+)\b/.test(content)) {
                untraced.push(pattern);
              }
            } catch { /* unreadable file, skip */ }
          }
        }
        if (untraced.length > 0) {
          failures.push({
            sensor: "traceability",
            passed: false,
            message: `No requirement ID (REQ-xxx) found in: ${untraced.join(", ")}`,
          });
        }
        break;
      }

      case "build-test-evidence": {
        const failure = validateEvidence(stage, sensor, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');

          // Commands validation — each must have cmd, exit_code=0, status=passed
          const commands = Array.isArray(evidence.commands) ? evidence.commands : [];
          if (commands.length === 0) errors.push("commands must contain at least one executed command");
          for (let i = 0; i < commands.length; i++) {
            const record = asRecord(commands[i]);
            if (!record) {
              errors.push(`commands[${i}] must be an object`);
              continue;
            }
            if (!asNonEmptyString(record.cmd)) errors.push(`commands[${i}].cmd must be a non-empty string`);
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
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          if (evidence.source_format !== "svg") errors.push('source_format must be "svg"');
          const diagrams = asPositiveInt(evidence.diagrams_checked);
          if (diagrams === null || diagrams < 1) errors.push("diagrams_checked must be >= 1");
          if (evidence.ids_unique !== true) errors.push("ids_unique must be true");
          if (evidence.ports_valid !== true) errors.push("ports_valid must be true");
          if (evidence.direction_consistent !== true) errors.push("direction_consistent must be true");
          if (evidence.legend_valid !== true) errors.push("legend_valid must be true");
          if (evidence.groups_valid !== true) errors.push("groups_valid must be true");
          if (evidence.viewbox_valid !== true) errors.push("viewbox_valid must be true");
          if (!["passed", "unverified", "not_required"].includes(String(evidence.provider_status))) errors.push('provider_status must be "passed", "unverified" or "not_required"');
          if (typeof evidence.target_operation_required !== "boolean") errors.push("target_operation_required must be boolean");
          if (evidence.target_operation_required === true && evidence.provider_status !== "passed") errors.push('provider_status must be "passed" when target_operation_required is true');
          if (evidence.fr_mapping_complete !== true) errors.push("fr_mapping_complete must be true");
          if (asNumber(evidence.unresolved) !== 0) errors.push("unresolved must be 0");
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
          if (pattern.includes("{")) return !checkDynamicProduce(pattern);
          const reviewPath = join(PROJECT_ROOT, pattern);
          return !existsSync(reviewPath) || statSync(reviewPath).size === 0;
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

  // multi_module: units.md has >1 unit section (## headings)
  let multi_module = false;
  const unitsPath = join(PROJECT_ROOT, "docs", "aidlc", "inception", "units.md");
  if (existsSync(unitsPath)) {
    try {
      const content = readFileSync(unitsPath, "utf-8");
      const unitHeadings = content.match(/^## /gm);
      multi_module = (unitHeadings?.length ?? 0) > 1;
    } catch { /* unreadable */ }
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
          result: "skipped",
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
    // Initialize new workflow
    state = createInitialState(scopeFlag);
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

  // Update current stage pointer (next is read-mostly but updates the cursor for resume)
  state.current_stage = nextStage.slug;
  state.current_phase = nextStage.phase;
  saveState(state);

  const gate = nextStage.approval === "block";

  // Build the run-stage directive
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
  const reason = flags.reason;

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
  if (result === "skipped" && stageNode.execution === "ALWAYS") {
    return { kind: "error", message: `Stage "${stageSlug}" is ALWAYS and cannot be skipped.` };
  }
  if (result === "completed" && stageNode.approval === "block") {
    return { kind: "error", message: `Stage "${stageSlug}" requires explicit approval. Re-report with --result approved after the decision is confirmed.` };
  }

  // Record history entry
  const entry: HistoryEntry = {
    stage: stageSlug,
    result,
    timestamp: new Date().toISOString(),
  };
  if (userInput) entry.user_input = userInput;

  // --- P0 Gate: Validate produces before allowing completion ---
  if (result === "completed" || result === "approved") {
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
      state.current_stage = ""; // cleared — next `next` will find the successor
      break;

    case "skipped":
      if (!reason) {
        return { kind: "error", message: "Skipping a stage requires --reason <explanation>" };
      }
      state.skipped_stages.push(stageSlug);
      state.current_stage = "";
      break;

    case "rejected":
      // Stage stays current — agent must revise and re-report
      break;

    case "revised":
      // After revision, stays current for re-completion attempt
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
    case "skipped":
      return {
        kind: "print",
        message: `⏭️ Stage "${stageSlug}" skipped: ${reason}. Run 'next' for the next stage.`,
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
}

main();
