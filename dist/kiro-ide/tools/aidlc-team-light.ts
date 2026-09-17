import { readModuleManifest, readUnitManifest } from "./aidlc-execution-context";
import { loadWorkflowState, saveWorkflowState, type TeamLightUnitSelection } from "./aidlc-light-state";

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function selectionKey(moduleId: string, unitId: string): string {
  return `${moduleId}:${unitId}`;
}

export function listUnits(projectRoot = process.cwd()): Array<Record<string, unknown>> {
  const state = loadWorkflowState(projectRoot);
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

export function selectUnit(projectRoot: string, moduleId: string, unitId: string, member: string, branch?: string, note?: string, replace = false): TeamLightUnitSelection {
  const state = loadWorkflowState(projectRoot);
  if (!state) throw new Error("no active AWS-style lightweight workflow");
  if (!readModuleManifest(projectRoot).some((module) => module.module_id === moduleId)) throw new Error(`unknown module: ${moduleId}`);
  if (!readUnitManifest(projectRoot, moduleId).some((unit) => unit.unit_id === unitId)) throw new Error(`unknown unit ${unitId} in module ${moduleId}`);
  const key = selectionKey(moduleId, unitId);
  const existing = (state.unit_selections || {})[key];
  if (existing && existing.member !== member && !replace) throw new Error(`unit ${key} is already selected by ${existing.member}; coordinate with the team or use --replace`);
  const selection: TeamLightUnitSelection = {
    member: text(member, "--member"),
    selected_at: new Date().toISOString(),
    ...(branch ? { branch: text(branch, "--branch") } : {}),
    ...(note ? { note: text(note, "--note") } : {}),
  };
  state.unit_selections = { ...(state.unit_selections || {}), [key]: selection };
  saveWorkflowState(projectRoot, state);
  return selection;
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new Error(`unexpected unit argument: ${arg}`);
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
  throw new Error("usage: loeyae-aidlc unit <list|select> [flags]");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(); } catch (error) { console.error(`Team-light unit command blocked: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; }
}
