import { randomUUID } from "crypto";
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

export interface HistoryEntry {
  stage: string;
  result: string;
  timestamp: string;
  instance_id?: string;
  module_id?: string;
  unit_id?: string;
  user_input?: string;
}

export interface TeamLightUnitSelection {
  member: string;
  selected_at: string;
  branch?: string;
  note?: string;
}

export interface TeamLightModuleSelection {
  owner: string;
  selected_at: string;
  branch?: string;
  worktree?: string;
  note?: string;
}

export interface TeamLightActiveInstance {
  module_id: string;
  stage_instance: string;
  owner: string;
  branch?: string;
  worktree?: string;
  claimed_at: string;
  heartbeat_at: string;
  expires_at: string;
}

export interface WorkflowState {
  format: "markdown-workflow";
  version: string;
  workflow_id: string;
  work_description: string;
  revision: number;
  scope: string;
  depth: string;
  current_phase: string;
  current_stage: string;
  current_stage_instance?: string;
  current_module?: string;
  current_unit?: string;
  status: "running" | "parked" | "done";
  completed_stages: string[];
  skipped_stages: string[];
  completed_stage_instances: string[];
  skipped_stage_instances: string[];
  selected_optional_stages: string[];
  history: HistoryEntry[];
  unit_selections: Record<string, TeamLightUnitSelection>;
  module_selections: Record<string, TeamLightModuleSelection>;
  active_instances: Record<string, TeamLightActiveInstance>;
  created_at: string;
  updated_at: string;
}

const SCOPES = new Set(["feature", "enterprise", "mvp", "classic", "express", "workshop", "bugfix", "refactor", "poc"]);
const PRD_SCOPES = new Set(["feature", "enterprise", "mvp", "classic"]);
const LOCK_WAIT_MS = 3_000;
const LOCK_STALE_MS = 30_000;

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function clean(value: string): string {
  return value.replace(/[\r\n|]/g, " ").trim();
}

function iso(value: string, field: string): string {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
  return value;
}

function unique(values: string[], field: string): string[] {
  if (new Set(values).size !== values.length) throw new Error(`${field} contains duplicates`);
  return values;
}

function scalar(markdown: string, label: string, required = true): string {
  const match = new RegExp(`^- ${label}:\\s*(.*)$`, "m").exec(markdown);
  if (!match) {
    if (required) throw new Error(`workflow state is missing ${label}`);
    return "";
  }
  const value = match[1].replace(/^`|`$/g, "").trim();
  return required ? text(value, label) : value;
}

function section(markdown: string, title: string): string {
  const marker = `## ${title}`;
  const start = markdown.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = markdown.indexOf("\n", start) + 1;
  const next = markdown.indexOf("\n## ", bodyStart);
  return markdown.slice(bodyStart, next < 0 ? markdown.length : next).trim();
}

function list(markdown: string, title: string): string[] {
  const content = section(markdown, title);
  if (!content || content === "- (none)") return [];
  return unique(content.split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean), title);
}

function table(markdown: string, title: string): string[][] {
  const content = section(markdown, title);
  return content.split("\n")
    .filter((line) => line.startsWith("|") && !line.includes("---"))
    .slice(1)
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== "-"));
}

function parseHistory(markdown: string): HistoryEntry[] {
  return table(markdown, "History").map((cells, index) => {
    if (cells.length !== 7) throw new Error(`History row ${index + 1} is malformed`);
    const entry: HistoryEntry = { stage: text(cells[0], "history stage"), result: text(cells[4], "history result"), timestamp: iso(cells[5], "history timestamp") };
    if (cells[1] !== "-") entry.instance_id = text(cells[1], "history instance");
    if (cells[2] !== "-") entry.module_id = text(cells[2], "history module");
    if (cells[3] !== "-") entry.unit_id = text(cells[3], "history unit");
    if (cells[6] !== "-") entry.user_input = clean(cells[6]);
    return entry;
  });
}

function parseSelections(markdown: string): Record<string, TeamLightUnitSelection> {
  const result: Record<string, TeamLightUnitSelection> = {};
  for (const [index, cells] of table(markdown, "Unit Selections").entries()) {
    if (cells.length !== 5) throw new Error(`Unit Selections row ${index + 1} is malformed`);
    const key = text(cells[0], "unit selection key");
    if (result[key]) throw new Error(`duplicate unit selection: ${key}`);
    result[key] = {
      member: text(cells[1], "unit selection member"),
      selected_at: iso(cells[2], "unit selection timestamp"),
      ...(cells[3] !== "-" ? { branch: clean(cells[3]) } : {}),
      ...(cells[4] !== "-" ? { note: clean(cells[4]) } : {}),
    };
  }
  return result;
}

function parseModuleSelections(markdown: string): Record<string, TeamLightModuleSelection> {
  const result: Record<string, TeamLightModuleSelection> = {};
  for (const [index, cells] of table(markdown, "Module Selections").entries()) {
    if (cells.length !== 6) throw new Error(`Module Selections row ${index + 1} is malformed`);
    const key = text(cells[0], "module selection key");
    if (result[key]) throw new Error(`duplicate module selection: ${key}`);
    result[key] = {
      owner: text(cells[1], "module selection owner"),
      selected_at: iso(cells[2], "module selection timestamp"),
      ...(cells[3] !== "-" ? { branch: clean(cells[3]) } : {}),
      ...(cells[4] !== "-" ? { worktree: clean(cells[4]) } : {}),
      ...(cells[5] !== "-" ? { note: clean(cells[5]) } : {}),
    };
  }
  return result;
}

function parseActiveInstances(markdown: string): Record<string, TeamLightActiveInstance> {
  const result: Record<string, TeamLightActiveInstance> = {};
  for (const [index, cells] of table(markdown, "Active Instances").entries()) {
    if (cells.length !== 8) throw new Error(`Active Instances row ${index + 1} is malformed`);
    const key = text(cells[0], "active instance key");
    if (result[key]) throw new Error(`duplicate active instance: ${key}`);
    result[key] = {
      stage_instance: key,
      module_id: text(cells[1], "active module"),
      owner: text(cells[2], "active owner"),
      ...(cells[3] !== "-" ? { branch: clean(cells[3]) } : {}),
      ...(cells[4] !== "-" ? { worktree: clean(cells[4]) } : {}),
      claimed_at: iso(cells[5], "active claimed_at"),
      heartbeat_at: iso(cells[6], "active heartbeat_at"),
      expires_at: iso(cells[7], "active expires_at"),
    };
  }
  return result;
}


export function lightStatePath(projectRoot: string): string {
  return resolve(projectRoot, "aidlc", "active", "aidlc-state.md");
}

export function lightAuditPath(projectRoot: string): string {
  return resolve(projectRoot, "aidlc", "active", "audit.md");
}

export function createInitialState(scope: string, version = "4.2.1", workflowId = randomUUID(), selectedOptionalStages: string[] = [], workDescription = ""): WorkflowState {
  if (!SCOPES.has(scope)) throw new Error(`invalid workflow scope: ${scope}`);
  if (selectedOptionalStages.some((stage) => stage !== "prd-generation") || (selectedOptionalStages.length > 0 && !PRD_SCOPES.has(scope))) {
    throw new Error("invalid selected optional stage for scope");
  }
  const now = new Date().toISOString();
  return {
    format: "markdown-workflow",
    version,
    workflow_id: text(workflowId, "workflow ID"),
    work_description: text(workDescription, "work description"),
    revision: 0,
    scope,
    depth: "standard",
    current_phase: "ideation",
    current_stage: "",
    status: "running",
    completed_stages: [],
    skipped_stages: [],
    completed_stage_instances: [],
    skipped_stage_instances: [],
    selected_optional_stages: [...selectedOptionalStages],
    history: [],
    unit_selections: {},
    module_selections: {},
    active_instances: {},
    created_at: now,
    updated_at: now,
  };
}

export function parseLightWorkflowState(markdown: string): WorkflowState {
  if (!markdown.startsWith("# AI-DLC Lightweight Workflow\n")) throw new Error("state is not an AWS-style lightweight workflow Markdown document");
  const scope = scalar(markdown, "Scope");
  if (!SCOPES.has(scope)) throw new Error(`invalid lightweight scope: ${scope}`);
  const status = scalar(markdown, "Status") as WorkflowState["status"];
  if (!(["running", "parked", "done"] as string[]).includes(status)) throw new Error(`invalid lightweight status: ${status}`);
  const revision = Number(scalar(markdown, "Revision"));
  if (!Number.isInteger(revision) || revision < 0) throw new Error("Revision must be a non-negative integer");
  const currentStage = scalar(markdown, "Current Stage", false);
  const currentInstance = scalar(markdown, "Current Instance", false);
  const currentModule = scalar(markdown, "Current Module", false);
  const currentUnit = scalar(markdown, "Current Unit", false);
  const optional = list(markdown, "Selected Optional Stages");
  if (optional.some((stage) => stage !== "prd-generation")) throw new Error("unsupported selected optional stage");
  return {
    format: "markdown-workflow",
    version: scalar(markdown, "Engine Version"),
    workflow_id: scalar(markdown, "Workflow ID"),
    work_description: scalar(markdown, "Work"),
    revision,
    scope,
    depth: scalar(markdown, "Depth"),
    current_phase: scalar(markdown, "Current Phase"),
    current_stage: currentStage === "-" ? "" : currentStage,
    ...(currentInstance && currentInstance !== "-" ? { current_stage_instance: currentInstance } : {}),
    ...(currentModule && currentModule !== "-" ? { current_module: currentModule } : {}),
    ...(currentUnit && currentUnit !== "-" ? { current_unit: currentUnit } : {}),
    status,
    completed_stages: list(markdown, "Completed Stages"),
    skipped_stages: list(markdown, "Skipped Stages"),
    completed_stage_instances: list(markdown, "Completed Stage Instances"),
    skipped_stage_instances: list(markdown, "Skipped Stage Instances"),
    selected_optional_stages: optional,
    history: parseHistory(markdown),
    unit_selections: parseSelections(markdown),
    module_selections: parseModuleSelections(markdown),
    active_instances: parseActiveInstances(markdown),
    created_at: iso(scalar(markdown, "Created At"), "Created At"),
    updated_at: iso(scalar(markdown, "Updated At"), "Updated At"),
  };
}

function bullet(values: string[]): string {
  return values.length ? values.map((value) => `- ${clean(value)}`).join("\n") : "- (none)";
}

function cell(value: string | undefined): string {
  return value ? clean(value) : "-";
}

export function renderLightWorkflowState(state: WorkflowState): string {
  return `# AI-DLC Lightweight Workflow

> AWS-style lightweight collaboration controlled by this Markdown state and its audit log.

- Workflow ID: ${clean(state.workflow_id)}
- Work: ${clean(state.work_description)}
- Scope: ${clean(state.scope)}
- Status: ${state.status}
- Revision: ${state.revision}
- Engine Version: ${clean(state.version)}
- Depth: ${clean(state.depth)}
- Current Phase: ${clean(state.current_phase)}
- Current Stage: ${cell(state.current_stage)}
- Current Instance: ${cell(state.current_stage_instance)}
- Current Module: ${cell(state.current_module)}
- Current Unit: ${cell(state.current_unit)}
- Created At: ${state.created_at}
- Updated At: ${state.updated_at}

## Selected Optional Stages
${bullet(state.selected_optional_stages)}

## Completed Stages
${bullet(state.completed_stages)}

## Skipped Stages
${bullet(state.skipped_stages)}

## Completed Stage Instances
${bullet(state.completed_stage_instances)}

## Skipped Stage Instances
${bullet(state.skipped_stage_instances)}

## Unit Selections
| Unit | Member | Selected At | Branch | Note |
| --- | --- | --- | --- | --- |
${Object.entries(state.unit_selections).sort(([left], [right]) => left.localeCompare(right)).map(([unit, selection]) => `| ${cell(unit)} | ${cell(selection.member)} | ${selection.selected_at} | ${cell(selection.branch)} | ${cell(selection.note)} |`).join("\n") || "| - | - | - | - | - |"}

## Module Selections
| Module | Owner | Selected At | Branch | Worktree | Note |
| --- | --- | --- | --- | --- | --- |
${Object.entries(state.module_selections || {}).sort(([left], [right]) => left.localeCompare(right)).map(([module, selection]) => `| ${cell(module)} | ${cell(selection.owner)} | ${selection.selected_at} | ${cell(selection.branch)} | ${cell(selection.worktree)} | ${cell(selection.note)} |`).join("\n") || "| - | - | - | - | - | - |"}

## Active Instances
| Stage Instance | Module | Owner | Branch | Worktree | Claimed At | Heartbeat At | Expires At |
| --- | --- | --- | --- | --- | --- | --- | --- |
${Object.entries(state.active_instances || {}).sort(([left], [right]) => left.localeCompare(right)).map(([instance, claim]) => `| ${cell(instance)} | ${cell(claim.module_id)} | ${cell(claim.owner)} | ${cell(claim.branch)} | ${cell(claim.worktree)} | ${claim.claimed_at} | ${claim.heartbeat_at} | ${claim.expires_at} |`).join("\n") || "| - | - | - | - | - | - | - | - |"}

## History
| Stage | Instance | Module | Unit | Result | Timestamp | Input |
| --- | --- | --- | --- | --- | --- | --- |
${state.history.map((entry) => `| ${cell(entry.stage)} | ${cell(entry.instance_id)} | ${cell(entry.module_id)} | ${cell(entry.unit_id)} | ${cell(entry.result)} | ${entry.timestamp} | ${cell(entry.user_input)} |`).join("\n") || "| - | - | - | - | - | - | - |"}
`;
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
      if (Date.now() - started > LOCK_WAIT_MS) throw new Error(`timed out waiting for workflow lock: ${path}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

function appendAudit(projectRoot: string, state: WorkflowState): void {
  const path = lightAuditPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, `## ${new Date().toISOString()}\n- Event: STATE_UPDATED\n- Revision: ${state.revision}\n- Work: ${clean(state.work_description)}\n- Current Instance: ${cell(state.current_stage_instance)}\n- Active Instances: ${Object.keys(state.active_instances || {}).sort().join(", ") || "-"}\n- Instance Owners: ${Object.values(state.active_instances || {}).map((claim) => `${claim.stage_instance}=${claim.owner}`).sort().join(", ") || "-"}\n- Status: ${state.status}\n\n`, "utf8");
}

export function loadWorkflowState(projectRoot: string): WorkflowState | null {
  const path = lightStatePath(projectRoot);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`workflow state must be a regular non-symlink file: ${path}`);
  return parseLightWorkflowState(readFileSync(path, "utf8"));
}

export function saveWorkflowState(projectRoot: string, state: WorkflowState): void {
  const path = lightStatePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lock = acquireLock(`${path}.lock`);
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    const existing = loadWorkflowState(projectRoot);
    if (existing && existing.revision !== state.revision) throw new Error(`workflow state revision conflict: expected ${state.revision}, found ${existing.revision}`);
    if (!existing && state.revision !== 0) throw new Error(`workflow state is missing at revision ${state.revision}`);
    const next = { ...state, revision: state.revision + 1, updated_at: new Date().toISOString() };
    appendAudit(projectRoot, next);
    writeFileSync(temporary, renderLightWorkflowState(next), { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
    Object.assign(state, next);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    closeSync(lock);
    if (existsSync(`${path}.lock`)) unlinkSync(`${path}.lock`);
  }
}

export function updateWorkflowState(projectRoot: string, mutate: (state: WorkflowState) => void, retries = 3): WorkflowState {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    const state = loadWorkflowState(projectRoot);
    if (!state) throw new Error("no active AWS-style lightweight workflow");
    try {
      mutate(state);
      saveWorkflowState(projectRoot, state);
      return state;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.startsWith("workflow state revision conflict")) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("workflow state update failed after retries");
}

export function migrateSingleInstanceState(projectRoot: string, owner = "legacy-single-instance"): WorkflowState {
  const state = loadWorkflowState(projectRoot);
  if (!state) throw new Error("no active AWS-style lightweight workflow");
  if (!state.current_stage_instance || !state.current_module || state.active_instances[state.current_stage_instance]) return state;
  const now = new Date().toISOString();
  state.active_instances[state.current_stage_instance] = {
    module_id: state.current_module,
    stage_instance: state.current_stage_instance,
    owner: text(owner, "owner"),
    claimed_at: state.updated_at || now,
    heartbeat_at: now,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
  saveWorkflowState(projectRoot, state);
  return state;
}
