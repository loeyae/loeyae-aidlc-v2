#!/usr/bin/env bun
/**
 * aidlc-orchestrate.ts — The deterministic workflow engine.
 *
 * Subcommands:
 *   next [args...]    — Read state + stage graph, return ONE typed directive (JSON)
 *   continue <token>  — Internal steering transport (load-steering chain)
 *   report [flags]    — Record stage outcome, advance state machine
 *   park              — Park workflow at current inter-stage boundary
 *   split             — Split a single workflow into per-module workflows (4.3.0)
 *   baseline          — Show / register / replace (4.6.0) / advance (4.7.0) the workflow baseline commit
 *
 * State file: <project>/aidlc/active/aidlc-state.md (single layout). After `split`, the
 * global, per-module (aidlc/active/modules/<id>/) and integration workflows are indexed
 * by aidlc/active/registry.md; see aidlc-workflow-layout.ts.
 * Stage graph: <engine>/core/tools/data/stage-graph.json
 *
 * This tool is DETERMINISTIC: same state → same directive.
 * `next` NEVER mutates state — only `report` and `park` write.
 *
 * Gate model: requires (准入) + produces + sensors (准出) guarantee completeness.
 * Approval remains blocking only for machine-unverifiable decisions declared
 * with `approval: block`; all other stages auto-advance after gates pass.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { join, dirname, resolve, relative, isAbsolute, sep } from "path";
import { fileURLToPath } from "url";
import { planAgentExecution, type AgentExecutionPlan } from "./aidlc-agent-runtime";
import { SEMANTIC_SENSORS, allowlistedPhaseCommand, argvDigest, i13CodeRefBlobs, i13UcdIdsByMode, phaseNotRequiredDigest, phaseObservationDigest, ucdExemptionDigest, unitUcdExemption, type Phase } from "./aidlc-evidence";
import { CANONICAL_SOURCE_PATTERN, resolveSourceRoots } from "./aidlc-source-roots";
import { CONTRACT_CONSUMER_COLUMN, CONTRACT_ID_COLUMN, CONTRACT_PROVIDER_COLUMN, moduleForValue } from "./aidlc-contract-table";
import { COMMIT_ID_PATTERN, commitAncestryErrors, readSourceRevision } from "./aidlc-revision";
import {
  baselineCodeRef,
  baselineCommitErrors,
  baselineEpochErrors,
  baselineUsage,
  checkAdvanceTarget,
  checkBaselineCandidate,
  currentHeadCommit,
  parseCodeRef,
  workflowBaselineForModule,
  type CodeRef,
} from "./aidlc-baseline";
import {
  evidenceRelativePath,
  greenCoveredUcds,
  i13UcdUnits,
  isEvidenceArtifactLabel,
  ucdCoverageGaps,
  unitUcdIds,
  type UnitUcdScope,
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
  FULL_WORKFLOW_SCOPES,
  verifiedModuleIds,
} from "./aidlc-execution-context";
import {
  BASELINE_UNAVAILABLE,
  DIAGRAM_FORMATS,
  ENGINE_VERSION,
  GLOBAL_WORKFLOW,
  appendAuditEvent,
  baselineChain,
  createInitialState,
  lightStatePath,
  loadWorkflowState,
  releaseExpiredModuleClaims,
  saveWorkflowState,
  workflowRefKey,
  type DiagramFormat,
  type HistoryEntry,
  type WorkflowRef,
  type WorkflowState,
} from "./aidlc-light-state";
import {
  evidenceScopeForInstance,
  extractOwnedState,
  integrationStageSlugs,
  isSplitLayout,
  loadWorkflowParts,
  mergeWorkflowView,
  ownerOfInstance,
  relativeStatePath,
  sameRef,
  saveRegistry,
  updateRegistry,
  type RegistryCrossRequire,
  type RegistrySharedContract,
  type WorkflowParts,
  type WorkflowRegistry,
} from "./aidlc-workflow-layout";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = resolve(__dirname, "..");
const GRAPH_PATH = join(__dirname, "data", "stage-graph.json");
const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");

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
  reviewer_agent?: string;
  scopes: string[];
  requires: string[];
  cross_module_requires?: string[];
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
  agent_execution?: AgentExecutionPlan;
  gate?: boolean;
  consumes?: string[];
  produces?: string[];
  sensors?: string[];
  choices?: string[];
  message?: string;
  handoff_prompt?: string;
  handoff_status?: "updated" | "unverified";
  handoff_error?: string;
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

const PRD_ELIGIBLE_SCOPES = new Set(FULL_WORKFLOW_SCOPES);

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

const SUBCOMMANDS = ["next", "continue", "report", "park", "archive", "split", "upgrade", "diagram-format", "baseline"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const VALID_RESULTS = ["completed", "approved", "rejected", "revised"] as const;
type StageResult = (typeof VALID_RESULTS)[number];
const NEXT_FLAGS = new Set(["scope", "work", "with-prd", "resume", "status", "text", "claim", "module", "owner", "branch", "worktree"]);
const REPORT_FLAGS = new Set(["stage", "result", "user-input", "instruction-ack", "module", "unit", "instance", "owner"]);
const SPLIT_FLAGS = new Set(["from", "dry-run"]);
const ARCHIVE_FLAGS = new Set(["reason"]);
const UPGRADE_FLAGS = new Set(["dry-run", "module"]);
const DIAGRAM_FORMAT_FLAGS = new Set(["set", "user-input"]);
// `module` is accepted only to reject it with a specific message (baseline is global-only).
const BASELINE_FLAGS = new Set(["set", "advance", "user-input", "reason", "dry-run", "replace", "expect", "module"]);
/** Appended to every error where the state write succeeded but its audit entry did not. */
const AUDIT_MISSING = "状态已写入、审计缺失，请人工补记";
const INTEGRATION_WORKFLOW: WorkflowRef = { kind: "integration" };

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
 * Filter stages by scope and the immutable user selections captured in Markdown workflow history.
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
  return state.selected_optional_stages;
}

const ARCHITECTURE_CHOICES = new Set(["single-module", "multi-module"]);
const UI_DESIGN_CHOICES = new Set(["html-mock", "figma-create", "figma-existing", "skip"]);
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
  return recorded && UI_DESIGN_CHOICES.has(recorded) ? recorded : undefined;
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
  if (!state.completed_stages.includes("module-division")) return [DEFAULT_MODULE];
  return readModuleManifest(PROJECT_ROOT);
}

function routingUnits(state: WorkflowState, modules: ModuleDescriptor[]): Array<{ module: ModuleDescriptor; unit: UnitDescriptor }> {
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

interface ModuleDependency {
  provider_module: string;
  consumer_module: string;
  provider_stage: string;
  consumer_stage: string;
  source: string;
}

function dependencyDocuments(): string[] {
  const root = join(PROJECT_ROOT, "docs", "aidlc");
  if (!existsSync(root)) return [];
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && (entry.name === "product-contracts.md" || entry.name === "runtime-dependencies.md")) result.push(path);
    }
  };
  visit(root);
  return result.sort();
}


export function moduleDependencyGraph(): ModuleDependency[] {
  const manifestPath = join(PROJECT_ROOT, "docs", "aidlc", "ideation", "module-manifest.json");
  if (!existsSync(manifestPath)) return [];
  const modules = readModuleManifest(PROJECT_ROOT);
  const dependencies: ModuleDependency[] = [];
  const append = (providerValue: string, consumerValue: string, providerStageValue: string | undefined, consumerStageValue: string | undefined, source: string): void => {
    const provider = moduleForValue(modules, providerValue);
    const consumer = moduleForValue(modules, consumerValue, provider);
    if (!provider || !consumer || provider === consumer) return;
    const providerStage = providerStageValue?.replace(/^(?:provider[_ -]?stage|提供方阶段)\s*[:：]\s*/i, "").trim() || "application-design";
    const consumerStage = consumerStageValue?.replace(/^(?:consumer[_ -]?stage|消费方阶段)\s*[:：]\s*/i, "").trim() || "application-design";
    dependencies.push({
      provider_module: provider,
      consumer_module: consumer,
      provider_stage: providerStage,
      consumer_stage: consumerStage,
      source,
    });
  };
  for (const sourcePath of dependencyDocuments()) {
    const source = relative(PROJECT_ROOT, sourcePath);
    const lines = readFileSync(sourcePath, "utf8").split(/\r?\n/);
    let header: string[] | undefined;
    for (const line of lines) {
      if (!line.trim().startsWith("|")) {
        header = undefined;
        continue;
      }
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.length === 0 || cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
      if (!header) {
        header = cells;
        continue;
      }
      const index = (patterns: RegExp[]): number => header!.findIndex((cell) => patterns.some((pattern) => pattern.test(cell)));
      const providerIndex = index([/provider|source|提供方|来源/i]);
      const consumerIndex = index([/consumer|target|消费者|消费方|目标/i]);
      if (providerIndex >= 0 && consumerIndex >= 0 && cells[providerIndex] && cells[consumerIndex]) {
        const providerStageIndex = index([/provider[_ -]?stage|提供方阶段/i]);
        const consumerStageIndex = index([/consumer[_ -]?stage|消费方阶段/i]);
        append(cells[providerIndex], cells[consumerIndex], providerStageIndex >= 0 ? cells[providerStageIndex] : undefined, consumerStageIndex >= 0 ? cells[consumerStageIndex] : undefined, source);
        continue;
      }
      const ids = modules.map((module) => module.module_id).filter((moduleId) => line.includes(moduleId));
      const distinct = [...new Set(ids)];
      if (distinct.length >= 2) {
        append(
          distinct[0],
          distinct[1],
          line.match(/(?:provider[_ -]?stage|提供方阶段)\s*[:：|]\s*([a-z0-9][a-z0-9-]*)/i)?.[1],
          line.match(/(?:consumer[_ -]?stage|消费方阶段)\s*[:：|]\s*([a-z0-9][a-z0-9-]*)/i)?.[1],
          source,
        );
      }
    }
  }
  const unique = new Map<string, ModuleDependency>();
  for (const dependency of dependencies) unique.set(`${dependency.provider_module}->${dependency.consumer_module}:${dependency.provider_stage}:${dependency.consumer_stage}`, dependency);
  return [...unique.values()];
}

// 缺口A:跨 module 契约依赖门禁。消费方阶段推进前,验证其依赖的 provider module 的 provider_stage 已完成。
// 复用 moduleDependencyGraph()(已从 product-contracts/runtime-dependencies 解析出 provider→consumer 边)
// 与 completedInstanceIds(阶段实例完成判定)。只判时序(provider 阶段是否完成),不判契约内容(那是 contract-baseline)。
// 遗留兼容:无跨 module 依赖表 → 空图 → 无 failure,不阻断存量项目。
export function checkCrossModuleDependencies(instance: StageInstance, state: WorkflowState): string[] {
  if (instance.axis !== "module" || !instance.module_id) return [];
  const failures: string[] = [];
  const completed = new Set(completedInstanceIds(state));
  const isProviderStageDone = (providerModule: string, providerStage: string): boolean => {
    // provider module 的 provider_stage 完成 = 存在已完成实例 `<providerStage>@module:<providerModule>`,
    // 或 project 轴阶段直接以 slug 记完成。
    const moduleInstanceId = `${providerStage}@module:${providerModule}`;
    return completed.has(moduleInstanceId) || completed.has(providerStage);
  };
  for (const dep of moduleDependencyGraph()) {
    if (dep.consumer_module !== instance.module_id || dep.consumer_stage !== instance.stage.slug) continue;
    if (!isProviderStageDone(dep.provider_module, dep.provider_stage)) {
      failures.push(`跨 module 依赖未就绪: ${dep.provider_module}@${dep.provider_stage} 未完成,但本阶段 ${dep.consumer_module}@${dep.consumer_stage} 消费其契约(来源: ${dep.source})`);
    }
  }
  return failures;
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
  for (const dependency of instance.stage.cross_module_requires || []) {
    const required = instances.filter((candidate) => candidate.stage.slug === dependency && candidate.axis === "module" && candidate.module_id !== instance.module_id);
    if (required.length === 0) missing.push(`cross-module:${dependency}`);
    else for (const candidate of required) if (!isInstanceResolved(state, candidate.instance_id)) missing.push(candidate.instance_id);
  }
  missing.push(...crossModuleRequires(instance, instances, state));
  return [...new Set(missing)];
}

export function crossModuleRequires(instance: StageInstance, instances: StageInstance[], state: WorkflowState): string[] {
  if (instance.axis !== "module" || !instance.module_id) return [];
  const failures: string[] = [];
  for (const dependency of moduleDependencyGraph()) {
    if (dependency.consumer_module !== instance.module_id || dependency.consumer_stage !== instance.stage.slug) continue;
    const providers = instances.filter((candidate) => candidate.axis === "module" && candidate.module_id === dependency.provider_module && candidate.stage.slug === dependency.provider_stage);
    if (providers.length === 0) {
      failures.push(`${dependency.provider_stage}@module:${dependency.provider_module} (from ${dependency.source})`);
      continue;
    }
    for (const provider of providers) if (!isInstanceResolved(state, provider.instance_id)) failures.push(provider.instance_id);
  }
  return failures;
}


function reconcileStageSummaries(state: WorkflowState, instances: StageInstance[]): void {
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

function artifactPlaceholderNames(pattern: string): string[] {
  return [...pattern.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

function allowsProjectAggregate(instance: StageInstance | undefined, allowProjectAggregate: boolean): boolean {
  return Boolean(allowProjectAggregate && instance && instance.axis === "project" && instance.stage.axis === "project");
}

function instanceArtifactPattern(pattern: string, instance?: StageInstance, allowProjectAggregate = false): string {
  if (!instance) return pattern;
  const resolved = substituteArtifactPattern(pattern, instance);
  const placeholders = artifactPlaceholderNames(resolved);
  const allowed = allowsProjectAggregate(instance, allowProjectAggregate)
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
  if (pattern === CANONICAL_SOURCE_PATTERN) {
    return [...new Set(expandSourcePattern(pattern, instance).flatMap((root) => resolveConcretePaths(root, instance, allowProjectAggregate)))];
  }
  return resolveConcretePaths(pattern, instance, allowProjectAggregate);
}

function resolveConcretePaths(pattern: string, instance?: StageInstance, allowProjectAggregate = false): string[] {
  const contextual = instanceArtifactPattern(pattern, instance, allowProjectAggregate).replace(/\\/g, "/");
  const expansionAllowed = allowsProjectAggregate(instance, allowProjectAggregate);
  if (contextual.includes("*") && !expansionAllowed) {
    throw new Error(`Artifact wildcards are not allowed for stage instance "${instance?.instance_id || "unknown"}": ${pattern}`);
  }
  const target = join(PROJECT_ROOT, contextual);
  if (!contextual.includes("*") && !/\{[^}]+\}/.test(contextual)) return collectFiles(target);

  const wildcard = contextual.replace(/\{(?:module-id|unit-id)\}/g, "*");
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
 * The canonical `src/` produce/consume resolves to the project's source roots
 * (module-manifest paths, then .aidlc/source-roots.json, then src/); every other
 * pattern is returned unchanged. Each root is checked on its own, so an empty or
 * missing configured root still fails the gate.
 */
function expandSourcePattern(pattern: string, instance?: StageInstance): string[] {
  if (pattern !== CANONICAL_SOURCE_PATTERN) return [pattern];
  return resolveSourceRoots(PROJECT_ROOT, instance?.module_id).roots.map((root) => `${root}/`);
}

/** Display form of a declared artifact for directives and messages. */
function displayArtifactPatterns(pattern: string, instance: StageInstance, allowProjectAggregate = false): string[] {
  return expandSourcePattern(pattern, instance).map((expanded) => instanceArtifactPattern(expanded, instance, allowProjectAggregate));
}

/**
 * Check if produces files exist (including directories and dynamic unit paths).
 */
const MIN_ARTIFACT_BYTES = 16;

/**
 * Shared presence rule of checkProduces and checkConsumes for one declared artifact
 * pattern (a canonical `src/` is expanded per source root by the callers first, so
 * every root is judged on its own). Returns the failure label, or undefined when the
 * artifact is present.
 *
 * - Directory artifact (pattern ends with `/`, or the resolved target is a directory):
 *   the directory exists and holds at least one file of >= MIN_ARTIFACT_BYTES. Empty
 *   or small files next to it (e.g. 0-byte Python `__init__.py`) do not fail it.
 * - Single-file artifact: the file exists and is >= MIN_ARTIFACT_BYTES; when a project
 *   aggregate expands it to several files, every one of them must be.
 *
 * Symbolic links / junctions and paths escaping the project root keep throwing (from
 * assertProjectPath / collectFiles); each caller keeps its own fail-closed handling.
 */
function artifactPresenceFailure(pattern: string, instance: StageInstance, allowProjectAggregate = false): string | undefined {
  const label = instanceArtifactPattern(pattern, instance, allowProjectAggregate);
  const contextual = label.replace(/\\/g, "/");
  const aggregated = contextual.includes("*") || /\{[^}]+\}/.test(contextual);
  let directory = contextual.endsWith("/");
  if (!directory && !aggregated) {
    const target = assertProjectPath(join(PROJECT_ROOT, contextual));
    directory = existsSync(target) && lstatSync(target).isDirectory();
  }
  if (directory && aggregated) {
    // A directory artifact expanded across modules/units would let a substantive file of
    // one module satisfy an empty directory of another; resolveConcretePaths returns only
    // files, so the concrete directories cannot be judged one by one here. No graph
    // consume reaches this combination today, so it is rejected instead (fail-closed).
    throw new Error(`directory artifact cannot be aggregated across modules/units: ${label}`);
  }
  const paths = resolveConcretePaths(pattern, instance, allowProjectAggregate);
  const present = directory
    ? paths.some((path) => lstatSync(path).size >= MIN_ARTIFACT_BYTES)
    : paths.length > 0 && paths.every((path) => lstatSync(path).size >= MIN_ARTIFACT_BYTES);
  return present ? undefined : label;
}

export function checkProduces(instance: StageInstance): string[] {
  const stage = instance.stage;
  if (!stage.produces || stage.produces.length === 0) return [];
  const missing: string[] = [];
  for (const pattern of stage.produces.flatMap((declared) => expandSourcePattern(declared, instance))) {
    const failure = artifactPresenceFailure(pattern, instance);
    if (failure !== undefined) missing.push(failure);
  }
  return missing;
}

export function checkConsumes(instance: StageInstance, state: WorkflowState, graph: StageGraph, instances: StageInstance[]): string[] {
  const stage = instance.stage;
  const failures: string[] = [];
  for (const pattern of stage.consumes || []) {
    let resolvedPattern = pattern;
    let missingLabel: string | undefined;
    try {
      resolvedPattern = displayArtifactPatterns(pattern, instance, true).join(", ");
      const expandedPatterns = expandSourcePattern(pattern, instance);
      if (expandedPatterns.length === 0) missingLabel = resolvedPattern;
      for (const expanded of expandedPatterns) {
        missingLabel = artifactPresenceFailure(expanded, instance, true);
        if (missingLabel !== undefined) break;
      }
    } catch (error) {
      failures.push(`${resolvedPattern}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (missingLabel !== undefined) {
      failures.push(`${missingLabel}: missing or smaller than ${MIN_ARTIFACT_BYTES} bytes`);
      continue;
    }
    const producers = graph.stages.filter((candidate) => (candidate.produces || []).includes(pattern));
    if (producers.length === 0) {
      failures.push(`${resolvedPattern}: no stage declares this canonical produce`);
      continue;
    }
    const completed = new Set(completedInstanceIds(state));
    const producerCompleted = producers.some((producer) => {
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

interface SensorCheckOptions {
  /**
   * Accept evidence whose source_revision no longer matches the current tree (the
   * revision fields must still be well-formed). Only used to re-check RED evidence
   * while completing GREEN: RED is observed on the pre-implementation tree, and the
   * GREEN implementation necessarily changes that tree. The recorded commit must still
   * be the current HEAD or one of its ancestors (non-git projects: exact match).
   */
  tolerateRevisionDrift?: boolean;
  /**
   * BASELINE evidence must have been produced in the current epoch of the baseline
   * chain (4.7.0). Set only when completing code-generation of the same unit.
   */
  requireCurrentBaselineEpoch?: boolean;
  /** Evaluate only these sensors of the stage (orchestrate baseline --advance anchor check). */
  onlySensors?: readonly string[];
}

function validateEvidence(
  stage: StageNode,
  sensor: string,
  instance: StageInstance,
  required: (value: Evidence) => string[],
  options: SensorCheckOptions = {},
): SensorResult | null {
  const loaded = loadEvidence(stage, sensor, instance);
  if (loaded.failure) return loaded.failure;
  const evidence = loaded.value as Evidence;
  const errors = required(evidence);

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
    if (sourceRevision.dirty !== null && typeof sourceRevision.dirty !== "boolean") errors.push("source_revision.dirty must be boolean or null");
    const recordedScope = typeof sourceRevision.scope === "string" ? sourceRevision.scope : undefined;
    if (recordedScope === undefined || recordedScope === "worktree") {
      // Historical binding: the exact commit, dirty flag and whole-worktree digest.
      const activeRevision = readSourceRevision(PROJECT_ROOT);
      const drift = !options.tolerateRevisionDrift;
      if (drift && commit && commit !== activeRevision.commit) errors.push(`source_revision.commit ${commit} does not match current HEAD ${activeRevision.commit}`);
      // The tolerated drift is the worktree only: the recorded commit must still be in HEAD's history.
      if (!drift && commit) errors.push(...commitAncestryErrors(PROJECT_ROOT, commit, activeRevision.commit));
      if (drift && sourceRevision.dirty !== activeRevision.dirty) errors.push("source_revision.dirty no longer matches the current worktree");
      if (!/^[a-f0-9]{64}$/.test(String(sourceRevision.worktree_digest || ""))) {
        errors.push("source_revision.worktree_digest must be a SHA-256 digest");
      } else if (drift && sourceRevision.worktree_digest !== activeRevision.worktree_digest) {
        errors.push("source_revision.worktree_digest no longer matches the current worktree");
      }
    } else {
      // Split layout: content-addressed within the owning workflow's scope. The commit
      // is provenance only, so another module's commit or write cannot invalidate it.
      const expectedScope = evidenceScopeForInstance(PROJECT_ROOT, instance.instance_id);
      if (options.tolerateRevisionDrift && commit) errors.push(...commitAncestryErrors(PROJECT_ROOT, commit, readSourceRevision(PROJECT_ROOT).commit));
      if (recordedScope !== expectedScope.label) {
        errors.push(`source_revision.scope ${recordedScope} does not match the ${expectedScope.label} scope of ${instance.instance_id}`);
      } else if (!/^[a-f0-9]{64}$/.test(String(sourceRevision.scope_digest || ""))) {
        errors.push("source_revision.scope_digest must be a SHA-256 digest");
      } else if (!options.tolerateRevisionDrift && sourceRevision.scope_digest !== readSourceRevision(PROJECT_ROOT, expectedScope).scope_digest) {
        errors.push(`source_revision.scope_digest no longer matches the ${recordedScope} scope`);
      }
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

/** I13 evidence records relevant to an instance: its module's, or every module's on the project axis. */
function i13Records(instance: StageInstance): Record<string, unknown>[] {
  const root = join(PROJECT_ROOT, ".aidlc", "evidence", "test-case-derivation");
  if (!existsSync(root)) return [];
  const paths = instance.module_id
    ? [join(root, instance.module_id, "test-case-derivation.json")]
    : collectFiles(root).filter((path) => path.endsWith("test-case-derivation.json"));
  return paths.flatMap((path) => {
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
    } catch { return []; }
  });
}

function i13Applicability(instance: StageInstance): { any: boolean; allNotApplicable: boolean } {
  const records = i13Records(instance);
  return { any: records.length > 0, allNotApplicable: records.length > 0 && records.every((record) => record.status === "not_applicable") };
}

/**
 * Which phase evidence the required I13 records demand: RED for tdd_mode new UC-Ds,
 * BASELINE for characterization UC-Ds. `known` is false when no required I13 record
 * is readable (callers then keep requiring RED).
 */
function i13PhaseNeeds(instance: StageInstance): { known: boolean; red: boolean; baseline: boolean } {
  // 4.8.0: a unit instance needs the phases of its own UC-D subset (the module set without ucd_units).
  const modes = i13Records(instance).filter((record) => record.status === "required").map((record) => unitUcdIds(record, instance.unit_id));
  return {
    known: modes.length > 0,
    red: modes.some((mode) => mode.new.length > 0),
    baseline: modes.some((mode) => mode.characterization.length > 0),
  };
}

/**
 * The unit's UC-D subset (4.8.0): set only for a unit instance whose module I13 is
 * required and declares `ucd_units`; null otherwise (module set, 4.7.1 behaviour).
 */
function unitScopeOf(instance: StageInstance): UnitUcdScope | null {
  if (!instance.unit_id) return null;
  const record = i13Records(instance).find((value) => value.status === "required");
  if (!record) return null;
  const scope = unitUcdIds(record, instance.unit_id);
  return scope.scoped ? scope : null;
}

/**
 * I13 `ucd_units` (4.8.0): absent, or exactly one non-empty list of distinct unit ids
 * of the module's unit manifest per UC-D.
 */
function i13UnitErrors(evidence: Evidence, ucdIds: string[], instance: StageInstance): string[] {
  if (evidence.ucd_units === undefined) return [];
  const record = asRecord(evidence.ucd_units);
  if (!record) return ["ucd_units must be an object keyed by UC-D"];
  const errors: string[] = [];
  const keys = Object.keys(record);
  if (keys.length !== ucdIds.length || !ucdIds.every((id) => keys.includes(id))) errors.push("ucd_units must have exactly one entry per ucd_ids entry");
  let known: string[] = [];
  try {
    known = instance.module_id ? readUnitManifest(PROJECT_ROOT, instance.module_id).map((unit) => unit.unit_id) : [];
  } catch (error) {
    errors.push(`ucd_units cannot be checked against the unit manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const [id, value] of Object.entries(record)) {
    const units = Array.isArray(value) && value.every((unit) => typeof unit === "string") ? value as string[] : null;
    if (!units || units.length === 0) {
      errors.push(`ucd_units.${id} must be a non-empty list of unit ids`);
      continue;
    }
    if (new Set(units).size !== units.length) errors.push(`ucd_units.${id} lists a unit more than once`);
    const unknown = known.length > 0 ? units.filter((unit) => !known.includes(unit)) : [];
    if (unknown.length > 0) errors.push(`ucd_units.${id} names unknown units ${unknown.join(", ")}`);
  }
  return errors;
}

/**
 * Module close-out reconciliation (4.8.0) from the files on disk: the I13 `ucd_units`
 * of the module against the passed GREEN evidence of each of its units. Returns [] when
 * the module's I13 has no `ucd_units` (nothing to reconcile).
 */
function moduleUcdCoverageGaps(moduleId: string): string[] {
  const i13Path = join(PROJECT_ROOT, evidenceRelativePath("test-case-derivation", "test-case-derivation", "module", { module_id: moduleId }));
  if (!existsSync(i13Path)) return [];
  let i13: Evidence | null = null;
  try {
    i13 = asRecord(JSON.parse(readFileSync(i13Path, "utf8")));
  } catch (error) {
    return [`I13 evidence cannot be parsed: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (!i13 || i13.status !== "required" || !i13UcdUnits(i13)) return [];
  const green = new Map<string, string[]>();
  const root = join(PROJECT_ROOT, ".aidlc", "evidence", "code-generation", moduleId);
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name, "green-test-evidence.json");
      if (!entry.isDirectory() || !existsSync(path)) continue;
      try {
        const record = asRecord(JSON.parse(readFileSync(path, "utf8")));
        if (record && record.status === "passed") green.set(entry.name, greenCoveredUcds(record));
      } catch {
        continue;
      }
    }
  }
  return ucdCoverageGaps(i13, green);
}

const UCD_MODES = new Set(["new", "characterization"]);
const BLOB_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/**
 * I13 `ucd_modes` / `characterization[]` / `baseline_commit` (4.6.0 S2.2). Evidence
 * without `ucd_modes` predates 4.6 and means every UC-D is new. When a UC-D uses
 * characterization, the recorded baseline must be the current workflow baseline (the
 * parent's for a module sub-workflow), still reachable from HEAD, and every code ref
 * must resolve to the recorded blob inside the source roots.
 */
function i13ModeErrors(evidence: Evidence, ucdIds: string[], state: WorkflowState, instance: StageInstance): string[] {
  const errors: string[] = [];
  let modes: Record<string, unknown>;
  if (evidence.ucd_modes === undefined) {
    if (evidence.characterization !== undefined || evidence.baseline_commit !== undefined) errors.push("characterization and baseline_commit require ucd_modes");
    modes = Object.fromEntries(ucdIds.map((id) => [id, "new"]));
  } else {
    const record = asRecord(evidence.ucd_modes);
    if (!record) return ["ucd_modes must be an object keyed by UC-D"];
    modes = record;
    const keys = Object.keys(record);
    if (keys.length !== ucdIds.length || !ucdIds.every((id) => keys.includes(id))) errors.push("ucd_modes must have exactly one entry per ucd_ids entry");
    for (const [id, mode] of Object.entries(record)) if (!UCD_MODES.has(String(mode))) errors.push(`ucd_modes.${id} must be new or characterization`);
  }
  const characterized = ucdIds.filter((id) => modes[id] === "characterization");
  if (state.scope === "bugfix" && ucdIds.length > 0 && characterized.length === ucdIds.length) errors.push("a bugfix workflow needs at least one tdd_mode new UC-D that reproduces the bug");
  if (characterized.length === 0) {
    if (evidence.characterization !== undefined) errors.push("characterization must be absent when no UC-D uses tdd_mode characterization");
    if (evidence.baseline_commit !== undefined) errors.push("baseline_commit must be absent when no UC-D uses tdd_mode characterization");
    return errors;
  }

  const entries = Array.isArray(evidence.characterization) ? evidence.characterization : null;
  if (!entries) return [...errors, "characterization must list every tdd_mode characterization UC-D"];
  let roots: string[] = [];
  try {
    roots = resolveSourceRoots(PROJECT_ROOT, instance.module_id).roots;
  } catch (error) {
    errors.push(`source roots cannot be resolved: ${error instanceof Error ? error.message : String(error)}`);
  }
  const refs: Array<{ ucd: string; ref: CodeRef; blob: string }> = [];
  const seen = new Set<string>();
  for (const [index, value] of entries.entries()) {
    const entry = asRecord(value);
    const ucd = asNonEmptyString(entry?.ucd);
    if (!entry || !ucd || !characterized.includes(ucd) || seen.has(ucd)) {
      errors.push(`characterization[${index}].ucd must name a distinct tdd_mode characterization UC-D`);
      continue;
    }
    seen.add(ucd);
    if (!asNonEmptyString(entry.reason)) errors.push(`characterization ${ucd} reason is required`);
    if (!asNonEmptyString(entry.approval_ref)) errors.push(`characterization ${ucd} approval_ref is required`);
    const codeRefs = Array.isArray(entry.code_refs) ? entry.code_refs : [];
    if (codeRefs.length === 0) errors.push(`characterization ${ucd} code_refs must be non-empty`);
    for (const item of codeRefs) {
      const codeRef = asRecord(item);
      const path = asNonEmptyString(codeRef?.path);
      const blob = String(codeRef?.baseline_blob || "");
      const symbol = codeRef?.symbol;
      if (!codeRef || !path || !BLOB_ID_PATTERN.test(blob) || (symbol !== undefined && !asNonEmptyString(symbol))) {
        errors.push(`characterization ${ucd} code_refs entries need path, baseline_blob and an optional non-empty symbol`);
        continue;
      }
      try {
        const ref = parseCodeRef(symbol === undefined ? path : `${path}::${String(symbol)}`, roots, `characterization ${ucd} code_refs`);
        if (ref.path !== path) errors.push(`characterization ${ucd} code_refs path ${path} is not normalized`);
        refs.push({ ucd, ref, blob });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  const missing = characterized.filter((id) => !seen.has(id));
  if (missing.length > 0) errors.push(`characterization is missing ${missing.join(", ")}`);

  let baseline: ReturnType<typeof workflowBaselineForModule>;
  try {
    baseline = workflowBaselineForModule(PROJECT_ROOT, instance.module_id);
  } catch (error) {
    return [...errors, `workflow baseline cannot be resolved: ${error instanceof Error ? error.message : String(error)}`];
  }
  const baselineErrors = baselineCommitErrors(PROJECT_ROOT, baseline.registered ? { baseline_commit: baseline.commit, baseline_source: baseline.source } : {});
  if (baselineErrors.length > 0 || !baseline.registered) return [...errors, ...baselineErrors];
  // 4.7.0: I13 stays bound to epoch 0 of the baseline chain; --advance never refreshes it.
  const epoch0 = baseline.epochs[0];
  if (evidence.baseline_commit !== epoch0) {
    return [...errors, `baseline_commit ${JSON.stringify(evidence.baseline_commit)} does not match the workflow baseline ${epoch0}${baseline.epochs.length > 1 ? " (epoch 0 of the baseline chain)" : ""}`];
  }
  for (const { ucd, ref, blob } of refs) {
    const resolved = baselineCodeRef(PROJECT_ROOT, epoch0, ref, `characterization ${ucd} code_refs ${ref.path}`);
    if ("error" in resolved) errors.push(resolved.error);
    else if (resolved.blob !== blob) errors.push(`characterization ${ucd} code_refs ${ref.path} baseline_blob ${blob} does not match ${resolved.blob} at the workflow baseline`);
  }
  return errors;
}

type I13Context = { value: Evidence } | { error: string };

/** The module's I13 evidence, read by the tdd gate to derive the RED / BASELINE UC-D sets. */
function moduleI13Evidence(instance: StageInstance): I13Context {
  if (!instance.module_id) return { error: "the tdd gate needs a module context to read the I13 evidence" };
  const path = join(PROJECT_ROOT, evidenceRelativePath("test-case-derivation", "test-case-derivation", "module", { module_id: instance.module_id }));
  if (!existsSync(path)) return { error: `I13 evidence is missing: ${normalizeArtifactLabel(relative(PROJECT_ROOT, path))}` };
  try {
    const value = asRecord(JSON.parse(readFileSync(path, "utf8")));
    return value ? { value } : { error: "I13 evidence must be a JSON object" };
  } catch (error) {
    return { error: `I13 evidence cannot be parsed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** `uc_mapping` must name exactly `expected` (by use_case), no more and no less. */
function ucMappingCoverageErrors(evidence: Evidence, requirement: string, expected: string[]): string[] {
  const named = (Array.isArray(evidence.uc_mapping) ? evidence.uc_mapping : []).map((entry) => asNonEmptyString(asRecord(entry)?.use_case) || "");
  const missing = expected.filter((id) => !named.includes(id));
  const unexpected = [...new Set(named.filter((id) => !expected.includes(id)))].map((id) => id || "(entry without use_case)");
  const duplicated = [...new Set(named.filter((id, index) => id && named.indexOf(id) !== index))];
  if (missing.length === 0 && unexpected.length === 0 && duplicated.length === 0) return [];
  const detail = [
    missing.length ? `missing ${missing.join(", ")}` : "",
    unexpected.length ? `unexpected ${unexpected.join(", ")}` : "",
    duplicated.length ? `duplicated ${duplicated.join(", ")}` : "",
  ].filter(Boolean).join("; ");
  return [`${requirement} (${expected.join(", ") || "none"}): ${detail}`];
}

/**
 * BASELINE binding to the workflow baseline chain (4.7.0 epochs): the evidence's
 * baseline_commit is one epoch of the chain (the current baseline when it was never
 * advanced), still reachable from HEAD; I13 is bound to epoch 0; code_ref_digests
 * name exactly the I13 code refs, each observed unchanged (worktree_blob ==
 * baseline_blob) at the evidence's own epoch, with that blob re-resolved here. The
 * worktree is not read: the digests are the record of what BASELINE observed.
 * `requireCurrentEpoch` (code-generation completion of the same unit) additionally
 * demands that BASELINE was produced in the current epoch, so a unit's BASELINE and
 * GREEN never straddle an --advance.
 */
function baselineEvidenceErrors(evidence: Evidence, i13: Evidence, instance: StageInstance, requireCurrentEpoch = false, scope: UnitUcdScope | null = null): string[] {
  const errors: string[] = [];
  let baseline: ReturnType<typeof workflowBaselineForModule>;
  try {
    baseline = workflowBaselineForModule(PROJECT_ROOT, instance.module_id);
  } catch (error) {
    return [`workflow baseline cannot be resolved: ${error instanceof Error ? error.message : String(error)}`];
  }
  const commitErrors = baselineCommitErrors(PROJECT_ROOT, baseline.registered ? { baseline_commit: baseline.commit, baseline_source: baseline.source } : {});
  if (commitErrors.length > 0 || !baseline.registered) return commitErrors;
  const chain = baseline.epochs;
  const epochIndex = typeof evidence.baseline_commit === "string" ? chain.indexOf(evidence.baseline_commit) : -1;
  const epoch = epochIndex >= 0 ? chain[epochIndex] : undefined;
  if (epoch === undefined) {
    errors.push(`BASELINE baseline_commit ${JSON.stringify(evidence.baseline_commit)} does not match the workflow baseline ${baseline.commit}${chain.length > 1 ? ` or any earlier epoch of the baseline chain (${chain.join(", ")})` : ""}`);
  } else {
    if (epoch !== baseline.commit) errors.push(...baselineEpochErrors(PROJECT_ROOT, epoch));
    if (requireCurrentEpoch && epoch !== baseline.commit) {
      errors.push(`BASELINE baseline_commit ${epoch} is epoch ${epochIndex} of the baseline chain, but the current epoch is ${baseline.commit} (epoch ${chain.length - 1}): a unit's BASELINE and GREEN must complete within one epoch`);
    }
  }
  if (i13.baseline_commit !== chain[0]) errors.push(`I13 baseline_commit ${JSON.stringify(i13.baseline_commit)} does not match the workflow baseline ${chain[0]}${chain.length > 1 ? " (epoch 0 of the baseline chain)" : ""}`);

  let expected: Array<{ path: string; baseline_blob: string }>;
  try {
    // 4.8.0: a unit-scoped BASELINE covers only the code refs of its own characterization UC-Ds.
    expected = i13CodeRefBlobs(i13, scope ? scope.characterization : undefined);
  } catch (error) {
    return [...errors, error instanceof Error ? error.message : String(error)];
  }
  const digests = Array.isArray(evidence.code_ref_digests) ? evidence.code_ref_digests.map((entry) => asRecord(entry)) : [];
  const paths = digests.map((entry) => asNonEmptyString(entry?.path) || "");
  const expectedPaths = expected.map((entry) => entry.path);
  if (!Array.isArray(evidence.code_ref_digests) || paths.length !== new Set(paths).size || paths.length !== expectedPaths.length || !expectedPaths.every((path) => paths.includes(path))) {
    errors.push(`code_ref_digests must cover exactly the ${scope ? `characterization code refs of unit ${instance.unit_id}` : "I13 characterization code refs"} (${expectedPaths.join(", ")}), got ${JSON.stringify(paths)}`);
  }
  for (const entry of digests) {
    const path = asNonEmptyString(entry?.path);
    const recorded = String(entry?.baseline_blob || "");
    const worktree = String(entry?.worktree_blob || "");
    if (!entry || !path || !BLOB_ID_PATTERN.test(recorded) || !BLOB_ID_PATTERN.test(worktree)) {
      errors.push("code_ref_digests entries need path, baseline_blob and worktree_blob git blob ids");
      continue;
    }
    if (worktree !== recorded) errors.push(`code_ref_digests ${path} worktree_blob ${worktree} must equal baseline_blob ${recorded}: BASELINE must observe the unmodified baseline code`);
    if (epoch === undefined) continue;
    // I13 records the epoch-0 blobs; an evidence of a later epoch is checked against its own epoch only.
    const declared = expected.find((item) => item.path === path);
    if (epochIndex === 0 && declared && declared.baseline_blob !== recorded) errors.push(`code_ref_digests ${path} baseline_blob ${recorded} does not match the I13 baseline_blob ${declared.baseline_blob}`);
    const resolved = baselineCodeRef(PROJECT_ROOT, epoch, { path }, `code_ref_digests ${path}`);
    if ("error" in resolved) errors.push(resolved.error);
    else if (resolved.blob !== recorded) errors.push(`code_ref_digests ${path} baseline_blob ${recorded} does not match ${resolved.blob} at the workflow baseline ${epoch}${chain.length > 1 ? ` (epoch ${epochIndex})` : ""}`);
  }
  return errors;
}

/**
 * RED / BASELINE / GREEN `not_required` of a unit with an empty UC-D subset (4.8.0):
 * only valid when the subset really is empty, and bound to the unit's `ucd_exemption`
 * in the unit manifest (fields equal, the executed command is its validation_command,
 * which exited 0, and the checker digest derives from that execution).
 */
function ucdExemptionEvidenceErrors(evidence: Evidence, phase: Phase, instance: StageInstance, scope: UnitUcdScope | null): string[] {
  const errors: string[] = [];
  const unitLabel = `unit ${instance.unit_id}`;
  if (!scope || !scope.scoped || scope.all.length > 0) {
    errors.push(`${phase} may be not_required by ucd_exemption only when the UC-D subset of ${unitLabel} is empty${scope?.scoped ? `; ${unitLabel}: ${scope.all.join(", ")}` : " (I13 declares no ucd_units)"}`);
    return errors;
  }
  if (evidence.phase !== phase) errors.push(`phase must be ${phase}`);
  if (!Array.isArray(evidence.ucd_ids) || evidence.ucd_ids.length !== 0) errors.push("not_required evidence must declare ucd_ids: []");
  let exemption: ReturnType<typeof unitUcdExemption>;
  try {
    exemption = unitUcdExemption(PROJECT_ROOT, instance.module_id!, instance.unit_id!);
  } catch (error) {
    return [...errors, `${unitLabel} owns no UC-D and its ucd_exemption cannot be read: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (!exemption) return [...errors, `${unitLabel} owns no UC-D of module ${instance.module_id} (unit_refs) and declares no ucd_exemption in its unit manifest`];
  const declared = asRecord(evidence.ucd_exemption);
  for (const field of ["reason_code", "reason", "approval_ref", "alternative_validation"] as const) {
    if (declared?.[field] !== exemption[field]) errors.push(`ucd_exemption.${field} does not match the unit manifest ucd_exemption of ${unitLabel}`);
  }
  const execution = asRecord(evidence.exemption_validation_execution);
  const commandDigest = argvDigest(exemption.validation_command);
  if (!execution) {
    errors.push("exemption_validation_execution is required");
  } else {
    if (execution.argv_digest !== commandDigest) errors.push(`exemption_validation_execution.argv_digest does not match the ucd_exemption validation_command of ${unitLabel}`);
    if (asNumber(execution.exit_code) !== 0 || execution.status !== "passed") errors.push("exemption_validation_execution must have passed with exit_code 0");
    if (asNumber(execution.duration_ms) === null) errors.push("exemption_validation_execution.duration_ms must be a number");
  }
  const checker = asRecord(evidence.checker);
  if (checker && checker.argv_digest !== ucdExemptionDigest(phase, commandDigest)) errors.push(`checker.argv_digest does not match the ${phase} ucd_exemption check`);
  return errors;
}

function phaseEvidenceErrors(
  evidence: Evidence,
  sensor: string,
  phase: Phase,
  applicability: { any: boolean; allNotApplicable: boolean },
  stageSlug: string,
  instance: StageInstance,
  requireCurrentBaselineEpoch = false,
): string[] {
  const errors: string[] = [];
  // RED covers the tdd_mode new UC-Ds and BASELINE the characterization UC-Ds of I13
  // (4.6.0 S3a), GREEN every UC-D (S3b); I13 without ucd_modes predates 4.6 and means
  // every UC-D is new.
  const i13 = moduleI13Evidence(instance);
  const i13Value = i13 && "value" in i13 ? i13.value : null;
  // 4.8.0: with I13 ucd_units a unit instance is checked against its own UC-D subset;
  // without them (or without a unit) `scope` is the module set and unscoped.
  const scope = i13Value?.status === "required" ? unitUcdIds(i13Value, instance.unit_id) : null;
  const modes = scope ? { new: scope.new, characterization: scope.characterization } : null;
  const scoped = scope?.scoped === true;
  const unitLabel = `unit ${instance.unit_id}`;
  const emptySubset = scoped && scope!.all.length === 0;
  const allowedStatuses = phase === "RED" ? ["failed", "not_applicable", "not_required"] : phase === "GREEN" ? (scoped ? ["passed", "not_applicable", "not_required"] : ["passed", "not_applicable"]) : ["passed", "not_required"];
  if (!allowedStatuses.includes(String(evidence.status))) errors.push(`status must be ${allowedStatuses.join(" or ")}`);
  if (i13 && "error" in i13) errors.push(`cannot derive the ${phase} UC-D set: ${i13.error}`);
  if (evidence.status === "not_required" && (emptySubset || evidence.ucd_exemption !== undefined || evidence.exemption_validation_execution !== undefined)) {
    errors.push(...ucdExemptionEvidenceErrors(evidence, phase, instance, scope));
    return errors;
  }
  if (evidence.status === "not_required" && phase === "GREEN" && scoped) {
    errors.push(`GREEN may be not_required only when the UC-D subset of ${unitLabel} is empty; ${unitLabel}: ${scope!.all.join(", ")}`);
    return errors;
  }
  if (evidence.status === "not_required" && phase !== "GREEN") {
    if (evidence.phase !== phase) errors.push(`phase must be ${phase}`);
    if (!Array.isArray(evidence.ucd_ids) || evidence.ucd_ids.length !== 0) errors.push("not_required evidence must declare ucd_ids: []");
    const checker = asRecord(evidence.checker);
    if (checker && checker.argv_digest !== phaseNotRequiredDigest(phase)) errors.push(`checker.argv_digest does not match the ${phase} not_required check`);
    if (phase === "RED") {
      if (i13Value && !modes) errors.push(`RED may be not_required only when I13 is required and declares no tdd_mode new UC-D (I13 status ${String(i13Value.status)})`);
      if (modes && modes.new.length > 0) errors.push(scoped ? `RED may be not_required only when ${unitLabel} owns no tdd_mode new UC-D; new: ${modes.new.join(", ")}` : `RED may be not_required only when I13 declares no tdd_mode new UC-D; new: ${modes.new.join(", ")}`);
    } else if (modes && modes.characterization.length > 0) {
      errors.push(scoped ? `BASELINE may be not_required only when ${unitLabel} owns no tdd_mode characterization UC-D; characterization: ${modes.characterization.join(", ")}` : `BASELINE may be not_required only when I13 declares no tdd_mode characterization UC-D; characterization: ${modes.characterization.join(", ")}`);
    }
    return errors;
  }
  if (evidence.status === "not_applicable") {
    if (!applicability.any || !applicability.allNotApplicable) errors.push(`${sensor} may be not_applicable only when I13 evidence is not_applicable`);
    if (!asNonEmptyString(evidence.not_applicable_reason)) errors.push("not_applicable_reason is required");
    if (!asNonEmptyString(evidence.alternative_validation)) errors.push("alternative_validation is required");
    const execution = asRecord(evidence.alternative_validation_execution);
    if (!execution) {
      errors.push("alternative_validation_execution is required");
    } else {
      if (!asNonEmptyString(execution.id)) errors.push("alternative_validation_execution.id is required");
      if (!/^[a-f0-9]{64}$/.test(String(execution.argv_digest || ""))) errors.push("alternative_validation_execution.argv_digest must be a SHA-256 digest");
      if (asNumber(execution.exit_code) !== 0 || execution.status !== "passed") errors.push("alternative_validation_execution must have passed with exit_code 0");
      if (asNumber(execution.duration_ms) === null) errors.push("alternative_validation_execution.duration_ms must be a number");
    }
    return errors;
  }
  if (evidence.phase !== phase) errors.push(`phase must be ${phase}`);
  if (evidence.compile_status !== "passed") errors.push("compile_status must be passed");
  if (evidence.environment_status !== "passed") errors.push("environment_status must be passed");
  const total = asPositiveInt(evidence.tests_total);
  const failed = asPositiveInt(evidence.tests_failed);
  if (total === null || total < 1) errors.push("tests_total must be >= 1");
  if (failed === null) errors.push("tests_failed must be a non-negative integer");
  if (evidence.traceability_complete !== true) errors.push("traceability_complete must be true");
  if (!Array.isArray(evidence.uc_mapping) || evidence.uc_mapping.length === 0) errors.push("uc_mapping must be non-empty");
  // The controlled producer records the observed test command separately from its
  // built-in checker; RED must have exited 1, GREEN and BASELINE 0.
  const observed = asRecord(evidence.observed_command);
  const expectedExit = phase === "RED" ? 1 : 0;
  if (!observed) {
    errors.push(`observed_command is required for controlled ${phase} evidence`);
  } else {
    if (!asNonEmptyString(observed.id)) errors.push("observed_command.id is required");
    if (observed.phase !== phase) errors.push(`observed_command.phase must be ${phase}`);
    const observedDigest = String(observed.argv_digest || "");
    if (!/^[a-f0-9]{64}$/.test(observedDigest)) {
      errors.push("observed_command.argv_digest must be a SHA-256 digest");
    } else {
      // Bind the observation to the stage's allowlisted command (same resolution and
      // stage-locked parser as the producer) and the checker digest to the observation.
      // Any allowlist failure rejects: the binding is never skipped.
      const role = phase.toLowerCase();
      try {
        const declared = allowlistedPhaseCommand(stageSlug, phase);
        if (observedDigest !== declared.argv_digest) errors.push(`observed_command.argv_digest does not match the allowlisted ${role} command ${declared.id} in ${normalizeArtifactLabel(relative(PROJECT_ROOT, declared.config))}`);
        if (asNonEmptyString(observed.id) && observed.id !== declared.id) errors.push(`observed_command.id must be ${declared.id}`);
      } catch (error) {
        errors.push(`cannot bind observed_command to the ${role} command allowlist of stage ${stageSlug}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const checker = asRecord(evidence.checker);
      if (checker && checker.argv_digest !== phaseObservationDigest(phase, observedDigest)) errors.push(`checker.argv_digest does not match the ${phase} observation of observed_command`);
    }
    if (asNumber(observed.exit_code) !== expectedExit) errors.push(`observed_command.exit_code must be ${expectedExit}`);
  }
  if (phase === "RED") {
    if (evidence.status !== "failed") errors.push('RED status must be "failed"');
    if (evidence.failure_class !== "behavior") errors.push('RED failure_class must be "behavior"');
    if (!asNonEmptyString(evidence.failure_signature)) errors.push("RED failure_signature is required");
    if (failed === null || failed < 1) errors.push("RED tests_failed must be >= 1");
    if (modes) errors.push(...ucMappingCoverageErrors(evidence, scoped ? `RED uc_mapping must cover exactly the tdd_mode new UC-Ds of ${unitLabel}` : "RED uc_mapping must cover exactly the tdd_mode new UC-Ds", modes.new));
  } else if (evidence.status !== "passed" || failed !== 0) {
    errors.push(`${phase} must be passed with tests_failed=0`);
  }
  // GREEN observes every UC-D of I13 after the change: new ones turned green and
  // characterization ones still green (4.6.0 S3b); with ucd_units, every UC-D of the unit (4.8.0).
  if (phase === "GREEN" && modes) {
    errors.push(...(scoped
      ? ucMappingCoverageErrors(evidence, `GREEN uc_mapping must cover every UC-D of ${unitLabel}`, scope!.all)
      : ucMappingCoverageErrors(evidence, "GREEN uc_mapping must cover every I13 UC-D", asStringArray(i13Value!.ucd_ids) || [])));
  }
  if (phase === "BASELINE") {
    if (!modes) {
      if (i13Value) errors.push(`BASELINE may be passed only when I13 is required and declares tdd_mode characterization UC-Ds (I13 status ${String(i13Value.status)})`);
    } else {
      errors.push(...ucMappingCoverageErrors(evidence, scoped ? `BASELINE uc_mapping must cover exactly the tdd_mode characterization UC-Ds of ${unitLabel}` : "BASELINE uc_mapping must cover exactly the tdd_mode characterization UC-Ds", modes.characterization));
      if (modes.characterization.length > 0) errors.push(...baselineEvidenceErrors(evidence, i13Value!, instance, requireCurrentBaselineEpoch, scoped ? scope : null));
    }
  }
  return errors;
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
export async function checkSensors(instance: StageInstance, state: WorkflowState, options: SensorCheckOptions = {}): Promise<SensorResult[]> {
  const stage = instance.stage;
  if (!stage.sensors || stage.sensors.length === 0) return [];

  const failures: SensorResult[] = [];

  for (const sensor of stage.sensors) {
    if (options.onlySensors && !options.onlySensors.includes(sensor)) continue;
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
        if (["tdd", "code-generation", "code-review", "build-and-test"].includes(stage.slug)) {
          const applicability = i13Applicability(instance);
          if (applicability.allNotApplicable) break;
        }

        const untraced: string[] = [];
        const unreadableFiles: string[] = [];
        // Files below MIN_ARTIFACT_BYTES inside a directory produce (e.g. empty or
        // one-line-comment Python `__init__.py` package markers under a source root) are
        // not artifacts on their own and are not traced, matching the artifact presence
        // rule (4.6.1 D8); a single-file produce is still traced whatever its size.
        const targets = [...new Set((stage.produces || [])
          .flatMap((pattern) => resolveProducePaths(pattern, instance)
            .filter((filePath) => !pattern.endsWith("/") || lstatSync(filePath).size >= MIN_ARTIFACT_BYTES))
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

      case "clarification-traceability": {
        // 澄清入链的确定性门禁:clarifications.md 必须存在、含 CL-xxx ID、且每条 CL 有实质内容。
        // 这让澄清结论进入追溯链,可被 user-stories / application-design / cross-validation 下游对账;
        // 修复"澄清文档是孤儿产物"的根源缺口。ID 规范见 knowledge/common-traceability-id-chain.md。
        const targets = [...new Set((stage.produces || [])
          .flatMap((pattern) => resolveProducePaths(pattern, instance))
          .filter((filePath) => !isEvidenceArtifact(filePath)))];
        const problems: string[] = [];
        for (const filePath of targets) {
          const content = producedText(filePath);
          if (content === null) { problems.push(`unreadable: ${artifactLabel(filePath)}`); continue; }
          const clIds = [...new Set((content.match(/\bCL-\d{3,}\b/g) || []))];
          if (clIds.length === 0) {
            // 无澄清结论是合法的(澄清可能确认"无歧义"):要求显式声明,避免空文件蒙混。
            if (!/(?:^|\n)\s*(?:无澄清项|无需澄清|no clarifications?)\b/i.test(content)) {
              problems.push(`${artifactLabel(filePath)} 无 CL-xxx 澄清条目,也未显式声明"无澄清项"`);
            }
            continue;
          }
          // 每条 CL 后必须有实质内容(结论文本),不能只有裸 ID。
          for (const cl of clIds) {
            const section = content.split(new RegExp(`\\b${cl}\\b`))[1]?.split(/\bCL-\d{3,}\b/)[0] || "";
            if (section.replace(/[#*_`>\-\s]/g, "").length < 10) problems.push(`${cl} 缺少实质澄清结论内容`);
          }
        }
        if (problems.length > 0) {
          failures.push({ sensor: "clarification-traceability", passed: false, message: problems.join("; ") });
        }
        break;
      }

      case "story-traceability": {
        // 用户故事对账(确定性):双向覆盖 + 澄清条件遵循。ID 规范见 knowledge/common-traceability-id-chain.md。
        //  - 正向:requirements.md 每个 REQ-xxx 必须被至少一个 STORY 的来源声明覆盖;
        //  - 反向:故事引用的每个 REQ/CL 必须真实存在于上游;
        //  - 澄清:clarifications.md 存在时,每个 CL-xxx 至少被一个 STORY 引用(遵循);不存在则跳过(澄清阶段可条件跳过);
        //  - 遗留兼容:requirements.md 无任何 REQ-xxx 时记 not_applicable 不阻断(未迁移旧项目)。
        const problems: string[] = [];
        const readModuleArtifact = (relPattern: string): string | null => {
          try {
            const rel = instanceArtifactPattern(relPattern, instance, true);
            if (/[{}]/.test(rel)) return null;
            const abs = join(PROJECT_ROOT, rel);
            return existsSync(abs) ? readFileSync(abs, "utf8") : null;
          } catch { return null; }
        };
        const storyTargets = [...new Set((stage.produces || [])
          .flatMap((pattern) => resolveProducePaths(pattern, instance))
          .filter((filePath) => !isEvidenceArtifact(filePath)))];
        const storyContent = storyTargets.map((p) => producedText(p) ?? "").join("\n");
        const reqContent = readModuleArtifact("docs/aidlc/modules/{module-id}/inception/requirements.md");
        const clarContent = readModuleArtifact("docs/aidlc/modules/{module-id}/inception/clarifications.md");

        const ids = (text: string | null, re: RegExp) => text ? [...new Set(text.match(re) || [])] : [];
        const reqIds = ids(reqContent, /\b(?:REQ-[A-Z0-9][A-Z0-9_-]*|R-\d+)\b/g);
        const storyIds = ids(storyContent, /\bSTORY-\d{3,}\b/g);
        const clIds = ids(clarContent, /\bCL-\d{3,}\b/g);
        const storyReqRefs = ids(storyContent, /\b(?:REQ-[A-Z0-9][A-Z0-9_-]*|R-\d+)\b/g);
        const storyClRefs = ids(storyContent, /\bCL-\d{3,}\b/g);

        if (reqContent === null) {
          problems.push("requirements.md 不可读或缺失,无法对账");
        } else if (reqIds.length === 0) {
          // 未迁移旧项目:需求无 REQ-xxx —— not_applicable,不阻断(仍要求故事非空)。
          if (storyContent.replace(/[#*_`>\-\s]/g, "").length < 20) problems.push("user-stories.md 内容为空");
        } else {
          if (storyIds.length === 0) problems.push("user-stories.md 无 STORY-xxx 故事 ID");
          // 正向:每个 REQ 被覆盖
          const uncovered = reqIds.filter((req) => !storyReqRefs.includes(req));
          if (uncovered.length > 0) problems.push(`未被任何故事覆盖的需求: ${uncovered.join(", ")}`);
          // 反向:故事引用的 REQ 必须存在
          const danglingReq = storyReqRefs.filter((req) => !reqIds.includes(req));
          if (danglingReq.length > 0) problems.push(`故事引用了不存在的需求: ${danglingReq.join(", ")}`);
          // 澄清遵循(条件):clarifications 存在且有 CL 时,每个 CL 至少被引用一次
          if (clarContent !== null && clIds.length > 0) {
            const ignoredCl = clIds.filter((cl) => !storyClRefs.includes(cl));
            if (ignoredCl.length > 0) problems.push(`澄清结论未被任何故事引用/遵循: ${ignoredCl.join(", ")}`);
            const danglingCl = storyClRefs.filter((cl) => !clIds.includes(cl));
            if (danglingCl.length > 0) problems.push(`故事引用了不存在的澄清: ${danglingCl.join(", ")}`);
          }
        }
        if (problems.length > 0) {
          failures.push({ sensor: "story-traceability", passed: false, message: problems.join("; ") });
        }
        break;
      }

      case "traceability-matrix": {
        // 全覆盖对账门禁:分类追溯矩阵到本阶段应完成的层必须 100% 覆盖,无 BROKEN@<layer>。
        // 由确定性 producer(traceabilityMatrix)生成 evidence;此处校验其结论。遗留(缺 track)降级放行。
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
          const errors: string[] = [];
          if (!["passed", "not_applicable"].includes(String(evidence.status))) errors.push('status must be "passed" or "not_applicable"');
          if (evidence.status === "not_applicable") return errors;
          const broken = Array.isArray(evidence.broken_rows) ? evidence.broken_rows : [];
          if (broken.length > 0) errors.push(`追溯矩阵存在断点(某需求在中途层丢失,drift): ${broken.slice(0, 20).join("; ")}`);
          // 遗留兼容:migration_status=MIGRATION_REQUIRED 允许(旧项目缺 track 标签),但仍报缺失清单供补齐。
          if (!["passed", "MIGRATION_REQUIRED"].includes(String(evidence.migration_status))) errors.push('migration_status must be "passed" or "MIGRATION_REQUIRED"');
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }


      case "test-case-derivation": {
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
          const errors: string[] = [];
          if (!["required", "not_applicable"].includes(String(evidence.status))) errors.push('status must be "required" or "not_applicable"');
          if (evidence.status === "not_applicable") {
            if (!["pure-declaration", "pure-style", "pure-configuration", "approved-exception"].includes(String(evidence.reason_code))) errors.push("reason_code is not an approved non-applicable code");
            for (const field of ["reason_code", "reason", "approval_ref", "alternative_validation", "validation_command"]) if (!asNonEmptyString(evidence[field])) errors.push(`${field} is required for not_applicable`);
            const sourceRefs = asStringArray(evidence.source_refs);
            if (!sourceRefs || sourceRefs.length === 0) errors.push("source_refs must be non-empty");
          } else {
            const total = asPositiveInt(evidence.ucd_total);
            const ready = asPositiveInt(evidence.ready_ucd);
            if (total === null || total < 1) errors.push("ucd_total must be >= 1");
            if (ready === null || ready !== total) errors.push("ready_ucd must equal ucd_total");
            const ucdIds = asStringArray(evidence.ucd_ids);
            if (!ucdIds || ucdIds.length === 0) errors.push("ucd_ids must be non-empty");
            if (!asNonEmptyString(evidence.index)) errors.push("index is required");
            errors.push(...i13ModeErrors(evidence, ucdIds || [], state, instance));
            errors.push(...i13UnitErrors(evidence, ucdIds || [], instance));
          }
          return errors;
        });
        if (failure) failures.push(failure);
        break;
      }

      case "red-test-evidence": {
        const applicability = i13Applicability(instance);
        const failure = validateEvidence(stage, sensor, instance, (evidence) => phaseEvidenceErrors(evidence, sensor, "RED", applicability, stage.slug, instance), options);
        if (failure) failures.push(failure);
        break;
      }

      case "baseline-test-evidence": {
        const applicability = i13Applicability(instance);
        const failure = validateEvidence(stage, sensor, instance, (evidence) => phaseEvidenceErrors(evidence, sensor, "BASELINE", applicability, stage.slug, instance, options.requireCurrentBaselineEpoch === true), options);
        if (failure) failures.push(failure);
        break;
      }

      case "green-test-evidence": {
        const applicability = i13Applicability(instance);
        const failure = validateEvidence(stage, sensor, instance, (evidence) => phaseEvidenceErrors(evidence, sensor, "GREEN", applicability, stage.slug, instance), options);
        if (failure) failures.push(failure);
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
          if (stage.mode === "review") {
            if (evidence.reviewer_agent !== stage.reviewer_agent) errors.push(`reviewer_agent must be ${stage.reviewer_agent}`);
            if (evidence.execution_context !== "isolated") errors.push('execution_context must be "isolated" for review mode');
            if (evidence.review_only !== true) errors.push("review_only must be true for review mode");
          }

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
        // RED is required for tdd_mode new UC-Ds and BASELINE for characterization
        // UC-Ds (4.6.0 S3b); without a readable required I13 RED stays mandatory.
        const needs = i13PhaseNeeds(instance);
        const unitScope = unitScopeOf(instance);
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
          const errors: string[] = [];
          if (evidence.status === "not_applicable") {
            // Only I13 not_applicable, or (4.8.0) a unit whose UC-D subset is empty, has nothing to map.
            if (unitScope ? unitScope.all.length > 0 : !i13Applicability(instance).allNotApplicable) {
              errors.push(unitScope ? `test-quality may be not_applicable only when the UC-D subset of unit ${instance.unit_id} is empty; unit ${instance.unit_id}: ${unitScope.all.join(", ")}` : "test-quality may be not_applicable only when I13 evidence is not_applicable");
            }
            if (!asNonEmptyString(evidence.not_applicable_reason)) errors.push("not_applicable_reason is required");
            if (!asNonEmptyString(evidence.alternative_validation)) errors.push("alternative_validation is required");
            if (evidence.traceability_complete !== true) errors.push("traceability_complete must be true");
            if (!Array.isArray(evidence.uc_mapping) || evidence.uc_mapping.length !== 0) errors.push("not_applicable uc_mapping must be empty");
            return errors;
          }
          if (evidence.status !== "passed") errors.push('status must be "passed"');
          if (evidence.green_seen !== true) errors.push("green_seen must be true (GREEN tests passing observed)");
          if (asNumber(evidence.tests_failed) !== 0) errors.push("tests_failed must be 0");
          const testsTotal = asPositiveInt(evidence.tests_total);
          if (testsTotal === null || testsTotal < 1) errors.push("tests_total must be >= 1");
          if (evidence.red_seen !== true && (needs.red || !needs.known)) errors.push("red_seen must be true (controlled RED evidence required)");
          if (evidence.baseline_seen !== true && needs.baseline) errors.push("baseline_seen must be true (controlled BASELINE evidence required for the tdd_mode characterization UC-Ds)");
          if (evidence.traceability_complete !== true) errors.push("traceability_complete must be true");
          const ucMapping = evidence.uc_mapping;
          if (!Array.isArray(ucMapping) || ucMapping.length === 0) {
            errors.push("uc_mapping must be a non-empty array mapping UC-D to test methods");
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

          {
            const modules = verifiedModuleIds(PROJECT_ROOT, state.scope);
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
              errors.push(`ui_modules_verified must match selected UI choices: ${expectedUiModules.join(", ") || "(none)"}`);
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
          // B3:这 4 项从"硬编码 true"升为确定性判定(required_sections 已保证节存在,这里查节内容充实)。
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
          // Mermaid (default) mode: static Mermaid checks; the SVG contract applies only after the user selects SVG.
          if (evidence.source_format === "mermaid") {
            if (diagramFormatOf(state) === "svg") errors.push("diagram format is svg (explicitly selected by the user); refresh the evidence so the SVG contract is checked");
            if (evidence.status !== "passed") errors.push(`Mermaid diagram evidence must be passed (got ${String(evidence.status)}); the stage document must contain valid mermaid code blocks`);
            const checked = asPositiveInt(evidence.diagrams_checked);
            if (checked === null || checked < 1) errors.push("Mermaid diagram evidence must check at least one mermaid code block");
            if (!Array.isArray(evidence.diagrams) || evidence.diagrams.length !== checked) errors.push("Mermaid diagram evidence must list every checked diagram");
            if (evidence.syntax_checks !== "static") errors.push('Mermaid diagram evidence must record syntax_checks "static"');
            if (!["passed", "not_executed"].includes(String(evidence.syntax_parse))) errors.push('Mermaid diagram evidence syntax_parse must be "passed" or "not_executed"');
            return errors;
          }
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
          // 方案1:遗留图降级路径允许 migration_status="MIGRATION_REQUIRED"(仅在 STATIC_PASS 时);
          // 完整 PASS 仍要求 migration_status="passed"。
          if (!["passed", "MIGRATION_REQUIRED"].includes(String(evidence.migration_status))) errors.push('migration_status must be "passed" or "MIGRATION_REQUIRED"');
          if (evidence.migration_status === "MIGRATION_REQUIRED" && final.status === "PASS") errors.push('migration_status=MIGRATION_REQUIRED cannot report full PASS; legacy diagrams stay at STATIC_PASS');
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
            if (evidence.provider_status === "passed") errors.push("STATIC_PASS cannot report provider passed");
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

      case "structural-invariants": {
        // 形态一致性门禁:生成产物不得违反设计声明的结构不变式(唯一真源/收敛/废弃/迁出/持久化授权)。
        // 无清单 → not_applicable(向后兼容);有清单 → violations 必须为空。证据只能由受控 producer 生成。
        const failure = validateEvidence(stage, sensor, instance, (evidence) => {
          const errors: string[] = [];
          if (!["passed", "not_applicable"].includes(String(evidence.status))) errors.push('status must be "passed" or "not_applicable"');
          const violations = Array.isArray(evidence.violations) ? evidence.violations : null;
          if (!violations) errors.push("violations must be an array");
          else if (violations.length > 0) errors.push(`结构不变式违例(形态 drift): ${violations.length} 项`);
          if (evidence.status === "not_applicable") {
            if (!asNonEmptyString(evidence.skip_reason)) errors.push("skip_reason is required when not_applicable");
            return errors;
          }
          if (evidence.module_id !== instance.module_id) errors.push(`module_id must be ${instance.module_id || "(none)"}`);
          const declared = asPositiveInt(evidence.invariants_declared);
          const persistenceStrict = evidence.persistence_mode === "strict";
          if (declared === null || (declared < 1 && !persistenceStrict)) errors.push("invariants_declared must be >= 1 (or persistence_mode strict)");
          if (asPositiveInt(evidence.files_scanned) === null) errors.push("files_scanned must be a non-negative integer");
          if (!asStringArray(evidence.manifests)?.length) errors.push("manifests must list the invariant manifests that were applied");
          if (!/^[a-f0-9]{64}$/.test(String(evidence.manifest_digest || ""))) errors.push("manifest_digest must be a SHA-256 digest");
          const expectedBinding = stage.slug === "application-design" ? "authoring" : "bound";
          if (evidence.manifest_binding !== expectedBinding) errors.push(`manifest_binding must be ${expectedBinding}`);
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
          if (evidence.design_mode !== expectedChoice) errors.push(`design_mode must match selected UI choice ${expectedChoice || "not-selected"}`);
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
          if (evidence.ui_route !== expectedUiRoute) errors.push(`ui_route must match selected UI choice ${expectedUiRoute}`);
          const uiPages = asNumber(evidence.ui_pages_checked);
          const uiSelected = expectedUiRoute === "html-mock" || expectedUiRoute === "figma-create" || expectedUiRoute === "figma-existing";
          if (uiPages === null || (uiSelected ? uiPages < 1 : uiPages !== 0)) errors.push("ui_pages_checked is inconsistent with selected UI route");
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
          if (uiSelected && evidence.design_mode !== expectedMode) errors.push(`design_mode must be ${expectedMode} for selected choice ${selectedChoice}`);
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
  // has_legacy_code: the resolved source roots hold more than 10 pre-existing files.
  // Evaluated lazily (only the has_legacy_code condition reads it) so an invalid
  // source-root configuration fails that condition loudly instead of reading as false.
  let legacyCode: boolean | undefined;
  const legacyCodeValue = (): boolean => (legacyCode ??= legacySourceFileCount() > LEGACY_CODE_FILE_THRESHOLD);

  // has_ui_requirements: user-stories.md contains 'UI' or '界面'
  const userStoriesPath = contextualConditionPath("docs/aidlc/inception/user-stories.md", instance);
  const userStoriesText = readConditionText(userStoriesPath);
  const has_ui_requirements = /\bUI\b|界面/.test(userStoriesText);

  // has_reverse_output: reverse-engineering.md exists
  const reverseEngineeringPath = contextualConditionPath("docs/aidlc/inception/reverse-engineering.md", instance);
  const has_reverse_output = existsSync(reverseEngineeringPath);

  const selectedArchitecture = architectureChoice(state);
  let multi_module = selectedArchitecture === "multi-module";
  const moduleManifestPath = join(PROJECT_ROOT, "docs", "aidlc", "ideation", "module-manifest.json");
  if (!selectedArchitecture && existsSync(moduleManifestPath)) {
    try {
      multi_module = readModuleManifest(PROJECT_ROOT).length > 1;
    } catch { /* invalid manifests are rejected by the module-division report gate */ }
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
  const selectedForUnit = (stageSlug: string, defaultValue: boolean): boolean =>
    unitStageSelections === undefined ? defaultValue : unitStageSelections.has(stageSlug);

  const moduleHasNfrNeeds = /NFR|非功能|性能|安全|可用性|可靠性|恢复|扩展性/i.test(contextText);
  const has_nfr_needs = unitStageSelections === undefined
    ? moduleHasNfrNeeds
    : unitStageSelections.has("nfr-requirements") && unitStageSelections.has("nfr-design");
  const moduleHasInfraNeeds = /基础设施|infrastructure|部署拓扑|容器|Kubernetes|Docker|Nacos|缓存|消息队列|分布式|外部系统/i.test(contextText);
  const has_infra_needs = selectedForUnit("infrastructure-design", moduleHasInfraNeeds);
  const applicationInstance = instance?.module_id
    ? stageInstanceId("application-design", "module", { module_id: instance.module_id })
    : "application-design";
  const applicationDesignCompleted = completedInstanceIds(state).includes(applicationInstance);
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
    readConditionText(join(PROJECT_ROOT, "docs", "aidlc", "ideation", "product-inception.md")),
    buildMetadata,
  ].join("\n");
  const has_product_contract_needs = multi_module
    || /跨模块|跨服务|跨进程|异步事件|事件\s*(?:schema|契约)|前后端接口|API\s*契约|接口契约|OpenAPI|swagger|webhook|消息队列|外部系统交换/i.test(productContractText);

  // is_loeyae_boot: build metadata references loeyae-boot framework.
  const projectUsesLoeyaeBoot = /loeyae-boot|loeyae\.boot/i.test(buildMetadata);
  const is_loeyae_boot = projectUsesLoeyaeBoot
    && selectedForUnit("loeyae-compliance", true);

  // Runtime UI mode is taken from Markdown workflow history, never from handoff text.
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
    get has_legacy_code() {
      return legacyCodeValue();
    },
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

const LEGACY_CODE_FILE_THRESHOLD = 10;
/** Build output and dependency directories never count as legacy source. */
const LEGACY_SCAN_SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "target"]);

/**
 * Number of distinct files under the project's source roots (module-manifest `paths`
 * → `.aidlc/source-roots.json` → default `src`). A missing root counts as 0 files; an
 * invalid configuration (absolute, escaping or symbolic-link root) throws. Nested
 * roots are counted once, and hidden entries keep being ignored as before.
 */
function legacySourceFileCount(): number {
  const files = new Set<string>();
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || LEGACY_SCAN_SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.add(fullPath);
    }
  };
  for (const sourceRoot of resolveSourceRoots(PROJECT_ROOT).roots) {
    const path = assertProjectPath(join(PROJECT_ROOT, ...sourceRoot.split("/")));
    if (!existsSync(path)) continue;
    if (!lstatSync(path).isDirectory()) throw new Error(`source root is not a directory: ${sourceRoot}`);
    visit(path);
  }
  return files.size;
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
function activeClaimed(state: WorkflowState, instanceId: string): boolean {
  const claim = state.active_instances?.[instanceId];
  return Boolean(claim && Date.parse(claim.expires_at) > Date.now());
}

function findClaimableModuleInstance(
  instances: StageInstance[],
  state: WorkflowState,
  moduleId: string,
  all: StageInstance[] = instances,
): {
  instance: StageInstance | null;
  blocked?: { instance: StageInstance; unsatisfied: string[] };
  conditionError?: { instance: StageInstance; condition: string };
  skippedByCondition?: { instance: StageInstance; reason: string }[];
} {
  let blocked: { instance: StageInstance; unsatisfied: string[] } | undefined;
  for (const instance of instances) {
    if (instance.axis !== "module" || instance.module_id !== moduleId || isInstanceResolved(state, instance.instance_id) || activeClaimed(state, instance.instance_id)) continue;
    const stage = instance.stage;
    if (stage.condition && stage.condition.trim() !== "") {
      const conditionResult = evaluateCondition(stage.condition, buildConditionContext(state, instance));
      if (conditionResult === undefined) return { instance: null, conditionError: { instance, condition: stage.condition } };
      if (!conditionResult) {
        state.skipped_stage_instances.push(instance.instance_id);
        state.history.push({
          stage: stage.slug,
          instance_id: instance.instance_id,
          module_id: instance.module_id,
          unit_id: instance.unit_id,
          result: "condition_skipped",
          timestamp: new Date().toISOString(),
          user_input: `Auto-skipped: condition "${stage.condition}" evaluated to false`,
        });
        continue;
      }
    }
    const unsatisfied = checkRequires(instance, all, state);
    if (unsatisfied.length === 0) return { instance };
    return { instance: null, blocked: { instance, unsatisfied } };
  }
  return { instance: null, blocked };
}

function findNextInstance(
  instances: StageInstance[],
  state: WorkflowState,
  all: StageInstance[] = instances,
): {
  instance: StageInstance | null;
  blocked?: { instance: StageInstance; unsatisfied: string[] };
  conditionError?: { instance: StageInstance; condition: string };
  skippedByCondition?: { instance: StageInstance; reason: string }[];
} {
  const conditionSkips: { instance: StageInstance; reason: string }[] = [];

  for (const instance of instances) {
    if (isInstanceResolved(state, instance.instance_id) || activeClaimed(state, instance.instance_id)) continue;
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
        state.skipped_stage_instances.push(instance.instance_id);
        state.history.push({
          stage: stage.slug,
          instance_id: instance.instance_id,
          module_id: instance.module_id,
          unit_id: instance.unit_id,
          result: "condition_skipped",
          timestamp: new Date().toISOString(),
          user_input: `Auto-skipped: condition "${stage.condition}" evaluated to false`,
        });
        reconcileStageSummaries(state, all);
        continue;
      }
    }

    const unsatisfied = checkRequires(instance, all, state);
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

function unsupportedFlag(flags: Record<string, string>, allowed: ReadonlySet<string>): string | undefined {
  return Object.keys(flags).find((flag) => !allowed.has(flag));
}

const CHOICE_DESCRIPTIONS: Record<string, Record<string, string>> = {
  "workspace-detection": {
    "single-module": "单一业务模块，不需要跨模块协作和产品级 inception",
    "multi-module": "多业务模块或多服务，启用产品级 inception（module-division、product-contracts 等）",
  },
  "ui-mock": {
    "html-mock": "生成可离线浏览的结构化 HTML 原型",
    "figma-create": "创建 Figma 设计，适合团队协作、高保真交付和 Dev Mode",
    "figma-existing": "使用已有 Figma 设计稿，验证后登记为正式设计基准",
    skip: "跳过 UI 设计，仅适用于无界面需求或用户明确不需要设计基准",
  },
};

function choicePrompt(stageSlug: string, choices: string[]): string {
  if (choices.length === 0) return "";
  const descriptions = CHOICE_DESCRIPTIONS[stageSlug] || {};
  const options = choices.map((choice) => `- ${choice}${descriptions[choice] ? `：${descriptions[choice]}` : ""}`).join("\n");
  return `\n用户选择：必须向用户提问并等待用户回答后再 report，不得自行选择；将用户回答的选项作为 --user-input 的值。可选项：\n${options}`;
}

export function diagramFormatOf(state: Pick<WorkflowState, "diagram_format">): DiagramFormat {
  return state.diagram_format === "svg" ? "svg" : "mermaid";
}

function diagramFormatPrompt(state: WorkflowState, instance: StageInstance): string {
  if (!instance.stage.sensors.includes("diagram-contract")) return "";
  return diagramFormatOf(state) === "svg"
    ? "\n图表格式：svg（用户已明确选择）。按 aidlc-diagram-design 交付 SVG 源与 .diagram.json，并通过 diagram-contract 的 SVG 契约。"
    : "\n图表格式：mermaid（默认）。直接写 Mermaid fenced block，不生成 SVG、.diagram.json 或 Provider Request，不做渲染验证。只有用户明确要求 SVG 时，先执行 loeyae-aidlc orchestrate diagram-format --set svg --user-input \"<用户原话>\"。";
}

function lightweightNextPrompt(state: WorkflowState, instance: StageInstance, agentExecution: AgentExecutionPlan, reportCommand?: string, choices: string[] = []): string {
  const unit = instance.module_id && instance.unit_id
    ? `当前单元：${instance.module_id}/${instance.unit_id}。团队成员可用 unit select 声明负责人与分支。`
    : "当前阶段不要求成员选择单元；按产物、review、构建和测试门禁推进。";
  const artifacts = instance.stage.produces.length
    ? instance.stage.produces.flatMap((pattern) => displayArtifactPatterns(pattern, instance)).join("、")
    : "本阶段没有声明文件产物";
  return `工作目标：${state.work_description}\n当前阶段：${instance.stage.name}（${instance.instance_id}，${instance.stage.phase}）\n${unit}\n执行角色：${agentExecution.primary.title}（${agentExecution.primary.id}）\n执行方式：${agentExecution.mode}；状态、审批和 merge 权限仅属于 conductor。\n需要产物：${artifacts}\n质量动作：完成适用 review、构建、测试和 sensor 检查。${diagramFormatPrompt(state, instance)}${choicePrompt(instance.stage.slug, choices)}\n下一步：完成后将结构化结果交回 conductor，再运行 ${reportCommand || "orchestrate report"}。`;
}

function clearActiveContext(state: WorkflowState): void {
  state.current_stage = "";
  delete state.current_stage_instance;
  delete state.current_module;
  delete state.current_unit;
}

function selectActiveContext(state: WorkflowState, owns: (instanceId: string) => boolean = () => true): void {
  const next = Object.values(state.active_instances || {}).filter((claim) => owns(claim.stage_instance)).sort((left, right) => left.stage_instance.localeCompare(right.stage_instance))[0];
  if (!next) {
    clearActiveContext(state);
    return;
  }
  const stageSlug = next.stage_instance.split("@", 1)[0];
  const stage = loadGraph().stages.find((candidate) => candidate.slug === stageSlug);
  state.current_stage = stageSlug;
  state.current_phase = stage?.phase || state.current_phase;
  state.current_stage_instance = next.stage_instance;
  state.current_module = next.module_id;
  const unitMatch = /@unit:([a-z0-9][a-z0-9-]*)$/.exec(next.stage_instance);
  if (unitMatch) state.current_unit = unitMatch[1];
  else delete state.current_unit;
}

function missingSemanticEvidence(instance: StageInstance): string[] {
  return instance.stage.sensors
    .filter((sensor) => SEMANTIC_SENSORS.has(sensor))
    .filter((sensor) => !existsSync(join(PROJECT_ROOT, evidenceRelativePath(instance.stage.slug, sensor, instance.axis, instance))));
}

function produceMissingSemanticEvidence(instance: StageInstance, refresh = false): string | null {
  const missing = missingSemanticEvidence(instance);
  if (missing.length === 0) return null;
  const evidenceTool = join(__dirname, "aidlc-evidence.ts");
  const result = spawnSync(process.execPath, [TSX_CLI, evidenceTool, "run", "--stage", instance.stage.slug, "--instance", instance.instance_id, "--all-sensors", ...(refresh ? ["--refresh"] : [])], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    shell: false,
    timeout: 30 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join("; ")
      .trim();
    return `automatic semantic evidence production failed for ${instance.instance_id} (${missing.join(", ")}): ${detail || `exit code ${result.status}`}`;
  }
  const stillMissing = missingSemanticEvidence(instance);
  return stillMissing.length === 0
    ? null
    : `automatic semantic evidence production did not write: ${stillMissing.join(", ")}`;
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
// Split per-module layout (4.3.0)
// ---------------------------------------------------------------------------

interface EngineContext {
  owner: WorkflowRef;
  loaded: WorkflowParts;
  view: WorkflowState;
}

function workflowLabel(ref: WorkflowRef): string {
  if (ref.kind === "module") return `Module workflow "${ref.module_id}"`;
  return ref.kind === "integration" ? "Integration workflow" : "Global workflow";
}

function moduleRef(moduleId: string): WorkflowRef {
  return { kind: "module", module_id: moduleId };
}

function openSplitContext(owner: WorkflowRef): EngineContext {
  const loaded = loadWorkflowParts(PROJECT_ROOT);
  if (!loaded.split) throw new Error("split workflow layout is not initialized");
  for (const part of loaded.parts.values()) {
    if (releaseExpiredModuleClaims(part.state).length > 0) saveWorkflowState(PROJECT_ROOT, part.state, part.ref);
  }
  if (!loaded.parts.has(workflowRefKey(owner))) throw new Error(`${workflowLabel(owner)} does not exist in the registry`);
  return { owner, loaded, view: mergeWorkflowView(loaded.parts, owner) };
}

function ownedInstances(instances: StageInstance[], ref: WorkflowRef): StageInstance[] {
  return instances.filter((instance) => sameRef(ownerOfInstance(instance.instance_id), ref));
}

function summarizeOwned(state: WorkflowState, instances: StageInstance[]): void {
  const completed = new Set(state.completed_stage_instances);
  const skipped = new Set(state.skipped_stage_instances);
  state.completed_stages = [];
  state.skipped_stages = [];
  for (const slug of [...new Set(instances.map((instance) => instance.stage.slug))]) {
    const group = instances.filter((instance) => instance.stage.slug === slug);
    if (!group.every((instance) => completed.has(instance.instance_id) || skipped.has(instance.instance_id))) continue;
    if (group.every((instance) => skipped.has(instance.instance_id))) state.skipped_stages.push(slug);
    else state.completed_stages.push(slug);
  }
}

/** Persist the owner's portion of a mutated view, then refresh the registry projections. */
function commitSplitContext(ctx: EngineContext, view: WorkflowState = ctx.view): void {
  const key = workflowRefKey(ctx.owner);
  const part = ctx.loaded.parts.get(key);
  if (!part) throw new Error(`${workflowLabel(ctx.owner)} is not loaded`);
  const next = extractOwnedState(view, part.state, ctx.owner);
  summarizeOwned(next, ownedInstances(expandStageInstances(loadGraph(), view), ctx.owner));
  saveWorkflowState(PROJECT_ROOT, next, ctx.owner);
  ctx.loaded.parts.set(key, { ref: ctx.owner, state: next });
  view.revision = next.revision;
  view.updated_at = next.updated_at;
  refreshRegistry(ctx.loaded);
}

function markdownTableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

/**
 * Cross-module shared contracts derived from docs/aidlc/ideation/product-contracts.md:
 * the contract list gives the provider module, the consumer status table gives each
 * consumer module and whether it is verified (已验证 / verified).
 */
function sharedContractProjection(): RegistrySharedContract[] {
  const path = join(PROJECT_ROOT, "docs", "aidlc", "ideation", "product-contracts.md");
  if (!existsSync(path)) return [];
  let modules: ModuleDescriptor[];
  try {
    modules = readModuleManifest(PROJECT_ROOT);
  } catch {
    return [];
  }
  const providers = new Map<string, string>();
  const consumers = new Map<string, Map<string, boolean>>();
  let header: string[] | undefined;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) {
      header = undefined;
      continue;
    }
    const cells = markdownTableCells(line);
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    if (!header) {
      header = cells;
      continue;
    }
    const column = (pattern: RegExp): number => header!.findIndex((cell) => pattern.test(cell));
    const idIndex = column(CONTRACT_ID_COLUMN);
    const contractId = idIndex >= 0 ? cells[idIndex] : "";
    if (!contractId || contractId === "-") continue;
    const providerIndex = column(CONTRACT_PROVIDER_COLUMN);
    const consumerIndex = column(CONTRACT_CONSUMER_COLUMN);
    const statusIndex = column(/^(?:状态|status)$/i);
    if (providerIndex >= 0 && consumerIndex < 0) {
      const provider = moduleForValue(modules, cells[providerIndex] || "");
      if (provider) providers.set(contractId, provider);
    } else if (consumerIndex >= 0 && statusIndex >= 0) {
      const consumer = moduleForValue(modules, cells[consumerIndex] || "");
      if (!consumer) continue;
      const status = cells[statusIndex] || "";
      const verified = /已验证|^verified$/i.test(status) && !/未验证|unverified/i.test(status);
      const entry = consumers.get(contractId) || new Map<string, boolean>();
      entry.set(consumer, (entry.get(consumer) ?? true) && verified);
      consumers.set(contractId, entry);
    }
  }
  const source = relative(PROJECT_ROOT, path).replace(/\\/g, "/");
  return [...providers.entries()].flatMap(([contractId, provider]) => {
    const moduleConsumers = [...(consumers.get(contractId) || new Map<string, boolean>()).entries()].filter(([consumer]) => consumer !== provider);
    if (moduleConsumers.length === 0) return [];
    return [{
      contract_id: contractId,
      provider,
      consumers: moduleConsumers.map(([consumer]) => consumer),
      verified: moduleConsumers.every(([, verified]) => verified),
      source,
    }];
  });
}

function crossModuleRequireProjection(view: WorkflowState, instances: StageInstance[]): RegistryCrossRequire[] {
  let dependencies: ModuleDependency[];
  try {
    dependencies = moduleDependencyGraph();
  } catch {
    return [];
  }
  return dependencies.map((dependency) => {
    const providers = instances.filter((candidate) => candidate.axis === "module" && candidate.module_id === dependency.provider_module && candidate.stage.slug === dependency.provider_stage);
    return {
      consumer: dependency.consumer_module,
      consumer_stage: dependency.consumer_stage,
      provider: dependency.provider_module,
      provider_stage: dependency.provider_stage,
      satisfied: providers.length > 0 && providers.every((provider) => isInstanceResolved(view, provider.instance_id)),
      source: dependency.source,
    };
  });
}

/** Recompute every projection column from the loaded workflow parts; identity rows are kept. */
function registryProjection(registry: WorkflowRegistry, loaded: WorkflowParts): WorkflowRegistry {
  const view = mergeWorkflowView(loaded.parts, GLOBAL_WORKFLOW);
  const instances = expandStageInstances(loadGraph(), view);
  const resolved = (instance: StageInstance): boolean => isInstanceResolved(view, instance.instance_id);
  const modules = registry.modules.map((row) => {
    const state = loaded.parts.get(`module:${row.module_id}`)?.state;
    if (!state) return row;
    const own = instances.filter((instance) => instance.module_id === row.module_id && instance.axis !== "project");
    const inceptionDone = own.filter((instance) => instance.axis === "module").every(resolved);
    return {
      ...row,
      status: state.status,
      current_stage: state.current_stage_instance || state.current_stage || "-",
      inception_done: inceptionDone,
      construction_done: inceptionDone && own.filter((instance) => instance.axis === "unit").every(resolved),
      owner: state.module_selections?.[row.module_id]?.owner || Object.values(state.active_instances || {})[0]?.owner || "-",
    };
  });
  const registered = new Set(modules.map((row) => row.module_id));
  const unregistered = [...new Set(instances.filter((instance) => instance.axis !== "project" && instance.module_id && !registered.has(instance.module_id)).map((instance) => instance.module_id as string))];
  const sharedContracts = sharedContractProjection();
  const blocking = [
    ...unregistered.map((moduleId) => `workflow:${moduleId}`),
    ...modules.filter((row) => !row.construction_done).map((row) => `construction:${row.module_id}`),
    ...sharedContracts.filter((contract) => !contract.verified).map((contract) => `contract:${contract.contract_id}`),
    // 4.8.0: a module with I13 ucd_units enters integration only when every UC-D is in
    // the GREEN of every unit its unit_refs name.
    ...modules.filter((row) => row.construction_done && moduleUcdCoverageGaps(row.module_id).length > 0).map((row) => `ucd-coverage:${row.module_id}`),
  ];
  const integration = loaded.parts.get("integration")?.state;
  return {
    ...registry,
    modules,
    integration: {
      ...registry.integration,
      status: integration?.status || registry.integration.status,
      current_stage: integration?.current_stage_instance || integration?.current_stage || "-",
      barrier_ready: blocking.length === 0,
      blocking,
    },
    shared_contracts: sharedContracts,
    cross_module_requires: crossModuleRequireProjection(view, instances),
  };
}

function refreshRegistry(loaded: WorkflowParts): void {
  const updated = updateRegistry(PROJECT_ROOT, (current) => registryProjection(current as WorkflowRegistry, loaded));
  loaded.registry = updated;
}

function reportCommandFor(instance: StageInstance): string {
  const target = `${instance.module_id ? ` --module ${instance.module_id}` : ""}${instance.unit_id ? ` --unit ${instance.unit_id}` : ""}`;
  const result = instance.stage.approval === "block" ? "approved --user-input Approve" : "completed";
  return `orchestrate report --stage ${instance.stage.slug}${target} --result ${result}`;
}

/** `probe` evaluates the next directive without persisting anything (used to compare modules). */
function advanceSplit(ctx: EngineContext, graph: StageGraph, args: string[], flags: Record<string, string>, probe = false): Promise<Directive> {
  const key = workflowRefKey(ctx.owner);
  const persisted = ctx.loaded.parts.get(key)!.state;
  return advance(graph, {
    state: ctx.view,
    flags,
    commit: probe ? () => undefined : (view) => commitSplitContext(ctx, view),
    retry: () => handleNext(args),
    label: workflowLabel(ctx.owner),
    finishedMessage: (count) => `🎉 ${workflowLabel(ctx.owner)}: all ${count} stage instances resolved.`,
    candidate: (instance) => sameRef(ownerOfInstance(instance.instance_id), ctx.owner),
    extras: { workflow: key, workflow_id: persisted.workflow_id, state_path: relativeStatePath(PROJECT_ROOT, ctx.owner) },
    reportCommand: reportCommandFor,
  });
}

function ensureModuleWorkflow(moduleId: string): Directive | null {
  const loaded = loadWorkflowParts(PROJECT_ROOT);
  if (loaded.parts.has(`module:${moduleId}`)) return null;
  let modules: ModuleDescriptor[];
  try {
    modules = readModuleManifest(PROJECT_ROOT);
  } catch (error) {
    return { kind: "error", message: `Module manifest is unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!modules.some((module) => module.module_id === moduleId)) {
    return { kind: "error", message: `Unknown module "${moduleId}"; declare it in docs/aidlc/ideation/module-manifest.json first.` };
  }
  const global = loaded.parts.get("global")!.state;
  const ref = moduleRef(moduleId);
  const state: WorkflowState = {
    ...createInitialState(global.scope, ENGINE_VERSION, randomUUID(), global.selected_optional_stages, global.work_description),
    workflow_kind: "module",
    module_id: moduleId,
    parent_workflow_id: global.workflow_id,
    depth: global.depth,
    current_phase: "inception",
  };
  saveWorkflowState(PROJECT_ROOT, state, ref);
  appendAuditEvent(PROJECT_ROOT, ref, "WORKFLOW_CREATED", { "Parent Workflow ID": global.workflow_id, Trigger: "next --module" });
  updateRegistry(PROJECT_ROOT, (current) => {
    const registry = current as WorkflowRegistry;
    if (registry.modules.some((row) => row.module_id === moduleId)) return registry;
    return {
      ...registry,
      modules: [...registry.modules, { module_id: moduleId, workflow_id: state.workflow_id, state_path: relativeStatePath(PROJECT_ROOT, ref), status: "running", current_stage: "-", inception_done: false, construction_done: false, owner: "-" }],
    };
  });
  return null;
}

function firstLine(value: unknown): string {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 2).join(" ");
}

/**
 * `next` in the split layout. `--module <id>` advances only that module. Without it the
 * global workflow goes first (compatible behavior), then the first module that can advance
 * (blocked, parked or finished modules are reported, never allowed to hold the others),
 * and finally the integration workflow once its cross-module barrier is ready.
 */
async function splitNext(args: string[], flags: Record<string, string>, graph: StageGraph): Promise<Directive> {
  // Explicit --module wins; AIDLC_MODULE is an equivalent default and never falls back to another module.
  const envModule = process.env.AIDLC_MODULE?.trim();
  const targetModule = flags.module || envModule;
  if (targetModule) {
    const failure = ensureModuleWorkflow(targetModule);
    if (failure) return flags.module ? failure : { ...failure, message: `AIDLC_MODULE: ${failure.message}` };
    return advanceSplit(openSplitContext(moduleRef(targetModule)), graph, args, { ...flags, module: targetModule });
  }
  const globalContext = openSplitContext(GLOBAL_WORKFLOW);
  if (globalContext.loaded.parts.get("global")!.state.status !== "done") {
    const directive = await advanceSplit(globalContext, graph, args, flags);
    if (directive.kind !== "done") return directive;
  }
  const moduleFlags = Object.fromEntries(Object.entries(flags).filter(([key]) => key !== "resume"));
  const notes: string[] = [];
  const ready: { module_id: string; stage: string; stage_instance: string; name: string }[] = [];
  let modulesDone = true;
  for (const row of openSplitContext(GLOBAL_WORKFLOW).loaded.registry!.modules) {
    const ctx = openSplitContext(moduleRef(row.module_id));
    const state = ctx.loaded.parts.get(`module:${row.module_id}`)!.state;
    if (state.status === "done") continue;
    modulesDone = false;
    if (state.status === "parked") {
      notes.push(`module:${row.module_id}: parked at ${state.current_stage_instance || state.current_stage || "-"} (resume with next --module ${row.module_id} --resume)`);
      continue;
    }
    const probed = await advanceSplit(ctx, graph, args, moduleFlags, true);
    if (probed.kind === "run-stage") {
      ready.push({ module_id: row.module_id, stage: String(probed.stage), stage_instance: String(probed.stage_instance), name: String(probed.name) });
      continue;
    }
    // Not advanceable: run it for real so auto-skips and completion are persisted as before.
    const directive = await advanceSplit(openSplitContext(moduleRef(row.module_id)), graph, args, moduleFlags);
    if (directive.kind === "done") continue;
    notes.push(`module:${row.module_id}: ${firstLine(directive.message)}`);
  }
  if (ready.length === 1) {
    const directive = await advanceSplit(openSplitContext(moduleRef(ready[0].module_id)), graph, args, moduleFlags);
    return notes.length ? { ...directive, other_workflows: notes } : directive;
  }
  if (ready.length > 1) {
    return {
      kind: "ask",
      ask_type: "module-selection",
      question: `${ready.length} module workflows can advance. Ask the user which module to work on, then run next --module <module-id> (or set AIDLC_MODULE).`,
      options: ready.map((item) => item.module_id),
      modules: ready,
      command_template: "loeyae-aidlc orchestrate next --module <module-id>",
      message: `Multiple module workflows can advance; the user must choose one:\n${ready.map((item) => `  • ${item.module_id}: next stage ${item.stage_instance} (${item.name})`).join("\n")}\n  Run: loeyae-aidlc orchestrate next --module <module-id>`,
      ...(notes.length ? { other_workflows: notes } : {}),
    };
  }
  if (!modulesDone) {
    const pending = openSplitContext(GLOBAL_WORKFLOW).loaded.registry!.modules.filter((row) => {
      const state = loadWorkflowState(PROJECT_ROOT, moduleRef(row.module_id));
      return state && state.status !== "done";
    });
    if (pending.length > 0) {
      return { kind: "error", message: `🚫 No module workflow can advance right now:\n${notes.map((note) => `  • ${note}`).join("\n")}\n  Use next --module <module-id> to work on one module.`, other_workflows: notes };
    }
  }
  const integrationContext = openSplitContext(INTEGRATION_WORKFLOW);
  if (integrationContext.loaded.parts.get("integration")!.state.status === "done") {
    return { kind: "done", message: "🎉 All split workflows finished (global, modules and integration)." };
  }
  const barrier = registryProjection(integrationContext.loaded.registry!, integrationContext.loaded).integration;
  if (!barrier.barrier_ready) {
    return {
      kind: "error",
      message: `🚫 Cross-module integration barrier is not ready: ${barrier.blocking.join(", ")}. Every module must finish construction and every shared contract consumer must be 已验证/verified in docs/aidlc/ideation/product-contracts.md.${barrier.blocking.filter((item) => item.startsWith("ucd-coverage:")).map((item) => ` Module ${item.slice("ucd-coverage:".length)} UC-D coverage is incomplete: ${moduleUcdCoverageGaps(item.slice("ucd-coverage:".length)).join("; ")}.`).join("")}`,
      workflow: "integration",
      blocking: barrier.blocking,
    };
  }
  const directive = await advanceSplit(integrationContext, graph, args, flags);
  if (directive.kind === "done") return { ...directive, message: "🎉 All split workflows finished (global, modules and integration)." };
  return directive;
}

function splitStatusDirective(graph: StageGraph, moduleId?: string): Directive {
  const loaded = loadWorkflowParts(PROJECT_ROOT);
  const view = mergeWorkflowView(loaded.parts, GLOBAL_WORKFLOW);
  const instances = expandStageInstances(graph, view);
  const projection = registryProjection(loaded.registry!, loaded);
  const refs = moduleId
    ? [moduleRef(moduleId)]
    : [GLOBAL_WORKFLOW, ...projection.modules.map((row) => moduleRef(row.module_id)), INTEGRATION_WORKFLOW];
  const lines = refs.map((ref) => {
    const state = loaded.parts.get(workflowRefKey(ref))?.state;
    if (!state) return `  [${workflowRefKey(ref)}] (no workflow yet)`;
    const own = ownedInstances(instances, ref);
    const completed = own.filter((instance) => state.completed_stage_instances.includes(instance.instance_id)).length;
    const skipped = own.filter((instance) => state.skipped_stage_instances.includes(instance.instance_id)).length;
    const remaining = own.filter((instance) => !isInstanceResolved(view, instance.instance_id)).map((instance) => instance.instance_id);
    return `  [${workflowRefKey(ref)}] ${state.status} | current: ${state.current_stage_instance || state.current_stage || "(none)"} | completed: ${completed}/${own.length} | skipped: ${skipped} | remaining: ${remaining.length}${remaining.length ? ` (${remaining.slice(0, 6).join(", ")}${remaining.length > 6 ? ", …" : ""})` : ""}`;
  });
  const barrier = projection.integration;
  return {
    kind: "print",
    message: `📊 Split Workflow Status (registry: aidlc/active/registry.md)\n` +
      `  Scope: ${view.scope} | Global workflow: ${projection.global_workflow_id}\n` +
      `${lines.join("\n")}\n` +
      `  Integration barrier: ${barrier.barrier_ready ? "ready" : `blocked (${barrier.blocking.join(", ")})`}`,
  };
}

interface LegacyEvidence {
  path: string;
  instance: string;
  valid: boolean;
  record: Record<string, unknown>;
}

/** Evidence still bound to the whole worktree; `valid` means it would pass the historical check now. */
function legacyEvidenceInventory(): LegacyEvidence[] {
  const root = join(PROJECT_ROOT, ".aidlc", "evidence");
  if (!existsSync(root)) return [];
  const current = readSourceRevision(PROJECT_ROOT);
  const inventory: LegacyEvidence[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      } catch {
        continue;
      }
      const revision = asRecord(record?.source_revision);
      if (!revision || typeof revision.scope === "string") continue;
      const segments = relative(root, path).split(sep);
      const derived = segments.length === 3
        ? `${segments[0]}@module:${segments[1]}`
        : segments.length === 4
          ? `${segments[0]}@module:${segments[1]}@unit:${segments[2]}`
          : segments[0];
      const instance = typeof record.stage_instance === "string" && record.stage_instance ? record.stage_instance : derived;
      if (ownerOfInstance(instance).kind === "integration") continue;
      inventory.push({
        path,
        instance,
        valid: revision.commit === current.commit && revision.dirty === current.dirty && revision.worktree_digest === current.worktree_digest,
        record,
      });
    }
  };
  visit(root);
  return inventory.sort((left, right) => left.path.localeCompare(right.path));
}

/** Re-anchor still-valid legacy evidence to its split scope; mismatched evidence needs --refresh. */
function anchorLegacyEvidence(inventory: LegacyEvidence[]): { anchored: string[]; stale: string[] } {
  const anchored: string[] = [];
  const stale: string[] = [];
  const digests = new Map<string, string | null | undefined>();
  for (const item of inventory) {
    const label = relative(PROJECT_ROOT, item.path).replace(/\\/g, "/");
    if (!item.valid) {
      stale.push(`${label} (${item.instance})`);
      continue;
    }
    const scope = evidenceScopeForInstance(PROJECT_ROOT, item.instance);
    if (scope.label === "worktree") continue;
    if (!digests.has(scope.label)) digests.set(scope.label, readSourceRevision(PROJECT_ROOT, scope).scope_digest);
    const digest = digests.get(scope.label);
    if (!digest) {
      stale.push(`${label} (${item.instance})`);
      continue;
    }
    const record = { ...item.record, source_revision: { ...(item.record.source_revision as Record<string, unknown>), scope: scope.label, scope_digest: digest, anchored_by: "orchestrate split", anchored_at: new Date().toISOString() } };
    const temporary = `${item.path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, item.path);
    anchored.push(label);
  }
  return { anchored, stale };
}

/**
 * Split a single-layout workflow into global, per-module and integration workflows without
 * losing any recorded stage instance, history row, claim or selection.
 */
function performSplit(fromId: string, dryRun: boolean, trigger: string): Directive {
  if (isSplitLayout(PROJECT_ROOT)) return { kind: "error", message: "The workflow layout is already split; use next --module <module-id>." };
  const legacy = loadState();
  if (!legacy) return { kind: "error", message: "No active workflow to split." };
  const requested = fromId.trim();
  if (!(legacy.workflow_id === requested || (requested.length >= 8 && legacy.workflow_id.startsWith(requested)))) {
    return { kind: "error", message: `--from ${requested} does not match the active workflow ${legacy.workflow_id}.` };
  }
  if (!legacy.completed_stages.includes("module-division")) {
    return { kind: "error", message: "Per-module workflows require a completed module-division stage and docs/aidlc/ideation/module-manifest.json." };
  }
  let modules: ModuleDescriptor[];
  try {
    modules = readModuleManifest(PROJECT_ROOT);
  } catch (error) {
    return { kind: "error", message: `Module manifest is unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
  const instances = expandStageInstances(loadGraph(), legacy);
  const refs: WorkflowRef[] = [GLOBAL_WORKFLOW, ...modules.map((module) => moduleRef(module.module_id)), INTEGRATION_WORKFLOW];
  const known = new Set(refs.map(workflowRefKey));
  const tracked = [
    ...legacy.completed_stage_instances,
    ...legacy.skipped_stage_instances,
    ...Object.keys(legacy.active_instances || {}),
    ...legacy.history.map((entry) => entry.instance_id).filter((value): value is string => Boolean(value)),
  ];
  const orphans = [...new Set(tracked.filter((instance) => !known.has(workflowRefKey(ownerOfInstance(instance)))))];
  if (orphans.length > 0) {
    return { kind: "error", message: `Cannot split: ${orphans.join(", ")} belong to modules missing from module-manifest.json. Restore the manifest before splitting.` };
  }
  const currentOwner = legacy.current_stage_instance ? ownerOfInstance(legacy.current_stage_instance) : GLOBAL_WORKFLOW;
  const planned = refs.map((ref) => {
    const isCurrent = sameRef(ref, currentOwner);
    const base: WorkflowState = ref.kind === "global"
      ? { ...legacy, workflow_kind: "global" }
      : {
        ...createInitialState(legacy.scope, ENGINE_VERSION, randomUUID(), legacy.selected_optional_stages, legacy.work_description),
        workflow_kind: ref.kind,
        ...(ref.kind === "module" ? { module_id: ref.module_id } : {}),
        parent_workflow_id: legacy.workflow_id,
        depth: legacy.depth,
        current_phase: legacy.current_phase,
      };
    const source: WorkflowState = isCurrent
      ? legacy
      : { ...legacy, current_stage: "", current_stage_instance: undefined, current_module: undefined, current_unit: undefined };
    const state = extractOwnedState(source, base, ref);
    const own = ownedInstances(instances, ref);
    summarizeOwned(state, own);
    const unresolved = own.filter((instance) => !state.completed_stage_instances.includes(instance.instance_id) && !state.skipped_stage_instances.includes(instance.instance_id));
    state.status = legacy.status === "done" ? "done" : isCurrent ? legacy.status : own.length > 0 && unresolved.length === 0 ? "done" : "running";
    return { ref, state, total: own.length, completed: state.completed_stage_instances.length, unresolved: unresolved.length };
  });
  const inventory = legacyEvidenceInventory();
  const describe = planned.map((item) => `  [${workflowRefKey(item.ref)}] ${item.state.status} | current: ${item.state.current_stage_instance || "-"} | completed: ${item.completed}/${item.total} | pending: ${item.unresolved}`);
  const staleCount = inventory.filter((item) => !item.valid).length;
  if (dryRun) {
    return {
      kind: "print",
      message: `🔎 Split plan for workflow ${legacy.workflow_id} (dry run, nothing written)\n${describe.join("\n")}\n` +
        `  Evidence: ${inventory.length - staleCount} still valid (will be re-anchored), ${staleCount} already stale (refresh with evidence run --module <id> --refresh).`,
      split_plan: planned.map((item) => ({ workflow: workflowRefKey(item.ref), status: item.state.status, current: item.state.current_stage_instance || null, completed: item.completed, total: item.total, pending: item.unresolved })),
      stale_evidence: inventory.filter((item) => !item.valid).map((item) => relative(PROJECT_ROOT, item.path).replace(/\\/g, "/")),
    };
  }

  const now = new Date().toISOString();
  const created: WorkflowRef[] = [];
  try {
    for (const item of planned) {
      if (item.ref.kind === "global") continue;
      if (existsSync(lightStatePath(PROJECT_ROOT, item.ref))) throw new Error(`${relativeStatePath(PROJECT_ROOT, item.ref)} already exists`);
      saveWorkflowState(PROJECT_ROOT, { ...item.state, revision: 0 }, item.ref);
      created.push(item.ref);
    }
    const integration = loadWorkflowState(PROJECT_ROOT, INTEGRATION_WORKFLOW)!;
    saveRegistry(PROJECT_ROOT, {
      version: "1",
      global_workflow_id: legacy.workflow_id,
      split_from_workflow_id: legacy.workflow_id,
      split_at: now,
      updated_at: now,
      modules: planned.filter((item) => item.ref.kind === "module").map((item) => {
        const persisted = loadWorkflowState(PROJECT_ROOT, item.ref)!;
        return { module_id: (item.ref as { module_id: string }).module_id, workflow_id: persisted.workflow_id, state_path: relativeStatePath(PROJECT_ROOT, item.ref), status: persisted.status, current_stage: persisted.current_stage_instance || "-", inception_done: false, construction_done: false, owner: "-" };
      }),
      integration: { workflow_id: integration.workflow_id, state_path: relativeStatePath(PROJECT_ROOT, INTEGRATION_WORKFLOW), status: integration.status, current_stage: "-", barrier_ready: false, blocking: [] },
      shared_contracts: [],
      cross_module_requires: [],
    });
    saveWorkflowState(PROJECT_ROOT, planned.find((item) => item.ref.kind === "global")!.state, GLOBAL_WORKFLOW);
  } catch (error) {
    for (const ref of created) {
      for (const path of [lightStatePath(PROJECT_ROOT, ref), join(dirname(lightStatePath(PROJECT_ROOT, ref)), "audit.md")]) {
        if (existsSync(path)) rmFile(path);
      }
    }
    const registry = join(PROJECT_ROOT, "aidlc", "active", "registry.md");
    if (existsSync(registry)) rmFile(registry);
    return { kind: "error", message: `Split aborted and rolled back: ${error instanceof Error ? error.message : String(error)}` };
  }

  const evidence = anchorLegacyEvidence(inventory);
  const moduleIds = modules.map((module) => module.module_id).join(", ");
  appendAuditEvent(PROJECT_ROOT, GLOBAL_WORKFLOW, "WORKFLOW_SPLIT", {
    Trigger: trigger,
    "Split From": legacy.workflow_id,
    Modules: moduleIds,
    "Evidence Anchored": String(evidence.anchored.length),
    "Evidence Stale": String(evidence.stale.length),
  });
  for (const item of planned) {
    if (item.ref.kind === "global") continue;
    appendAuditEvent(PROJECT_ROOT, item.ref, "WORKFLOW_CREATED", {
      "Parent Workflow ID": legacy.workflow_id,
      Trigger: trigger,
      "Migrated Instances": String(item.state.completed_stage_instances.length + item.state.skipped_stage_instances.length),
    });
  }
  refreshRegistry(loadWorkflowParts(PROJECT_ROOT));
  return {
    kind: "print",
    message: `✅ Workflow ${legacy.workflow_id} split into per-module workflows (registry: aidlc/active/registry.md)\n${describe.join("\n")}\n` +
      `  Evidence: ${evidence.anchored.length} re-anchored to their scope, ${evidence.stale.length} stale` +
      (evidence.stale.length ? ` — refresh completed stages with evidence run --stage <slug> --module <id> --refresh, then report --stage <slug> --module <id> --result completed.` : "."),
    split: {
      registry: "aidlc/active/registry.md",
      workflows: planned.map((item) => ({ workflow: workflowRefKey(item.ref), state_path: relativeStatePath(PROJECT_ROOT, item.ref), status: item.state.status })),
      evidence,
    },
  };
}

function rmFile(path: string): void {
  const stat = lstatSync(path);
  if (stat.isFile() || stat.isSymbolicLink()) unlinkSync(path);
}

// ---------------------------------------------------------------------------
// next — compute the next directive without mutating state
// ---------------------------------------------------------------------------

async function handleNext(args: string[]): Promise<Directive> {
  const graph = loadGraph();
  const flags = parseFlags(args);
  const invalidFlag = unsupportedFlag(flags, NEXT_FLAGS);
  if (invalidFlag) return { kind: "error", message: `Unsupported AWS-style workflow option: --${invalidFlag}` };

  const claimRequested = "claim" in flags;
  if (claimRequested && flags.claim !== "true") return { kind: "error", message: "--claim is a boolean flag and does not accept a value" };
  if (claimRequested && !flags.module) return { kind: "error", message: "--claim requires --module <module-id>" };

  // PRD is a user-selected workflow option, never a default Inception gate.
  const withPrd = "with-prd" in flags;
  if (withPrd && flags["with-prd"] !== "true") {
    return { kind: "error", message: "--with-prd is a boolean flag and does not accept a value" };
  }

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
  if ("status" in flags && isSplitLayout(PROJECT_ROOT)) return splitStatusDirective(graph, flags.module);
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
        `  Active claims: ${Object.values(state.active_instances || {}).map((claim) => `${claim.stage_instance}=${claim.owner}`).join(", ") || "(none)"}\n` +
        `  Context: module=${state.current_module || "-"}, unit=${state.current_unit || "-"}\n` +
        `  Completed: ${completedCount}/${instances.length} stage instances\n` +
        `  Skipped: ${skippedCount}\n` +
        `  Remaining: ${remaining.length} (${remaining.map((instance) => instance.instance_id).join(", ")})`,
    };
  }

  // An existing workflow is never replaced implicitly: --scope/--work only initialize.
  if (scopeFlag || flags.work) {
    const existing = loadWorkflowState(PROJECT_ROOT, GLOBAL_WORKFLOW);
    if (existing) {
      const steps = existing.status === "running"
        ? "park it with 'orchestrate park', then archive it with 'orchestrate archive'"
        : "archive it with 'orchestrate archive'";
      return {
        kind: "error",
        workflow_id: existing.workflow_id,
        status: existing.status,
        message: `Workflow ${existing.workflow_id} already exists (status: ${existing.status}); --scope/--work only initialize a new workflow. To start new work, ${steps}; to continue it, run 'orchestrate next' without --scope/--work.`,
      };
    }
  }

  // Split per-module layout (4.3.0): route to the owning workflow. A legacy multi-module
  // workflow is split automatically the first time `next --module <id>` is used without --claim.
  if (!isSplitLayout(PROJECT_ROOT) && flags.module && !claimRequested) {
    const legacy = loadState();
    if (!legacy) {
      return { kind: "error", message: "No active workflow. Start with next --scope <scope> --work <description>; per-module workflows start after module-division completes." };
    }
    const split = performSplit(legacy.workflow_id, false, "next --module");
    if (split.kind === "error") return split;
  }
  if (isSplitLayout(PROJECT_ROOT)) {
    if (withPrd) return { kind: "error", message: "--with-prd can only be selected when initializing a new workflow" };
    return splitNext(args, flags, graph);
  }

  // Load or create state
  let state = loadState();

  if (state) {
    const released = releaseExpiredModuleClaims(state);
    if (released.length > 0) saveState(state);
  }

  if (state && withPrd) {
    return { kind: "error", message: "--with-prd can only be selected when initializing a new workflow" };
  }

  if (!state) {
    if (!scopeFlag) {
      return {
        kind: "ask",
        question: "No active AWS-style lightweight workflow found. Which scope should this work use?",
        options: ["feature", "enterprise", "mvp", "classic", "express", "workshop", "bugfix", "refactor", "poc"],
        ask_type: "scope-selection",
      } as unknown as Directive;
    }
    const workDescription = flags.work || flags.text;
    if (!workDescription) {
      return {
        kind: "ask",
        question: "Describe the work this new lightweight workflow should perform.",
        ask_type: "work-description",
      } as unknown as Directive;
    }
    const selectedOptionalStages = withPrd ? ["prd-generation"] : [];
    state = createInitialState(scopeFlag, ENGINE_VERSION, undefined, selectedOptionalStages, workDescription);
    // Only a new global/single workflow records its baseline; createInitialState stays
    // baseline-free so module/integration workflows and pre-4.6 states never get one.
    state.baseline_commit = currentHeadCommit(PROJECT_ROOT);
    state.baseline_source = "created";
    saveState(state);
    try {
      appendAuditEvent(PROJECT_ROOT, GLOBAL_WORKFLOW, "BASELINE_COMMIT_RECORDED", {
        "Workflow ID": state.workflow_id,
        Commit: state.baseline_commit,
        Source: "created",
      });
    } catch (error) {
      return { kind: "error", message: `Workflow ${state.workflow_id} was created with baseline ${state.baseline_commit}, but the BASELINE_COMMIT_RECORDED audit entry could not be written (${error instanceof Error ? error.message : String(error)}): ${AUDIT_MISSING}。` };
    }
    return {
      kind: "print",
      message: `✅ AWS-style lightweight workflow initialized for: ${workDescription}\n` +
        `  PRD option: ${withPrd ? "selected" : "not selected"}\n` +
        `  Baseline commit: ${state.baseline_commit} (created)\n` +
        `  Executable stages: ${getExecutableStages(graph, scopeFlag, selectedOptionalStages).length}/${graph.stage_count}\n` +
        `  Run 'next' again to get the first stage directive.`,
    };
  }

  const legacyState = state;
  return advance(graph, {
    state: legacyState,
    flags,
    commit: (value) => saveState(value),
    retry: () => handleNext(args),
    label: "Workflow",
    finishedMessage: (count) => `🎉 All ${count} stage instances resolved. Workflow finished.`,
  });
}

interface AdvanceOptions {
  /** Legacy: the workflow state itself. Split: the merged view whose owner is being advanced. */
  state: WorkflowState;
  flags: Record<string, string>;
  commit: (state: WorkflowState) => void;
  retry: () => Promise<Directive>;
  label: string;
  finishedMessage: (count: number) => string;
  /** Split layout: only the owner's instances are candidates; dependencies still see every instance. */
  candidate?: (instance: StageInstance) => boolean;
  extras?: Record<string, unknown>;
  reportCommand?: (instance: StageInstance) => string;
}

/**
 * Advance one workflow: parked/resume handling, instance selection, admission gates
 * (requires, consumes, cross-module dependencies, upstream sensor re-check), current
 * context and optional claim. Shared by the single layout and every split workflow.
 */
async function advance(graph: StageGraph, opts: AdvanceOptions): Promise<Directive> {
  const { state, flags } = opts;
  const isResume = "resume" in flags;
  const claimRequested = "claim" in flags;
  const extras = opts.extras || {};

  // Parked workflow — resume or report parked
  if (state.status === "parked") {
    if (!isResume) {
      return {
        kind: "parked",
        stage: state.current_stage,
        message: `${opts.label} is parked at stage "${state.current_stage}". Pass --resume to continue.`,
        ...extras,
      };
    }
    // Resume: clear parked status
    state.status = "running";
    opts.commit(state);
  }

  // Done workflow
  if (state.status === "done") {
    return { kind: "done", message: `${opts.label} is already complete.`, ...extras };
  }

  // Expand the static graph into the currently known execution instances.
  const instances = expandStageInstances(graph, state);
  const candidates = opts.candidate ? instances.filter(opts.candidate) : instances;
  const search = claimRequested
    ? findClaimableModuleInstance(candidates, state, flags.module as string, instances)
    : findNextInstance(candidates, state, instances);
  const { instance: nextInstance, blocked, conditionError, skippedByCondition } = search;

  if (skippedByCondition && skippedByCondition.length > 0) opts.commit(state);

  if (conditionError) {
    return {
      kind: "error",
      message: `🚫 Unknown stage condition "${conditionError.condition}" on "${conditionError.instance.instance_id}". Register the condition in the engine before continuing.`,
      ...extras,
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
      ...extras,
    };
  }

  if (!nextInstance) {
    if (claimRequested) {
      return { kind: "error", message: `Module "${flags.module}" has no unclaimed ready stage instance; inspect dependency waiting and active claims with runtime summary.`, ...extras };
    }
    reconcileStageSummaries(state, instances);
    state.status = "done";
    clearActiveContext(state);
    opts.commit(state);
    return {
      kind: "done",
      message: opts.finishedMessage(candidates.length),
      ...extras,
    };
  }

  if (claimRequested && nextInstance && nextInstance.axis !== "module") {
    return { kind: "error", message: `--claim can only claim a module stage instance; ${nextInstance.instance_id} is ${nextInstance.axis}-axis`, ...extras };
  }

  const effectiveNextInstance = runtimeInstance(nextInstance, state);
  const nextStage = effectiveNextInstance.stage;
  const consumeFailures = checkConsumes(effectiveNextInstance, state, graph, instances);
  if (consumeFailures.length > 0) {
    return {
      kind: "error",
      message: `🚫 Stage instance "${nextInstance.instance_id}" is missing canonical consumed artifacts:\n${consumeFailures.map((failure) => `  ❌ ${failure}`).join("\n")}`,
      ...extras,
    };
  }

  // 缺口A:跨 module 契约依赖门禁。消费方阶段推进前,provider module 的 provider_stage 必须已完成。
  const crossModuleFailures = checkCrossModuleDependencies(effectiveNextInstance, state);
  if (crossModuleFailures.length > 0) {
    return {
      kind: "error",
      message: `🚫 Stage instance "${nextInstance.instance_id}" 跨 module 依赖未就绪:\n${crossModuleFailures.map((failure) => `  ❌ ${failure}`).join("\n")}`,
      ...extras,
    };
  }

  // Harness-independent 准出门禁底座 (Phase A):在发出下一 directive 前,重新校验本阶段所依赖的
  // 上游 completed 阶段的 sensor(准出门禁)是否仍然满足。这让"想拿下一步指令 → 上游门禁必须现在仍绿"
  // 成为程序化事实,不依赖 host 是否提供 Stop hook —— kiro-crew 等无自动 hook 的 harness 也据此硬拦。
  // 只复验已 resolved(completed,非 skipped)的直接 requires 依赖;首个阶段无上游依赖时自然放行。
  {
    const upstreamDeps = new Set<StageInstance>();
    for (const dependency of effectiveNextInstance.stage.requires || []) {
      for (const dep of dependencyInstances(effectiveNextInstance, dependency, instances)) {
        if (completedInstanceIds(state).includes(dep.instance_id)) upstreamDeps.add(dep);
      }
    }
    const upstreamGateFailures: { instance: string; message: string }[] = [];
    for (const dep of upstreamDeps) {
      const failures = await checkSensors(dep, state);
      for (const failure of failures) {
        // 已 completed 的上游阶段在完成时其门禁已为绿;此处复验只为拦截"事后被改坏/覆盖不再满足"的实质失败。
        // 纯时间性证据过期(>24h resume 间隔)不是回归,不应阻断多日跨度的正常续作 —— 过滤掉纯 staleness 失败。
        if (/evidence is stale \(\d+h old/i.test(failure.message)) continue;
        upstreamGateFailures.push({ instance: dep.instance_id, message: `[${failure.sensor}] ${failure.message}` });
      }
    }
    if (upstreamGateFailures.length > 0) {
      return {
        kind: "error",
        message: `🚫 无法推进到 "${nextInstance.instance_id}" — 上游阶段的准出门禁已不满足,必须先修复:\n` +
          upstreamGateFailures.map((f) => `  ❌ ${f.instance}: ${f.message}`).join("\n") +
          `\n\n修复上游产物/证据后重新 report 使门禁转绿,再执行 next。` +
          (opts.reportCommand
            ? `已完成阶段可先用 evidence run --stage <slug> --module <id> --refresh 重新产证,再以 report --stage <slug> --module <id> --result completed 复验。`
            : ""),
        ...extras,
      };
    }
  }

  state.current_stage = nextStage.slug;
  state.current_phase = nextStage.phase;
  state.current_stage_instance = nextInstance.instance_id;
  if (nextInstance.module_id) state.current_module = nextInstance.module_id;
  else delete state.current_module;
  if (nextInstance.unit_id) state.current_unit = nextInstance.unit_id;
  else delete state.current_unit;
  if (claimRequested) {
    const now = new Date();
    const selected = state.module_selections?.[effectiveNextInstance.module_id || ""];
    const owner = flags.owner || process.env.AIDLC_OWNER || process.env.AIDLC_MEMBER || "unidentified-owner";
    state.active_instances[effectiveNextInstance.instance_id] = {
      module_id: effectiveNextInstance.module_id as string,
      stage_instance: effectiveNextInstance.instance_id,
      owner,
      ...(flags.branch || selected?.branch ? { branch: flags.branch || selected?.branch } : {}),
      ...(flags.worktree || selected?.worktree ? { worktree: flags.worktree || selected?.worktree } : {}),
      claimed_at: now.toISOString(),
      heartbeat_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    };
  }

  const gate = nextStage.approval === "block";
  try {
    opts.commit(state);
  } catch (error) {
    if (claimRequested && error instanceof Error && error.message.startsWith("workflow state revision conflict")) return opts.retry();
    throw error;
  }

  const directiveChoices = runtimeChoices(nextStage, state);
  const agentExecution = planAgentExecution(nextStage);
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
    agent_execution: agentExecution,
    gate,
    approval: nextStage.approval,
    completion_contract: nextStage.completion_contract,
    consumes: nextStage.consumes.flatMap((pattern) => displayArtifactPatterns(pattern, effectiveNextInstance, true)),
    produces: nextStage.produces.flatMap((pattern) => displayArtifactPatterns(pattern, effectiveNextInstance)),
    sensors: nextStage.sensors,
    choices: directiveChoices,
    diagram_format: diagramFormatOf(state),
    handoff_prompt: lightweightNextPrompt(state, effectiveNextInstance, agentExecution, opts.reportCommand?.(effectiveNextInstance), directiveChoices),
    ...(claimRequested ? { claimed: true, owner: state.active_instances[effectiveNextInstance.instance_id].owner, claim_expires_at: state.active_instances[effectiveNextInstance.instance_id].expires_at } : {}),
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// report — validate and record a stage outcome
// ---------------------------------------------------------------------------

async function handleReport(args: string[]): Promise<Directive> {
  const flags = parseFlags(args);
  const invalidFlag = unsupportedFlag(flags, REPORT_FLAGS);
  if (invalidFlag) return { kind: "error", message: `Unsupported AWS-style report option: --${invalidFlag}` };
  const stageSlug = flags.stage;
  const result = flags.result as StageResult;
  const userInput = flags["user-input"];

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
  const graph = loadGraph();
  const stageNode = graph.stages.find((stage) => stage.slug === stageSlug);
  let state: WorkflowState | null;
  let commit: (value: WorkflowState) => void;
  let label = "Workflow";
  let extras: Record<string, unknown> = {};
  let ownsInstance: (instanceId: string) => boolean = () => true;
  if (isSplitLayout(PROJECT_ROOT)) {
    if (!stageNode) return { kind: "error", message: `Unknown stage "${stageSlug}".` };
    const owner = reportOwner(flags, stageNode);
    if (owner.kind === "error") return owner as Directive;
    const ownerRef = owner as WorkflowRef;
    if (!loadWorkflowParts(PROJECT_ROOT).parts.has(workflowRefKey(ownerRef))) {
      return { kind: "error", message: `${workflowLabel(ownerRef)} does not exist yet; start it with orchestrate next --module ${ownerRef.kind === "module" ? ownerRef.module_id : "<module-id>"}.` };
    }
    const context = openSplitContext(ownerRef);
    state = context.view;
    commit = (value) => commitSplitContext(context, value);
    label = workflowLabel(ownerRef);
    ownsInstance = (instanceId) => sameRef(ownerOfInstance(instanceId), ownerRef);
    extras = { workflow: workflowRefKey(ownerRef), workflow_id: context.loaded.parts.get(workflowRefKey(ownerRef))!.state.workflow_id };
  } else {
    state = loadState();
    commit = (value) => saveState(value);
  }
  if (!state) {
    return { kind: "error", message: "No active workflow. Cannot report." };
  }

  // Re-attestation: an explicitly addressed, already completed instance re-runs its exit
  // gates (typically after evidence run --refresh) without changing workflow progress.
  const addressed = addressedInstance(flags, stageNode);
  if (stageNode && addressed && completedInstanceIds(state).includes(addressed)
    && addressed !== state.current_stage_instance && !state.active_instances?.[addressed]) {
    return reattestInstance(state, stageNode, addressed, flags, graph, commit, extras);
  }

  if (state.status !== "running") {
    return { kind: "error", message: `${label} is ${state.status}, not running. Cannot report.`, ...extras };
  }

  if (!stageNode) {
    return { kind: "error", message: `Unknown stage "${stageSlug}".` };
  }
  const instances = expandStageInstances(graph, state);
  const activeCandidates = instances.filter((instance) =>
    instance.stage.slug === stageSlug && state.active_instances?.[instance.instance_id]
    && ownsInstance(instance.instance_id)
    && (!flags.module || instance.module_id === flags.module)
    && (!flags.instance || instance.instance_id === flags.instance)
  );
  let declaredCurrentInstance: StageInstance | undefined;
  if (activeCandidates.length > 1 && !flags.module && !flags.instance) {
    return { kind: "error", message: `Multiple claimed instances are active for stage "${stageSlug}"; report with --module or --instance.` };
  }
  if (activeCandidates.length > 0) {
    declaredCurrentInstance = activeCandidates[0];
  } else if (flags.instance) {
    declaredCurrentInstance = instances.find((instance) => instance.instance_id === flags.instance);
  } else {
    if (state.current_stage !== stageSlug) {
      return {
        kind: "error",
        message: `Stage mismatch: current is "${state.current_stage}", but report is for "${stageSlug}". Cannot report on a stage that is not the active one.`,
      };
    }
    declaredCurrentInstance = instances.find((instance) => instance.instance_id === state.current_stage_instance);
  }
  if (!declaredCurrentInstance || declaredCurrentInstance.stage.slug !== stageSlug) {
    return {
      kind: "error",
      message: `Active stage instance "${flags.instance || state.current_stage_instance || stageSlug}" no longer exists in the declared module/unit manifests. Restore the current Markdown workflow manifests before reporting.`,
    };
  }
  const currentInstance = runtimeInstance(declaredCurrentInstance, state);
  const claim = state.active_instances?.[currentInstance.instance_id];
  if (claim) {
    const owner = flags.owner || process.env.AIDLC_OWNER || process.env.AIDLC_MEMBER || "unidentified-owner";
    if (claim.owner !== owner) return { kind: "error", message: `Stage instance ${currentInstance.instance_id} is claimed by ${claim.owner}, not ${owner}.` };
    if (Date.parse(claim.expires_at) <= Date.now()) return { kind: "error", message: `Stage instance ${currentInstance.instance_id} claim expired at ${claim.expires_at}; claim it again before reporting.` };
    claim.heartbeat_at = new Date().toISOString();
    claim.expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  }
  if (flags.module && flags.module !== currentInstance.module_id) {
    return { kind: "error", message: `Module mismatch: active module is "${currentInstance.module_id || "(none)"}", but report specified "${flags.module}".` };
  }
  if (flags.unit && flags.unit !== currentInstance.unit_id) {
    return { kind: "error", message: `Unit mismatch: active unit is "${currentInstance.unit_id || "(none)"}", but report specified "${flags.unit}".` };
  }
  if (result === "completed" && stageNode.approval === "block") {
    return { kind: "error", message: `Stage "${stageSlug}" requires explicit approval. Report --result approved --user-input Approve after presenting the decision summary.` };
  }
  if (result === "approved") {
    if (stageNode.approval !== "block") {
      return { kind: "error", message: `Stage "${stageSlug}" is not an approval gate and cannot use --result approved.` };
    }
    if (userInput !== "Approve") {
      return { kind: "error", message: `Stage "${stageSlug}" requires --user-input Approve.` };
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
        message: `Stage "${stageSlug}" requires --user-input with one of: ${runtimeChoiceValues.join(", ")}. The choice is stored in Markdown workflow history.`,
      };
    }
  }

  // Record history entry
  const entry: HistoryEntry = {
    stage: stageSlug,
    instance_id: currentInstance.instance_id,
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

      if (stageSlug === "code-generation") {
        const redInstance = instances.find((candidate) => candidate.stage.slug === "tdd" && candidate.module_id === currentInstance.module_id && candidate.unit_id === currentInstance.unit_id);
        if (redInstance) {
          // 4.7.0: completing GREEN also demands that the unit's BASELINE belongs to the current epoch.
          const redFailures = await checkSensors(redInstance, state, { tolerateRevisionDrift: true, requireCurrentBaselineEpoch: true });
          if (redFailures.length > 0) {
            return {
              kind: "error",
              message: `🚫 Cannot complete GREEN stage "${currentInstance.instance_id}" — RED gate evidence is invalid:\n${redFailures.map((failure) => `  ❌ [${failure.sensor}] ${failure.message}`).join("\\n")}`,
            };
          }
        }
      }

      const automaticEvidenceError = produceMissingSemanticEvidence(currentInstance);
      if (automaticEvidenceError) {
        return {
          kind: "error",
          message: `🚫 Cannot complete stage "${stageSlug}" — ${automaticEvidenceError}`,
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

      if (stageSlug === "module-division") {
        readModuleManifest(PROJECT_ROOT);
      }
      if (stageSlug === "units-generation") {
        if (!currentInstance.module_id) throw new Error("units-generation requires an active module context");
        const units = readUnitManifest(PROJECT_ROOT, currentInstance.module_id);
        if (architectureChoice(state)) {
          const missingSelections = units
            .filter((unit) => unit.conditional_stages === undefined)
            .map((unit) => unit.unit_id);
          if (missingSelections.length > 0) {
            return {
              kind: "error",
              message: `🚫 Cannot complete stage instance "${currentInstance.instance_id}" — each unit must declare conditional_stages; missing: ${missingSelections.join(", ")}.`,
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
      state.completed_stage_instances.push(currentInstance.instance_id);
      reconcileStageSummaries(state, instances);
      if (state.active_instances?.[currentInstance.instance_id]) delete state.active_instances[currentInstance.instance_id];
      if (state.current_stage_instance === currentInstance.instance_id) selectActiveContext(state, ownsInstance);
      break;

    case "rejected":
      break;

    case "revised":
      break;
  }

  try {
    commit(state);
  } catch (error) {
    if (claim && error instanceof Error && error.message.startsWith("workflow state revision conflict")) return handleReport(args);
    throw error;
  }

  const nextCommand = isSplitLayout(PROJECT_ROOT) && currentInstance.module_id ? `next --module ${currentInstance.module_id}` : "next";
  // Return confirmation
  switch (result) {
    case "completed":
    case "approved":
      return {
        kind: "print",
        message: `✅ Stage "${stageSlug}" ${result}. Run '${nextCommand}' for the next stage.`,
        handoff_prompt: `工作目标：${state.work_description}\n当前阶段：${stageSlug} 已完成。\n下一步：运行 orchestrate ${nextCommand} 获取新的 directive，并按其产物、review、构建、测试和 sensor 要求继续。`,
        ...extras,
      };
    case "rejected":
      return {
        kind: "print",
        message: `🔄 Stage "${stageSlug}" rejected. Revise and report --result revised, then re-report --result completed.`,
        ...extras,
      };
    case "revised":
      return {
        kind: "print",
        message: `📝 Stage "${stageSlug}" revised. Report --result completed when ready.`,
        ...extras,
      };
  }
}

function reportOwner(flags: Record<string, string>, stage: StageNode): WorkflowRef | Directive {
  if (flags.instance) return ownerOfInstance(flags.instance);
  if (flags.module) return moduleRef(flags.module);
  if (stage.axis === "project") return integrationStageSlugs().has(stage.slug) ? INTEGRATION_WORKFLOW : GLOBAL_WORKFLOW;
  const matches = [...loadWorkflowParts(PROJECT_ROOT).parts.values()].filter((part) => part.ref.kind === "module"
    && (part.state.current_stage === stage.slug || Object.keys(part.state.active_instances || {}).some((instance) => instance.startsWith(`${stage.slug}@`))));
  if (matches.length === 1) return matches[0].ref;
  return {
    kind: "error",
    message: `Split workflow layout: report --stage ${stage.slug} needs --module <module-id>${matches.length > 1 ? ` (active in ${matches.map((part) => workflowRefKey(part.ref)).join(", ")})` : ""}.`,
  };
}

function addressedInstance(flags: Record<string, string>, stage: StageNode | undefined): string | undefined {
  if (!stage) return undefined;
  if (flags.instance) return flags.instance;
  if (!flags.module) return undefined;
  if (stage.axis === "module") return stageInstanceId(stage.slug, "module", { module_id: flags.module });
  if (stage.axis === "unit" && flags.unit) return stageInstanceId(stage.slug, "unit", { module_id: flags.module, unit_id: flags.unit });
  return undefined;
}

/**
 * Re-verify an already completed stage instance: consumes, produces and sensors must be
 * green again. It records a `reattested` history row and never changes progress, so it is
 * allowed while the owning workflow is parked (the usual repair path after a refresh).
 */
async function reattestInstance(
  state: WorkflowState,
  stageNode: StageNode,
  instanceId: string,
  flags: Record<string, string>,
  graph: StageGraph,
  commit: (value: WorkflowState) => void,
  extras: Record<string, unknown>,
): Promise<Directive> {
  const result = flags.result as StageResult;
  const userInput = flags["user-input"];
  if (result !== "completed" && result !== "approved") {
    return { kind: "error", message: `Stage instance "${instanceId}" is already completed; re-attest it with --result completed (or approved for approval gates).`, ...extras };
  }
  if (result === "completed" && stageNode.approval === "block") {
    return { kind: "error", message: `Stage "${stageNode.slug}" requires explicit approval. Re-attest with --result approved --user-input Approve.`, ...extras };
  }
  if (result === "approved" && (stageNode.approval !== "block" || userInput !== "Approve")) {
    return { kind: "error", message: stageNode.approval !== "block" ? `Stage "${stageNode.slug}" is not an approval gate and cannot use --result approved.` : `Stage "${stageNode.slug}" requires --user-input Approve.`, ...extras };
  }
  if (stageNode.completion_contract === "instruction_only" && flags["instruction-ack"] !== stageNode.slug) {
    return { kind: "error", message: `Stage "${stageNode.slug}" is instruction-only; re-attest with --instruction-ack ${stageNode.slug}.`, ...extras };
  }
  const instances = expandStageInstances(graph, state);
  const declared = instances.find((instance) => instance.instance_id === instanceId);
  if (!declared) {
    return { kind: "error", message: `Stage instance "${instanceId}" no longer exists in the declared module/unit manifests.`, ...extras };
  }
  const instance = runtimeInstance(declared, state);
  const consumeFailures = checkConsumes(instance, state, graph, instances);
  if (consumeFailures.length > 0) {
    return { kind: "error", message: `🚫 Cannot re-attest "${instanceId}" — canonical consumed artifacts are no longer valid:\n${consumeFailures.map((failure) => `  ❌ ${failure}`).join("\\n")}`, ...extras };
  }
  if (stageNode.slug === "code-generation") {
    const redInstance = instances.find((candidate) => candidate.stage.slug === "tdd" && candidate.module_id === instance.module_id && candidate.unit_id === instance.unit_id);
    if (redInstance) {
      const redFailures = await checkSensors(redInstance, state, { tolerateRevisionDrift: true });
      if (redFailures.length > 0) return { kind: "error", message: `🚫 Cannot re-attest GREEN stage "${instanceId}" — RED gate evidence is invalid:\\n${redFailures.map((failure) => `  ❌ [${failure.sensor}] ${failure.message}`).join("\\n")}`, ...extras };
    }
  }
  const automaticEvidenceError = produceMissingSemanticEvidence(instance, true);
  if (automaticEvidenceError) return { kind: "error", message: `🚫 Cannot re-attest "${instanceId}" — ${automaticEvidenceError}`, ...extras };
  const missingProduces = checkProduces(instance);
  if (missingProduces.length > 0) {
    return { kind: "error", message: `🚫 Cannot re-attest "${instanceId}" — required produces not found:\n${missingProduces.map((path) => `  ❌ ${path}`).join("\n")}`, ...extras };
  }
  const sensorFailures = await checkSensors(instance, state);
  if (sensorFailures.length > 0) {
    return {
      kind: "error",
      message: `🚫 Cannot re-attest "${instanceId}" — sensor checks failed:\n${sensorFailures.map((failure) => `  ❌ [${failure.sensor}] ${failure.message}`).join("\n")}\n\nRefresh evidence with evidence run --stage ${stageNode.slug}${instance.module_id ? ` --module ${instance.module_id}` : ""}${instance.unit_id ? ` --unit ${instance.unit_id}` : ""} --refresh, then re-attest.`,
      ...extras,
    };
  }
  state.history.push({
    stage: stageNode.slug,
    instance_id: instanceId,
    module_id: instance.module_id,
    unit_id: instance.unit_id,
    result: "reattested",
    timestamp: new Date().toISOString(),
    user_input: userInput || "exit gates re-verified",
  });
  commit(state);
  return {
    kind: "print",
    message: `✅ Stage instance "${instanceId}" re-attested: consumes, produces and sensors are green. Workflow progress is unchanged.`,
    reattested: true,
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// park — save workflow for later resume
// ---------------------------------------------------------------------------

async function handlePark(args: string[] = []): Promise<Directive> {
  const flags = parseFlags(args);
  if (isSplitLayout(PROJECT_ROOT)) {
    const loaded = loadWorkflowParts(PROJECT_ROOT);
    const owner = flags.module
      ? moduleRef(flags.module)
      : loaded.parts.get("global")!.state.status !== "done" ? GLOBAL_WORKFLOW : INTEGRATION_WORKFLOW;
    if (!loaded.parts.has(workflowRefKey(owner))) return { kind: "error", message: `${workflowLabel(owner)} does not exist.` };
    const context = openSplitContext(owner);
    const view = context.view;
    if (view.status !== "running") return { kind: "error", message: `${workflowLabel(owner)} is ${view.status}, not running. Cannot park.`, workflow: workflowRefKey(owner) };
    view.status = "parked";
    commitSplitContext(context, view);
    return {
      kind: "parked",
      stage: view.current_stage,
      workflow: workflowRefKey(owner),
      message: `${workflowLabel(owner)} parked at stage "${view.current_stage}". Resume with 'next ${owner.kind === "module" ? `--module ${owner.module_id} ` : ""}--resume'. Other workflows are unaffected.`,
    };
  }
  if (flags.module) return { kind: "error", message: "park --module requires the per-module layout; split first with orchestrate split --from <workflow-id>." };

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
// archive — move a parked/done workflow and its evidence out of the active area
// ---------------------------------------------------------------------------

function lockFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...lockFiles(path));
    else if (entry.name.endsWith(".lock")) found.push(relative(PROJECT_ROOT, path));
  }
  return found;
}

async function handleArchive(args: string[]): Promise<Directive> {
  const flags = parseFlags(args);
  const invalidFlag = unsupportedFlag(flags, ARCHIVE_FLAGS);
  if (invalidFlag) return { kind: "error", message: `Unsupported archive option: --${invalidFlag}` };
  if (flags.reason === "true") return { kind: "error", message: "--reason requires a value" };
  if (flags.text) return { kind: "error", message: `Unexpected archive argument: ${flags.text}` };

  const loaded = loadWorkflowParts(PROJECT_ROOT);
  const global = loaded.parts.get("global");
  if (!global) return { kind: "error", message: "No active workflow to archive." };
  const notArchivable = [...loaded.parts.values()].filter((part) => part.state.status !== "parked" && part.state.status !== "done");
  if (notArchivable.length > 0) {
    return {
      kind: "error",
      message: `Only parked or done workflows can be archived; ${notArchivable.map((part) => `${workflowLabel(part.ref)} is ${part.state.status}`).join(", ")}. Park it first with 'orchestrate park${notArchivable[0].ref.kind === "module" ? ` --module ${notArchivable[0].ref.module_id}` : ""}'.`,
    };
  }
  const claims = [...loaded.parts.values()].flatMap((part) => Object.values(part.state.active_instances || {}).map((claim) => `${claim.stage_instance}=${claim.owner}`));
  if (claims.length > 0) return { kind: "error", message: `Workflow has unreleased claims: ${claims.join(", ")}. Release them before archiving.` };

  const activeDir = resolve(PROJECT_ROOT, "aidlc", "active");
  const evidenceDir = resolve(PROJECT_ROOT, ".aidlc", "evidence");
  const locks = [...lockFiles(activeDir), ...lockFiles(evidenceDir)];
  if (locks.length > 0) return { kind: "error", message: `Workflow or evidence locks are held: ${locks.join(", ")}. Wait for the running command to finish before archiving.` };

  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const target = resolve(PROJECT_ROOT, "aidlc", "archive", `${global.state.workflow_id}-${timestamp}`);
  const targetLabel = relative(PROJECT_ROOT, target).split(sep).join("/");
  if (existsSync(target)) return { kind: "error", message: `Archive target already exists: ${targetLabel}` };
  if (existsSync(join(activeDir, "evidence"))) return { kind: "error", message: "aidlc/active/evidence already exists and would collide with the archived evidence directory." };

  appendAuditEvent(PROJECT_ROOT, GLOBAL_WORKFLOW, "WORKFLOW_ARCHIVED", {
    "Workflow ID": global.state.workflow_id,
    Status: global.state.status,
    Reason: flags.reason || "-",
    Target: targetLabel,
  });
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  renameSync(activeDir, target);
  const evidenceArchived = existsSync(evidenceDir);
  if (evidenceArchived) renameSync(evidenceDir, join(target, "evidence"));

  return {
    kind: "print",
    workflow_id: global.state.workflow_id,
    archive_path: targetLabel,
    evidence_archived: evidenceArchived,
    message: `📦 Workflow ${global.state.workflow_id} archived to ${targetLabel}${evidenceArchived ? " (evidence included)" : ""}.\n` +
      `  Start a new workflow with: loeyae-aidlc orchestrate next --scope <scope> --work "<description>"`,
  };
}

// ---------------------------------------------------------------------------
// upgrade --dry-run — list completed instances that lack evidence for the current graph
// ---------------------------------------------------------------------------

/** Sensors whose verdict is read from a controlled evidence file. */
function evidenceBackedSensor(sensor: string): boolean {
  return SEMANTIC_SENSORS.has(sensor) || sensor === "build-test-evidence";
}

function upgradeRecoveryCommands(instance: StageInstance, missing: string[]): string[] {
  const target = `--stage ${instance.stage.slug} --instance ${instance.instance_id}`;
  const evidence = instance.stage.slug === "build-and-test"
    ? missing.map((sensor) => sensor === "build-test-evidence"
      ? `loeyae-aidlc evidence run ${target} --refresh`
      : `loeyae-aidlc evidence run ${target} --sensor ${sensor} --refresh`)
    : [`loeyae-aidlc evidence run ${target} --all-sensors --refresh`];
  const result = instance.stage.approval === "block" ? "--result approved --user-input Approve" : "--result completed";
  const ack = instance.stage.completion_contract === "instruction_only" ? ` --instruction-ack ${instance.stage.slug}` : "";
  return [...evidence, `loeyae-aidlc orchestrate report ${target} ${result}${ack}`];
}

async function handleUpgrade(args: string[]): Promise<Directive> {
  const flags = parseFlags(args);
  const invalidFlag = unsupportedFlag(flags, UPGRADE_FLAGS);
  if (invalidFlag) return { kind: "error", message: `Unsupported upgrade option: --${invalidFlag}` };
  if (flags.text) return { kind: "error", message: `Unexpected upgrade argument: ${flags.text}` };
  if (!("dry-run" in flags)) {
    return { kind: "error", message: "orchestrate upgrade only supports --dry-run. Run it with --dry-run, then execute the listed recovery commands one instance at a time." };
  }
  if (flags["dry-run"] !== "true") return { kind: "error", message: "--dry-run is a boolean flag and does not accept a value" };
  if (flags.module === "true") return { kind: "error", message: "--module requires a value" };
  const moduleFilter = flags.module;

  const loaded = loadWorkflowParts(PROJECT_ROOT);
  if (!loaded.parts.has("global")) return { kind: "error", message: "No active workflow to check." };
  if (moduleFilter && loaded.split && !loaded.parts.has(workflowRefKey(moduleRef(moduleFilter)))) {
    return { kind: "error", message: `Module workflow "${moduleFilter}" does not exist in the registry.` };
  }
  const view = loaded.split ? mergeWorkflowView(loaded.parts) : loaded.parts.get("global")!.state;
  const instances = expandStageInstances(loadGraph(), view);
  if (moduleFilter && !loaded.split && !instances.some((instance) => instance.module_id === moduleFilter)) {
    return { kind: "error", message: `Module "${moduleFilter}" is not declared in the module manifest.` };
  }
  const completed = new Set(completedInstanceIds(view));
  const ownerKey = (instanceId: string): string => loaded.split ? workflowRefKey(ownerOfInstance(instanceId)) : "global";

  const pending = instances
    .filter((instance) => completed.has(instance.instance_id))
    .filter((instance) => !moduleFilter || instance.module_id === moduleFilter)
    .map((declared) => {
      const instance = runtimeInstance(declared, view);
      const missing = instance.stage.sensors
        .filter(evidenceBackedSensor)
        .filter((sensor) => !existsSync(evidencePath(instance.stage, sensor, instance)));
      return { instance, missing };
    })
    .filter((item) => item.missing.length > 0)
    .map(({ instance, missing }) => ({
      instance_id: instance.instance_id,
      stage: instance.stage.slug,
      module_id: instance.module_id || null,
      unit_id: instance.unit_id || null,
      workflow: ownerKey(instance.instance_id),
      missing_sensors: missing,
      requires_user_approval: instance.stage.approval === "block",
      commands: upgradeRecoveryCommands(instance, missing),
    }));

  const workflows = [...loaded.parts.values()]
    .filter((part) => !moduleFilter || (part.ref.kind === "module" ? part.ref.module_id === moduleFilter : !loaded.split))
    .map((part) => ({
      workflow: workflowRefKey(part.ref),
      workflow_id: part.state.workflow_id,
      status: part.state.status,
      recorded_engine_version: part.state.version || "unknown",
    }));

  return {
    kind: "print",
    dry_run: true,
    engine_version: ENGINE_VERSION,
    layout: loaded.split ? "split" : "single",
    ...(moduleFilter ? { module_id: moduleFilter } : {}),
    workflows,
    pending,
    message: pending.length === 0
      ? "✅ Every completed stage instance has evidence for the sensors declared by the current stage graph."
      : `⚠️ ${pending.length} completed stage instance(s) lack evidence for the current stage graph. Run each instance's commands in order; ` +
        "approval gates (requires_user_approval) must only be re-attested after the user explicitly approves. Nothing was written.",
  };
}

// ---------------------------------------------------------------------------
// diagram-format — record the user's explicit diagram format choice (default mermaid)
// ---------------------------------------------------------------------------

/** Injection points for handlers that write state then audit (tests simulate failures and races). */
export interface StateWriteHooks {
  /** Audit writer; defaults to appendAuditEvent. */
  appendAudit?: typeof appendAuditEvent;
  /** Runs after every check passed and before the state is re-read for the write. */
  beforeWrite?: () => void;
}

export async function handleDiagramFormat(args: string[], hooks: StateWriteHooks = {}): Promise<Directive> {
  const flags = parseFlags(args);
  const invalidFlag = unsupportedFlag(flags, DIAGRAM_FORMAT_FLAGS);
  if (invalidFlag) return { kind: "error", message: `Unsupported diagram-format option: --${invalidFlag}` };
  if (flags.text) return { kind: "error", message: `Unexpected diagram-format argument: ${flags.text}` };
  const state = loadWorkflowState(PROJECT_ROOT, GLOBAL_WORKFLOW);
  if (!state) return { kind: "error", message: "No active workflow. Start one with orchestrate next --scope <scope> --work \"<description>\"." };
  const current = diagramFormatOf(state);
  if (!("set" in flags)) {
    return {
      kind: "print",
      diagram_format: current,
      message: `Diagram format: ${current}${state.diagram_format ? "" : " (default)"}. Change it only on the user's explicit request: orchestrate diagram-format --set <mermaid|svg> --user-input "<user's words>".`,
    };
  }
  const requested = flags.set;
  if (!(DIAGRAM_FORMATS as readonly string[]).includes(requested)) return { kind: "error", message: `--set must be one of: ${DIAGRAM_FORMATS.join(", ")}` };
  const userInput = flags["user-input"];
  if (!userInput || userInput === "true" || !userInput.trim()) {
    return { kind: "error", message: "--user-input is required: quote the user's explicit request for this diagram format; never choose it on the user's behalf." };
  }
  if (current === requested && state.diagram_format) {
    return { kind: "print", diagram_format: current, changed: false, message: `Diagram format is already ${current}.` };
  }
  state.diagram_format = requested as DiagramFormat;
  saveWorkflowState(PROJECT_ROOT, state, GLOBAL_WORKFLOW);
  try {
    (hooks.appendAudit || appendAuditEvent)(PROJECT_ROOT, GLOBAL_WORKFLOW, "DIAGRAM_FORMAT_SET", {
      "Workflow ID": state.workflow_id,
      From: current,
      To: requested,
      "User Input": userInput,
    });
  } catch (error) {
    return {
      kind: "error",
      diagram_format: requested,
      message: `Diagram format ${requested} was saved to the workflow state, but the DIAGRAM_FORMAT_SET audit entry could not be written (${error instanceof Error ? error.message : String(error)}): ${AUDIT_MISSING}。`,
    };
  }
  return {
    kind: "print",
    diagram_format: requested,
    changed: true,
    message: requested === "svg"
      ? "✅ Diagram format set to svg. Diagrams are delivered through aidlc-diagram-design (SVG source + .diagram.json) and diagram-contract checks the SVG contract; refresh diagram-contract evidence of completed stages if needed."
      : "✅ Diagram format set to mermaid. Diagrams are Mermaid fenced blocks; diagram-contract records not_applicable.",
  };
}

// ---------------------------------------------------------------------------
// baseline — show, register (--set), correct (--set --replace --expect) or advance (--advance, 4.7.0) the workflow baseline
// ---------------------------------------------------------------------------

function baselineError(message: string, extra: Record<string, unknown> = {}): Directive {
  return { kind: "error", message, ...extra };
}

const UNAVAILABLE_T0_NOTE = "The replacement commit's committer date must be no later than the workflow start (T0); if the workflow was created before the repository's first commit, no valid baseline exists and 需要重新开始工作流 (start a new workflow).";

export async function handleBaseline(args: string[], hooks: StateWriteHooks = {}): Promise<Directive> {
  const flags = parseFlags(args);
  if (flags.text) return baselineError(`Unexpected baseline argument: ${flags.text}`);
  const invalidFlag = unsupportedFlag(flags, BASELINE_FLAGS);
  if (invalidFlag) return baselineError(`Unsupported baseline option: --${invalidFlag}`);
  if ("module" in flags) {
    return baselineError("orchestrate baseline only runs on the global (or single) workflow; module sub-workflows read the parent workflow's baseline and cannot register their own. Drop --module.");
  }
  for (const flag of ["dry-run", "replace"]) {
    if (flag in flags && flags[flag] !== "true") return baselineError(`--${flag} is a boolean flag and does not accept a value`);
  }
  const setting = "set" in flags;
  const advancing = "advance" in flags;
  if (advancing && (setting || "replace" in flags)) {
    return baselineError("--advance cannot be combined with --set or --replace: --advance appends a new epoch to the baseline chain, --set/--replace register or correct the baseline itself.");
  }
  if (!setting && !advancing) {
    const stray = ["replace", "expect", "dry-run", "user-input", "reason"].find((flag) => flag in flags);
    if (stray) return baselineError(`--${stray} is only valid with --set <commit> (or --advance <commit>)`);
  }

  const state = loadWorkflowState(PROJECT_ROOT, GLOBAL_WORKFLOW);
  if (!setting && !advancing) {
    if (!state) return baselineError("No active workflow. Start one with orchestrate next --scope <scope> --work \"<description>\".");
    const registered = state.baseline_commit !== undefined;
    const chain = baselineChain(state);
    return {
      kind: "print",
      workflow_id: state.workflow_id,
      registered,
      baseline_commit: state.baseline_commit ?? null,
      baseline_source: state.baseline_source ?? null,
      baseline_epoch: registered ? chain.length - 1 : null,
      baseline_history: chain,
      message: registered
        ? chain.length > 1
          ? `Workflow baseline: ${state.baseline_commit} (source: ${state.baseline_source}, epoch ${chain.length - 1}). Baseline chain: ${chain.map((commit, index) => `#${index} ${commit}`).join(" → ")}.`
          : `Workflow baseline: ${state.baseline_commit} (source: ${state.baseline_source}).`
        : "No workflow baseline is registered. Register the commit existing behavior is characterized against with: orchestrate baseline --set <commit> --user-input Approve --reason \"<reason>\" [--dry-run].",
    };
  }
  if (advancing) return advanceBaseline(flags, state, hooks);

  const target = flags.set;
  if (!COMMIT_ID_PATTERN.test(target)) {
    return baselineError(`--set must be a full 40- or 64-character lowercase hex commit id; abbreviations, revision expressions (HEAD~3), branch names and options are rejected (got ${JSON.stringify(target)})`);
  }
  if (flags["user-input"] !== "Approve") return baselineError("--user-input must be exactly Approve: registering a baseline requires the user's explicit approval.");
  if (!flags.reason || flags.reason === "true" || !flags.reason.trim()) return baselineError("--reason is required: state why this commit is the baseline.");
  const replace = "replace" in flags;
  if (!replace && "expect" in flags) return baselineError("--expect is only valid with --replace");
  if (replace && (!flags.expect || flags.expect === "true")) return baselineError("--replace requires --expect <current baseline commit>");
  if (replace && !COMMIT_ID_PATTERN.test(flags.expect) && flags.expect !== BASELINE_UNAVAILABLE) {
    return baselineError(`--expect must be a full 40- or 64-character lowercase hex commit id, or exactly ${BASELINE_UNAVAILABLE} when correcting an unavailable baseline (got ${JSON.stringify(flags.expect)})`);
  }

  if (!state) return baselineError("No active workflow. Start one with orchestrate next --scope <scope> --work \"<description>\".");
  if (state.status === "done") {
    // 4.7.1: the done global workflow of a split layout still owns the baseline its live sub-workflows inherit.
    const blocked = doneGlobalBaselineBlocker(state, "its baseline can no longer be registered or replaced");
    if (blocked) return baselineError(blocked);
  } else if (state.status !== "running" && state.status !== "parked") return baselineError(`Workflow ${state.workflow_id} is ${state.status}; baseline requires a running or parked workflow.`);
  if (state.workflow_kind && state.workflow_kind !== "global") return baselineError(`aidlc/active/aidlc-state.md is a ${state.workflow_kind} workflow; baseline only runs on the global workflow.`);

  const current = state.baseline_commit;
  const unchanged = (): Directive => ({
    kind: "print",
    workflow_id: state.workflow_id,
    baseline_commit: current,
    baseline_source: state.baseline_source,
    changed: false,
    message: `Workflow baseline is already ${current}; nothing was written.`,
  });
  if (!replace) {
    if (current === target) return unchanged();
    if (current !== undefined) {
      const correction = `orchestrate baseline --set ${target} --replace --expect ${current} --user-input Approve --reason "<why>"`;
      return baselineError(current === BASELINE_UNAVAILABLE
        ? `Workflow baseline is ${BASELINE_UNAVAILABLE} (source: ${state.baseline_source}): no commit was available when the workflow started. To correct it, run: ${correction}. ${UNAVAILABLE_T0_NOTE}`
        : `Workflow baseline is already ${current} (source: ${state.baseline_source}). To correct it, run: ${correction}`);
    }
  } else {
    if (current === undefined) return baselineError("No workflow baseline is registered yet, so there is nothing to replace; use --set <commit> without --replace.");
    // 4.7.0 fail-closed: an advanced baseline chain is append-only and never replaced.
    if (state.baseline_source === "advanced" || state.baseline_history !== undefined) {
      return baselineError(`Workflow baseline ${current} was advanced (baseline chain: ${baselineChain(state).join(" → ")}); an advanced baseline chain is append-only and cannot be replaced. Use orchestrate baseline --advance to append an epoch, or start a new workflow.`);
    }
    if (flags.expect !== current) return baselineError(`--expect ${flags.expect} does not match the current workflow baseline ${current}`);
    if (target === current) return unchanged();
  }

  let usage: ReturnType<typeof baselineUsage> | undefined;
  if (replace) {
    usage = baselineUsage(PROJECT_ROOT);
    if (usage.used) {
      return baselineError(`Workflow baseline ${current} is already in use and cannot be replaced (${usage.summary}): ${usage.findings.join("; ")}`, { usage_check: usage.summary });
    }
  }
  const checked = checkBaselineCandidate(PROJECT_ROOT, state, target);
  if ("error" in checked) {
    const restart = current === BASELINE_UNAVAILABLE && /is later than the workflow start/.test(checked.error) ? `. ${UNAVAILABLE_T0_NOTE}` : "";
    return baselineError(`Cannot use ${target} as the workflow baseline: ${checked.error}${restart}`);
  }
  const candidate = checked.candidate;
  const anchors = candidate.anchors.length ? candidate.anchors.join(", ") : "none";
  const checks = {
    head: candidate.head,
    committer_date: candidate.committer_date,
    author_date: candidate.author_date,
    workflow_started_at: candidate.workflow_started_at,
    anchor_commits: candidate.anchors,
    tracked_state_at_commit: candidate.tracked_state,
    ...(usage ? { usage_check: usage.summary } : {}),
  };
  if ("dry-run" in flags) {
    return {
      kind: "print",
      dry_run: true,
      changed: true,
      workflow_id: state.workflow_id,
      baseline_commit: target,
      ...(replace ? { replaces: current } : {}),
      checks,
      message: `🔎 ${target} passes every baseline check (dry run, nothing written). Run the same command without --dry-run to ${replace ? "replace" : "register"} it.`,
    };
  }

  hooks.beforeWrite?.();
  const fresh = loadWorkflowState(PROJECT_ROOT, GLOBAL_WORKFLOW);
  if (!fresh || fresh.revision !== state.revision) {
    return baselineError(`workflow state revision conflict: expected ${state.revision}, found ${fresh ? fresh.revision : "no workflow"}; nothing was written, re-run the command.`);
  }
  if (fresh.baseline_commit !== current) {
    return baselineError(`--expect ${current ?? "(none)"} is no longer the workflow baseline (now ${fresh.baseline_commit ?? "none"}); nothing was written.`);
  }
  const source = replace ? "replaced" : "registered";
  const replacementCount = fresh.history.filter((entry) => entry.stage === "baseline" && entry.result === "replaced").length + 1;
  const previousSource = fresh.baseline_source;
  fresh.baseline_commit = target;
  fresh.baseline_source = source;
  fresh.history.push({ stage: "baseline", result: source, timestamp: new Date().toISOString(), user_input: "Approve" });
  try {
    saveWorkflowState(PROJECT_ROOT, fresh, GLOBAL_WORKFLOW, { baselineWrite: true });
  } catch (error) {
    return baselineError(`${error instanceof Error ? error.message : String(error)}; nothing was written, re-run the command.`);
  }

  const dates = {
    "Committer Date (self-reported)": candidate.committer_date,
    "Author Date (self-reported)": candidate.author_date,
    "Workflow Started At": candidate.workflow_started_at,
    "Anchor Commits": anchors,
    "Tracked State At Commit": candidate.tracked_state,
  };
  const event = replace ? "BASELINE_COMMIT_REPLACED" : "BASELINE_COMMIT_SET";
  const fields: Record<string, string> = replace
    ? {
      "Workflow ID": fresh.workflow_id,
      From: current as string,
      "From Source": previousSource || "-",
      To: target,
      Expected: flags.expect,
      "HEAD At Replacement": candidate.head,
      ...dates,
      "Usage Check": usage!.summary,
      "Replacement Count": String(replacementCount),
      Reason: flags.reason.trim(),
      "User Input": "Approve",
    }
    : {
      "Workflow ID": fresh.workflow_id,
      Commit: target,
      Source: source,
      "HEAD At Registration": candidate.head,
      ...dates,
      Reason: flags.reason.trim(),
      "User Input": "Approve",
    };
  try {
    (hooks.appendAudit || appendAuditEvent)(PROJECT_ROOT, GLOBAL_WORKFLOW, event, fields);
  } catch (error) {
    return baselineError(`Workflow baseline ${target} was saved to the workflow state, but the ${event} audit entry could not be written (${error instanceof Error ? error.message : String(error)}): ${AUDIT_MISSING}。`, { baseline_commit: target, baseline_source: source });
  }
  return {
    kind: "print",
    changed: true,
    workflow_id: fresh.workflow_id,
    baseline_commit: target,
    baseline_source: source,
    ...(replace ? { replaced: current, replacement_count: replacementCount } : {}),
    checks,
    message: replace
      ? `✅ Workflow baseline replaced: ${current} → ${target} (replacement #${replacementCount}).`
      : `✅ Workflow baseline registered: ${target}.`,
  };
}

// ---------------------------------------------------------------------------
// baseline --advance — append an epoch to the workflow baseline chain (4.7.0)
// ---------------------------------------------------------------------------

/**
 * Why a done workflow cannot take a baseline write, or undefined when it can (4.7.1).
 * Only the global workflow of a split layout (registry present, same Global Workflow ID)
 * qualifies, and only while at least one module or integration sub-workflow is running
 * or parked: those sub-workflows inherit the global baseline chain via workflowBaseline().
 * A done single (non-split) workflow is always refused with the pre-4.7.1 text.
 */
function doneGlobalBaselineBlocker(state: WorkflowState, refusal: string): string | undefined {
  const refused = `Workflow ${state.workflow_id} is done; ${refusal}`;
  let loaded: WorkflowParts;
  try {
    loaded = loadWorkflowParts(PROJECT_ROOT);
  } catch (error) {
    return `${refused} (the split workflow layout cannot be loaded: ${error instanceof Error ? error.message : String(error)}).`;
  }
  if (!loaded.split || !loaded.registry) return `${refused}.`;
  if (state.workflow_kind && state.workflow_kind !== "global") return `${refused}.`;
  if (loaded.registry.global_workflow_id !== state.workflow_id) {
    return `${refused} (registry Global Workflow ID ${loaded.registry.global_workflow_id} does not match it).`;
  }
  const live = [...loaded.parts.values()].filter((part) => part.ref.kind !== "global" && (part.state.status === "running" || part.state.status === "parked"));
  if (live.length === 0) {
    return `${refused}: it is the global workflow of a split layout, but no module or integration sub-workflow is running or parked.`;
  }
  return undefined;
}

const ADVANCE_USAGE = "orchestrate baseline --advance <commit> --expect <current baseline> --user-input Approve --reason \"<reason>\" [--dry-run]";

/** Every workflow part as one merged read view (the global/single state outside the split layout). */
function baselineScanView(): { view: WorkflowState; parts: WorkflowParts } {
  const parts = loadWorkflowParts(PROJECT_ROOT);
  const global = parts.parts.get("global")?.state;
  if (!global) throw new Error("no active workflow");
  return { view: parts.split ? mergeWorkflowView(parts.parts, GLOBAL_WORKFLOW) : global, parts };
}

/** I13 evidence files that declare characterization code refs, project-relative. */
function characterizationI13Files(): Array<{ path: string; value: Record<string, unknown> }> {
  const root = join(PROJECT_ROOT, ".aidlc", "evidence", "test-case-derivation");
  if (!existsSync(root)) return [];
  return collectFiles(root).filter((path) => path.endsWith("test-case-derivation.json")).sort().map((path) => {
    const label = normalizeArtifactLabel(relative(PROJECT_ROOT, path));
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`I13 evidence ${label} cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const record = asRecord(value);
    if (!record) throw new Error(`I13 evidence ${label} must be a JSON object`);
    return { path: label, value: record };
  }).filter((file) => file.value.status === "required" && i13UcdIdsByMode(file.value).characterization.length > 0);
}

async function advanceBaseline(flags: Record<string, string>, state: WorkflowState | null, hooks: StateWriteHooks): Promise<Directive> {
  const target = flags.advance;
  if (!COMMIT_ID_PATTERN.test(target)) {
    return baselineError(`--advance must be a full 40- or 64-character lowercase hex commit id; abbreviations, revision expressions (HEAD~3), branch names and options are rejected (got ${JSON.stringify(target)})`);
  }
  if (flags["user-input"] !== "Approve") return baselineError("--user-input must be exactly Approve: advancing the baseline requires the user's explicit approval.");
  if (!flags.reason || flags.reason === "true" || !flags.reason.trim()) return baselineError("--reason is required: state why the baseline advances to this commit.");
  if (!flags.expect || flags.expect === "true") return baselineError(`--advance requires --expect <current baseline commit> (same optimistic check as --replace). Usage: ${ADVANCE_USAGE}`);
  if (!COMMIT_ID_PATTERN.test(flags.expect)) return baselineError(`--expect must be a full 40- or 64-character lowercase hex commit id (got ${JSON.stringify(flags.expect)})`);

  // 1. Workflow, git repository and a usable current epoch.
  if (!state) return baselineError("No active workflow. Start one with orchestrate next --scope <scope> --work \"<description>\".");
  if (state.status === "done") {
    // 4.7.1: in the split layout the global workflow is legitimately done once the product-level
    // stages resolve; the module / integration sub-workflows that inherit its chain keep running.
    const blocked = doneGlobalBaselineBlocker(state, "baseline --advance requires a running or parked workflow");
    if (blocked) return baselineError(blocked);
  } else if (state.status !== "running" && state.status !== "parked") return baselineError(`Workflow ${state.workflow_id} is ${state.status}; baseline --advance requires a running or parked workflow.`);
  if (state.workflow_kind && state.workflow_kind !== "global") return baselineError(`aidlc/active/aidlc-state.md is a ${state.workflow_kind} workflow; baseline only runs on the global workflow.`);
  const current = state.baseline_commit;
  if (current === undefined || state.baseline_source === undefined) {
    return baselineError("No workflow baseline is registered, so there is no epoch to advance from; register one with orchestrate baseline --set <commit> --user-input Approve --reason \"<reason>\".");
  }
  if (current === BASELINE_UNAVAILABLE) {
    return baselineError(`Workflow baseline is ${BASELINE_UNAVAILABLE}; it cannot be advanced. Correct it first with orchestrate baseline --set <commit> --replace --expect ${BASELINE_UNAVAILABLE} --user-input Approve --reason "<why>".`);
  }
  if (flags.expect !== current) return baselineError(`--expect ${flags.expect} does not match the current workflow baseline ${current}`);
  const currentErrors = baselineCommitErrors(PROJECT_ROOT, state);
  if (currentErrors.length > 0) return baselineError(`Cannot advance the workflow baseline: ${currentErrors.join("; ")}`);

  // 2. Target: existing commit, HEAD or an ancestor of HEAD, strict descendant of the current epoch.
  const gitCheck = checkAdvanceTarget(PROJECT_ROOT, current, target);
  if ("error" in gitCheck) return baselineError(`Cannot advance the workflow baseline to ${target}: ${gitCheck.error}`);

  let scan: ReturnType<typeof baselineScanView>;
  try {
    scan = baselineScanView();
  } catch (error) {
    return baselineError(`Cannot advance the workflow baseline: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { view, parts } = scan;
  const graph = loadGraph();
  const instances = expandStageInstances(graph, view);
  const completed = new Set(completedInstanceIds(view));

  // 4. Never between a unit's BASELINE and GREEN: no active code-generation, and no unit
  //    whose controlled BASELINE observation exists while its code-generation is open.
  const blockers: string[] = [];
  const unitKey = (instance: StageInstance) => `${instance.module_id}/${instance.unit_id}`;
  const codeGenerationDone = new Set(instances.filter((instance) => instance.stage.slug === "code-generation" && completed.has(instance.instance_id)).map(unitKey));
  for (const part of parts.parts.values()) {
    const open = [...Object.keys(part.state.active_instances || {}), ...(part.state.status !== "done" && part.state.current_stage_instance ? [part.state.current_stage_instance] : [])];
    for (const id of new Set(open)) {
      if (id.split("@", 1)[0] === "code-generation" && !completed.has(id)) blockers.push(`${id} is active in the ${workflowRefKey(part.ref)} workflow`);
    }
  }
  for (const instance of instances.filter((candidate) => candidate.stage.slug === "tdd")) {
    if (codeGenerationDone.has(unitKey(instance))) continue;
    const path = evidencePath(instance.stage, "baseline-test-evidence", instance);
    if (!existsSync(path)) continue;
    let observed = true;
    try {
      observed = asRecord(JSON.parse(readFileSync(path, "utf8")))?.status !== "not_required";
    } catch { /* unreadable BASELINE evidence counts as observed: fail closed */ }
    if (observed) blockers.push(`${instance.instance_id} already holds BASELINE evidence (${normalizeArtifactLabel(relative(PROJECT_ROOT, path))}) while code-generation of unit ${unitKey(instance)} is not completed`);
  }
  if (blockers.length > 0) {
    return baselineError(`Cannot advance the workflow baseline while a unit sits between its BASELINE and GREEN: ${blockers.join("; ")}. Complete that unit's code-generation first.`);
  }

  // 3. Anchor: the target is the source_revision.commit of the controlled GREEN evidence
  //    of a completed code-generation instance that still passes its gate.
  const anchorErrors: string[] = [];
  let anchor: { instance: string; path: string; commit: string } | undefined;
  for (const declared of instances.filter((candidate) => candidate.stage.slug === "code-generation" && completed.has(candidate.instance_id))) {
    const instance = runtimeInstance(declared, view);
    const path = evidencePath(instance.stage, "green-test-evidence", instance);
    const label = normalizeArtifactLabel(relative(PROJECT_ROOT, path));
    const loaded = loadEvidence(instance.stage, "green-test-evidence", instance);
    if (!loaded.value) continue;
    if (asRecord(loaded.value.source_revision)?.commit !== target) continue;
    const failures = await checkSensors(instance, view, { tolerateRevisionDrift: true, onlySensors: ["green-test-evidence"] });
    if (failures.length > 0) {
      anchorErrors.push(`${label}: ${failures.map((failure) => failure.message).join("; ")}`);
      continue;
    }
    anchor = { instance: instance.instance_id, path: label, commit: target };
    break;
  }
  if (!anchor) {
    return baselineError(anchorErrors.length > 0
      ? `Cannot advance the workflow baseline to ${target}: the GREEN evidence anchored at it no longer passes its gate: ${anchorErrors.join("; ")}`
      : `Cannot advance the workflow baseline to ${target}: it is not the source_revision.commit of the controlled GREEN evidence of any completed code-generation instance. --advance only moves to the completion point of a finished unit; commit that unit's changes before its GREEN evidence is produced (or refresh it after the commit).`);
  }

  // 5. Every I13 characterization code ref resolves at the target commit.
  const refErrors: string[] = [];
  try {
    for (const file of characterizationI13Files()) {
      for (const { path } of i13CodeRefBlobs(file.value)) {
        const resolved = baselineCodeRef(PROJECT_ROOT, target, { path }, `${file.path} code ref ${path}`);
        if ("error" in resolved) refErrors.push(resolved.error);
      }
    }
  } catch (error) {
    refErrors.push(error instanceof Error ? error.message : String(error));
  }
  if (refErrors.length > 0) return baselineError(`Cannot advance the workflow baseline to ${target}: the I13 characterization code refs do not resolve there: ${refErrors.join("; ")}`);

  const chain = [...baselineChain(state), target];
  const epoch = chain.length - 1;
  const checks = { head: gitCheck.head, anchor, epoch, baseline_history: chain };
  if ("dry-run" in flags) {
    return {
      kind: "print",
      dry_run: true,
      changed: true,
      workflow_id: state.workflow_id,
      baseline_commit: target,
      advances: current,
      checks,
      message: `🔎 ${target} passes every baseline --advance check (dry run, nothing written). Run the same command without --dry-run to advance to epoch ${epoch}.`,
    };
  }

  hooks.beforeWrite?.();
  const fresh = loadWorkflowState(PROJECT_ROOT, GLOBAL_WORKFLOW);
  if (!fresh || fresh.revision !== state.revision) {
    return baselineError(`workflow state revision conflict: expected ${state.revision}, found ${fresh ? fresh.revision : "no workflow"}; nothing was written, re-run the command.`);
  }
  if (fresh.baseline_commit !== current || JSON.stringify(baselineChain(fresh)) !== JSON.stringify(baselineChain(state))) {
    return baselineError(`--expect ${current} is no longer the workflow baseline (now ${fresh.baseline_commit ?? "none"}); nothing was written.`);
  }
  const previousSource = fresh.baseline_source;
  fresh.baseline_history = chain;
  fresh.baseline_commit = target;
  fresh.baseline_source = "advanced";
  fresh.history.push({ stage: "baseline", result: "advanced", timestamp: new Date().toISOString(), user_input: "Approve" });
  try {
    saveWorkflowState(PROJECT_ROOT, fresh, GLOBAL_WORKFLOW, { baselineWrite: true });
  } catch (error) {
    return baselineError(`${error instanceof Error ? error.message : String(error)}; nothing was written, re-run the command.`);
  }
  const event = "BASELINE_COMMIT_ADVANCED";
  try {
    (hooks.appendAudit || appendAuditEvent)(PROJECT_ROOT, GLOBAL_WORKFLOW, event, {
      "Workflow ID": fresh.workflow_id,
      From: current,
      "From Source": previousSource || "-",
      To: target,
      Epoch: String(epoch),
      Chain: chain.join(", "),
      Anchor: `${anchor.path} @ ${anchor.commit} (${anchor.instance})`,
      Expected: flags.expect,
      HEAD: gitCheck.head,
      Reason: flags.reason.trim(),
      "User Input": "Approve",
    });
  } catch (error) {
    return baselineError(`Workflow baseline ${target} was saved to the workflow state, but the ${event} audit entry could not be written (${error instanceof Error ? error.message : String(error)}): ${AUDIT_MISSING}。`, { baseline_commit: target, baseline_source: "advanced" });
  }
  return {
    kind: "print",
    changed: true,
    workflow_id: fresh.workflow_id,
    baseline_commit: target,
    baseline_source: "advanced",
    advanced: current,
    baseline_epoch: epoch,
    baseline_history: chain,
    checks,
    message: `✅ Workflow baseline advanced: ${current} → ${target} (epoch ${epoch}). Completed units keep their original BASELINE evidence; run evidence run for the active unit's tdd to observe BASELINE at the new epoch.`,
  };
}

// ---------------------------------------------------------------------------
// split — migrate a single-layout workflow into per-module workflows
// ---------------------------------------------------------------------------

async function handleSplit(args: string[]): Promise<Directive> {
  const flags = parseFlags(args);
  const invalidFlag = unsupportedFlag(flags, SPLIT_FLAGS);
  if (invalidFlag) return { kind: "error", message: `Unsupported split option: --${invalidFlag}` };
  if (!flags.from || flags.from === "true") return { kind: "error", message: "split requires --from <workflow-id> (the Workflow ID of aidlc/active/aidlc-state.md, or its first 8+ characters)" };
  if ("dry-run" in flags && flags["dry-run"] !== "true") return { kind: "error", message: "--dry-run is a boolean flag and does not accept a value" };
  return performSplit(flags.from, "dry-run" in flags, "orchestrate split");
}

// ---------------------------------------------------------------------------
// continue — steering chain transport (placeholder for rule loading)
// ---------------------------------------------------------------------------

async function handleContinue(token: string): Promise<Directive> {
  // Load-steering chains are simplified:
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
        message: "Usage: aidlc-orchestrate.ts <next|continue|report|park|archive|split|upgrade|diagram-format|baseline> [args...]",
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
      directive = await handlePark(rest);
      break;
    case "archive":
      directive = await handleArchive(rest);
      break;
    case "split":
      directive = await handleSplit(rest);
      break;
    case "upgrade":
      directive = await handleUpgrade(rest);
      break;
    case "diagram-format":
      directive = await handleDiagramFormat(rest);
      break;
    case "baseline":
      directive = await handleBaseline(rest);
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
