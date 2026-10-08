/**
 * aidlc-workflow-layout.ts — per-module workflow layout (4.3.0).
 *
 * Single layout (default, 4.2.x compatible):
 *   aidlc/active/aidlc-state.md + audit.md hold the only workflow.
 *
 * Split layout (present when aidlc/active/registry.md exists):
 *   aidlc/active/aidlc-state.md               global workflow (leading project-axis stages)
 *   aidlc/active/modules/<id>/aidlc-state.md  one workflow per module (module + unit axis)
 *   aidlc/active/integration/aidlc-state.md   cross-module integration (trailing project-axis stages)
 *   aidlc/active/registry.md                  identity index + engine projections
 *
 * The registry is Markdown because the control plane is Markdown only. Its identity
 * rows (module -> workflow ID / state path) are authoritative; status, dependency
 * and contract columns are projections the engine refreshes after every write.
 */

import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { readModuleManifest, type ModuleDescriptor } from "./aidlc-execution-context";
import {
  GLOBAL_WORKFLOW,
  lightStatePath,
  loadWorkflowState,
  markdownCell,
  markdownScalar,
  markdownTable,
  workflowRefKey,
  type HistoryEntry,
  type WorkflowRef,
  type WorkflowState,
} from "./aidlc-light-state";
import { readSourceRevision, type DigestScope, type SourceRevision } from "./aidlc-revision";
import { nestedSourceRepos } from "./aidlc-nested-repos";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = join(TOOL_DIR, "data", "stage-graph.json");
const LOCK_WAIT_MS = 3_000;
const LOCK_STALE_MS = 30_000;

/** Project-level roots written only by integration-owned stages. */
const INTEGRATION_ROOTS = ["docs/aidlc/construction/", "docs/aidlc/operation/"];

interface GraphStageLite {
  slug: string;
  axis: "project" | "module" | "unit";
}

let graphCache: GraphStageLite[] | undefined;

function graphStages(): GraphStageLite[] {
  if (!graphCache) {
    const graph = JSON.parse(readFileSync(GRAPH_PATH, "utf8")) as { stages: GraphStageLite[] };
    graphCache = graph.stages.map((stage) => ({ slug: stage.slug, axis: stage.axis }));
  }
  return graphCache;
}

/** Project-axis stages that follow the first module/unit stage belong to the integration workflow. */
export function integrationStageSlugs(): Set<string> {
  const stages = graphStages();
  const first = stages.findIndex((stage) => stage.axis !== "project");
  if (first < 0) return new Set();
  return new Set(stages.slice(first).filter((stage) => stage.axis === "project").map((stage) => stage.slug));
}

export function stageAxis(slug: string): GraphStageLite["axis"] | undefined {
  return graphStages().find((stage) => stage.slug === slug)?.axis;
}

export function ownerOfInstance(instanceId: string): WorkflowRef {
  const moduleMatch = /@module:([a-z0-9][a-z0-9-]*)/.exec(instanceId);
  if (moduleMatch) return { kind: "module", module_id: moduleMatch[1] };
  return integrationStageSlugs().has(instanceId.split("@", 1)[0]) ? { kind: "integration" } : GLOBAL_WORKFLOW;
}

export function ownerOfHistory(entry: HistoryEntry): WorkflowRef {
  if (entry.instance_id) return ownerOfInstance(entry.instance_id);
  if (entry.module_id) return { kind: "module", module_id: entry.module_id };
  return integrationStageSlugs().has(entry.stage) ? { kind: "integration" } : GLOBAL_WORKFLOW;
}

export function sameRef(left: WorkflowRef, right: WorkflowRef): boolean {
  return workflowRefKey(left) === workflowRefKey(right);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface RegistryModuleRow {
  module_id: string;
  workflow_id: string;
  state_path: string;
  status: string;
  current_stage: string;
  inception_done: boolean;
  construction_done: boolean;
  owner: string;
}

export interface RegistryIntegrationRow {
  workflow_id: string;
  state_path: string;
  status: string;
  current_stage: string;
  barrier_ready: boolean;
  blocking: string[];
}

export interface RegistrySharedContract {
  contract_id: string;
  provider: string;
  consumers: string[];
  verified: boolean;
  source: string;
}

export interface RegistryCrossRequire {
  consumer: string;
  consumer_stage: string;
  provider: string;
  provider_stage: string;
  satisfied: boolean;
  source: string;
}

export interface WorkflowRegistry {
  version: "1";
  global_workflow_id: string;
  split_from_workflow_id: string;
  split_at: string;
  updated_at: string;
  modules: RegistryModuleRow[];
  integration: RegistryIntegrationRow;
  shared_contracts: RegistrySharedContract[];
  cross_module_requires: RegistryCrossRequire[];
}

export function registryPath(projectRoot: string): string {
  return resolve(projectRoot, "aidlc", "active", "registry.md");
}

export function isSplitLayout(projectRoot: string): boolean {
  return existsSync(registryPath(projectRoot));
}

function flag(value: string): boolean {
  return value === "yes";
}

function parseList(value: string): string[] {
  return value === "-" ? [] : value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseRegistry(markdown: string): WorkflowRegistry {
  if (!markdown.startsWith("# AI-DLC Workflow Registry\n")) throw new Error("registry is not an AI-DLC workflow registry Markdown document");
  const version = markdownScalar(markdown, "Registry Version");
  if (version === "2") return parseIdentityRegistry(markdown);
  if (version !== "1") throw new Error("registry version must be 1 or 2");
  const modules = markdownTable(markdown, "Modules").map((cells, index) => {
    if (cells.length !== 8) throw new Error(`registry Modules row ${index + 1} is malformed`);
    return {
      module_id: cells[0],
      workflow_id: cells[1],
      state_path: cells[2],
      status: cells[3],
      current_stage: cells[4],
      inception_done: flag(cells[5]),
      construction_done: flag(cells[6]),
      owner: cells[7],
    };
  });
  if (new Set(modules.map((row) => row.module_id)).size !== modules.length) throw new Error("registry contains duplicate module rows");
  const integrationRows = markdownTable(markdown, "Integration");
  if (integrationRows.length !== 1 || integrationRows[0].length !== 6) throw new Error("registry must contain exactly one Integration row");
  const [integration] = integrationRows;
  return {
    version: "1",
    global_workflow_id: markdownScalar(markdown, "Global Workflow ID"),
    split_from_workflow_id: markdownScalar(markdown, "Split From Workflow ID"),
    split_at: markdownScalar(markdown, "Split At"),
    updated_at: markdownScalar(markdown, "Updated At"),
    modules,
    integration: {
      workflow_id: integration[0],
      state_path: integration[1],
      status: integration[2],
      current_stage: integration[3],
      barrier_ready: flag(integration[4]),
      blocking: parseList(integration[5]),
    },
    shared_contracts: markdownTable(markdown, "Shared Contracts").map((cells, index) => {
      if (cells.length !== 5) throw new Error(`registry Shared Contracts row ${index + 1} is malformed`);
      return { contract_id: cells[0], provider: cells[1], consumers: parseList(cells[2]), verified: flag(cells[3]), source: cells[4] };
    }),
    cross_module_requires: markdownTable(markdown, "Cross Module Requires").map((cells, index) => {
      if (cells.length !== 6) throw new Error(`registry Cross Module Requires row ${index + 1} is malformed`);
      return { consumer: cells[0], consumer_stage: cells[1], provider: cells[2], provider_stage: cells[3], satisfied: flag(cells[4]), source: cells[5] };
    }),
  };
}

/**
 * Registry version 2 (4.13.0, MARS-98): identity only. The file changes only when a
 * workflow is created, so members advancing different modules never touch it; module
 * rows are sorted by module ID so two members creating different modules add lines
 * at different places (keep both rows when git still reports a conflict). Status,
 * dependency, contract and barrier projections are computed from the workflow states
 * on every read and are not persisted.
 */
function parseIdentityRegistry(markdown: string): WorkflowRegistry {
  const modules = markdownTable(markdown, "Modules").map((cells, index) => {
    if (cells.length !== 3) throw new Error(`registry Modules row ${index + 1} is malformed`);
    return { module_id: cells[0], workflow_id: cells[1], state_path: cells[2], status: "-", current_stage: "-", inception_done: false, construction_done: false, owner: "-" };
  });
  if (new Set(modules.map((row) => row.module_id)).size !== modules.length) throw new Error("registry contains duplicate module rows");
  const integrationRows = markdownTable(markdown, "Integration");
  if (integrationRows.length !== 1 || integrationRows[0].length !== 2) throw new Error("registry must contain exactly one Integration row");
  const splitAt = markdownScalar(markdown, "Split At");
  return {
    version: "1",
    global_workflow_id: markdownScalar(markdown, "Global Workflow ID"),
    split_from_workflow_id: markdownScalar(markdown, "Split From Workflow ID"),
    split_at: splitAt,
    updated_at: splitAt,
    modules,
    integration: { workflow_id: integrationRows[0][0], state_path: integrationRows[0][1], status: "-", current_stage: "-", barrier_ready: false, blocking: [] },
    shared_contracts: [],
    cross_module_requires: [],
  };
}

export function renderRegistry(registry: WorkflowRegistry): string {
  const modules = [...registry.modules].sort((left, right) => left.module_id.localeCompare(right.module_id))
    .map((row) => `| ${markdownCell(row.module_id)} | ${markdownCell(row.workflow_id)} | ${markdownCell(row.state_path)} |`);
  const integration = registry.integration;
  return `# AI-DLC Workflow Registry

> Per-module workflow identity index (module -> workflow ID and state path). It changes only when a workflow is created; status, contracts and the integration barrier are computed from the workflow states (orchestrate next --status). On a git conflict keep the module rows of both sides; never keep one side of aidlc/active as a whole.

- Registry Version: 2
- Global Workflow ID: ${markdownCell(registry.global_workflow_id)}
- Split From Workflow ID: ${markdownCell(registry.split_from_workflow_id)}
- Split At: ${registry.split_at}

## Modules
| Module | Workflow ID | State Path |
| --- | --- | --- |
${modules.join("\n") || "| - | - | - |"}

## Integration
| Workflow ID | State Path |
| --- | --- |
| ${markdownCell(integration.workflow_id)} | ${markdownCell(integration.state_path)} |
`;
}

export function loadRegistry(projectRoot: string): WorkflowRegistry | null {
  const path = registryPath(projectRoot);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`workflow registry must be a regular non-symlink file: ${path}`);
  return parseRegistry(readFileSync(path, "utf8"));
}

function acquireLock(path: string): number {
  const started = Date.now();
  while (true) {
    try {
      return openSync(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
        unlinkSync(path);
        continue;
      }
      if (Date.now() - started > LOCK_WAIT_MS) throw new Error(`timed out waiting for registry lock: ${path}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

export function saveRegistry(projectRoot: string, registry: WorkflowRegistry): void {
  updateRegistry(projectRoot, () => registry, true);
}

/**
 * Read-modify-write the registry under its lock so concurrent writers (a lazily created
 * module workflow, a projection refresh) never drop each other's identity rows.
 */
export function updateRegistry(projectRoot: string, mutate: (current: WorkflowRegistry | null) => WorkflowRegistry, allowCreate = false): WorkflowRegistry {
  const path = registryPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lock = acquireLock(`${path}.lock`);
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    const current = loadRegistry(projectRoot);
    if (!current && !allowCreate) throw new Error("workflow registry is missing; run orchestrate split first");
    const next = { ...mutate(current), updated_at: new Date().toISOString() };
    // 4.13.0: identity-only file; an unchanged identity leaves it byte-for-byte untouched.
    const rendered = renderRegistry(next);
    if (current && readFileSync(path, "utf8").replace(/\r\n/g, "\n") === rendered) return next;
    writeFileSync(temporary, rendered, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
    return next;
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    closeSync(lock);
    if (existsSync(`${path}.lock`)) unlinkSync(`${path}.lock`);
  }
}

export function relativeStatePath(projectRoot: string, ref: WorkflowRef): string {
  return relative(resolve(projectRoot), lightStatePath(projectRoot, ref)).replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Parts and merged view
// ---------------------------------------------------------------------------

export interface WorkflowPart {
  ref: WorkflowRef;
  state: WorkflowState;
}

export interface WorkflowParts {
  split: boolean;
  registry: WorkflowRegistry | null;
  parts: Map<string, WorkflowPart>;
}

/**
 * 4.13.0 (MARS-98): every sub-workflow of a split layout belongs to the registry's
 * lineage. A module or integration state carried over from another split (a merge that
 * mixed two lineages file by file) is rejected on every command instead of only by the
 * baseline resolution. States written before 4.3 parentage are accepted.
 */
function assertSameLineage(registry: WorkflowRegistry, label: string, state: WorkflowState): void {
  if (!state.parent_workflow_id || state.parent_workflow_id === registry.global_workflow_id) return;
  throw new Error(`workflow lineage conflict: ${label} ${state.workflow_id} belongs to lineage ${state.parent_workflow_id}, but the registry and the global workflow are lineage ${registry.global_workflow_id}. Two lineages are mixed in aidlc/active; restore the files of one lineage from git (orchestrate state verify lists both) instead of merging them.`);
}

export function loadWorkflowParts(projectRoot: string): WorkflowParts {
  const registry = loadRegistry(projectRoot);
  const parts = new Map<string, WorkflowPart>();
  const global = loadWorkflowState(projectRoot, GLOBAL_WORKFLOW);
  if (global) parts.set("global", { ref: GLOBAL_WORKFLOW, state: global });
  if (!registry) return { split: false, registry: null, parts };
  if (!global) throw new Error("split workflow layout is missing the global workflow state");
  if (global.workflow_id !== registry.global_workflow_id) throw new Error(`registry global workflow ${registry.global_workflow_id} does not match ${global.workflow_id}`);
  for (const row of registry.modules) {
    const ref: WorkflowRef = { kind: "module", module_id: row.module_id };
    const state = loadWorkflowState(projectRoot, ref);
    if (!state) throw new Error(`registry module ${row.module_id} has no workflow state at ${relativeStatePath(projectRoot, ref)}`);
    if (state.workflow_id !== row.workflow_id) throw new Error(`module workflow ${row.module_id} ID ${state.workflow_id} does not match registry ${row.workflow_id}`);
    assertSameLineage(registry, `module workflow ${row.module_id}`, state);
    parts.set(workflowRefKey(ref), { ref, state });
  }
  const integrationRef: WorkflowRef = { kind: "integration" };
  const integration = loadWorkflowState(projectRoot, integrationRef);
  if (!integration) throw new Error("split workflow layout is missing the integration workflow state");
  if (integration.workflow_id !== registry.integration.workflow_id) throw new Error(`integration workflow ID ${integration.workflow_id} does not match registry ${registry.integration.workflow_id}`);
  assertSameLineage(registry, "integration workflow", integration);
  parts.set("integration", { ref: integrationRef, state: integration });
  return { split: true, registry, parts };
}

function uniqueConcat(lists: string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const list of lists) for (const value of list) if (!seen.has(value)) { seen.add(value); result.push(value); }
  return result;
}

/**
 * Merge every workflow part into one read view for dependency evaluation. Scalars
 * come from the global workflow; status, revision and the current context come from
 * the owner so handlers see exactly the workflow they will write.
 */
export function mergeWorkflowView(parts: Map<string, WorkflowPart>, owner: WorkflowRef = GLOBAL_WORKFLOW): WorkflowState {
  const ordered = [...parts.values()];
  const global = parts.get("global")?.state;
  const ownerState = parts.get(workflowRefKey(owner))?.state;
  if (!global || !ownerState) throw new Error(`workflow ${workflowRefKey(owner)} is not loaded`);
  const history = ordered.flatMap((part) => part.state.history)
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => left.entry.timestamp.localeCompare(right.entry.timestamp) || left.index - right.index)
    .map((item) => ({ ...item.entry }));
  return {
    ...global,
    workflow_id: ownerState.workflow_id,
    workflow_kind: ownerState.workflow_kind,
    ...(ownerState.module_id ? { module_id: ownerState.module_id } : { module_id: undefined }),
    parent_workflow_id: ownerState.parent_workflow_id,
    revision: ownerState.revision,
    status: ownerState.status,
    current_phase: ownerState.current_phase,
    current_stage: ownerState.current_stage,
    current_stage_instance: ownerState.current_stage_instance,
    current_module: ownerState.current_module,
    current_unit: ownerState.current_unit,
    completed_stages: uniqueConcat(ordered.map((part) => part.state.completed_stages)),
    skipped_stages: uniqueConcat(ordered.map((part) => part.state.skipped_stages)),
    completed_stage_instances: uniqueConcat(ordered.map((part) => part.state.completed_stage_instances)),
    skipped_stage_instances: uniqueConcat(ordered.map((part) => part.state.skipped_stage_instances)),
    selected_optional_stages: [...global.selected_optional_stages],
    history,
    unit_selections: Object.assign({}, ...ordered.map((part) => part.state.unit_selections)),
    module_selections: Object.assign({}, ...ordered.map((part) => part.state.module_selections)),
    active_instances: Object.assign({}, ...ordered.map((part) => part.state.active_instances)),
    created_at: global.created_at,
    updated_at: ownerState.updated_at,
  };
}

/** Read-only projection for consumers that do not write: legacy state or the merged split view. */
export function loadWorkflowView(projectRoot: string, moduleId?: string): WorkflowState | null {
  const loaded = loadWorkflowParts(projectRoot);
  if (!loaded.split) return loaded.parts.get("global")?.state || null;
  const owner: WorkflowRef = moduleId && loaded.parts.has(`module:${moduleId}`) ? { kind: "module", module_id: moduleId } : GLOBAL_WORKFLOW;
  return mergeWorkflowView(loaded.parts, owner);
}

function ownedSelections<T>(values: Record<string, T>, ref: WorkflowRef, key: (entry: string) => string): Record<string, T> {
  if (ref.kind !== "module") return {};
  return Object.fromEntries(Object.entries(values || {}).filter(([entry]) => key(entry) === ref.module_id));
}

/**
 * Extract the portion of a (possibly mutated) merged view that a workflow owns.
 * Scalars stay those of the owner's persisted state; progress, history, claims,
 * selections and the current context are taken from the view.
 */
export function extractOwnedState(view: WorkflowState, base: WorkflowState, ref: WorkflowRef): WorkflowState {
  const owns = (instanceId: string): boolean => sameRef(ownerOfInstance(instanceId), ref);
  return {
    ...base,
    status: view.status,
    current_phase: view.current_phase,
    current_stage: view.current_stage,
    current_stage_instance: view.current_stage_instance,
    current_module: view.current_module,
    current_unit: view.current_unit,
    completed_stage_instances: view.completed_stage_instances.filter(owns),
    skipped_stage_instances: view.skipped_stage_instances.filter(owns),
    history: view.history.filter((entry) => sameRef(ownerOfHistory(entry), ref)),
    active_instances: Object.fromEntries(Object.entries(view.active_instances || {}).filter(([instance]) => owns(instance))),
    module_selections: ownedSelections(view.module_selections, ref, (entry) => entry),
    unit_selections: ownedSelections(view.unit_selections, ref, (entry) => entry.split(":", 1)[0]),
  };
}

// ---------------------------------------------------------------------------
// Evidence scope
// ---------------------------------------------------------------------------

function underAny(path: string, roots: string[]): boolean {
  return roots.some((root) => {
    const prefix = root.endsWith("/") ? root : `${root}/`;
    return path === root.replace(/\/$/, "") || path.startsWith(prefix);
  });
}

function manifestModules(projectRoot: string): ModuleDescriptor[] {
  try {
    return readModuleManifest(projectRoot);
  } catch {
    return [];
  }
}

/**
 * Digest scope for evidence of one stage instance. The single layout keeps the
 * historical whole-worktree binding; the split layout binds module evidence to
 * everything except other modules' private roots, and global evidence to
 * everything except module and integration roots.
 */
export function evidenceScopeForInstance(projectRoot: string, instanceId: string): DigestScope {
  if (!isSplitLayout(projectRoot)) return { label: "worktree", exclude: () => false };
  const owner = ownerOfInstance(instanceId);
  const modules = manifestModules(projectRoot);
  if (owner.kind === "module") {
    const otherPaths = modules.filter((module) => module.module_id !== owner.module_id).flatMap((module) => module.paths || []);
    return {
      label: `module:${owner.module_id}`,
      exclude: (path) => {
        if (path.startsWith("docs/aidlc/modules/")) return path.split("/")[3] !== owner.module_id;
        return underAny(path, INTEGRATION_ROOTS) || underAny(path, otherPaths);
      },
    };
  }
  if (owner.kind === "global") {
    const modulePaths = modules.flatMap((module) => module.paths || []);
    return {
      label: "global",
      exclude: (path) => path.startsWith("docs/aidlc/modules/") || underAny(path, INTEGRATION_ROOTS) || underAny(path, modulePaths),
    };
  }
  return { label: "worktree", exclude: () => false };
}

/**
 * Source revision recorded by a new piece of evidence. 4.9.0: every declared nested
 * repository (checked fail closed by nestedSourceRepos) gets its own `repos` entry.
 */
export function evidenceSourceRevision(projectRoot: string, instanceId: string | undefined): SourceRevision {
  return readSourceRevision(projectRoot, instanceId ? evidenceScopeForInstance(projectRoot, instanceId) : undefined, nestedSourceRepos(projectRoot));
}
