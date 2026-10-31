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

import { existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { readModuleManifest, readUnitManifest, type ModuleDescriptor } from "./aidlc-execution-context";
import {
  GLOBAL_WORKFLOW,
  lightStatePath,
  loadWorkflowState,
  markdownCell,
  markdownScalar,
  markdownTable,
  workflowRefKey,
  withWorkflowFileLock,
  type HistoryEntry,
  type WorkflowRef,
  type WorkflowState,
} from "./aidlc-light-state";
import { readSourceRevision, type DigestScope, type SourceRevision } from "./aidlc-revision";
import { nestedSourceRepos } from "./aidlc-nested-repos";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = join(TOOL_DIR, "data", "stage-graph.json");

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

// In-process registry parse memoization (MARS-277), mtime-keyed like the workflow
// state cache; writes go through updateRegistry, which deletes the entry.
const registryCache = new Map<string, { mtime: number; registry: WorkflowRegistry | null }>();

export function loadRegistry(projectRoot: string): WorkflowRegistry | null {
  const path = registryPath(projectRoot);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`workflow registry must be a regular non-symlink file: ${path}`);
  const cached = registryCache.get(path);
  if (cached && cached.mtime === stat.mtimeMs) return cached.registry ? structuredClone(cached.registry) : null;
  const registry = parseRegistry(readFileSync(path, "utf8"));
  registryCache.set(path, { mtime: stat.mtimeMs, registry });
  return structuredClone(registry);
}

export function saveRegistry(projectRoot: string, registry: WorkflowRegistry): void {
  updateRegistry(projectRoot, () => registry, true);
}

const registryPublications = new Set<string>();

/** Retain the registry lock through a family initialization and its rollback. */
export function withRegistryPublication<T>(projectRoot: string, publish: () => T): T {
  const path = registryPath(projectRoot);
  if (registryPublications.has(path)) return publish();
  return withWorkflowFileLock(path, () => {
    if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) throw new Error("workflow registry must be a regular non-symlink file");
    const before = existsSync(path) ? readFileSync(path) : undefined;
    registryPublications.add(path);
    try { return publish(); }
    catch (error) {
      if (before === undefined) { if (existsSync(path)) unlinkSync(path); }
      else writeFileSync(path, before);
      throw error;
    } finally { registryPublications.delete(path); }
  });
}

/**
 * Read-modify-write the registry under its lock so concurrent writers (a lazily created
 * module workflow, a projection refresh) never drop each other's identity rows.
 */
export function updateRegistry(projectRoot: string, mutate: (current: WorkflowRegistry | null) => WorkflowRegistry, allowCreate = false): WorkflowRegistry {
  const path = registryPath(projectRoot);
  return withRegistryPublication(projectRoot, () => {
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
      registryCache.delete(path);
      return next;
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  });
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

export function loadWorkflowParts(projectRoot: string, missingModuleForRecovery?: string): WorkflowParts {
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
    // Recovery may reconstruct exactly one absent target. Ordinary readers and
    // writers still require every registry identity to have a valid state.
    if (!state && row.module_id === missingModuleForRecovery) continue;
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
    quality_gates_version: ownerState.quality_gates_version,
    document_slices_version: ownerState.document_slices_version,
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
    unit_contexts: Object.keys(Object.assign({}, ...ordered.map((part) => part.state.unit_contexts || {}))).length
      ? Object.assign({}, ...ordered.map((part) => part.state.unit_contexts || {}))
      : undefined,
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
    unit_contexts: ownedSelections(view.unit_contexts || {}, ref, (entry) => entry.split(":", 1)[0]),
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
  return existsSync(join(projectRoot, "docs/aidlc/ideation/module-manifest.json")) ? readModuleManifest(projectRoot) : [];
}

/**
 * Versioned input scope, independent of storage layout. Unclassified inputs are
 * conservative; only declared private ownership permits source exclusion. Real
 * shared contracts and transitive unit dependencies override private exclusions.
 *
 * Module-axis (planning) instances record the `:baseline` scope: their inputs are
 * the planning documents, declared contracts and every unit's shared paths, while
 * the module's own source roots and construction tree — the downstream
 * implementation those stages only plan for — cannot invalidate them (4.22.13,
 * MARS-277). `legacyEvidenceScopeForInstance` reproduces the pre-baseline wide
 * module scope, used only to re-check evidence recorded under that label.
 */
export function evidenceScopeForInstance(projectRoot: string, instanceId: string): DigestScope {
  return moduleEvidenceScope(projectRoot, instanceId, false);
}

/** The pre-4.22.13 wide module scope, kept for validating evidence recorded under it. */
export function legacyEvidenceScopeForInstance(projectRoot: string, instanceId: string): DigestScope {
  return moduleEvidenceScope(projectRoot, instanceId, true);
}

function moduleEvidenceScope(projectRoot: string, instanceId: string, legacy: boolean): DigestScope {
  const owner = ownerOfInstance(instanceId);
  const modules = manifestModules(projectRoot);
  if (owner.kind === "module") {
    const own = modules.find(module => module.module_id === owner.module_id);
    const otherPaths = modules.filter((module) => module.module_id !== owner.module_id).flatMap((module) => module.paths || []);
    const unitId = /@unit:([a-z0-9][a-z0-9-]*)$/.exec(instanceId)?.[1];
    const unitManifest = join(projectRoot, "docs/aidlc/modules", owner.module_id, "inception/unit-manifest.json");
    const units = unitId && existsSync(unitManifest) ? readUnitManifest(projectRoot, owner.module_id) : [];
    if (units.length && !units.some(unit => unit.unit_id === unitId)) throw new Error(`unknown evidence input unit ${unitId}`);
    const relevant = new Set<string>(unitId ? [unitId] : []);
    const visit = (id: string): void => {
      for (const dep of units.find(unit => unit.unit_id === id)?.evidence_inputs?.depends_on_units || []) {
        if (!relevant.has(dep)) { relevant.add(dep); visit(dep); }
      }
    };
    if (unitId) visit(unitId);
    // Only explicit, disjoint unit ownership can narrow source/tests. Unknown
    // files, root lockfiles and shared inputs remain bound by default.
    for (const unit of units) for (const p of unit.evidence_inputs?.paths || []) {
      if (!underAny(p, own?.paths || [])) throw new Error(`unit evidence path ${p} is outside its module roots`);
      for (const sibling of units.filter(row => row.unit_id !== unit.unit_id)) for (const q of sibling.evidence_inputs?.paths || []) {
        if (underAny(p, [q]) || underAny(q, [p])) throw new Error(`overlapping unit evidence paths: ${p}, ${q}`);
      }
    }
    const privateUnits = units.filter(unit => !relevant.has(unit.unit_id));
    const narrowSources = Boolean(unitId && units.length && units.every(unit => unit.evidence_inputs));
    const privateSource = narrowSources ? privateUnits.flatMap(unit => unit.evidence_inputs!.paths) : [];
    // A module-axis baseline binds every unit's shared paths: with no unit bound to
    // the instance, any declared shared input is a real dependency of the plan.
    const baseline = !legacy && !unitId;
    const sharedPaths = [...(own?.contract_paths || []), ...units.filter(unit => baseline || relevant.has(unit.unit_id)).flatMap(unit => unit.evidence_inputs?.shared_paths || [])];
    return {
      label: `inputs-v2:module:${owner.module_id}${unitId ? `:unit:${unitId}` : ""}${baseline ? ":baseline" : ""}`,
      projectedInputs: {
        ...(modules.length ? { "docs/aidlc/ideation/module-manifest.json": JSON.stringify({ version: 1, module: own,
          ownership: modules.map(module => ({ module_id: module.module_id, paths: module.paths || [], contract_paths: module.contract_paths || [] })),
        }) } : {}),
        ...(units.length ? { [`docs/aidlc/modules/${owner.module_id}/inception/unit-manifest.json`]: JSON.stringify({
        version: 1,
        units: narrowSources ? units.filter(unit => relevant.has(unit.unit_id)) : units,
        // Ownership controls exclusions even when sibling business metadata is irrelevant.
        ownership: units.map(unit => ({ unit_id: unit.unit_id, paths: unit.evidence_inputs?.paths || [] })),
        }) } : {}),
      },
      exclude: (path) => {
        if (underAny(path, sharedPaths)) return false;
        if (narrowSources && privateUnits.some(unit => path.startsWith(`docs/aidlc/modules/${owner.module_id}/construction/${unit.unit_id}/`))) return true;
        if (path.startsWith("docs/aidlc/modules/")) return path.split("/")[3] !== owner.module_id;
        // The planning baseline stops at what planning actually consumed: the module's
        // own source roots and construction tree are downstream implementation output.
        // Integration roots, other modules and their sources stay excluded as before.
        if (baseline) return path.startsWith(`docs/aidlc/modules/${owner.module_id}/construction/`) || underAny(path, own?.paths || [])
          || underAny(path, INTEGRATION_ROOTS) || underAny(path, otherPaths);
        return underAny(path, INTEGRATION_ROOTS) || (underAny(path, otherPaths) && !underAny(path, own?.paths || [])) || underAny(path, privateSource);
      },
    };
  }
  if (owner.kind === "global" && isSplitLayout(projectRoot)) {
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
