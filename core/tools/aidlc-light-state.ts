import { randomUUID } from "crypto";
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { realpathSync } from "fs";
import { COMMIT_ID_PATTERN } from "./aidlc-revision";
import {
  assertExecutionProfile,
  type ExecutionProfile,
  type ExecutionProfileEvent,
} from "./aidlc-execution-profile";

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
  session_id?: string;
  generation?: string;
  handoff?: string;
  claimed_at: string;
  heartbeat_at: string;
  expires_at: string;
}

export const ENGINE_VERSION = "4.10.0";

export type WorkflowKind = "global" | "module" | "integration";

/** Document diagram format. Mermaid is the default; SVG is recorded only on the user's explicit request. */
export type DiagramFormat = "mermaid" | "svg";
export const DIAGRAM_FORMATS: readonly DiagramFormat[] = ["mermaid", "svg"];

/**
 * How the workflow baseline commit was recorded: automatically when `next --scope`
 * created the workflow, registered later with `orchestrate baseline --set`,
 * corrected with `orchestrate baseline --set --replace --expect`, or moved to a new
 * epoch of the baseline chain with `orchestrate baseline --advance` (4.7.0).
 */
export type BaselineSource = "created" | "registered" | "replaced" | "advanced";
export const BASELINE_SOURCES: readonly BaselineSource[] = ["created", "registered", "replaced", "advanced"];
/** Baseline commit value of a workflow created outside a git repository. */
export const BASELINE_UNAVAILABLE = "unavailable";

export type WorkflowRef = { kind: "global" } | { kind: "module"; module_id: string } | { kind: "integration" };

export const GLOBAL_WORKFLOW: WorkflowRef = { kind: "global" };

export function workflowRefKey(ref: WorkflowRef): string {
  return ref.kind === "module" ? `module:${ref.module_id}` : ref.kind;
}

export interface WorkflowState {
  format: "markdown-workflow";
  version: string;
  workflow_id: string;
  work_description: string;
  workflow_kind?: WorkflowKind;
  module_id?: string;
  parent_workflow_id?: string;
  diagram_format?: DiagramFormat;
  /** Global/single workflows only; both baseline fields are present or both absent. */
  baseline_commit?: string;
  baseline_source?: BaselineSource;
  /**
   * Append-only baseline chain (4.7.0): epoch 0 first, the current baseline last.
   * Present only once the baseline was advanced (Baseline Source `advanced`); absent
   * means the chain is the single epoch `[baseline_commit]`.
   */
  baseline_history?: string[];
  /**
   * 4.9.0: the current commit of every registered nested source repository, keyed by
   * its project-relative path (`- Baseline Repos: app=<sha>, web=<sha>`). Global/single
   * workflows only; absent for projects without registered nested repositories.
   */
  baseline_repos?: Record<string, string>;
  /**
   * 4.9.0: per nested repository, the epoch it was registered in (`start`) and its
   * commit in every epoch from `start` to the current one
   * (`- Baseline Repos History: app=@0:<sha>+<sha>`). Present exactly when both
   * Baseline History and Baseline Repos are.
   */
  baseline_repos_history?: Record<string, { start: number; commits: string[] }>;
  /**
   * 4.10.0 adoption baseline (`orchestrate baseline --adopt --module`): module
   * sub-workflows only. The commit the module's characterization UC-Ds and BASELINE
   * resolve against instead of the global baseline chain, for implementations that
   * already existed when the module was taken over by the workflow. Adoption Baseline,
   * Adoption Approval Ref and Adopted At are present together or absent together.
   */
  adoption_baseline?: string;
  /** 4.10.0: nested repository commits of the adoption baseline (`- Adoption Baseline Repos: app=<sha>`). */
  adoption_baseline_repos?: Record<string, string>;
  /** 4.10.0: the adoption chain once advanced with `--advance --module` (epoch 0 first, current last). */
  adoption_baseline_history?: string[];
  /** 4.10.0: per nested repository chain of an advanced adoption baseline (same format as Baseline Repos History). */
  adoption_baseline_repos_history?: Record<string, { start: number; commits: string[] }>;
  adoption_approval_ref?: string;
  adopted_at?: string;
  /**
   * 4.13.0 (MARS-98): global/single workflows only. Other workflow lineages (Workflow IDs)
   * found in git that the user explicitly retired (`orchestrate state retire`, or
   * `--replace-lineage` on split / next --scope); lineage checks ignore them.
   */
  retired_lineages?: string[];
  /**
   * MARS-161: execution classification for the global workflow lineage only.
   * It deliberately remains absent on legacy files until explicitly initialized.
   */
  execution_profile?: ExecutionProfile;
  quality_gates_version?: string;
  document_slices_version?: string;
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

const SCOPES = new Set(["feature", "enterprise", "mvp", "classic", "express", "workshop", "bugfix", "refactor"]);
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

export function markdownScalar(markdown: string, label: string, required = true): string {
  return scalar(markdown, label, required);
}

/** A scalar line that may be absent (undefined) or present with any value, including empty. */
function presentScalar(markdown: string, label: string): string | undefined {
  const match = new RegExp(`^- ${label}:[ \\t]*(.*)$`, "m").exec(markdown);
  return match ? match[1].replace(/^`|`$/g, "").trim() : undefined;
}

function subWorkflowBaselineError(kind: string): Error {
  return new Error(`${kind} sub-workflow state must not carry Baseline Commit / Baseline Source / Baseline History; the workflow baseline belongs to the global workflow`);
}

/**
 * Structural rules of the workflow baseline, shared by parsing and saving: both fields
 * or neither; the commit is a full lowercase hex id or "unavailable"; the source is
 * created / registered / replaced / advanced; module and integration sub-workflows
 * carry none. The baseline chain (4.7.0) exists exactly when the source is advanced:
 * at least two distinct full commit ids, the last one equal to Baseline Commit. Git
 * ancestry between epochs is checked when the chain is used, not here.
 */
export function assertBaselineFields(state: Pick<WorkflowState, "baseline_commit" | "baseline_source" | "workflow_kind" | "baseline_history"> & Partial<Pick<WorkflowState, "baseline_repos" | "baseline_repos_history">>): void {
  const hasCommit = state.baseline_commit !== undefined;
  const hasSource = state.baseline_source !== undefined;
  const hasHistory = state.baseline_history !== undefined;
  const hasRepos = state.baseline_repos !== undefined;
  const hasReposHistory = state.baseline_repos_history !== undefined;
  if (!hasCommit && !hasSource && !hasHistory && !hasRepos && !hasReposHistory) return;
  if ((state.workflow_kind === "module" || state.workflow_kind === "integration") && (hasRepos || hasReposHistory) && !hasCommit && !hasSource && !hasHistory) {
    throw subWorkflowReposError(state.workflow_kind);
  }
  if (state.workflow_kind === "module" || state.workflow_kind === "integration") throw subWorkflowBaselineError(state.workflow_kind);
  if (hasCommit !== hasSource) throw new Error("Baseline Commit and Baseline Source must both be present or both be absent");
  if (hasHistory && !hasCommit) throw new Error("Baseline History requires Baseline Commit and Baseline Source");
  if ((hasRepos || hasReposHistory) && !hasCommit) throw new Error("Baseline Repos / Baseline Repos History require Baseline Commit and Baseline Source");
  const commit = state.baseline_commit as string;
  if (commit !== BASELINE_UNAVAILABLE && !COMMIT_ID_PATTERN.test(commit)) {
    throw new Error(`Baseline Commit must be a 40- or 64-character lowercase hex commit id or "${BASELINE_UNAVAILABLE}", got ${JSON.stringify(commit)}`);
  }
  if (!(BASELINE_SOURCES as readonly string[]).includes(state.baseline_source as string)) {
    throw new Error(`Baseline Source must be one of ${BASELINE_SOURCES.join(", ")}, got ${JSON.stringify(state.baseline_source)}`);
  }
  if (hasRepos || hasReposHistory) assertBaselineRepoFields(state as BaselineRepoState);
  const advanced = state.baseline_source === "advanced";
  if (advanced && !hasHistory) throw new Error("Baseline Source advanced requires a Baseline History chain");
  if (!hasHistory) return;
  if (!advanced) throw new Error(`Baseline History is only valid with Baseline Source advanced, got ${JSON.stringify(state.baseline_source)}`);
  const chain = state.baseline_history as string[];
  if (!Array.isArray(chain) || chain.length < 2) throw new Error("Baseline History must list at least two epochs (epoch 0 and the advanced baseline)");
  for (const entry of chain) {
    if (typeof entry !== "string" || !COMMIT_ID_PATTERN.test(entry)) {
      throw new Error(`Baseline History entries must be 40- or 64-character lowercase hex commit ids, got ${JSON.stringify(entry)}`);
    }
  }
  if (!hasRepos) {
    if (new Set(chain).size !== chain.length) throw new Error("Baseline History contains duplicate commits");
  } else {
    // 4.9.0: an epoch may keep the workflow commit while a nested repository advances,
    // so an epoch is identified by the workflow commit together with its repo commits.
    const tuples = chain.map((entry, epoch) => [entry, ...Object.entries(baselineReposAtEpoch(state as BaselineRepoState, epoch)).map(([key, sha]) => `${key}=${sha}`)].join(";"));
    if (new Set(tuples).size !== tuples.length) throw new Error("Baseline History contains duplicate epochs (the same workflow commit with the same nested repository commits)");
  }
  if (chain[chain.length - 1] !== commit) {
    throw new Error(`the last Baseline History entry ${chain[chain.length - 1]} must equal Baseline Commit ${commit}`);
  }
}

type BaselineRepoState = Pick<WorkflowState, "baseline_commit" | "baseline_history" | "baseline_repos" | "baseline_repos_history">;

const REPO_KEY_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function subWorkflowReposError(kind: string): Error {
  return new Error(`${kind} sub-workflow state must not carry Baseline Repos / Baseline Repos History; the workflow baseline (nested repositories included) belongs to the global workflow`);
}

/**
 * 4.9.0 structural rules of the nested repository baseline: keys are nested repository
 * paths, values full lowercase hex commit ids; never with an unavailable workflow
 * commit. Baseline Repos History exists exactly when Baseline History and Baseline
 * Repos do; it has the same keys, each with a start epoch in [0, current] and one
 * commit per epoch from the start to the current epoch (no gaps), the last one equal to
 * Baseline Repos. Without Baseline History every repository starts at epoch 0.
 */
function assertBaselineRepoFields(state: BaselineRepoState): void {
  const repos = state.baseline_repos;
  const history = state.baseline_repos_history;
  if (state.baseline_commit === BASELINE_UNAVAILABLE) throw new Error(`Baseline Repos cannot be recorded with Baseline Commit ${BASELINE_UNAVAILABLE}`);
  if (history !== undefined && repos === undefined) throw new Error("Baseline Repos History requires Baseline Repos");
  if (!repos || typeof repos !== "object" || Object.keys(repos).length === 0) throw new Error("Baseline Repos must name at least one nested repository");
  for (const [key, sha] of Object.entries(repos)) {
    if (!REPO_KEY_PATTERN.test(key) || key === "." || key.split("/").some((segment) => segment === "." || segment === "..")) throw new Error(`Baseline Repos key ${JSON.stringify(key)} must be a nested repository path`);
    if (typeof sha !== "string" || !COMMIT_ID_PATTERN.test(sha)) throw new Error(`Baseline Repos ${key} must be a 40- or 64-character lowercase hex commit id, got ${JSON.stringify(sha)}`);
  }
  const hasHistory = state.baseline_history !== undefined;
  if (hasHistory !== (history !== undefined)) {
    throw new Error(hasHistory ? "Baseline History with Baseline Repos requires Baseline Repos History" : "Baseline Repos History is only valid together with Baseline History");
  }
  if (!history) return;
  const current = (state.baseline_history as string[]).length - 1;
  const keys = Object.keys(repos).sort();
  const historyKeys = Object.keys(history).sort();
  if (JSON.stringify(keys) !== JSON.stringify(historyKeys)) throw new Error(`Baseline Repos History keys (${historyKeys.join(", ")}) must equal the Baseline Repos keys (${keys.join(", ")})`);
  for (const key of keys) {
    const { start, commits } = history[key];
    if (!Number.isInteger(start) || start < 0 || start > current) throw new Error(`Baseline Repos History ${key} start epoch ${start} must be between 0 and the current epoch ${current}`);
    if (!Array.isArray(commits) || commits.length !== current - start + 1) {
      throw new Error(`Baseline Repos History ${key} must record one commit for every epoch from ${start} to ${current} (no gaps), got ${Array.isArray(commits) ? commits.length : 0}`);
    }
    for (const sha of commits) if (!COMMIT_ID_PATTERN.test(sha)) throw new Error(`Baseline Repos History ${key} entries must be 40- or 64-character lowercase hex commit ids, got ${JSON.stringify(sha)}`);
    if (commits[commits.length - 1] !== repos[key]) throw new Error(`the last Baseline Repos History entry of ${key} (${commits[commits.length - 1]}) must equal Baseline Repos ${key}=${repos[key]}`);
  }
}

/**
 * Per nested repository, its start epoch and commits (epoch `start` first). Without
 * Baseline Repos History every registered repository starts at epoch 0 with its
 * Baseline Repos commit (a never-advanced chain has the single epoch 0).
 */
export function baselineRepoChains(state: Partial<BaselineRepoState>): Record<string, { start: number; commits: string[] }> {
  if (state.baseline_repos_history) {
    return Object.fromEntries(Object.entries(state.baseline_repos_history).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, { start: value.start, commits: [...value.commits] }]));
  }
  return Object.fromEntries(Object.entries(state.baseline_repos || {}).sort(([left], [right]) => left.localeCompare(right)).map(([key, sha]) => [key, { start: 0, commits: [sha] }]));
}

/** Commits of the nested repositories registered at `epoch` (start epoch ≤ epoch), keyed and sorted. */
export function baselineReposAtEpoch(state: Partial<BaselineRepoState>, epoch: number): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, chain] of Object.entries(baselineRepoChains(state))) {
    if (epoch >= chain.start && epoch - chain.start < chain.commits.length) result[key] = chain.commits[epoch - chain.start];
  }
  return result;
}

/** `app=<sha>, web=<sha>` (keys sorted). */
export function renderBaselineRepos(repos: Record<string, string>): string {
  return Object.keys(repos).sort().map((key) => `${key}=${repos[key]}`).join(", ");
}

function parseBaselineRepos(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of text.split(",").map((value) => value.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");
    if (separator <= 0) throw new Error(`Baseline Repos entries must be <path>=<commit>, got ${JSON.stringify(entry)}`);
    const key = entry.slice(0, separator).trim();
    if (key in result) throw new Error(`Baseline Repos lists ${key} more than once`);
    result[key] = entry.slice(separator + 1).trim();
  }
  return result;
}

function renderBaselineReposHistory(history: Record<string, { start: number; commits: string[] }>): string {
  return Object.keys(history).sort().map((key) => `${key}=@${history[key].start}:${history[key].commits.join("+")}`).join(", ");
}

function parseBaselineReposHistory(text: string): Record<string, { start: number; commits: string[] }> {
  const result: Record<string, { start: number; commits: string[] }> = {};
  for (const entry of text.split(",").map((value) => value.trim()).filter(Boolean)) {
    const match = /^([^=\s]+)=@(\d+):(.+)$/.exec(entry);
    if (!match) throw new Error(`Baseline Repos History entries must be <path>=@<start epoch>:<commit>+<commit>…, got ${JSON.stringify(entry)}`);
    if (match[1] in result) throw new Error(`Baseline Repos History lists ${match[1]} more than once`);
    result[match[1]] = { start: Number(match[2]), commits: match[3].split("+").map((value) => value.trim()) };
  }
  return result;
}

type AdoptionState = Pick<WorkflowState, "workflow_kind" | "adoption_baseline" | "adoption_baseline_repos" | "adoption_baseline_history" | "adoption_baseline_repos_history" | "adoption_approval_ref" | "adopted_at">;

/** The adoption fields in the shape of the workflow baseline fields (chain helpers accept both). */
export function adoptionAsBaseline(state: Partial<AdoptionState>): Pick<WorkflowState, "baseline_commit" | "baseline_history" | "baseline_repos" | "baseline_repos_history"> {
  return {
    ...(state.adoption_baseline !== undefined ? { baseline_commit: state.adoption_baseline } : {}),
    ...(state.adoption_baseline_history !== undefined ? { baseline_history: [...state.adoption_baseline_history] } : {}),
    ...(state.adoption_baseline_repos !== undefined ? { baseline_repos: { ...state.adoption_baseline_repos } } : {}),
    ...(state.adoption_baseline_repos_history !== undefined ? { baseline_repos_history: state.adoption_baseline_repos_history } : {}),
  };
}

function adoptionFieldsPresent(state: Partial<AdoptionState>): boolean {
  return state.adoption_baseline !== undefined || state.adoption_baseline_repos !== undefined || state.adoption_baseline_history !== undefined
    || state.adoption_baseline_repos_history !== undefined || state.adoption_approval_ref !== undefined || state.adopted_at !== undefined;
}

/**
 * 4.10.0 structural rules of the adoption baseline: module sub-workflows only; Adoption
 * Baseline, Adoption Approval Ref and Adopted At together; a full lowercase hex commit
 * id; a non-empty approval reference; an ISO Adopted At. Nested repositories and the
 * advanced chain follow the same rules as Baseline Repos / Baseline History (at least
 * two distinct epochs, the last one equal to Adoption Baseline).
 */
export function assertAdoptionFields(state: Partial<AdoptionState>): void {
  if (!adoptionFieldsPresent(state)) return;
  if (state.workflow_kind !== "module") throw new Error("Adoption Baseline fields are only valid in a module sub-workflow state");
  if (state.adoption_baseline === undefined || state.adoption_approval_ref === undefined || state.adopted_at === undefined) {
    throw new Error("Adoption Baseline, Adoption Approval Ref and Adopted At must all be present or all be absent");
  }
  if (!COMMIT_ID_PATTERN.test(state.adoption_baseline)) throw new Error(`Adoption Baseline must be a 40- or 64-character lowercase hex commit id, got ${JSON.stringify(state.adoption_baseline)}`);
  if (!state.adoption_approval_ref.trim()) throw new Error("Adoption Approval Ref must be a non-empty approval record reference");
  if (Number.isNaN(Date.parse(state.adopted_at))) throw new Error("Adopted At must be an ISO timestamp");
  const mapped = adoptionAsBaseline(state);
  if (mapped.baseline_repos !== undefined || mapped.baseline_repos_history !== undefined) {
    try {
      assertBaselineRepoFields(mapped);
    } catch (error) {
      throw new Error(`Adoption ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const chain = mapped.baseline_history;
  if (chain === undefined) return;
  if (!Array.isArray(chain) || chain.length < 2) throw new Error("Adoption Baseline History must list at least two epochs (epoch 0 and the advanced adoption baseline)");
  for (const entry of chain) {
    if (typeof entry !== "string" || !COMMIT_ID_PATTERN.test(entry)) throw new Error(`Adoption Baseline History entries must be 40- or 64-character lowercase hex commit ids, got ${JSON.stringify(entry)}`);
  }
  const tuples = chain.map((entry, epoch) => [entry, ...Object.entries(baselineReposAtEpoch(mapped, epoch)).map(([key, sha]) => `${key}=${sha}`)].join(";"));
  if (new Set(tuples).size !== tuples.length) throw new Error("Adoption Baseline History contains duplicate epochs");
  if (chain[chain.length - 1] !== state.adoption_baseline) throw new Error(`the last Adoption Baseline History entry ${chain[chain.length - 1]} must equal Adoption Baseline ${state.adoption_baseline}`);
}

/** Baseline chain of a state that has a commit baseline: the recorded history, or the single epoch. */
export function baselineChain(state: Pick<WorkflowState, "baseline_commit" | "baseline_history">): string[] {
  if (state.baseline_history !== undefined) return [...state.baseline_history];
  return state.baseline_commit !== undefined ? [state.baseline_commit] : [];
}

export function markdownTable(markdown: string, title: string): string[][] {
  return table(markdown, title);
}

export function markdownCell(value: string | undefined): string {
  return value ? clean(value) : "-";
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
    if (cells.length !== 8 && cells.length !== 11) throw new Error(`Active Instances row ${index + 1} is malformed`);
    if (cells.length === 11 && ((cells[8] !== "-") !== (cells[9] !== "-"))) throw new Error("active session and generation must be recorded together");
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
      ...(cells[8] && cells[8] !== "-" ? { session_id: text(cells[8], "active session"), generation: text(cells[9], "active generation") } : {}),
      ...(cells[10] && cells[10] !== "-" ? { handoff: clean(cells[10]) } : {}),
    };
  }
  return result;
}


export function workflowDirectory(projectRoot: string, ref: WorkflowRef = GLOBAL_WORKFLOW): string {
  const active = resolve(projectRoot, "aidlc", "active");
  if (ref.kind === "module") {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62})$/.test(ref.module_id)) throw new Error(`invalid module workflow id: ${ref.module_id}`);
    return resolve(active, "modules", ref.module_id);
  }
  return ref.kind === "integration" ? resolve(active, "integration") : active;
}

export function lightStatePath(projectRoot: string, ref: WorkflowRef = GLOBAL_WORKFLOW): string {
  return resolve(workflowDirectory(projectRoot, ref), "aidlc-state.md");
}

export function lightAuditPath(projectRoot: string, ref: WorkflowRef = GLOBAL_WORKFLOW): string {
  return resolve(workflowDirectory(projectRoot, ref), "audit.md");
}

export function createInitialState(scope: string, version = ENGINE_VERSION, workflowId = randomUUID(), selectedOptionalStages: string[] = [], workDescription = ""): WorkflowState {
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
  const kind = scalar(markdown, "Workflow Kind", false);
  if (kind && !(["global", "module", "integration"] as string[]).includes(kind)) throw new Error(`invalid workflow kind: ${kind}`);
  const workflowModule = scalar(markdown, "Module", false);
  if (kind === "module" && !workflowModule) throw new Error("module workflow state is missing Module");
  const parentWorkflow = scalar(markdown, "Parent Workflow ID", false);
  const diagramFormat = scalar(markdown, "Diagram Format", false);
  if (diagramFormat && !(DIAGRAM_FORMATS as readonly string[]).includes(diagramFormat)) throw new Error(`invalid diagram format: ${diagramFormat}`);
  const baselineCommit = presentScalar(markdown, "Baseline Commit");
  const baselineSource = presentScalar(markdown, "Baseline Source");
  const baselineHistoryText = presentScalar(markdown, "Baseline History");
  const baselineHistory = baselineHistoryText === undefined ? undefined : baselineHistoryText.split(",").map((entry) => entry.trim());
  const baselineReposText = presentScalar(markdown, "Baseline Repos");
  const baselineRepos = baselineReposText === undefined ? undefined : parseBaselineRepos(baselineReposText);
  const baselineReposHistoryText = presentScalar(markdown, "Baseline Repos History");
  const baselineReposHistory = baselineReposHistoryText === undefined ? undefined : parseBaselineReposHistory(baselineReposHistoryText);
  assertBaselineFields({
    baseline_commit: baselineCommit,
    baseline_source: baselineSource as BaselineSource | undefined,
    baseline_history: baselineHistory,
    baseline_repos: baselineRepos,
    baseline_repos_history: baselineReposHistory,
    workflow_kind: (kind || undefined) as WorkflowKind | undefined,
  });
  const adoptionBaseline = presentScalar(markdown, "Adoption Baseline");
  const adoptionReposText = presentScalar(markdown, "Adoption Baseline Repos");
  const adoptionHistoryText = presentScalar(markdown, "Adoption Baseline History");
  const adoptionReposHistoryText = presentScalar(markdown, "Adoption Baseline Repos History");
  const adoption: Partial<AdoptionState> = {
    ...(adoptionBaseline !== undefined ? { adoption_baseline: adoptionBaseline } : {}),
    ...(adoptionReposText !== undefined ? { adoption_baseline_repos: parseBaselineRepos(adoptionReposText) } : {}),
    ...(adoptionHistoryText !== undefined ? { adoption_baseline_history: adoptionHistoryText.split(",").map((entry) => entry.trim()) } : {}),
    ...(adoptionReposHistoryText !== undefined ? { adoption_baseline_repos_history: parseBaselineReposHistory(adoptionReposHistoryText) } : {}),
    ...(presentScalar(markdown, "Adoption Approval Ref") !== undefined ? { adoption_approval_ref: presentScalar(markdown, "Adoption Approval Ref") } : {}),
    ...(presentScalar(markdown, "Adopted At") !== undefined ? { adopted_at: presentScalar(markdown, "Adopted At") } : {}),
  };
  assertAdoptionFields({ ...adoption, workflow_kind: (kind || undefined) as WorkflowKind | undefined });
  const retiredText = presentScalar(markdown, "Retired Lineages");
  const retired = retiredText === undefined ? undefined : retiredText.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (retired !== undefined && (kind === "module" || kind === "integration")) throw new Error(`${kind} sub-workflow state must not carry Retired Lineages; lineages belong to the global workflow`);
  const executionProfile = parseExecutionProfile(markdown);
  if (executionProfile !== undefined && (kind === "module" || kind === "integration")) {
    throw new Error(`${kind} sub-workflow state must not carry Execution Profile; it belongs to the global workflow`);
  }
  return {
    format: "markdown-workflow",
    version: scalar(markdown, "Engine Version"),
    ...(scalar(markdown, "Quality Gates Version", false) ? { quality_gates_version: scalar(markdown, "Quality Gates Version", false) } : {}),
    ...(scalar(markdown, "Document Slices Version", false) ? { document_slices_version: scalar(markdown, "Document Slices Version", false) } : {}),
    workflow_id: scalar(markdown, "Workflow ID"),
    work_description: scalar(markdown, "Work"),
    ...(kind ? { workflow_kind: kind as WorkflowKind } : {}),
    ...(workflowModule ? { module_id: workflowModule } : {}),
    ...(parentWorkflow ? { parent_workflow_id: parentWorkflow } : {}),
    ...(diagramFormat ? { diagram_format: diagramFormat as DiagramFormat } : {}),
    ...(baselineCommit !== undefined ? { baseline_commit: baselineCommit, baseline_source: baselineSource as BaselineSource } : {}),
    ...(baselineHistory !== undefined ? { baseline_history: baselineHistory } : {}),
    ...(baselineRepos !== undefined ? { baseline_repos: baselineRepos } : {}),
    ...(baselineReposHistory !== undefined ? { baseline_repos_history: baselineReposHistory } : {}),
    ...adoption,
    ...(retired !== undefined && retired.length > 0 ? { retired_lineages: retired } : {}),
    ...(executionProfile !== undefined ? { execution_profile: executionProfile } : {}),
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
  assertExecutionProfileOwnership(state);
  return `# AI-DLC Lightweight Workflow

> AWS-style lightweight collaboration controlled by this Markdown state and its audit log.

- Workflow ID: ${clean(state.workflow_id)}
- Work: ${clean(state.work_description)}
- Scope: ${clean(state.scope)}
- Status: ${state.status}
- Revision: ${state.revision}
- Engine Version: ${clean(state.version)}
${state.quality_gates_version ? `- Quality Gates Version: ${clean(state.quality_gates_version)}\n` : ""}
${state.document_slices_version ? `- Document Slices Version: ${clean(state.document_slices_version)}\n` : ""}
${state.workflow_kind ? `- Workflow Kind: ${state.workflow_kind}\n` : ""}${state.module_id ? `- Module: ${clean(state.module_id)}\n` : ""}${state.parent_workflow_id ? `- Parent Workflow ID: ${clean(state.parent_workflow_id)}\n` : ""}${state.diagram_format ? `- Diagram Format: ${state.diagram_format}\n` : ""}${state.baseline_commit !== undefined ? `- Baseline Commit: ${clean(state.baseline_commit)}\n- Baseline Source: ${clean(state.baseline_source || "")}\n` : ""}${state.baseline_history !== undefined ? `- Baseline History: ${state.baseline_history.map(clean).join(", ")}\n` : ""}${state.baseline_repos !== undefined ? `- Baseline Repos: ${clean(renderBaselineRepos(state.baseline_repos))}\n` : ""}${state.baseline_repos_history !== undefined ? `- Baseline Repos History: ${clean(renderBaselineReposHistory(state.baseline_repos_history))}\n` : ""}${renderAdoption(state)}${state.retired_lineages?.length ? `- Retired Lineages: ${state.retired_lineages.map(clean).join(", ")}\n` : ""}- Depth: ${clean(state.depth)}
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
| Stage Instance | Module | Owner | Branch | Worktree | Claimed At | Heartbeat At | Expires At | Session | Generation | Handoff |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${Object.entries(state.active_instances || {}).sort(([left], [right]) => left.localeCompare(right)).map(([instance, claim]) => `| ${cell(instance)} | ${cell(claim.module_id)} | ${cell(claim.owner)} | ${cell(claim.branch)} | ${cell(claim.worktree)} | ${claim.claimed_at} | ${claim.heartbeat_at} | ${claim.expires_at} | ${cell(claim.session_id)} | ${cell(claim.generation)} | ${cell(claim.handoff)} |`).join("\n") || "| - | - | - | - | - | - | - | - | - | - | - |"}

## History
| Stage | Instance | Module | Unit | Result | Timestamp | Input |
| --- | --- | --- | --- | --- | --- | --- |
${state.history.map((entry) => `| ${cell(entry.stage)} | ${cell(entry.instance_id)} | ${cell(entry.module_id)} | ${cell(entry.unit_id)} | ${cell(entry.result)} | ${entry.timestamp} | ${cell(entry.user_input)} |`).join("\n") || "| - | - | - | - | - | - | - |"}
${renderExecutionProfile(state.execution_profile)}
`;
}

function parseExecutionProfile(markdown: string): ExecutionProfile | undefined {
  const content = section(markdown, "Execution Profile");
  if (!content) return undefined;
  const risksContent = section(markdown, "Execution Profile Active Risks");
  const eventsContent = section(markdown, "Execution Profile Events");
  if (!risksContent || !eventsContent) {
    throw new Error("Execution Profile requires Active Risks and Events sections");
  }
  const risks = list(markdown, "Execution Profile Active Risks");
  const events = table(markdown, "Execution Profile Events").map((cells, index): ExecutionProfileEvent => {
    if (cells.length !== 7) throw new Error(`Execution Profile Events row ${index + 1} is malformed`);
    return {
      kind: cells[0] as ExecutionProfileEvent["kind"],
      at: cells[1],
      actor: cells[2] as ExecutionProfileEvent["actor"],
      reason_code: cells[3] as ExecutionProfileEvent["reason_code"],
      ...(cells[4] !== "-" ? { from: cells[4] as ExecutionProfileEvent["from"] } : {}),
      ...(cells[5] !== "-" ? { to: cells[5] as ExecutionProfileEvent["to"] } : {}),
      ...(cells[6] !== "-" ? { detail: cells[6] } : {}),
    };
  });
  const profile: ExecutionProfile = {
    level: scalar(content, "Level") as ExecutionProfile["level"],
    source: scalar(content, "Source") as ExecutionProfile["source"],
    primary_reason: scalar(content, "Primary Reason") as ExecutionProfile["primary_reason"],
    active_risks: risks as ExecutionProfile["active_risks"],
    events,
  };
  assertExecutionProfile(profile);
  return profile;
}

function renderExecutionProfile(profile: ExecutionProfile | undefined): string {
  if (profile === undefined) return "";
  assertExecutionProfile(profile);
  const risks = profile.active_risks.length
    ? profile.active_risks.map((risk) => `- ${risk}`).join("\n")
    : "- (none)";
  const events = profile.events.map((event) =>
    `| ${event.kind} | ${event.at} | ${event.actor} | ${event.reason_code} | ${cell(event.from)} | ${cell(event.to)} | ${cell(event.detail)} |`,
  ).join("\n") || "| - | - | - | - | - | - | - |";
  return `

## Execution Profile
- Level: ${profile.level}
- Source: ${profile.source}
- Primary Reason: ${profile.primary_reason}

## Execution Profile Active Risks
${risks}

## Execution Profile Events
| Kind | At | Actor | Reason Code | From | To | Detail |
| --- | --- | --- | --- | --- | --- | --- |
${events}
`;
}

function assertExecutionProfileOwnership(state: WorkflowState): void {
  if (state.execution_profile === undefined) return;
  assertExecutionProfile(state.execution_profile);
  if (state.workflow_kind === "module" || state.workflow_kind === "integration") {
    throw new Error("Execution Profile is only valid in the global workflow state");
  }
}

/** 4.10.0 adoption baseline lines of a module sub-workflow (empty when not adopted). */
function renderAdoption(state: WorkflowState): string {
  if (state.adoption_baseline === undefined) return "";
  return [
    `- Adoption Baseline: ${clean(state.adoption_baseline)}`,
    ...(state.adoption_baseline_repos !== undefined ? [`- Adoption Baseline Repos: ${clean(renderBaselineRepos(state.adoption_baseline_repos))}`] : []),
    ...(state.adoption_baseline_history !== undefined ? [`- Adoption Baseline History: ${state.adoption_baseline_history.map(clean).join(", ")}`] : []),
    ...(state.adoption_baseline_repos_history !== undefined ? [`- Adoption Baseline Repos History: ${clean(renderBaselineReposHistory(state.adoption_baseline_repos_history))}`] : []),
    `- Adoption Approval Ref: ${clean(state.adoption_approval_ref || "")}`,
    `- Adopted At: ${clean(state.adopted_at || "")}`,
  ].map((line) => `${line}\n`).join("");
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

function appendAudit(projectRoot: string, state: WorkflowState, ref: WorkflowRef): void {
  const path = lightAuditPath(projectRoot, ref);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, `## ${new Date().toISOString()}\n- Event: STATE_UPDATED\n- Revision: ${state.revision}\n- Work: ${clean(state.work_description)}\n${state.workflow_kind ? `- Workflow: ${workflowRefKey(ref)}\n` : ""}- Current Instance: ${cell(state.current_stage_instance)}\n- Active Instances: ${Object.keys(state.active_instances || {}).sort().join(", ") || "-"}\n- Instance Owners: ${Object.values(state.active_instances || {}).map((claim) => `${claim.stage_instance}=${claim.owner}`).sort().join(", ") || "-"}\n- Session Claims: ${Object.values(state.active_instances || {}).map(claim => `${claim.stage_instance}=${claim.session_id || "legacy"}/${claim.generation || "legacy"};${claim.handoff || ""}`).join("; ")}\n- Status: ${state.status}\n\n`, "utf8");
}

export function appendAuditEvent(projectRoot: string, ref: WorkflowRef, event: string, fields: Record<string, string>): void {
  const append = (): void => {
  const path = lightAuditPath(projectRoot, ref);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lines = Object.entries(fields).map(([key, value]) => `- ${key}: ${clean(value) || "-"}`).join("\n");
  appendFileSync(path, `## ${new Date().toISOString()}\n- Event: ${clean(event)}\n${lines}${lines ? "\n" : ""}\n`, "utf8");

  };
  const state = loadWorkflowState(projectRoot, ref);
  const binding = sessionBinding();
  if (state && (binding || state.current_stage_instance || Object.keys(state.active_instances || {}).length)) {
    if (!binding) throw new Error("audit append requires explicit session binding");
    withSessionPublication(projectRoot, ref, binding.stage_instance, append, binding);
    return;
  }
  append();
}

export function releaseExpiredModuleClaims(state: WorkflowState, now = Date.now()): string[] {
  const released: string[] = [];
  for (const [instance, claim] of Object.entries(state.active_instances || {})) {
    if (!claim.session_id && Date.parse(claim.expires_at) <= now) {
      delete state.active_instances[instance];
      released.push(instance);
    }
  }
  return released.sort();
}

export function loadWorkflowState(projectRoot: string, ref: WorkflowRef = GLOBAL_WORKFLOW): WorkflowState | null {
  const path = lightStatePath(projectRoot, ref);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`workflow state must be a regular non-symlink file: ${path}`);
  return parseLightWorkflowState(readFileSync(path, "utf8"));
}

const CLAIM_TRANSACTION = Symbol("claim transaction");

export interface SaveWorkflowOptions {
  /** Private transaction token; callers cannot grant claim-write authority with a boolean. */
  claimWrite?: symbol;
  /** Synchronous audit/receipt finalization under the same committed-state lock. */
  afterCommit?: () => void;
  /**
   * Only `orchestrate baseline` sets this: it may register, replace or advance the
   * baseline. Every other save must keep Baseline Commit / Baseline Source / Baseline
   * History exactly as persisted.
   */
  baselineWrite?: boolean;
  /**
   * 4.13.0: `orchestrate state adopt` creates a module state carried over from another
   * lineage; it continues that state's Revision instead of starting at 0.
   */
  adoptRevision?: boolean;
}

function assertBaselinePreserved(existing: WorkflowState | null, state: WorkflowState, ref: WorkflowRef, options: SaveWorkflowOptions): void {
  assertBaselineFields(state);
  assertAdoptionFields(state);
  if (adoptionFieldsPresent(state) && ref.kind !== "module") throw new Error("Adoption Baseline fields are only valid in a module sub-workflow state");
  if (!options.baselineWrite && existing) {
    const keys = ["adoption_baseline", "adoption_baseline_repos", "adoption_baseline_history", "adoption_baseline_repos_history", "adoption_approval_ref", "adopted_at"] as const;
    if (keys.some((key) => JSON.stringify(existing[key]) !== JSON.stringify(state[key]))) {
      throw new Error("the adoption baseline can only be changed by orchestrate baseline --adopt / --advance --module; an ordinary save must keep the Adoption Baseline fields unchanged");
    }
  } else if (!options.baselineWrite && adoptionFieldsPresent(state)) {
    throw new Error("a new workflow cannot start with an adoption baseline");
  }
  if (ref.kind !== "global" && (state.baseline_commit !== undefined || state.baseline_source !== undefined || state.baseline_history !== undefined)) throw subWorkflowBaselineError(ref.kind);
  if (ref.kind !== "global" && (state.baseline_repos !== undefined || state.baseline_repos_history !== undefined)) throw subWorkflowReposError(ref.kind);
  assertExecutionProfileOwnership(state);
  if (state.execution_profile !== undefined && ref.kind !== "global") {
    throw new Error("Execution Profile is only valid in the global workflow state");
  }
  if (options.baselineWrite) return;
  if (existing) {
    if (existing.baseline_commit !== state.baseline_commit || existing.baseline_source !== state.baseline_source
      || JSON.stringify(existing.baseline_history) !== JSON.stringify(state.baseline_history)) {
      throw new Error("the workflow baseline can only be changed by orchestrate baseline; an ordinary save must keep Baseline Commit / Baseline Source / Baseline History unchanged");
    }
    if (JSON.stringify(baselineRepoChains(existing)) !== JSON.stringify(baselineRepoChains(state))
      || (existing.baseline_repos_history === undefined) !== (state.baseline_repos_history === undefined)) {
      throw new Error("the workflow baseline can only be changed by orchestrate baseline; an ordinary save must keep Baseline Repos / Baseline Repos History unchanged");
    }
  } else if (state.baseline_history !== undefined) {
    throw new Error("a new workflow cannot start with a Baseline History chain");
  } else if (state.baseline_repos_history !== undefined) {
    throw new Error("a new workflow cannot start with a Baseline Repos History chain");
  } else if (state.baseline_source !== undefined && state.baseline_source !== "created") {
    throw new Error(`a new workflow can only record a created baseline, got Baseline Source ${state.baseline_source}`);
  }
}

export function saveWorkflowState(projectRoot: string, state: WorkflowState, ref: WorkflowRef = GLOBAL_WORKFLOW, options: SaveWorkflowOptions = {}): void {
  const path = lightStatePath(projectRoot, ref);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lock = acquireLock(`${path}.lock`);
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    const existing = loadWorkflowState(projectRoot, ref);
    if (!existing && sessionBinding()) throw new Error("clear an unrelated session binding before initializing a workflow");
    if (existing && existing.revision !== state.revision) throw new Error(`workflow state revision conflict: expected ${state.revision}, found ${existing.revision}`);
    if (!existing && state.revision !== 0 && !options.adoptRevision) throw new Error(`workflow state is missing at revision ${state.revision}`);
    if (existing && options.adoptRevision) throw new Error("an adopted workflow state cannot overwrite an existing state");
    if (existing && options.claimWrite !== CLAIM_TRANSACTION) assertSessionMutation(projectRoot, existing, state);
    assertBaselinePreserved(existing, state, ref, options);
    const next = { ...state, version: ENGINE_VERSION, revision: state.revision + 1, updated_at: new Date().toISOString() };
    appendAudit(projectRoot, next, ref);
    writeFileSync(temporary, renderLightWorkflowState(next), { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
    Object.assign(state, next);
    if (options.afterCommit) {
      const binding = sessionBinding();
      if (binding) publicationLocks.set(path, binding);
      try { options.afterCommit(); } finally { if (binding) publicationLocks.delete(path); }
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    closeSync(lock);
    if (existsSync(`${path}.lock`)) unlinkSync(`${path}.lock`);
  }
}

export function updateWorkflowState(projectRoot: string, mutate: (state: WorkflowState) => void, retries = 3, ref: WorkflowRef = GLOBAL_WORKFLOW): WorkflowState {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    const state = loadWorkflowState(projectRoot, ref);
    if (!state) throw new Error(ref.kind === "global" ? "no active AWS-style lightweight workflow" : `no ${workflowRefKey(ref)} workflow`);
    try {
      mutate(state);
      saveWorkflowState(projectRoot, state, ref);
      return state;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.startsWith("workflow state revision conflict")) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("workflow state update failed after retries");
}

export function migrateSingleInstanceState(projectRoot: string, owner = "legacy-single-instance", ref: WorkflowRef = GLOBAL_WORKFLOW): WorkflowState {
  const state = loadWorkflowState(projectRoot, ref);
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
  saveWorkflowState(projectRoot, state, ref);
  return state;
}


/** A session-local capability. Branch/worktree and ACTIVE_MODULE are never credentials. */
export interface SessionBinding {
  project_root: string;
  workflow_id: string;
  stage_instance: string;
  owner: string;
  session_id: string;
  generation: string;
}

export function sessionBinding(raw = process.env.AIDLC_SESSION_BINDING): SessionBinding | undefined {
  if (!raw?.trim()) return undefined;
  const value = JSON.parse(raw) as SessionBinding;
  for (const key of ["project_root", "workflow_id", "stage_instance", "owner", "session_id", "generation"] as const) {
    if (typeof value[key] !== "string" || !value[key].trim()) throw new Error(`invalid session binding: ${key}`);
  }
  return value;
}

export function bindingFor(projectRoot: string, state: WorkflowState, claim: TeamLightActiveInstance): SessionBinding {
  if (!claim.session_id || !claim.generation) throw new Error("legacy claim requires explicit session binding");
  return { project_root: realpathSync(projectRoot), workflow_id: state.workflow_id, stage_instance: claim.stage_instance, owner: claim.owner, session_id: claim.session_id, generation: claim.generation };
}

export function assertSessionClaim(projectRoot: string, state: WorkflowState, instance: string, binding = sessionBinding()): TeamLightActiveInstance {
  const claim = state.active_instances?.[instance];
  if (!binding || !claim?.session_id || !claim.generation) throw new Error(`explicit session binding required for ${instance}; use module bind`);
  const root = realpathSync(projectRoot);
  if (binding.project_root !== root || binding.workflow_id !== state.workflow_id || binding.stage_instance !== instance
    || claim.owner !== binding.owner || claim.session_id !== binding.session_id || claim.generation !== binding.generation) {
    throw new Error(`claim transferred or session binding conflicts for ${instance}; reread the handoff and bind the current claim`);
  }
  if (Date.parse(claim.expires_at) <= Date.now()) throw new Error(`claim expired for ${instance}; explicitly bind/renew before writing`);
  return claim;
}

/** Called inside the existing state CAS lock, covering every engine save path. */
function assertSessionMutation(projectRoot: string, existing: WorkflowState, next: WorkflowState): void {
  const binding = sessionBinding();
  const managed = Object.values(existing.active_instances || {}).some(claim => claim.session_id);
  if (!managed && !binding && !existing.current_stage_instance && Object.keys(existing.active_instances || {}).length === 0) return; // Initialization only. Legacy reads never write.
  if (!binding) throw new Error("explicit session binding required before workflow mutation");
  assertSessionClaim(projectRoot, existing, binding.stage_instance, binding);
  if (next.workflow_id !== existing.workflow_id) throw new Error("session cannot replace workflow identity");
  for (const instance of Object.keys(next.active_instances)) {
    if (!existing.active_instances[instance] && instance !== binding.stage_instance) throw new Error("new stage claims require an explicit bind transaction");
  }
  for (const [instance, claim] of Object.entries(existing.active_instances)) {
    if (instance !== binding.stage_instance && JSON.stringify(claim) !== JSON.stringify(next.active_instances[instance])) {
      throw new Error(`session cannot modify another claim: ${instance}`);
    }
  }
  const scope = (instance: string) => instance.includes("@module:") ? instance.slice(instance.indexOf("@module:")) : "project";
  if (next.current_stage_instance && next.current_stage_instance !== existing.current_stage_instance && scope(next.current_stage_instance) !== scope(binding.stage_instance)) {
    throw new Error("session cannot expand its module/unit responsibility; explicitly bind the target");
  }
  for (const key of ["completed_stage_instances", "skipped_stage_instances"] as const) {
    for (const instance of new Set([...existing[key], ...next[key]])) {
      if (existing[key].includes(instance) !== next[key].includes(instance) && scope(instance) !== scope(binding.stage_instance)) throw new Error(`session cannot resolve sibling instance ${instance}`);
    }
  }
  const module = /@module:([a-z0-9][a-z0-9-]*)/.exec(binding.stage_instance)?.[1];
  for (const key of new Set([...Object.keys(existing.module_selections || {}), ...Object.keys(next.module_selections || {})])) {
    if (JSON.stringify(existing.module_selections?.[key]) !== JSON.stringify(next.module_selections?.[key]) && key !== module) throw new Error(`session cannot select sibling module ${key}`);
    if (JSON.stringify(existing.module_selections?.[key]) !== JSON.stringify(next.module_selections?.[key]) && next.module_selections?.[key]?.owner !== binding.owner) throw new Error("selection owner changes require explicit transfer");
  }
  for (const key of new Set([...Object.keys(existing.unit_selections), ...Object.keys(next.unit_selections)])) {
    if (JSON.stringify(existing.unit_selections[key]) !== JSON.stringify(next.unit_selections[key]) && (!module || !key.startsWith(`${module}:`) || (binding.stage_instance.includes("@unit:") && key !== `${module}:${binding.stage_instance.split("@unit:")[1]}`))) throw new Error(`session cannot select sibling unit ${key}`);
    if (JSON.stringify(existing.unit_selections[key]) !== JSON.stringify(next.unit_selections[key]) && next.unit_selections[key]?.member !== binding.owner) throw new Error("unit selection owner changes require explicit transfer");
  }
  for (const entry of next.history.slice(existing.history.length)) {
    if (entry.instance_id && entry.instance_id !== binding.stage_instance && !(entry.result === "condition_skipped" && scope(entry.instance_id) === scope(binding.stage_instance))) throw new Error("session cannot report another stage instance");
  }
}

const publicationLocks = new Map<string, SessionBinding>();

/** Evidence publication and transfer use the SAME workflow lock: no check/rename gap. */
export function withSessionPublication<T>(projectRoot: string, ref: WorkflowRef, instance: string, publish: () => T, binding = sessionBinding()): T {
  const path = lightStatePath(projectRoot, ref);
  const nested = publicationLocks.get(path);
  if (nested) {
    if (!binding || Object.entries(nested).some(([key, value]) => binding[key as keyof SessionBinding] !== value)) throw new Error("nested publication has a conflicting session binding");
    return publish();
  }
  const lock = acquireLock(`${path}.lock`);
  try {
    const state = loadWorkflowState(projectRoot, ref);
    if (!state) throw new Error("workflow disappeared before evidence publication");
    assertSessionClaim(projectRoot, state, instance, binding);
    publicationLocks.set(path, binding!);
    return publish();
  } finally {
    publicationLocks.delete(path);
    closeSync(lock);
    unlinkSync(`${path}.lock`);
  }
}


/** Narrow ownership CAS: accepts only claim/selection handoff fields, never arbitrary workflow mutations. */
export function saveClaimTransaction(projectRoot: string, next: WorkflowState, ref: WorkflowRef, target: string, expectedClaim: TeamLightActiveInstance | undefined): void {
  const existing = loadWorkflowState(projectRoot, ref);
  if (!existing || existing.workflow_id !== next.workflow_id || existing.revision !== next.revision) throw new Error("claim changed; reread before retrying transfer");
  const canonical = (value: unknown): string => JSON.stringify(value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : null);
  const previous = existing.active_instances[target];
  if (canonical(previous) !== canonical(expectedClaim)) throw new Error("claim changed; expected original ownership no longer matches");
  const claim = next.active_instances[target];
  if (!claim?.owner || !claim.session_id || !claim.generation || claim.stage_instance !== target) throw new Error("incomplete claim transaction");
  const record = JSON.parse(claim.handoff || "{}") as Record<string, unknown>;
  if (record.previous_owner !== (previous?.owner || null) || record.previous_session !== (previous?.session_id || null) || record.previous_generation !== (previous?.generation || null) || record.target !== target || record.owner !== claim.owner || record.session !== claim.session_id) throw new Error("handoff must record expected original claim");
  const transfer = previous && (previous.owner !== claim.owner || (previous.session_id && previous.session_id !== claim.session_id));
  if (transfer && (typeof record.human_instruction_ref !== "string" || !record.human_instruction_ref.trim())) throw new Error("ownership transfer requires an explicit human instruction reference");
  if (previous?.session_id && !transfer) {
    const binding = sessionBinding();
    const expected = bindingFor(projectRoot, existing, previous);
    if (!binding || Object.entries(expected).some(([key, value]) => binding[key as keyof SessionBinding] !== value)) throw new Error("renewal requires current session binding");
  }
  const module = /@module:([a-z0-9][a-z0-9-]*)/.exec(target)?.[1];
  const unit = /@unit:([a-z0-9][a-z0-9-]*)$/.exec(target)?.[1];
  for (const key of new Set([...Object.keys(existing), ...Object.keys(next)])) {
    if (["active_instances", "module_selections", "unit_selections", "status"].includes(key)) continue;
    if (JSON.stringify(existing[key as keyof WorkflowState]) !== JSON.stringify(next[key as keyof WorkflowState])) throw new Error(`claim transaction cannot change workflow field ${key}`);
  }
  for (const key of new Set([...Object.keys(existing.active_instances), ...Object.keys(next.active_instances)])) {
    if (key !== target && canonical(existing.active_instances[key]) !== canonical(next.active_instances[key])) throw new Error("claim transaction cannot change sibling ownership");
  }
  for (const key of new Set([...Object.keys(existing.module_selections || {}), ...Object.keys(next.module_selections || {})])) {
    if (canonical(existing.module_selections?.[key]) !== canonical(next.module_selections?.[key]) && (key !== module || next.module_selections?.[key]?.owner !== claim.owner)) throw new Error("claim transaction cannot select another module");
  }
  for (const key of new Set([...Object.keys(existing.unit_selections), ...Object.keys(next.unit_selections)])) {
    if (canonical(existing.unit_selections[key]) !== canonical(next.unit_selections[key]) && (key !== `${module}:${unit}` || next.unit_selections[key]?.member !== claim.owner)) throw new Error("claim transaction cannot select another unit");
  }
  if (next.status !== existing.status && !(existing.status === "parked" && next.status === "running" && existing.current_stage_instance === target)) throw new Error("handoff can only resume the exact parked current instance");
  saveWorkflowState(projectRoot, next, ref, { claimWrite: CLAIM_TRANSACTION });
}
