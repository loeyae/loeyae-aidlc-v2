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
import {
  buildApprovalProviderRequest,
  validateApprovalConversationConfirmation,
  validateApprovalProviderResponse,
} from "./aidlc-approval-provider";
import { readSourceRevision } from "./aidlc-revision";
import {
  evidenceRelativePath,
  isEvidenceArtifactLabel,
  moduleInceptionRoot,
  normalizeArtifactLabel,
  readModuleManifest,
  readUnitManifest,
  stageInstanceId,
  substituteArtifactPattern,
  unitConstructionRoot,
  type ExecutionAxis,
  type ExecutionContext,
  type ModuleDescriptor,
  type UnitDescriptor,
} from "./aidlc-execution-context";
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

export interface StageNode {
  slug: string;
  number: string;
  name: string;
  phase: string;
  axis: ExecutionAxis;
  execution: "ALWAYS" | "CONDITIONAL";
  selection: "automatic" | "user";
  choices: string[];
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

export interface StageGraph {
  version: string;
  stages: StageNode[];
  stage_count: number;
}

export interface StageInstance extends ExecutionContext {
  stage: StageNode;
  axis: ExecutionAxis;
  instance_id: string;
}

export interface Directive {
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

export interface ConditionContext {
  has_legacy_code: boolean;
  has_ui_requirements: boolean;
  has_reverse_output: boolean;
  multi_module: boolean;
  has_product_contract_needs: boolean;
  has_nfr_needs: boolean;
  has_infra_needs: boolean;
  has_test_case_sources: boolean;
  has_contract_dependencies: boolean;
  has_subagent_support: boolean;
  is_loeyae_boot: boolean;
  context_compacted: boolean;
  ui_design_selected: boolean;
  ui_mode_html_mock: boolean;
  ui_mode_figma: boolean;
  has_application_design_needs: boolean;
  has_unit_generation_needs: boolean;
  has_functional_design_needs: boolean;
  needs_ui_implementation_bridge: boolean;
  has_deployment_needs: boolean;
  has_operations_template_needs: boolean;
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

const FULL_WORKFLOW_SCOPES = new Set(["feature", "enterprise", "mvp", "classic"]);
const PRD_ELIGIBLE_SCOPES = new Set(FULL_WORKFLOW_SCOPES);

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

export function loadGraph(): StageGraph {
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

export function runtimeChoices(stage: StageNode, state: WorkflowState): string[] {
  if (stage.slug === "workspace-detection" && !FULL_WORKFLOW_SCOPES.has(state.scope)) return [];
  return stage.choices || [];
}

/**
 * Filter stages by scope and the immutable user selections captured in signed
 * workflow state. User-selected stages never enter the default path.
 */
export function getExecutableStages(
  graph: StageGraph,
  scope: string,
  selectedOptionalStages: string[] = [],
): StageNode[] {
  const selected = new Set(selectedOptionalStages);
  return graph.stages.filter((stage) =>
    (stage.execution === "ALWAYS" || stage.scopes.includes(scope))
    && (stage.selection !== "user" || selected.has(stage.slug))
  );
}

const DEFAULT_MODULE: ModuleDescriptor = { module_id: "project", name: "Project", service_id: "not-applicable" };
const DEFAULT_UNIT: UnitDescriptor = { unit_id: "default", name: "Default", service_id: "not-applicable" };

export function selectedOptionalStages(state: WorkflowState): string[] {
  if (state.selected_optional_stages !== undefined) return state.selected_optional_stages;
  const legacyPrdWasResolved = state.completed_stages.includes("prd-generation")
    || state.skipped_stages.includes("prd-generation");
  const legacyPrdIsActive = state.current_stage === "prd-generation";
  return legacyPrdWasResolved || legacyPrdIsActive ? ["prd-generation"] : [];
}

const ARCHITECTURE_CHOICES = new Set(["single-module", "multi-module"]);
const UI_DESIGN_CHOICES = new Set(["html-mock", "figma-create", "figma-existing", "skip"]);
const FIGMA_ROUTE_STAGES = new Set(["ui-figma", "ui-figma-generation"]);
const HTML_MOCK_ROUTE_STAGES = new Set([
  "ui-mock-workflow",
  "ui-mock-design-spec",
  "ui-mock-styles",
  "ui-mock-reasoning-principles",
  "ui-mock-generation",
]);

function recordedStageChoice(state: WorkflowState, stageSlug: string, moduleId?: string): string | undefined {
  return [...state.history].reverse().find((entry) =>
    entry.stage === stageSlug
    && (entry.result === "completed" || entry.result === "approved")
    && (!moduleId || entry.module_id === moduleId)
    && typeof entry.user_input === "string"
  )?.user_input;
}

export function architectureChoice(state: WorkflowState): string | undefined {
  const recorded = recordedStageChoice(state, "workspace-detection");
  return recorded && ARCHITECTURE_CHOICES.has(recorded) ? recorded : undefined;
}

function uiDesignChoice(state: WorkflowState, moduleId?: string): string | undefined {
  const recorded = recordedStageChoice(state, "ui-mock", moduleId);
  if (recorded && UI_DESIGN_CHOICES.has(recorded)) return recorded;

  const routerResolvedWithoutChoice = state.history.some((entry) =>
    entry.stage === "ui-mock"
    && entry.result === "condition_skipped"
    && (!moduleId || entry.module_id === moduleId)
  );
  // A current signed architecture choice identifies the new routing contract.
  // Missing/condition-skipped UI choices in that contract mean "not selected";
  // stale files must never reactivate a branch. Filesystem fallback is retained
  // only for older signed workflows that predate runtime UI choices.
  if (routerResolvedWithoutChoice || architectureChoice(state)) return undefined;

  // Compatibility for signed workflows created before runtime choices were
  // recorded. Preserve an already active/resolved branch rather than changing
  // its route during upgrade.
  const matchingLegacyStage = (slug: string): boolean => {
    if (state.current_stage === slug && (!moduleId || state.current_module === moduleId)) return true;
    return state.history.some((entry) => entry.stage === slug && (!moduleId || entry.module_id === moduleId));
  };
  if ([...FIGMA_ROUTE_STAGES].some(matchingLegacyStage)) return "figma-create";
  if ([...HTML_MOCK_ROUTE_STAGES].some(matchingLegacyStage)) return "html-mock";

  const htmlRoot = moduleId
    ? join(PROJECT_ROOT, "docs", "aidlc", "modules", moduleId, "inception", "ui-mock")
    : join(PROJECT_ROOT, "docs", "aidlc", "inception", "ui-mock");
  return existsSync(htmlRoot) ? "html-mock" : undefined;
}

function runtimeStage(instance: StageInstance, state: WorkflowState): StageNode {
  const stage = instance.stage;
  let consumes = [...stage.consumes];
  let produces = [...stage.produces];
  let sensors = [...stage.sensors];

  if (stage.slug === "cross-validation" && instance.module_id) {
    if (selectedOptionalStages(state).includes("prd-generation")) {
      consumes.push(
        "docs/aidlc/ideation/prd.md",
        ".aidlc/evidence/prd-generation/prd-completeness.json",
      );
    }
    const choice = uiDesignChoice(state, instance.module_id);
    if (choice === "html-mock" || choice === "figma-create" || choice === "figma-existing") {
      consumes.push(
        "docs/aidlc/modules/{module-id}/inception/ui-design/page-plan.md",
        ".aidlc/evidence/ui-page-planning/{module-id}/ui-artifact-consistency.json",
      );
      if (choice === "html-mock") {
        consumes.push(
          "docs/aidlc/modules/{module-id}/inception/ui-mock/",
          ".aidlc/evidence/ui-mock-generation/{module-id}/ui-artifact-consistency.json",
        );
      } else {
        consumes.push(
          "docs/aidlc/modules/{module-id}/inception/ui-design/figma-manifest.json",
          ".aidlc/evidence/ui-figma-generation/{module-id}/ui-artifact-consistency.json",
        );
      }
    }
  }

  if (stage.slug === "code-review") {
    const choice = uiDesignChoice(state, instance.module_id);
    const uiSelected = choice === "html-mock" || choice === "figma-create" || choice === "figma-existing";
    if (!uiSelected) {
      sensors = sensors.filter((sensor) => sensor !== "ui-design-alignment");
      produces = produces.filter((pattern) => !pattern.endsWith("/ui-design-alignment.json"));
    }
  }

  return {
    ...stage,
    consumes: [...new Set(consumes)],
    produces: [...new Set(produces)],
    sensors: [...new Set(sensors)],
  };
}

export function runtimeInstance(instance: StageInstance, state: WorkflowState): StageInstance {
  return { ...instance, stage: runtimeStage(instance, state) };
}

function completedInstanceIds(state: WorkflowState): string[] {
  return state.completed_stage_instances || state.completed_stages;
}

function skippedInstanceIds(state: WorkflowState): string[] {
  return state.skipped_stage_instances || state.skipped_stages;
}

function isInstanceResolved(state: WorkflowState, instanceId: string): boolean {
  return completedInstanceIds(state).includes(instanceId) || skippedInstanceIds(state).includes(instanceId);
}

export function makeInstance(stage: StageNode, axis: ExecutionAxis, context: ExecutionContext = {}): StageInstance {
  return { stage, axis, ...context, instance_id: stageInstanceId(stage.slug, axis, context) };
}

function routingModules(state: WorkflowState): ModuleDescriptor[] {
  if (state.routing_model !== "module-unit-v1") return [DEFAULT_MODULE];
  if (!state.completed_stages.includes("module-division")) return [DEFAULT_MODULE];
  return readModuleManifest(PROJECT_ROOT);
}

function routingUnits(state: WorkflowState, modules: ModuleDescriptor[]): Array<{ module: ModuleDescriptor; unit: UnitDescriptor }> {
  if (state.routing_model !== "module-unit-v1") return [{ module: DEFAULT_MODULE, unit: DEFAULT_UNIT }];
  return modules.flatMap((module) => {
    const unitsStage = stageInstanceId("units-generation", "module", { module_id: module.module_id });
    if (completedInstanceIds(state).includes(unitsStage)) {
      return readUnitManifest(PROJECT_ROOT, module.module_id).map((unit) => ({ module, unit }));
    }
    // A condition-skipped I14 intentionally uses one deterministic default
    // unit; it must not require a unit-manifest that the skipped Stage did not
    // produce.
    return [{ module, unit: DEFAULT_UNIT }];
  });
}

/**
 * Expand the static graph into deterministic project/module/unit instances.
 * Consecutive module stages run module-major; consecutive unit stages run unit-major.
 */
export function expandStageInstances(graph: StageGraph, state: WorkflowState): StageInstance[] {
  const stages = getExecutableStages(graph, state.scope, selectedOptionalStages(state));
  if (state.routing_model !== "module-unit-v1") return stages.map((stage) => makeInstance(stage, "project"));

  const modules = routingModules(state);
  const units = routingUnits(state, modules);
  const instances: StageInstance[] = [];
  for (let index = 0; index < stages.length;) {
    const axis = stages[index].axis;
    let end = index + 1;
    while (end < stages.length && stages[end].axis === axis) end++;
    const segment = stages.slice(index, end);
    if (axis === "project") {
      instances.push(...segment.map((stage) => makeInstance(stage, "project")));
    } else if (axis === "module") {
      for (const module of modules) {
        instances.push(...segment.map((stage) => makeInstance(stage, "module", { module_id: module.module_id })));
      }
    } else {
      for (const { module, unit } of units) {
        instances.push(...segment.map((stage) => makeInstance(stage, "unit", { module_id: module.module_id, unit_id: unit.unit_id })));
      }
    }
    index = end;
  }
  return instances;
}

export function dependencyInstances(instance: StageInstance, dependency: string, instances: StageInstance[]): StageInstance[] {
  const candidates = instances.filter((candidate) => candidate.stage.slug === dependency);
  if (instance.axis === "project") return candidates;
  if (instance.axis === "module") {
    return candidates.filter((candidate) => candidate.axis === "project" || candidate.module_id === instance.module_id);
  }
  return candidates.filter((candidate) => {
    if (candidate.axis === "project") return true;
    if (candidate.module_id !== instance.module_id) return false;
    return candidate.axis === "module" || candidate.unit_id === instance.unit_id;
  });
}

function checkRequires(instance: StageInstance, instances: StageInstance[], state: WorkflowState): string[] {
  const missing: string[] = [];
  for (const dependency of instance.stage.requires || []) {
    const required = dependencyInstances(instance, dependency, instances);
    if (required.length === 0) {
      if (!instance.stage.scope_waived_requires.includes(dependency)) missing.push(dependency);
      continue;
    }
    for (const candidate of required) if (!isInstanceResolved(state, candidate.instance_id)) missing.push(candidate.instance_id);
  }
  return missing;
}

function reconcileStageSummaries(state: WorkflowState, instances: StageInstance[]): void {
  if (state.routing_model !== "module-unit-v1") return;
  for (const stage of getExecutableStages(loadGraph(), state.scope, selectedOptionalStages(state))) {
    const stageInstances = instances.filter((instance) => instance.stage.slug === stage.slug);
    if (stageInstances.length === 0) continue;
    const completed = new Set(completedInstanceIds(state));
    const skipped = new Set(skippedInstanceIds(state));
    const allResolved = stageInstances.every((instance) => completed.has(instance.instance_id) || skipped.has(instance.instance_id));
    if (!allResolved) continue;
    if (stageInstances.every((instance) => skipped.has(instance.instance_id))) {
      if (!state.skipped_stages.includes(stage.slug)) state.skipped_stages.push(stage.slug);
    } else if (!state.completed_stages.includes(stage.slug)) {
      state.completed_stages.push(stage.slug);
    }
  }
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

function legacyArtifactPattern(pattern: string): string {
  return pattern
    .replace("docs/aidlc/ideation/module-manifest.json", "docs/aidlc/ideation/module-division.md")
    .replace(/docs\/aidlc\/modules\/\{module-id\}\/inception/g, "docs/aidlc/inception")
    .replace(/docs\/aidlc\/modules\/\{module-id\}\/construction\/\{unit-id\}/g, "docs/aidlc/construction/{unit-name}")
    .replace(/(\.aidlc\/evidence\/[^/]+)\/\{module-id\}\/\{unit-id\}/g, "$1")
    .replace(/(\.aidlc\/evidence\/[^/]+)\/\{module-id\}/g, "$1");
}

function artifactPlaceholderNames(pattern: string): string[] {
  return [...pattern.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

function isLegacyArtifactInstance(instance?: StageInstance): boolean {
  return Boolean(instance && instance.axis === "project" && instance.stage.axis !== "project");
}

function allowsProjectAggregate(instance: StageInstance | undefined, allowProjectAggregate: boolean): boolean {
  return Boolean(allowProjectAggregate && instance && instance.axis === "project" && instance.stage.axis === "project");
}

export function instanceArtifactPattern(pattern: string, instance?: StageInstance, allowProjectAggregate = false): string {
  if (!instance) return pattern;
  const legacy = isLegacyArtifactInstance(instance);
  const resolved = legacy ? legacyArtifactPattern(pattern) : substituteArtifactPattern(pattern, instance);
  const placeholders = artifactPlaceholderNames(resolved);
  const allowed = legacy
    ? new Set(["unit-name"])
    : allowsProjectAggregate(instance, allowProjectAggregate)
      ? new Set(["module-id", "unit-id"])
      : new Set<string>();
  const invalid = placeholders.filter((placeholder) => !allowed.has(placeholder));
  if (invalid.length > 0) {
    throw new Error(`Unresolved artifact placeholder(s) ${invalid.map((name) => `{${name}}`).join(", ")} for stage instance "${instance.instance_id}": ${pattern}`);
  }
  return resolved;
}

function escapeExpression(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function resolveProducePaths(pattern: string, instance?: StageInstance, allowProjectAggregate = false): string[] {
  const contextual = instanceArtifactPattern(pattern, instance, allowProjectAggregate).replace(/\\/g, "/");
  const expansionAllowed = isLegacyArtifactInstance(instance) || allowsProjectAggregate(instance, allowProjectAggregate);
  if (contextual.includes("*") && !expansionAllowed) {
    throw new Error(`Artifact wildcards are not allowed for stage instance "${instance?.instance_id || "unknown"}": ${pattern}`);
  }
  const target = join(PROJECT_ROOT, contextual);
  if (!contextual.includes("*") && !/\{[^}]+\}/.test(contextual)) return collectFiles(target);

  const wildcard = contextual.replace(/\{(?:module-id|unit-id|unit-name)\}/g, "*");
  const wildcardIndex = wildcard.indexOf("*");
  const slashIndex = wildcard.lastIndexOf("/", wildcardIndex);
  const basePattern = slashIndex >= 0 ? wildcard.slice(0, slashIndex) : ".";
  const base = join(PROJECT_ROOT, basePattern);
  if (!existsSync(base) || !statSync(base).isDirectory()) return [];
  const relativePattern = wildcard.slice(slashIndex + 1);
  const expression = new RegExp(`^${escapeExpression(relativePattern).replace(/\*/g, "[^/]+")}$`);
  return collectFiles(base).filter((path) => expression.test(relative(base, path).replace(/\\/g, "/")));
}

/**
 * Check if produces files exist (including directories and dynamic unit paths).
 */
const MIN_ARTIFACT_BYTES = 16;

export function checkProduces(instance: StageInstance): string[] {
  const stage = instance.stage;
  if (!stage.produces || stage.produces.length === 0) return [];
  const missing: string[] = [];
  for (const pattern of stage.produces) {
    const paths = resolveProducePaths(pattern, instance);
    if (paths.length === 0) {
      missing.push(instanceArtifactPattern(pattern, instance));
      continue;
    }

    if (pattern.endsWith("/") || paths.some((path) => statSync(path).isDirectory())) {
      const hasSubstantiveFile = paths.some((path) => statSync(path).size >= MIN_ARTIFACT_BYTES);
      if (!hasSubstantiveFile) missing.push(instanceArtifactPattern(pattern, instance));
      continue;
    }

    if (paths.some((path) => statSync(path).size < MIN_ARTIFACT_BYTES)) missing.push(instanceArtifactPattern(pattern, instance));
  }
  return missing;
}

export function checkConsumes(instance: StageInstance, state: WorkflowState, graph: StageGraph, instances: StageInstance[]): string[] {
  const stage = instance.stage;
  const failures: string[] = [];
  for (const pattern of stage.consumes || []) {
    const resolvedPattern = instanceArtifactPattern(pattern, instance, true);
    let paths: string[] = [];
    try {
      paths = resolveProducePaths(pattern, instance, true);
    } catch (error) {
      failures.push(`${resolvedPattern}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (paths.length === 0 || paths.some((path) => lstatSync(path).isFile() && lstatSync(path).size < MIN_ARTIFACT_BYTES)) {
      failures.push(`${resolvedPattern}: missing or smaller than ${MIN_ARTIFACT_BYTES} bytes`);
      continue;
    }
    const producers = graph.stages.filter((candidate) => (candidate.produces || []).includes(pattern));
    if (producers.length === 0) {
      failures.push(`${resolvedPattern}: no stage declares this canonical produce`);
      continue;
    }
    const completed = new Set(completedInstanceIds(state));
    const producerCompleted = producers.some((producer) => {
      if (state.routing_model !== "module-unit-v1") return state.completed_stages.includes(producer.slug);
      const required = dependencyInstances(instance, producer.slug, instances);
      return required.length > 0 && required.every((candidate) => completed.has(candidate.instance_id));
    });
    if (!producerCompleted) {
      failures.push(`${resolvedPattern}: producer not completed (${producers.map((producer) => producer.slug).join(", ")})`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Sensors — 准出 quality gates (machine-verifiable checks)
// ---------------------------------------------------------------------------

export interface SensorResult {
  sensor: string;
  passed: boolean;
  message: string;
}

type Evidence = Record<string, unknown>;

/** Maximum evidence file size: 512 KB. Prevents unbounded JSON injection. */
const MAX_EVIDENCE_BYTES = 512 * 1024;

/** Maximum evidence staleness: 24 hours. Older evidence is rejected. */
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

function evidencePath(stage: StageNode, sensor: string, instance?: StageInstance): string {
  if (!instance || (instance.axis === "project" && stage.axis !== "project")) {
    return join(PROJECT_ROOT, ".aidlc", "evidence", stage.slug, `${sensor}.json`);
  }
  return join(PROJECT_ROOT, evidenceRelativePath(stage.slug, sensor, instance.axis, instance));
}

function loadEvidence(stage: StageNode, sensor: string, instance?: StageInstance): { value?: Evidence; failure?: SensorResult } {
  const path = evidencePath(stage, sensor, instance);
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
  instance: StageInstance,
  required: (value: Evidence) => string[],
): SensorResult | null {
  const loaded = loadEvidence(stage, sensor, instance);
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
      message: `Evidence rejected at ${evidencePath(stage, sensor, instance)}: ${errors.join("; ")}`,
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
  return normalizeArtifactLabel(relative(PROJECT_ROOT, path) || path);
}

function isEvidenceArtifact(path: string): boolean {
  return isEvidenceArtifactLabel(artifactLabel(path));
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
export async function checkSensors(instance: StageInstance, state: WorkflowState): Promise<SensorResult[]> {
  const stage = instance.stage;
  if (!stage.sensors || stage.sensors.length === 0) return [];

  const failures: SensorResult[] = [];

  for (const sensor of stage.sensors) {
    switch (sensor) {
      case "no-todo": {
        const todoFiles: string[] = [];
        const unreadableFiles: string[] = [];
        for (const pattern of stage.produces || []) {
          for (const filePath of resolveProducePaths(pattern, instance)) {
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
          .flatMap((pattern) => resolveProducePaths(pattern, instance))
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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

          if (state.routing_model === "module-unit-v1") {
            const modules = readModuleManifest(PROJECT_ROOT).map((module) => module.module_id).sort();
            if (evidence.selected_artifacts_verified !== true) errors.push("selected_artifacts_verified must be true");
            if (asNumber(evidence.modules_verified) !== modules.length) errors.push(`modules_verified must be ${modules.length}`);
            const expectedPrd = selectedOptionalStages(state).includes("prd-generation");
            if (evidence.prd_verified !== expectedPrd) errors.push(`prd_verified must be ${expectedPrd}`);
            const expectedUiModules = modules.filter((moduleId) => {
              const choice = uiDesignChoice(state, moduleId);
              return choice === "html-mock" || choice === "figma-create" || choice === "figma-existing";
            });
            const actualUiModules = asStringArray(evidence.ui_modules_verified);
            if (!actualUiModules) {
              errors.push("ui_modules_verified must be an array (empty when no module selected UI)");
            } else if (JSON.stringify([...actualUiModules].sort()) !== JSON.stringify(expectedUiModules)) {
              errors.push(`ui_modules_verified must match signed UI selections: ${expectedUiModules.join(", ") || "(none)"}`);
            }
          }

          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "prd-completeness": {
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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

      case "ui-artifact-consistency": {
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          if (evidence.stage !== stage.slug) errors.push(`stage must be ${stage.slug}`);
          if (evidence.module_id !== instance.module_id) errors.push(`module_id must be ${instance.module_id || "(none)"}`);
          const expectedChoice = uiDesignChoice(state, instance.module_id);
          if (evidence.design_mode !== expectedChoice) errors.push(`design_mode must match signed UI choice ${expectedChoice || "not-selected"}`);
          if (asPositiveInt(evidence.pages_checked) === null || (evidence.pages_checked as number) < 1) errors.push("pages_checked must be >= 1");
          const phases = asStringArray(evidence.phases_verified);
          if (!phases || phases.length === 0) errors.push("phases_verified must list validated phases");
          const artifacts = asStringArray(evidence.artifacts_checked);
          if (!artifacts || artifacts.length < 3) errors.push("artifacts_checked must include canonical upstream and current artifacts");
          if (asNumber(evidence.unresolved) !== 0) errors.push("unresolved must be 0");
          if (stage.slug === "ui-mock-generation" && (!phases?.includes("skeleton") || !phases?.includes("content"))) {
            errors.push("HTML Mock consistency must verify skeleton and content phases");
          }
          if (stage.slug === "ui-figma-generation" && asPositiveInt(evidence.elements_checked) === null) {
            errors.push("Figma consistency must report elements_checked");
          }
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "inception-consistency": {
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
          const errors: string[] = [];
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          if (evidence.module_id !== instance.module_id) errors.push(`module_id must be ${instance.module_id || "(none)"}`);
          if (asPositiveInt(evidence.requirements_checked) === null || (evidence.requirements_checked as number) < 1) errors.push("requirements_checked must be >= 1");
          if (asPositiveInt(evidence.stories_checked) === null || (evidence.stories_checked as number) < 1) errors.push("stories_checked must be >= 1");
          const expectedPrd = selectedOptionalStages(state).includes("prd-generation");
          if (evidence.prd_selected !== expectedPrd) errors.push(`prd_selected must be ${expectedPrd}`);
          const prdItems = asNumber(evidence.prd_items_checked);
          if (prdItems === null || (expectedPrd ? prdItems < 1 : prdItems !== 0)) errors.push(`prd_items_checked is inconsistent with selected PRD route`);
          const expectedUiRoute = uiDesignChoice(state, instance.module_id) || "not-selected";
          if (evidence.ui_route !== expectedUiRoute) errors.push(`ui_route must match signed UI choice ${expectedUiRoute}`);
          const uiPages = asNumber(evidence.ui_pages_checked);
          const uiSelected = expectedUiRoute === "html-mock" || expectedUiRoute === "figma-create" || expectedUiRoute === "figma-existing";
          if (uiPages === null || (uiSelected ? uiPages < 1 : uiPages !== 0)) errors.push("ui_pages_checked is inconsistent with signed UI route");
          if (asNumber(evidence.unresolved_conflicts) !== 0) errors.push("unresolved_conflicts must be 0");
          const artifacts = asStringArray(evidence.artifacts_checked);
          if (!artifacts || artifacts.length < 3) errors.push("artifacts_checked must list canonical consistency inputs");
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "ui-design-alignment": {
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
          const errors: string[] = [];
          if (!["passed", "not_applicable"].includes(String(evidence.status))) errors.push('status must be "passed" or "not_applicable"');
          const selectedChoice = uiDesignChoice(state, instance.module_id);
          const uiSelected = selectedChoice === "html-mock" || selectedChoice === "figma-create" || selectedChoice === "figma-existing";
          if (evidence.status === "not_applicable") {
            if (uiSelected && !asNonEmptyString(evidence.reason)) errors.push("selected UI routes require a reason when the current unit is not applicable");
            return errors;
          }
          const expectedMode = selectedChoice === "html-mock" ? "html-mock" : "figma";
          if (uiSelected && evidence.design_mode !== expectedMode) errors.push(`design_mode must be ${expectedMode} for signed choice ${selectedChoice}`);
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
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
        const executable = new Set(
          getExecutableStages(loadGraph(), state.scope, selectedOptionalStages(state)).map((candidate) => candidate.slug)
        );
        const cascadeDependencies: Record<string, Array<[string, string]>> = {
          "functional-design": [
            ["application-design", "docs/aidlc/modules/{module-id}/inception/application-design.md"],
            ["units-generation", "docs/aidlc/modules/{module-id}/inception/unit-manifest.json"],
          ],
          "nfr-design": [["nfr-requirements", "docs/aidlc/modules/{module-id}/construction/{unit-id}/nfr-requirements.md"]],
          "code-generation": [["functional-design", "docs/aidlc/modules/{module-id}/construction/{unit-id}/functional-design.md"]],
          "build-and-test": [["code-review", "docs/aidlc/modules/{module-id}/construction/{unit-id}/code-review.md"]],
          "implementation-report": [["build-and-test", "docs/aidlc/construction/build-test-report.md"]],
          "operations": [["implementation-report", "docs/aidlc/construction/implementation-report.md"]],
        };
        const requiredDocs = (cascadeDependencies[stage.slug] || [])
          .filter(([dependency]) => executable.has(dependency) && !skipped.has(dependency))
          .map(([, document]) => document);
        const missingDocs = requiredDocs.filter((document) => resolveProducePaths(document, instance, true).length === 0);
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
          const resolved = resolveProducePaths(pattern, instance);
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
function contextualConditionPath(relativePath: string, instance?: StageInstance): string {
  if (!instance || !instance.module_id || (instance.axis === "project" && instance.stage.axis !== "project")) {
    return join(PROJECT_ROOT, relativePath);
  }
  return join(PROJECT_ROOT, relativePath.replace("docs/aidlc/inception", moduleInceptionRoot(instance.module_id)));
}

function unitConditionalStageSelections(instance?: StageInstance): Set<string> | undefined {
  if (instance?.axis !== "unit" || !instance.module_id || !instance.unit_id) return undefined;
  const manifestPath = join(PROJECT_ROOT, moduleInceptionRoot(instance.module_id), "unit-manifest.json");
  if (!existsSync(manifestPath)) return undefined;
  const unit = readUnitManifest(PROJECT_ROOT, instance.module_id)
    .find((candidate) => candidate.unit_id === instance.unit_id);
  if (!unit) throw new Error(`unit manifest does not contain active unit ${instance.module_id}/${instance.unit_id}`);
  return unit.conditional_stages === undefined ? undefined : new Set(unit.conditional_stages);
}

function readConditionText(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function plannedStageDecision(plan: string, stageSlug: string): boolean | undefined {
  if (!plan) return undefined;
  const escaped = stageSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = [...plan.matchAll(new RegExp(`\\|\\s*\`?${escaped}\`?\\s*\\|\\s*(execute|skip|执行|跳过)\\s*\\|`, "gi"))];
  if (rows.length === 0) return undefined;
  return rows.some((row) => /^(execute|执行)$/i.test(row[1]));
}

function projectModuleConditionText(relativePaths: string[]): string {
  const manifest = join(PROJECT_ROOT, "docs", "aidlc", "ideation", "module-manifest.json");
  if (!existsSync(manifest)) return "";
  try {
    return readModuleManifest(PROJECT_ROOT).flatMap((module) => relativePaths.map((relativePath) =>
      readConditionText(join(PROJECT_ROOT, moduleInceptionRoot(module.module_id), relativePath))
    )).join("\n");
  } catch {
    return "";
  }
}

function rootBuildMetadata(): string {
  return ["package.json", "pom.xml", "build.gradle", "build.gradle.kts", "pubspec.yaml"]
    .map((file) => readConditionText(join(PROJECT_ROOT, file)))
    .join("\n");
}

export function buildConditionContext(state: WorkflowState, instance?: StageInstance): ConditionContext {
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
  const userStoriesPath = contextualConditionPath("docs/aidlc/inception/user-stories.md", instance);
  const userStoriesText = readConditionText(userStoriesPath);
  const has_ui_requirements = /\bUI\b|界面/.test(userStoriesText);

  // has_reverse_output: reverse-engineering.md exists
  const reverseEngineeringPath = contextualConditionPath("docs/aidlc/inception/reverse-engineering.md", instance);
  const has_reverse_output = existsSync(reverseEngineeringPath);

  // multi_module first honors the signed workspace architecture choice. Older
  // signed workflows without that choice fall back to canonical project facts.
  const signedArchitecture = architectureChoice(state);
  const architectureChoiceKnown = signedArchitecture !== undefined;
  let architectureEvidenceAvailable = architectureChoiceKnown;
  let multi_module = signedArchitecture === "multi-module";
  const moduleManifestPath = join(PROJECT_ROOT, "docs", "aidlc", "ideation", "module-manifest.json");
  if (!architectureChoiceKnown && existsSync(moduleManifestPath)) {
    try {
      multi_module = readModuleManifest(PROJECT_ROOT).length > 1;
      architectureEvidenceAvailable = true;
    } catch { /* invalid manifests are rejected by the module-division report gate */ }
  }
  const workspaceFactsPath = join(PROJECT_ROOT, ".aidlc", "workspace-facts.json");
  const moduleDivisionPath = join(PROJECT_ROOT, "docs", "aidlc", "ideation", "module-division.md");
  if (!architectureChoiceKnown && existsSync(workspaceFactsPath)) {
    try {
      const facts = JSON.parse(readFileSync(workspaceFactsPath, "utf-8")) as Record<string, unknown>;
      if (Array.isArray(facts.modules)) {
        multi_module = facts.modules.length > 1;
        architectureEvidenceAvailable = true;
      }
    } catch { /* invalid facts are ignored and upstream document detection is used */ }
  }
  if (!architectureChoiceKnown && !architectureEvidenceAvailable && existsSync(moduleDivisionPath)) {
    try {
      const content = readFileSync(moduleDivisionPath, "utf-8");
      const moduleHeadings = content.match(/^##\s+(?!摘要|概述|Summary)/gim);
      if ((moduleHeadings?.length ?? 0) > 0) {
        multi_module = (moduleHeadings?.length ?? 0) > 1;
        architectureEvidenceAvailable = true;
      }
    } catch { /* unreadable */ }
  }
  if (!architectureChoiceKnown && !architectureEvidenceAvailable) {
    try {
      const packageJsonPath = join(PROJECT_ROOT, "package.json");
      if (existsSync(packageJsonPath)) {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
        if (Array.isArray(pkg.workspaces) || (pkg.workspaces !== null && typeof pkg.workspaces === "object")) {
          multi_module = true;
          architectureEvidenceAvailable = true;
        }
      }
    } catch { /* invalid package metadata */ }
  }
  if (!architectureChoiceKnown && !architectureEvidenceAvailable) {
    const productInceptionInstance = "product-inception";
    const legacyMultiRoute = state.current_stage === "product-inception"
      || completedInstanceIds(state).includes(productInceptionInstance)
      || state.history.some((entry) => entry.stage === "product-inception");
    // Before workspace choices existed, every complete workflow entered the
    // product route. Preserve that conservative behavior only for signed legacy
    // workflows that already resolved workspace-detection.
    if (legacyMultiRoute || isInstanceResolved(state, "workspace-detection")) multi_module = true;
  }

  const contextDocs = [
    contextualConditionPath("docs/aidlc/inception/requirements.md", instance),
    contextualConditionPath("docs/aidlc/inception/application-design.md", instance),
    contextualConditionPath("docs/aidlc/inception/workflow-plan.md", instance),
    userStoriesPath,
  ];
  let contextText = contextDocs.map(readConditionText).join("\n");
  let workflowPlanText = readConditionText(contextualConditionPath("docs/aidlc/inception/workflow-plan.md", instance));
  if (instance?.axis === "project") {
    const moduleText = projectModuleConditionText(["requirements.md", "application-design.md", "workflow-plan.md", "user-stories.md"]);
    const modulePlans = projectModuleConditionText(["workflow-plan.md"]);
    contextText = `${contextText}\n${moduleText}`;
    workflowPlanText = `${workflowPlanText}\n${modulePlans}`;
  }

  const unitStageSelections = unitConditionalStageSelections(instance);
  const selectedForUnit = (stageSlug: string, legacyFallback: boolean): boolean =>
    unitStageSelections === undefined ? legacyFallback : unitStageSelections.has(stageSlug);

  const moduleHasNfrNeeds = /NFR|非功能|性能|安全|可用性|可靠性|恢复|扩展性/i.test(contextText);
  const has_nfr_needs = unitStageSelections === undefined
    ? moduleHasNfrNeeds
    : unitStageSelections.has("nfr-requirements") && unitStageSelections.has("nfr-design");
  const moduleHasInfraNeeds = /基础设施|infrastructure|部署拓扑|容器|Kubernetes|Docker|Nacos|缓存|消息队列|分布式|外部系统/i.test(contextText);
  const has_infra_needs = selectedForUnit("infrastructure-design", moduleHasInfraNeeds);
  const applicationInstance = instance?.module_id
    ? stageInstanceId("application-design", "module", { module_id: instance.module_id })
    : "application-design";
  const applicationDesignCompleted = completedInstanceIds(state).includes(applicationInstance)
    || (state.routing_model !== "module-unit-v1" && state.completed_stages.includes("application-design"));
  const has_test_case_sources = applicationDesignCompleted && (existsSync(userStoriesPath) || has_nfr_needs || has_infra_needs);
  const moduleHasContractDependencies = /共享契约|shared.?contract|API.?contract|接口契约|proto|protobuf|OpenAPI|swagger/i.test(contextText);
  const has_contract_dependencies = selectedForUnit("shared-contract-baseline", moduleHasContractDependencies);

  const applicationDecision = plannedStageDecision(workflowPlanText, "application-design");
  const applicationEvidence = /新接口|新组件|应用服务|编排器|跨模块|跨服务|多端|复杂业务规则|共享配置|数据迁移|一致性|外部故障|数据 Owner|runtime consumer/i.test(contextText);
  const has_application_design_needs = applicationDecision ?? (multi_module || applicationEvidence);

  const functionalDecision = plannedStageDecision(workflowPlanText, "functional-design");
  const functionalEvidence = /新数据模型|新 schema|schema 变化|业务规则.{0,20}(3|三)条|状态机变化|复杂算法|领域模型/i.test(contextText);
  const has_functional_design_needs = selectedForUnit("functional-design", functionalDecision ?? functionalEvidence);

  const unitDecision = plannedStageDecision(workflowPlanText, "units-generation");
  const unitEvidence = /多个工作单元|多单元|跨服务协调|多个包|多个模块|并行开发|工作量超出单次执行/i.test(contextText);
  const has_unit_generation_needs = unitDecision ?? (multi_module || has_functional_design_needs || unitEvidence);

  // has_subagent_support means the approved workflow plan selected delegated/parallel execution.
  const moduleHasSubagentSupport = /subagent|sub-agent|parallel|并行|mob/i.test(workflowPlanText);
  const has_subagent_support = moduleHasSubagentSupport
    && selectedForUnit("subagent-execution", true);

  const buildMetadata = rootBuildMetadata();
  const productContractText = [
    readConditionText(moduleDivisionPath),
    readConditionText(workspaceFactsPath),
    readConditionText(join(PROJECT_ROOT, "docs", "aidlc", "ideation", "product-inception.md")),
    buildMetadata,
  ].join("\n");
  const has_product_contract_needs = multi_module
    || /跨模块|跨服务|跨进程|异步事件|事件\s*(?:schema|契约)|前后端接口|API\s*契约|接口契约|OpenAPI|swagger|webhook|消息队列|外部系统交换/i.test(productContractText);

  // is_loeyae_boot: build metadata references loeyae-boot framework.
  const projectUsesLoeyaeBoot = /loeyae-boot|loeyae\.boot/i.test(buildMetadata);
  const is_loeyae_boot = projectUsesLoeyaeBoot
    && selectedForUnit("loeyae-compliance", true);

  // Runtime UI mode is taken from signed history, never from handoff.md.
  const uiChoice = uiDesignChoice(state, instance?.module_id);
  const ui_mode_html_mock = uiChoice === "html-mock";
  const ui_mode_figma = uiChoice === "figma-create" || uiChoice === "figma-existing";
  const ui_design_selected = ui_mode_html_mock || ui_mode_figma;
  const crossPlatformTarget = /Taro|React Native|Flutter|UniApp|uni-app|跨端|小程序|@tarojs|react-native/i.test(`${contextText}\n${buildMetadata}`);
  const needs_ui_implementation_bridge = ui_design_selected
    && crossPlatformTarget
    && selectedForUnit("ui-implementation-bridge", true);

  const implementationText = readConditionText(join(PROJECT_ROOT, "docs", "aidlc", "construction", "implementation-report.md"));
  const deploymentText = `${contextText}\n${implementationText}\n${buildMetadata}`;
  const operationsDecision = plannedStageDecision(workflowPlanText, "operations");
  const explicitlyNoDeployment = /无需部署|不需要部署|纯库|library only|纯本地工具|local-only/i.test(deploymentText);
  const deploymentFilesExist = ["Dockerfile", "compose.yml", "docker-compose.yml", "Procfile", "Jenkinsfile"]
    .some((file) => existsSync(join(PROJECT_ROOT, file)))
    || ["k8s", "kubernetes", "helm"].some((directory) => existsSync(join(PROJECT_ROOT, directory)));
  const deploymentEvidence = /独立服务|可部署服务|需要部署|部署目标|容器化|Kubernetes|Docker Compose|平台托管|生产发布|deployment target/i.test(deploymentText);
  const packageHasRuntimeStart = /"(start|serve)"\s*:/.test(readConditionText(join(PROJECT_ROOT, "package.json")));
  const inferredDeploymentNeed = deploymentFilesExist || deploymentEvidence || packageHasRuntimeStart;
  const has_deployment_needs = operationsDecision ?? (!explicitlyNoDeployment && inferredDeploymentNeed);

  const operationsText = [
    "docs/aidlc/operation/operations-plan.md",
    "docs/aidlc/operation/plans/operations-plan.md",
    "docs/aidlc/operation/deployment-config.md",
    "docs/aidlc/operation/operations-summary.md",
  ].map((path) => readConditionText(join(PROJECT_ROOT, path))).join("\n");
  const has_operations_template_needs = has_deployment_needs
    && /(?:可复用|归档|保留|生成).{0,16}(?:模板|template)|(?:模板|template).{0,16}(?:Dockerfile|Docker Compose|Jenkins|Kubernetes|Helm|Kustomize|Nginx)/i.test(operationsText);

  const context_compacted = existsSync(join(PROJECT_ROOT, ".aidlc", "context-compacted"));

  return {
    has_legacy_code,
    has_ui_requirements,
    has_reverse_output,
    multi_module,
    has_product_contract_needs,
    has_nfr_needs,
    has_infra_needs,
    has_test_case_sources,
    has_contract_dependencies,
    has_subagent_support,
    is_loeyae_boot,
    context_compacted,
    ui_design_selected,
    ui_mode_html_mock,
    ui_mode_figma,
    has_application_design_needs,
    has_unit_generation_needs,
    has_functional_design_needs,
    needs_ui_implementation_bridge,
    has_deployment_needs,
    has_operations_template_needs,
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
export function evaluateCondition(condition: string, context: ConditionContext): boolean | undefined {
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
function findNextInstance(
  instances: StageInstance[],
  state: WorkflowState
): {
  instance: StageInstance | null;
  blocked?: { instance: StageInstance; unsatisfied: string[] };
  conditionError?: { instance: StageInstance; condition: string };
  skippedByCondition?: { instance: StageInstance; reason: string }[];
} {
  const conditionSkips: { instance: StageInstance; reason: string }[] = [];

  for (const instance of instances) {
    if (isInstanceResolved(state, instance.instance_id)) continue;
    const stage = instance.stage;

    if (stage.condition && stage.condition.trim() !== "") {
      const conditionResult = evaluateCondition(stage.condition, buildConditionContext(state, instance));
      if (conditionResult === undefined) {
        return {
          instance: null,
          conditionError: { instance, condition: stage.condition },
          skippedByCondition: conditionSkips.length > 0 ? conditionSkips : undefined,
        };
      }
      if (!conditionResult) {
        conditionSkips.push({ instance, reason: "condition not met" });
        if (state.routing_model === "module-unit-v1") {
          state.skipped_stage_instances!.push(instance.instance_id);
        } else if (!state.skipped_stages.includes(stage.slug)) {
          state.skipped_stages.push(stage.slug);
        }
        state.history.push({
          stage: stage.slug,
          instance_id: state.routing_model === "module-unit-v1" ? instance.instance_id : undefined,
          module_id: instance.module_id,
          unit_id: instance.unit_id,
          result: "condition_skipped",
          timestamp: new Date().toISOString(),
          user_input: `Auto-skipped: condition "${stage.condition}" evaluated to false`,
        });
        reconcileStageSummaries(state, instances);
        continue;
      }
    }

    const unsatisfied = checkRequires(instance, instances, state);
    if (unsatisfied.length > 0) {
      return {
        instance: null,
        blocked: { instance, unsatisfied },
        skippedByCondition: conditionSkips.length > 0 ? conditionSkips : undefined,
      };
    }

    return { instance, skippedByCondition: conditionSkips.length > 0 ? conditionSkips : undefined };
  }

  return { instance: null, skippedByCondition: conditionSkips.length > 0 ? conditionSkips : undefined };
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

function activeApprovalKey(state: WorkflowState, instance: StageInstance): string {
  return state.routing_model === "module-unit-v1" ? instance.instance_id : instance.stage.slug;
}

function clearActiveContext(state: WorkflowState): void {
  state.current_stage = "";
  delete state.current_stage_instance;
  delete state.current_module;
  delete state.current_unit;
}

export function artifactRoot(instance: StageInstance): string {
  if (instance.axis === "module" && instance.module_id) return moduleInceptionRoot(instance.module_id);
  if (instance.axis === "unit" && instance.module_id && instance.unit_id) return unitConstructionRoot(instance.module_id, instance.unit_id);
  const phaseDirectory = instance.stage.phase === "operation" ? "operations" : instance.stage.phase;
  return `docs/aidlc/${phaseDirectory}`;
}

export function evidenceRoot(instance: StageInstance): string {
  const parts = [".aidlc", "evidence", instance.stage.slug];
  if (instance.axis !== "project" && instance.module_id) parts.push(instance.module_id);
  if (instance.axis === "unit" && instance.unit_id) parts.push(instance.unit_id);
  return parts.join("/");
}

// ---------------------------------------------------------------------------
// next — compute the next directive without mutating state
// ---------------------------------------------------------------------------

async function handleNext(args: string[]): Promise<Directive> {
  const graph = loadGraph();
  const flags = parseFlags(args);

  // PRD is a user-selected workflow option, never a default Inception gate.
  const withPrd = "with-prd" in flags;
  if (withPrd && flags["with-prd"] !== "true") {
    return { kind: "error", message: "--with-prd is a boolean flag and does not accept a value" };
  }

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

  if (withPrd && (!scopeFlag || !PRD_ELIGIBLE_SCOPES.has(scopeFlag))) {
    return {
      kind: "error",
      message: "--with-prd is only valid when initializing feature, enterprise, mvp, or classic scope",
    };
  }

  // Check for --status flag
  if ("status" in flags) {
    const state = loadState();
    if (!state) {
      return { kind: "print", message: "No active workflow. Start with: aidlc-orchestrate next --scope <scope> \"<description>\"" };
    }
    const instances = expandStageInstances(graph, state);
    const remaining = instances.filter((instance) => !isInstanceResolved(state, instance.instance_id));
    const completedCount = instances.filter((instance) => completedInstanceIds(state).includes(instance.instance_id)).length;
    const skippedCount = instances.filter((instance) => skippedInstanceIds(state).includes(instance.instance_id)).length;
    return {
      kind: "print",
      message: `📊 Workflow Status\n` +
        `  Scope: ${state.scope} | Phase: ${state.current_phase} | Status: ${state.status}\n` +
        `  PRD option: ${selectedOptionalStages(state).includes("prd-generation") ? "selected" : "not selected"}\n` +
        `  Current stage: ${state.current_stage_instance || state.current_stage || "(none)"}\n` +
        `  Context: module=${state.current_module || "-"}, unit=${state.current_unit || "-"}\n` +
        `  Completed: ${completedCount}/${instances.length} stage instances\n` +
        `  Skipped: ${skippedCount}\n` +
        `  Remaining: ${remaining.length} (${remaining.map((instance) => instance.instance_id).join(", ")})`,
    };
  }

  // Load or create state
  let state = loadState();

  if (state && withPrd) {
    return { kind: "error", message: "--with-prd can only be selected when initializing a new workflow" };
  }

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
    const selectedOptionalStages = withPrd ? ["prd-generation"] : [];
    state = createInitialState(scopeFlag, "2.4.0", pendingWorkflowId, selectedOptionalStages);
    saveState(state);
    return {
      kind: "print",
      message: `✅ Workflow initialized with scope: ${scopeFlag}\n` +
        `  PRD option: ${withPrd ? "selected" : "not selected"}\n` +
        `  Executable stages: ${getExecutableStages(graph, scopeFlag, selectedOptionalStages).length}/${graph.stage_count}\n` +
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

  // Expand the static graph into the currently known execution instances.
  const instances = expandStageInstances(graph, state);
  const { instance: nextInstance, blocked, conditionError, skippedByCondition } = findNextInstance(instances, state);

  if (skippedByCondition && skippedByCondition.length > 0) saveState(state);

  if (conditionError) {
    return {
      kind: "error",
      message: `🚫 Unknown stage condition "${conditionError.condition}" on "${conditionError.instance.instance_id}". Register the condition in the engine before continuing.`,
    };
  }

  if (blocked) {
    return {
      kind: "error",
      message: `🚫 Stage instance "${blocked.instance.instance_id}" (${blocked.instance.stage.name}) is blocked.\n` +
        `  Unsatisfied requires: ${blocked.unsatisfied.join(", ")}\n` +
        `  These stage instances must be completed first.` +
        (skippedByCondition && skippedByCondition.length > 0
          ? `\n  ⏭️ Auto-skipped by condition: ${skippedByCondition.map((item) => item.instance.instance_id).join(", ")}`
          : ""),
    };
  }

  if (!nextInstance) {
    reconcileStageSummaries(state, instances);
    state.status = "done";
    clearActiveContext(state);
    saveState(state);
    return {
      kind: "done",
      message: `🎉 All ${instances.length} stage instances resolved. Workflow finished.`,
    };
  }

  const effectiveNextInstance = runtimeInstance(nextInstance, state);
  const nextStage = effectiveNextInstance.stage;
  const consumeFailures = checkConsumes(effectiveNextInstance, state, graph, instances);
  if (consumeFailures.length > 0) {
    return {
      kind: "error",
      message: `🚫 Stage instance "${nextInstance.instance_id}" is missing canonical consumed artifacts:\n${consumeFailures.map((failure) => `  ❌ ${failure}`).join("\n")}`,
    };
  }

  state.current_stage = nextStage.slug;
  state.current_phase = nextStage.phase;
  if (state.routing_model === "module-unit-v1") {
    state.current_stage_instance = nextInstance.instance_id;
    if (nextInstance.module_id) state.current_module = nextInstance.module_id;
    else delete state.current_module;
    if (nextInstance.unit_id) state.current_unit = nextInstance.unit_id;
    else delete state.current_unit;
  }
  const gate = nextStage.approval === "block";
  const approvalKey = activeApprovalKey(state, effectiveNextInstance);
  if (gate && !state.approval_challenges[approvalKey]) {
    state.approval_challenges[approvalKey] = `${Date.now()}.${randomBytes(24).toString("hex")}`;
  }
  saveState(state);

  const directiveChoices = runtimeChoices(nextStage, state);
  return {
    kind: "run-stage",
    stage: nextStage.slug,
    stage_instance: effectiveNextInstance.instance_id,
    axis: effectiveNextInstance.axis,
    module_id: effectiveNextInstance.module_id || null,
    unit_id: effectiveNextInstance.unit_id || null,
    artifact_root: artifactRoot(effectiveNextInstance),
    evidence_root: evidenceRoot(effectiveNextInstance),
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
    approval_challenge: gate ? state.approval_challenges[approvalKey] : undefined,
    consumes: nextStage.consumes.map((pattern) => instanceArtifactPattern(pattern, effectiveNextInstance, true)),
    produces: nextStage.produces.map((pattern) => instanceArtifactPattern(pattern, effectiveNextInstance)),
    sensors: nextStage.sensors,
    choices: directiveChoices,
    choice_required: directiveChoices.length > 0,
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
  let approvalTokenValue = flags["approval-token"] || process.env.AIDLC_APPROVAL_TOKEN;
  const approvalResponseFromStdin = "approval-response-stdin" in flags;
  const approvalConfirmationFromStdin = "approval-confirmation-stdin" in flags;

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
  if (approvalResponseFromStdin && flags["approval-response-stdin"] !== "true") {
    return { kind: "error", message: "--approval-response-stdin is a boolean flag and does not accept a value" };
  }
  if (approvalConfirmationFromStdin && flags["approval-confirmation-stdin"] !== "true") {
    return { kind: "error", message: "--approval-confirmation-stdin is a boolean flag and does not accept a value" };
  }
  if (approvalResponseFromStdin && approvalConfirmationFromStdin) {
    return { kind: "error", message: "Use exactly one approval stdin channel: --approval-confirmation-stdin or --approval-response-stdin." };
  }
  if ((approvalResponseFromStdin || approvalConfirmationFromStdin) && result !== "approved") {
    return { kind: "error", message: "Approval stdin is only valid with --result approved" };
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
  const instances = expandStageInstances(graph, state);
  const declaredCurrentInstance = state.routing_model === "module-unit-v1"
    ? instances.find((instance) => instance.instance_id === state.current_stage_instance)
    : makeInstance(stageNode, "project");
  if (!declaredCurrentInstance || declaredCurrentInstance.stage.slug !== stageSlug) {
    return {
      kind: "error",
      message: `Active stage instance "${state.current_stage_instance || stageSlug}" no longer exists in the declared module/unit manifests. Restore the signed routing manifests before reporting.`,
    };
  }
  const currentInstance = runtimeInstance(declaredCurrentInstance, state);
  if (flags.module && flags.module !== currentInstance.module_id) {
    return { kind: "error", message: `Module mismatch: active module is "${currentInstance.module_id || "(none)"}", but report specified "${flags.module}".` };
  }
  if (flags.unit && flags.unit !== currentInstance.unit_id) {
    return { kind: "error", message: `Unit mismatch: active unit is "${currentInstance.unit_id || "(none)"}", but report specified "${flags.unit}".` };
  }
  const approvalKey = activeApprovalKey(state, currentInstance);
  if (result === "completed" && stageNode.approval === "block") {
    return { kind: "error", message: `Stage "${stageSlug}" requires explicit approval. Supply the exact active conversation confirmation with --result approved --approval-confirmation-stdin.` };
  }
  if (result === "approved") {
    if (stageNode.approval !== "block") {
      return { kind: "error", message: `Stage "${stageSlug}" is not an approval gate and cannot use --result approved.` };
    }
    const challenge = state.approval_challenges[approvalKey];
    if (!challenge) return { kind: "error", message: `No active approval challenge for stage instance "${currentInstance.instance_id}". Run next to obtain one.` };
    const issuedAt = Number(challenge.split(".", 1)[0]);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 15 * 60 * 1000 || issuedAt > Date.now() + 60 * 1000) {
      delete state.approval_challenges[approvalKey];
      saveState(state);
      return { kind: "error", message: `Approval challenge for stage instance "${currentInstance.instance_id}" expired. Run next to obtain a new challenge.` };
    }
    if (approvalConfirmationFromStdin) {
      if (flags["approval-token"] || process.env.AIDLC_APPROVAL_TOKEN) {
        return { kind: "error", message: "Use exactly one approval channel: conversation confirmation stdin, provider response stdin, --approval-token, or AIDLC_APPROVAL_TOKEN." };
      }
      const request = buildApprovalProviderRequest(state, stageSlug);
      const confirmation = validateApprovalConversationConfirmation(readFileSync(0, "utf8"), request);
      approvalTokenValue = confirmation.approval_token;
    }
    if (approvalResponseFromStdin) {
      if (flags["approval-token"] || process.env.AIDLC_APPROVAL_TOKEN) {
        return { kind: "error", message: "Use exactly one approval channel: conversation confirmation stdin, provider response stdin, --approval-token, or AIDLC_APPROVAL_TOKEN." };
      }
      const request = buildApprovalProviderRequest(state, stageSlug);
      const providerResponse = validateApprovalProviderResponse(readFileSync(0, "utf8"), request);
      approvalTokenValue = providerResponse.approval_token;
    }
    if (!approvalTokenValue) {
      return { kind: "error", message: `Stage instance "${currentInstance.instance_id}" requires an exact conversation confirmation, trusted provider response, or --approval-token from the TTY fallback.` };
    }
    if (!verifyApprovalToken(state.workflow_id, approvalKey, challenge, approvalTokenValue)) {
      return { kind: "error", message: `Invalid or stale approval confirmation/token for stage instance "${currentInstance.instance_id}".` };
    }
  }
  if (stageNode.completion_contract === "instruction_only" && result === "completed" && flags["instruction-ack"] !== stageSlug) {
    return {
      kind: "error",
      message: `Stage "${stageSlug}" is instruction-only and cannot be auto-completed by a lifecycle Hook. After executing its body, report again with --instruction-ack ${stageSlug}.`,
    };
  }
  const runtimeChoiceValues = runtimeChoices(stageNode, state);
  if ((result === "completed" || result === "approved") && runtimeChoiceValues.length > 0) {
    if (!userInput || !runtimeChoiceValues.includes(userInput)) {
      return {
        kind: "error",
        message: `Stage "${stageSlug}" requires --user-input with one of: ${runtimeChoiceValues.join(", ")}. The choice is stored in signed workflow history.`,
      };
    }
  }

  // Record history entry
  const entry: HistoryEntry = {
    stage: stageSlug,
    instance_id: state.routing_model === "module-unit-v1" ? currentInstance.instance_id : undefined,
    module_id: currentInstance.module_id,
    unit_id: currentInstance.unit_id,
    result,
    timestamp: new Date().toISOString(),
  };
  if (userInput) entry.user_input = userInput;

  // --- P0 Gate: Validate consumes and produces before allowing completion ---
  if (result === "completed" || result === "approved") {
      const consumeFailures = checkConsumes(currentInstance, state, graph, instances);
      if (consumeFailures.length > 0) {
        return {
          kind: "error",
          message: `🚫 Cannot complete stage instance "${currentInstance.instance_id}" — canonical consumed artifacts are no longer valid:\n` +
            consumeFailures.map((failure) => `  ❌ ${failure}`).join("\n"),
        };
      }

      const missingProduces = checkProduces(currentInstance);
      if (missingProduces.length > 0) {
        return {
          kind: "error",
          message: `🚫 Cannot complete stage instance "${currentInstance.instance_id}" — required produces not found:\n` +
            missingProduces.map((path) => `  ❌ ${path}`).join("\n") +
            `\n\nGenerate these artifacts first, then report again.`,
        };
      }

      if (state.routing_model === "module-unit-v1" && stageSlug === "module-division") {
        readModuleManifest(PROJECT_ROOT);
      }
      if (state.routing_model === "module-unit-v1" && stageSlug === "units-generation") {
        if (!currentInstance.module_id) throw new Error("units-generation requires an active module context");
        const units = readUnitManifest(PROJECT_ROOT, currentInstance.module_id);
        if (architectureChoice(state)) {
          const missingSelections = units
            .filter((unit) => unit.conditional_stages === undefined)
            .map((unit) => unit.unit_id);
          if (missingSelections.length > 0) {
            return {
              kind: "error",
              message: `🚫 Cannot complete stage instance "${currentInstance.instance_id}" — new signed workflows require conditional_stages for every unit; missing: ${missingSelections.join(", ")}.`,
            };
          }
        }
      }

      const sensorFailures = await checkSensors(currentInstance, state);
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
      if (state.routing_model === "module-unit-v1") {
        state.completed_stage_instances!.push(currentInstance.instance_id);
        reconcileStageSummaries(state, instances);
      } else if (!state.completed_stages.includes(stageSlug)) {
        state.completed_stages.push(stageSlug);
      }
      clearActiveContext(state);
      if (result === "approved") delete state.approval_challenges[approvalKey];
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exit(2);
  });
}
