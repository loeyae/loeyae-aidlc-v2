import { readModuleManifest, readUnitManifest } from "./aidlc-execution-context";
import {
  GLOBAL_WORKFLOW,
  migrateSingleInstanceState,
  releaseExpiredModuleClaims,
  updateWorkflowState,
  type TeamLightActiveInstance,
  type TeamLightModuleSelection,
  type TeamLightUnitSelection,
  type WorkflowRef,
  type WorkflowState,
} from "./aidlc-light-state";
import { isSplitLayout, loadRegistry, loadWorkflowView, ownerOfInstance, updateRegistry } from "./aidlc-workflow-layout";
import { resolve } from "path";
import { fileURLToPath } from "url";

export { releaseExpiredModuleClaims };

const CLAIM_TTL_MS = 30 * 60 * 1000;

/**
 * Where team coordination for a module is written: the single workflow, or in the split
 * layout that module's own workflow (its registry identity row must exist).
 */
function moduleWorkflowRef(projectRoot: string, moduleId: string): WorkflowRef {
  if (!isSplitLayout(projectRoot)) return GLOBAL_WORKFLOW;
  if (!loadRegistry(projectRoot)?.modules.some((row) => row.module_id === moduleId)) {
    throw new Error(`module ${moduleId} has no workflow yet; start it with orchestrate next --module ${moduleId}`);
  }
  return { kind: "module", module_id: moduleId };
}

function updateModuleWorkflow(projectRoot: string, moduleId: string, mutate: (state: WorkflowState) => void): WorkflowState {
  return updateWorkflowState(projectRoot, mutate, 3, moduleWorkflowRef(projectRoot, moduleId));
}

function projectRegistryOwner(projectRoot: string, moduleId: string, owner: string): void {
  if (!isSplitLayout(projectRoot)) return;
  updateRegistry(projectRoot, (current) => ({
    ...current!,
    modules: current!.modules.map((row) => row.module_id === moduleId ? { ...row, owner } : row),
  }));
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function selectionKey(moduleId: string, unitId: string): string {
  return `${moduleId}:${unitId}`;
}

function moduleClaimInstance(moduleId: string, instance: string): boolean {
  return new RegExp(`^[a-z0-9][a-z0-9-]*@module:${moduleId}$`).test(instance);
}

export function listUnits(projectRoot = process.cwd()): Array<Record<string, unknown>> {
  const state = loadWorkflowView(projectRoot);
  if (!state) throw new Error("no active AWS-style lightweight workflow");
  return readModuleManifest(projectRoot).flatMap((module) =>
    readUnitManifest(projectRoot, module.module_id).map((unit) => ({
      module_id: module.module_id,
      unit_id: unit.unit_id,
      name: unit.name,
      service_id: unit.service_id,
      selection: (state.unit_selections || {})[selectionKey(module.module_id, unit.unit_id)] || null,
    })),
  );
}

export function listModules(projectRoot = process.cwd()): Array<Record<string, unknown>> {
  const state = loadWorkflowView(projectRoot);
  if (!state) throw new Error("no active AWS-style lightweight workflow");
  const active = Object.values(state.active_instances || {});
  const registry = isSplitLayout(projectRoot) ? loadRegistry(projectRoot) : null;
  return readModuleManifest(projectRoot).map((module) => {
    const row = registry?.modules.find((candidate) => candidate.module_id === module.module_id);
    return {
      module_id: module.module_id,
      name: module.name,
      service_id: module.service_id,
      selection: (state.module_selections || {})[module.module_id] || null,
      active_instances: active.filter((claim) => claim.module_id === module.module_id),
      ...(registry ? { workflow: row ? { workflow_id: row.workflow_id, state_path: row.state_path, status: row.status, current_stage: row.current_stage } : null } : {}),
    };
  });
}

export function selectUnit(projectRoot: string, moduleId: string, unitId: string, member: string, branch?: string, note?: string, replace = false): TeamLightUnitSelection {
  if (!readModuleManifest(projectRoot).some((module) => module.module_id === moduleId)) throw new Error(`unknown module: ${moduleId}`);
  if (!readUnitManifest(projectRoot, moduleId).some((unit) => unit.unit_id === unitId)) throw new Error(`unknown unit ${unitId} in module ${moduleId}`);
  const key = selectionKey(moduleId, unitId);
  const selection: TeamLightUnitSelection = {
    member: text(member, "--member"),
    selected_at: new Date().toISOString(),
    ...(branch ? { branch: text(branch, "--branch") } : {}),
    ...(note ? { note: text(note, "--note") } : {}),
  };
  let result: TeamLightUnitSelection | undefined;
  updateModuleWorkflow(projectRoot, moduleId, (state) => {
    const existing = (state.unit_selections || {})[key];
    if (existing && existing.member !== selection.member && !replace) throw new Error(`unit ${key} is already selected by ${existing.member}; coordinate with the team or use --replace`);
    state.unit_selections = { ...(state.unit_selections || {}), [key]: selection };
    result = selection;
  });
  return result as TeamLightUnitSelection;
}

export function selectModule(projectRoot: string, moduleId: string, owner: string, branch?: string, worktree?: string, note?: string, replace = false): TeamLightModuleSelection {
  if (!readModuleManifest(projectRoot).some((module) => module.module_id === moduleId)) throw new Error(`unknown module: ${moduleId}`);
  const selection: TeamLightModuleSelection = {
    owner: text(owner, "--owner"),
    selected_at: new Date().toISOString(),
    ...(branch ? { branch: text(branch, "--branch") } : {}),
    ...(worktree ? { worktree: text(worktree, "--worktree") } : {}),
    ...(note ? { note: text(note, "--note") } : {}),
  };
  let result: TeamLightModuleSelection | undefined;
  updateModuleWorkflow(projectRoot, moduleId, (state) => {
    const existing = (state.module_selections || {})[moduleId];
    if (existing && existing.owner !== selection.owner && !replace) throw new Error(`module ${moduleId} is already selected by ${existing.owner}; coordinate with the team or use --replace`);
    state.module_selections = { ...(state.module_selections || {}), [moduleId]: selection };
    result = selection;
  });
  projectRegistryOwner(projectRoot, moduleId, selection.owner);
  return result as TeamLightModuleSelection;
}

export function claimModule(projectRoot: string, moduleId: string, owner: string, stageInstance: string, branch?: string, worktree?: string): TeamLightActiveInstance {
  if (!readModuleManifest(projectRoot).some((module) => module.module_id === moduleId)) throw new Error(`unknown module: ${moduleId}`);
  const instance = text(stageInstance, "--stage-instance");
  if (!moduleClaimInstance(moduleId, instance)) throw new Error(`module claim requires a module stage instance for ${moduleId}: ${instance}`);
  const selectedOwner = text(owner, "--owner");
  let result: TeamLightActiveInstance | undefined;
  updateModuleWorkflow(projectRoot, moduleId, (state) => {
    releaseExpiredModuleClaims(state);
    const existing = state.active_instances[instance];
    if (existing) {
      if (existing.owner === selectedOwner) {
        result = existing;
        return;
      }
      throw new Error(`stage instance ${instance} is already claimed by ${existing.owner} until ${existing.expires_at}`);
    }
    const selection = state.module_selections?.[moduleId];
    const now = new Date();
    const claim: TeamLightActiveInstance = {
      module_id: moduleId,
      stage_instance: instance,
      owner: selectedOwner,
      ...(branch || selection?.branch ? { branch: text(branch || selection?.branch, "branch") } : {}),
      ...(worktree || selection?.worktree ? { worktree: text(worktree || selection?.worktree, "worktree") } : {}),
      claimed_at: now.toISOString(),
      heartbeat_at: now.toISOString(),
      expires_at: new Date(now.getTime() + CLAIM_TTL_MS).toISOString(),
    };
    state.active_instances[instance] = claim;
    if (!selection || selection.owner !== selectedOwner) {
      state.module_selections = {
        ...(state.module_selections || {}),
        [moduleId]: {
          owner: selectedOwner,
          selected_at: now.toISOString(),
          ...(claim.branch ? { branch: claim.branch } : {}),
          ...(claim.worktree ? { worktree: claim.worktree } : {}),
        },
      };
    }
    result = claim;
  });
  projectRegistryOwner(projectRoot, moduleId, selectedOwner);
  return result as TeamLightActiveInstance;
}

export function heartbeatModule(projectRoot: string, stageInstance: string, owner: string): TeamLightActiveInstance {
  const expectedOwner = text(owner, "--owner");
  const instanceOwner = ownerOfInstance(stageInstance);
  const ref = isSplitLayout(projectRoot) && instanceOwner.kind === "module" ? moduleWorkflowRef(projectRoot, instanceOwner.module_id) : GLOBAL_WORKFLOW;
  let result: TeamLightActiveInstance | undefined;
  updateWorkflowState(projectRoot, (state) => {
    releaseExpiredModuleClaims(state);
    const claim = state.active_instances[stageInstance];
    if (!claim) throw new Error(`stage instance ${stageInstance} is not actively claimed`);
    if (claim.owner !== expectedOwner) throw new Error(`stage instance ${stageInstance} is claimed by ${claim.owner}, not ${expectedOwner}`);
    const now = new Date();
    claim.heartbeat_at = now.toISOString();
    claim.expires_at = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();
    result = claim;
  }, 3, ref);
  return result as TeamLightActiveInstance;
}

/**
 * Legacy single-instance migration. In the split layout it acts on one module workflow:
 * the module's current instance becomes an active claim of the given owner.
 */
export function migrateModuleOwnership(projectRoot: string, owner: string, moduleId?: string): WorkflowState {
  if (!isSplitLayout(projectRoot)) return migrateSingleInstanceState(projectRoot, owner);
  if (!moduleId) throw new Error("split workflow layout: module migrate requires --module <module-id>");
  const ref = moduleWorkflowRef(projectRoot, moduleId);
  const state = migrateSingleInstanceState(projectRoot, owner, ref);
  const migrated = updateWorkflowState(projectRoot, (current) => {
    const existing = current.module_selections?.[moduleId];
    if (existing?.owner === owner) return;
    current.module_selections = { ...(current.module_selections || {}), [moduleId]: { ...(existing || {}), owner, selected_at: new Date().toISOString() } };
  }, 3, ref);
  projectRegistryOwner(projectRoot, moduleId, owner);
  return migrated || state;
}

function main(): void {
  const raw = process.argv.slice(2);
  const command = raw[0];
  const moduleCommand = command === "module" ? raw[1] : undefined;
  const args = command === "module" ? raw.slice(2) : raw.slice(1);
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new Error(`unexpected team argument: ${arg}`);
    if (arg === "--replace") { flags.replace = "true"; continue; }
    const value = args[++index];
    if (!value) throw new Error(`${arg} requires a value`);
    flags[arg.slice(2)] = value;
  }
  const project = flags.project || process.cwd();
  if (command === "list") {
    process.stdout.write(`${JSON.stringify({ units: listUnits(project) }, null, 2)}\n`);
    return;
  }
  if (command === "select") {
    const selection = selectUnit(project, text(flags.module, "--module"), text(flags.unit, "--unit"), text(flags.member, "--member"), flags.branch, flags.note, flags.replace === "true");
    process.stdout.write(`${JSON.stringify({ selection }, null, 2)}\n`);
    return;
  }
  if (command === "module") {
    if (moduleCommand === "list") {
      process.stdout.write(`${JSON.stringify({ modules: listModules(project) }, null, 2)}\n`);
      return;
    }
    if (moduleCommand === "select") {
      const selection = selectModule(project, text(flags.module, "--module"), text(flags.owner || flags.member, "--owner"), flags.branch, flags.worktree, flags.note, flags.replace === "true");
      process.stdout.write(`${JSON.stringify({ selection }, null, 2)}\n`);
      return;
    }
    if (moduleCommand === "claim") {
      const claim = claimModule(project, text(flags.module, "--module"), text(flags.owner || flags.member, "--owner"), text(flags["stage-instance"], "--stage-instance"), flags.branch, flags.worktree);
      process.stdout.write(`${JSON.stringify({ claim }, null, 2)}\n`);
      return;
    }
    if (moduleCommand === "heartbeat") {
      const claim = heartbeatModule(project, text(flags["stage-instance"], "--stage-instance"), text(flags.owner || flags.member, "--owner"));
      process.stdout.write(`${JSON.stringify({ claim }, null, 2)}\n`);
      return;
    }
    if (moduleCommand === "migrate") {
      const state = migrateModuleOwnership(project, flags.owner || flags.member || "legacy-single-instance", flags.module);
      process.stdout.write(`${JSON.stringify({ migrated: true, active_instances: state.active_instances }, null, 2)}\n`);
      return;
    }
    throw new Error("use module list/select/claim/heartbeat/migrate");
  }
  if (command === "module-select") {
    const selection = selectModule(project, text(flags.module, "--module"), text(flags.owner || flags.member, "--owner"), flags.branch, flags.worktree, flags.note, flags.replace === "true");
    process.stdout.write(`${JSON.stringify({ selection }, null, 2)}\n`);
    return;
  }
  if (command === "module-claim") {
    const claim = claimModule(project, text(flags.module, "--module"), text(flags.owner || flags.member, "--owner"), text(flags["stage-instance"], "--stage-instance"), flags.branch, flags.worktree);
    process.stdout.write(`${JSON.stringify({ claim }, null, 2)}\n`);
    return;
  }
  if (command === "module-heartbeat") {
    const claim = heartbeatModule(project, text(flags["stage-instance"], "--stage-instance"), text(flags.owner || flags.member, "--owner"));
    process.stdout.write(`${JSON.stringify({ claim }, null, 2)}\n`);
    return;
  }
  if (command === "module-migrate") {
    const state = migrateModuleOwnership(project, flags.owner || flags.member || "legacy-single-instance", flags.module);
    process.stdout.write(`${JSON.stringify({ migrated: true, active_instances: state.active_instances }, null, 2)}\n`);
    return;
  }
  throw new Error("usage: loeyae-aidlc unit <list|select> [flags] or module <list|select|claim|heartbeat|migrate> [flags]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Team-light command blocked: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; }
}
