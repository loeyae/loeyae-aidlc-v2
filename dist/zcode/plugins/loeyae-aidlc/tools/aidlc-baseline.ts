/**
 * aidlc-baseline.ts — workflow baseline commit (4.6.0).
 *
 * The global (or single) workflow records the commit that existing behavior is
 * characterized against: automatically when `next --scope` creates the workflow
 * (Baseline Source `created`), or explicitly with `orchestrate baseline --set`
 * (`registered`) / `--set --replace --expect` (`replaced`). Module and integration
 * sub-workflows never store a baseline; they read the parent's via workflowBaseline().
 *
 * 4.7.0: the baseline is an append-only chain of epochs. `orchestrate baseline
 * --advance` (`advanced`) appends the completion commit of a finished unit; every
 * BASELINE evidence stays bound to the epoch it was produced in (`Baseline History`).
 *
 * Every git call uses argument arrays with `shell: false`. All checks fail closed:
 * git being unavailable, a shallow history or unreadable evidence reject instead of
 * skipping the check.
 */

import { type SpawnSyncReturns } from "child_process";
import { runSync } from "./aidlc-spawn";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "fs";
import { join, relative, resolve } from "path";
import { COMMIT_ID_PATTERN } from "./aidlc-revision";
import {
  BASELINE_UNAVAILABLE,
  GLOBAL_WORKFLOW,
  adoptionAsBaseline,
  baselineChain,
  baselineRepoChains,
  loadWorkflowState,
  workflowRefKey,
  type BaselineSource,
  type WorkflowRef,
  type WorkflowState,
} from "./aidlc-light-state";
import { normalizeSourceRoot, SOURCE_ROOTS_CONFIG } from "./aidlc-source-roots";
import { nestedRepositoryHint, WORKFLOW_REPO_KEY, type CodeRefRepo } from "./aidlc-nested-repos";
import { isSplitLayout, loadWorkflowParts } from "./aidlc-workflow-layout";

/** Stages whose evidence is produced against the baseline (usage check U1). */
export const BASELINE_CONSUMING_STAGES: ReadonlySet<string> = new Set(["tdd", "code-generation", "code-review", "build-and-test"]);
const STATE_PATH_IN_TREE = "aidlc/active/aidlc-state.md";
const EVIDENCE_ROOT = join(".aidlc", "evidence");

function root(projectRoot: string): string {
  return realpathSync(resolve(projectRoot));
}

function git(projectRoot: string, args: string[]): SpawnSyncReturns<string> {
  return runSync("git", args, { cwd: root(projectRoot), encoding: "utf8", shell: false});
}

/** HEAD of the project repository, or "unavailable" outside git (or before the first commit). */
export function currentHeadCommit(projectRoot: string): string {
  const result = git(projectRoot, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const head = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return !result.error && result.status === 0 && COMMIT_ID_PATTERN.test(head) ? head : BASELINE_UNAVAILABLE;
}

export type BaselineKind = "workflow" | "adoption";

export type WorkflowBaseline =
  | {
    registered: true;
    /** 4.10.0: `adoption` when the module registered an adoption baseline, otherwise `workflow`. */
    kind: BaselineKind;
    /** The current epoch (the last entry of `epochs`). */
    commit: string;
    source: BaselineSource;
    workflow_id: string;
    /** The baseline chain (4.7.0), epoch 0 first; `[commit]` when never advanced. */
    epochs: string[];
    /** 4.9.0: registered nested repositories, each with its start epoch and per-epoch commits ({} when none). */
    repos: Record<string, { start: number; commits: string[] }>;
  }
  | { registered: false; kind: "workflow"; workflow_id: string };

/**
 * The baseline that applies to a workflow. The global (or single) workflow answers
 * with its own fields; module and integration sub-workflows answer with the parent
 * global workflow's value (its whole baseline chain included), or "not registered"
 * when the parent has none.
 */
export function workflowBaseline(projectRoot: string, ref: WorkflowRef = GLOBAL_WORKFLOW): WorkflowBaseline {
  const own = loadWorkflowState(projectRoot, ref);
  if (!own) throw new Error(`no ${workflowRefKey(ref)} workflow`);
  let owner = own;
  if (ref.kind !== "global") {
    const parent = loadWorkflowState(projectRoot, GLOBAL_WORKFLOW);
    if (!parent) throw new Error(`${workflowRefKey(ref)} workflow has no parent global workflow`);
    if (own.parent_workflow_id && own.parent_workflow_id !== parent.workflow_id) {
      throw new Error(`${workflowRefKey(ref)} workflow parent ${own.parent_workflow_id} does not match the global workflow ${parent.workflow_id}`);
    }
    owner = parent;
  }
  if (owner.baseline_commit === undefined || owner.baseline_source === undefined) return { registered: false, kind: "workflow", workflow_id: owner.workflow_id };
  return { registered: true, kind: "workflow", commit: owner.baseline_commit, source: owner.baseline_source, workflow_id: owner.workflow_id, epochs: baselineChain(owner), repos: baselineRepoChains(owner) };
}

type CommitCheck = { ok: true } | { ok: false; error: string };

function isShallow(projectRoot: string): boolean {
  const result = git(projectRoot, ["rev-parse", "--is-shallow-repository"]);
  return result.status === 0 && result.stdout.trim() === "true";
}

const UNSHALLOW_HINT = "the repository is a shallow clone, so its truncated history cannot prove ancestry; run git fetch --unshallow and retry";

/** `commit` names an existing commit object that is HEAD or one of its ancestors. */
function commitIsAncestorOfHead(projectRoot: string, commit: string, label: string): CommitCheck {
  const shallow = isShallow(projectRoot);
  const type = git(projectRoot, ["cat-file", "-t", commit]);
  if (type.error) return { ok: false, error: `${label} ${commit} cannot be verified: git is unavailable (${type.error.message})` };
  if (type.status !== 0) {
    return { ok: false, error: shallow ? `${label} ${commit} is missing: ${UNSHALLOW_HINT}` : `${label} ${commit} does not exist in this repository` };
  }
  const objectType = type.stdout.trim();
  if (objectType !== "commit") return { ok: false, error: `${label} ${commit} is a ${objectType || "unknown"} object, not a commit` };
  const ancestor = git(projectRoot, ["merge-base", "--is-ancestor", commit, "HEAD"]);
  if (ancestor.error) return { ok: false, error: `${label} ${commit} cannot be verified: git is unavailable (${ancestor.error.message})` };
  if (ancestor.status === 0) return { ok: true };
  if (shallow) return { ok: false, error: `${label} ${commit} could not be confirmed as an ancestor of HEAD: ${UNSHALLOW_HINT}` };
  if (ancestor.status === 1) return { ok: false, error: `${label} ${commit} is not the current HEAD or one of its ancestors` };
  return { ok: false, error: `${label} ${commit} ancestry cannot be determined (git merge-base exit ${ancestor.status}): ${ancestor.stderr.trim()}` };
}

/**
 * Shared gate check (S2/S3): re-verifies on every call that the workflow baseline is
 * registered, is not "unavailable", exists, and is still HEAD or one of its ancestors
 * (a rebase that orphans the baseline is reported). Pass the global state, or the
 * value returned by workflowBaseline() for a sub-workflow.
 */
export function baselineCommitErrors(projectRoot: string, state: Pick<WorkflowState, "baseline_commit" | "baseline_source">): string[] {
  const commit = state.baseline_commit;
  if (commit === undefined || state.baseline_source === undefined) {
    return ["workflow baseline commit is not registered; register it with orchestrate baseline --set <commit> --user-input Approve --reason \"<reason>\""];
  }
  if (commit === BASELINE_UNAVAILABLE) return ["workflow baseline commit is unavailable: the workflow was created outside a git repository"];
  if (!COMMIT_ID_PATTERN.test(commit)) return [`workflow baseline commit ${JSON.stringify(commit)} must be a 40- or 64-character lowercase hex commit id`];
  const check = commitIsAncestorOfHead(projectRoot, commit, "workflow baseline commit");
  return check.ok ? [] : [check.error];
}

/**
 * Errors when an earlier epoch of the baseline chain is no longer usable: it must be
 * a full commit id that is still HEAD or one of its ancestors. The current epoch is
 * covered by baselineCommitErrors().
 */
export function baselineEpochErrors(projectRoot: string, epoch: string): string[] {
  if (!COMMIT_ID_PATTERN.test(epoch)) return [`baseline epoch ${JSON.stringify(epoch)} must be a 40- or 64-character lowercase hex commit id`];
  const check = commitIsAncestorOfHead(projectRoot, epoch, "baseline epoch");
  return check.ok ? [] : [check.error];
}

/**
 * Git checks of `orchestrate baseline --advance` (4.7.0) on the target commit: a git
 * work tree with a HEAD; the target is an existing commit object that is HEAD or one
 * of its ancestors; it is a strict descendant of the current epoch. Shallow clones
 * that cannot prove ancestry reject.
 */
export function checkAdvanceTarget(projectRoot: string, current: string, target: string): { error: string } | { head: string } {
  const repository = gitWorkTreeError(projectRoot);
  if (repository) return { error: `${repository}; orchestrate baseline --advance requires a git repository` };
  const head = currentHeadCommit(projectRoot);
  if (head === BASELINE_UNAVAILABLE) return { error: "the git repository has no HEAD commit" };
  const ancestry = commitIsAncestorOfHead(projectRoot, target, "commit");
  if (!ancestry.ok) return { error: ancestry.error };
  if (target === current) return { error: `commit ${target} is the current baseline epoch; --advance needs a strict descendant of it` };
  const descendant = git(projectRoot, ["merge-base", "--is-ancestor", current, target]);
  if (descendant.error) return { error: `commit ${target} cannot be verified: git is unavailable (${descendant.error.message})` };
  if (descendant.status === 0) return { head };
  if (isShallow(projectRoot)) return { error: `commit ${target} could not be confirmed as a descendant of the current baseline ${current}: ${UNSHALLOW_HINT}` };
  if (descendant.status === 1) return { error: `commit ${target} is not a descendant of the current baseline epoch ${current}` };
  return { error: `commit ${target} ancestry cannot be determined (git merge-base exit ${descendant.status}): ${descendant.stderr.trim()}` };
}

/**
 * The baseline that applies to a module's stages: in the split layout the module
 * sub-workflow (which reads its parent global workflow); otherwise the global/single
 * workflow, which also owns every module of the single layout.
 *
 * 4.10.0: a module sub-workflow that registered an adoption baseline (`orchestrate
 * baseline --adopt --module`) answers with its own adoption chain (`kind: adoption`)
 * instead of the parent's chain. Modules without one keep the 4.9.x resolution.
 */
export function workflowBaselineForModule(projectRoot: string, moduleId?: string): WorkflowBaseline {
  const ref: WorkflowRef = moduleId && isSplitLayout(projectRoot) ? { kind: "module", module_id: moduleId } : GLOBAL_WORKFLOW;
  const resolved = workflowBaseline(projectRoot, ref);
  if (ref.kind !== "module") return resolved;
  const own = loadWorkflowState(projectRoot, ref);
  return own && own.adoption_baseline !== undefined ? adoptionBaseline(own) : resolved;
}

/** The adoption chain of a module sub-workflow state that registered one (4.10.0). */
export function adoptionBaseline(state: WorkflowState): Extract<WorkflowBaseline, { registered: true }> {
  if (state.adoption_baseline === undefined) throw new Error(`module ${state.module_id} has no adoption baseline`);
  const mapped = adoptionAsBaseline(state);
  return {
    registered: true,
    kind: "adoption",
    commit: state.adoption_baseline,
    source: state.adoption_baseline_history !== undefined ? "advanced" : "registered",
    workflow_id: state.workflow_id,
    epochs: baselineChain(mapped),
    repos: baselineRepoChains(mapped),
  };
}

/**
 * Gate check of an evidence's `baseline_kind` (4.10.0): absent means `workflow` (every
 * evidence produced before 4.10.0, and every evidence of a module without adoption);
 * it must equal the kind of the baseline that applies to the module now, so evidence
 * produced against the global chain is never accepted against an adoption baseline
 * (or the other way round).
 */
export function baselineKindErrors(recorded: unknown, baseline: WorkflowBaseline, label: string): string[] {
  const kind = recorded === undefined ? "workflow" : recorded;
  if (kind !== "workflow" && kind !== "adoption") return [`${label} baseline_kind must be "adoption" or "workflow", got ${JSON.stringify(recorded)}`];
  if (kind === baseline.kind) return [];
  return [`${label} baseline_kind ${kind} does not match the ${baseline.kind} baseline that now applies to this module${baseline.kind === "adoption" ? " (orchestrate baseline --adopt)" : ""}; refresh the evidence with evidence run --refresh`];
}

/** Null when the project is a git work tree, otherwise why it is not (git missing included). */
export function gitWorkTreeError(projectRoot: string): string | null {
  const inside = git(projectRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.error) return `git is unavailable (${inside.error.message})`;
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return "the project is not a git repository";
  return null;
}

// ---------------------------------------------------------------------------
// UC-D code_refs (tdd_mode characterization, 4.6.0 S2)
// ---------------------------------------------------------------------------

export interface CodeRef {
  /** Project-relative POSIX path inside one of the source roots. */
  path: string;
  symbol?: string;
}

/**
 * Parse one UC-D `code_refs` entry `<project-relative path>[::<symbol>]`. The path
 * follows the source-root rules (normalizeSourceRoot: `\` or `/` separators; absolute,
 * drive, UNC, `.`/`..` and control-plane paths rejected) and must lie inside one of
 * `roots`. The symbol, when given, is a single token without whitespace or `:`.
 */
export function parseCodeRef(value: unknown, roots: readonly string[], label: string): CodeRef {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty "<path>[::<symbol>]" string`);
  const raw = value.trim();
  const separator = raw.indexOf("::");
  const pathPart = separator >= 0 ? raw.slice(0, separator) : raw;
  const symbol = separator >= 0 ? raw.slice(separator + 2).trim() : undefined;
  const where = `${label} ${JSON.stringify(value)}`;
  if (symbol !== undefined && symbol.length === 0) throw new Error(`${where}: the symbol after "::" must not be empty`);
  if (symbol !== undefined && !/^[^\s:]+$/.test(symbol)) throw new Error(`${where}: the symbol must be a single token without whitespace or ":"`);
  const path = normalizeSourceRoot(pathPart, where);
  if (!roots.some((sourceRoot) => path.startsWith(`${sourceRoot}/`))) {
    throw new Error(`${where}: ${path} is outside the source roots (${roots.join(", ")})`);
  }
  return symbol === undefined ? { path } : { path, symbol };
}

function escapeExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a code ref against the workflow baseline commit: no symbolic link on the
 * path in the worktree, `git cat-file -e <base>:<path>` succeeds, the tree entry is a
 * regular file (not a symlink or a directory), and a declared symbol occurs as a whole
 * token in `git show <base>:<path>`. Returns the git blob id of the file at the base.
 */
export function baselineCodeRef(projectRoot: string, commit: string, ref: CodeRef, label: string, repo?: CodeRefRepo): { blob: string } | { error: string } {
  const base = root(projectRoot);
  const segments = ref.path.split("/");
  for (let index = 1; index <= segments.length; index++) {
    const partial = segments.slice(0, index).join("/");
    let isLink = false;
    try {
      isLink = lstatSync(join(base, ...segments.slice(0, index))).isSymbolicLink();
    } catch {
      break;
    }
    if (isLink) return { error: `${label}: ${partial} is a symbolic link in the worktree` };
  }
  // 4.9.0: a code ref of a nested repository resolves inside that repository, at its own commit.
  const nested = repo && repo.repoKey !== WORKFLOW_REPO_KEY ? repo : undefined;
  const cwd = nested ? nested.repoRoot : projectRoot;
  const path = nested ? nested.relativePath : ref.path;
  const where = nested ? `the baseline ${commit} of the nested repository ${nested.repoKey}/` : `the workflow baseline ${commit}`;
  const spec = `${commit}:${path}`;
  const exists = git(cwd, ["cat-file", "-e", spec]);
  if (exists.error) return { error: `${label}: git is unavailable (${exists.error.message})` };
  if (exists.status !== 0) {
    const hint = nested ? undefined : nestedRepositoryHint(projectRoot, ref.path);
    return { error: `${label}: ${ref.path} does not exist in ${where}; characterization covers code that already existed at the baseline${hint ? `. ${hint}` : ""}` };
  }
  const listed = git(cwd, ["ls-tree", "-z", commit, "--", path]);
  const entry = listed.status === 0 ? listed.stdout.split("\0").find((line) => line.endsWith(`\t${path}`)) : undefined;
  const match = entry ? /^(\d{6}) (\w+) ([a-f0-9]{40}|[a-f0-9]{64})\t/.exec(entry) : null;
  if (!match) return { error: `${label}: cannot read the tree entry of ${ref.path} at ${where}` };
  const [, mode, type, blob] = match;
  if (mode === "120000") return { error: `${label}: ${ref.path} is a symbolic link in ${where}` };
  if (type !== "blob") return { error: `${label}: ${ref.path} is not a file in ${where} (git ${type})` };
  if (ref.symbol !== undefined) {
    const shown = git(cwd, ["show", spec]);
    if (shown.status !== 0) return { error: `${label}: cannot read ${ref.path} at ${where}: ${shown.stderr.trim()}` };
    const token = new RegExp(`(?<![A-Za-z0-9_$])${escapeExpression(ref.symbol)}(?![A-Za-z0-9_$])`);
    if (!token.test(shown.stdout)) return { error: `${label}: symbol ${ref.symbol} not found in ${ref.path} at ${where}` };
  }
  return { blob };
}

// ---------------------------------------------------------------------------
// Nested source repositories (4.9.0)
// ---------------------------------------------------------------------------

/** Commits of the nested repositories registered at `epoch` of a registered baseline (start ≤ epoch). */
export function epochRepos(baseline: Extract<WorkflowBaseline, { registered: true }>, epoch: number): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, chain] of Object.entries(baseline.repos)) {
    if (epoch >= chain.start && epoch - chain.start < chain.commits.length) result[key] = chain.commits[epoch - chain.start];
  }
  return result;
}

/**
 * Errors when the registered nested repositories and the declared ones disagree by an
 * extra key (registered but no longer declared). A declared but unregistered repository
 * is a pending migration, reported only by the operations that need it.
 */
export function extraRepoKeyErrors(baseline: Extract<WorkflowBaseline, { registered: true }>, declared: readonly string[]): string[] {
  const extra = Object.keys(baseline.repos).filter((key) => !declared.includes(key)).sort();
  if (extra.length === 0) return [];
  return [`the workflow baseline registers nested repositories that ${SOURCE_ROOTS_CONFIG} no longer declares: ${extra.map((key) => `${key}/`).join(", ")} (registered: ${Object.keys(baseline.repos).sort().join(", ") || "none"}; declared: ${declared.join(", ") || "none"}); a registered nested repository cannot be removed from a workflow — restore the declaration or start a new workflow`];
}

/** Declared nested repositories that the workflow baseline has not registered (pending migration). */
export function pendingRepos(baseline: Extract<WorkflowBaseline, { registered: true }>, declared: readonly string[]): string[] {
  return declared.filter((key) => !(key in baseline.repos));
}

/**
 * Git checks of one nested repository commit: the repository has a HEAD, the commit is
 * an existing commit object that is HEAD or one of its ancestors (shallow clones that
 * cannot prove ancestry reject). The repository's own errors are prefixed with its key.
 */
export function nestedCommitErrors(projectRoot: string, key: string, commit: string, label = "commit"): string[] {
  const repoRoot = join(root(projectRoot), ...key.split("/"));
  if (!COMMIT_ID_PATTERN.test(commit)) return [`${key}/: ${label} ${JSON.stringify(commit)} must be a 40- or 64-character lowercase hex commit id`];
  if (currentHeadCommit(repoRoot) === BASELINE_UNAVAILABLE) return [`${key}/: the nested repository has no HEAD commit`];
  const check = commitIsAncestorOfHead(repoRoot, commit, `${key}/ ${label}`);
  return check.ok ? [] : [check.error];
}

/**
 * Per-repository variant of checkAdvanceTarget: the target equals the current commit
 * (this repository does not advance in this epoch) or is a strict descendant of it,
 * and is HEAD of the nested repository or one of its ancestors.
 */
export function checkRepoAdvanceTarget(projectRoot: string, key: string, current: string, target: string): { error: string } | { moved: boolean } {
  const repoRoot = join(root(projectRoot), ...key.split("/"));
  const errors = nestedCommitErrors(projectRoot, key, target, "--repo target");
  if (errors.length > 0) return { error: errors.join("; ") };
  if (target === current) return { moved: false };
  const descendant = git(repoRoot, ["merge-base", "--is-ancestor", current, target]);
  if (descendant.error) return { error: `${key}/: commit ${target} cannot be verified: git is unavailable (${descendant.error.message})` };
  if (descendant.status === 0) return { moved: true };
  if (isShallow(repoRoot)) return { error: `${key}/: commit ${target} could not be confirmed as a descendant of the current baseline ${current}: ${UNSHALLOW_HINT}` };
  if (descendant.status === 1) return { error: `${key}/: commit ${target} is not a descendant of the current baseline epoch ${current} of the nested repository (nor equal to it)` };
  return { error: `${key}/: commit ${target} ancestry cannot be determined (git merge-base exit ${descendant.status}): ${descendant.stderr.trim()}` };
}

/**
 * Registration checks of one nested repository commit (`--set`, `next --scope`,
 * migration): repository HEAD, commit object, HEAD ancestry, not shallow, a committer
 * date no later than the workflow start (when given), and ancestor of every controlled
 * evidence anchor `source_revision.repos.<key>.commit`.
 */
export function checkRepoCandidate(projectRoot: string, key: string, commit: string, startedAt?: string): { error: string } | { head: string; committer_date: string; anchors: string[] } {
  const repoRoot = join(root(projectRoot), ...key.split("/"));
  const head = currentHeadCommit(repoRoot);
  if (head === BASELINE_UNAVAILABLE) return { error: `${key}/: the nested repository has no commit yet; commit first` };
  const errors = nestedCommitErrors(projectRoot, key, commit);
  if (errors.length > 0) return { error: errors.join("; ") };
  const anchors: string[] = [];
  for (const file of scanEvidenceFiles(projectRoot)) {
    if (file.error) return { error: `evidence ${file.path} ${file.error}; evidence anchors cannot be verified` };
    const evidence = asRecord(file.value);
    if (asRecord(evidence?.producer)?.mode !== "controlled") continue;
    const repos = asRecord(asRecord(evidence?.source_revision)?.repos);
    if (!repos || !(key in repos)) continue;
    const anchor = asRecord(repos[key])?.commit;
    if (typeof anchor !== "string" || !COMMIT_ID_PATTERN.test(anchor)) {
      return { error: `controlled evidence ${file.path} has source_revision.repos.${key}.commit ${JSON.stringify(anchor)}, which cannot serve as an evidence anchor` };
    }
    if (anchor === commit || anchors.includes(anchor)) {
      if (!anchors.includes(anchor)) anchors.push(anchor);
      continue;
    }
    const result = git(repoRoot, ["merge-base", "--is-ancestor", commit, anchor]);
    if (result.error) return { error: `${key}/: evidence anchor ${anchor} cannot be verified: git is unavailable (${result.error.message})` };
    if (result.status !== 0) return { error: `${key}/: commit ${commit} is not an ancestor of evidence anchor ${anchor} (${file.path}); the baseline must predate all evidence of this workflow` };
    anchors.push(anchor);
  }
  const dates = git(repoRoot, ["show", "-s", "--format=%cI", commit]);
  if (dates.status !== 0) return { error: `${key}/: cannot read the dates of commit ${commit}: ${dates.stderr.trim()}` };
  const committerDate = dates.stdout.trim();
  if (startedAt !== undefined) {
    const committed = Date.parse(committerDate);
    if (Number.isNaN(committed)) return { error: `${key}/: commit ${commit} has an unreadable committer date ${JSON.stringify(committerDate)}` };
    if (committed > Date.parse(startedAt)) return { error: `${key}/: commit ${commit} committer date ${committerDate} (self-reported) is later than the workflow start ${startedAt}; the baseline must predate the workflow` };
  }
  return { head, committer_date: committerDate, anchors };
}

/** Whether `git status --porcelain` of the nested repository reports anything (untracked files included); null when unreadable. */
export function nestedDirty(projectRoot: string, key: string): boolean | null {
  const result = git(join(root(projectRoot), ...key.split("/")), ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Evidence scan (anchors for --set, usage U2-U4 for --replace)
// ---------------------------------------------------------------------------

export interface EvidenceFile {
  /** Project-relative POSIX path. */
  path: string;
  value?: unknown;
  error?: string;
}

/** Every `.json` file under `.aidlc/evidence/`, parsed; unreadable entries carry `error`. */
export function scanEvidenceFiles(projectRoot: string): EvidenceFile[] {
  const base = root(projectRoot);
  const found: EvidenceFile[] = [];
  const label = (path: string) => relative(base, path).replace(/\\/g, "/");
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        found.push({ path: label(path), error: "evidence entry is a symbolic link" });
      } else if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          found.push({ path: label(path), value: JSON.parse(readFileSync(path, "utf8")) });
        } catch (error) {
          found.push({ path: label(path), error: `cannot be parsed: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
    }
  };
  const evidence = join(base, EVIDENCE_ROOT);
  if (existsSync(evidence)) {
    if (lstatSync(evidence).isSymbolicLink()) return [{ path: label(evidence), error: "evidence directory is a symbolic link" }];
    walk(evidence);
  }
  return found;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function hasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKey(item, key));
  const record = asRecord(value);
  if (!record) return false;
  return Object.prototype.hasOwnProperty.call(record, key) || Object.values(record).some((item) => hasKey(item, key));
}

function nonEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  const record = asRecord(value);
  return record ? Object.keys(record).length > 0 : true;
}

// ---------------------------------------------------------------------------
// Registration checks (orchestrate baseline --set, and --replace for the new commit)
// ---------------------------------------------------------------------------

export interface BaselineCandidate {
  commit: string;
  head: string;
  committer_date: string;
  author_date: string;
  /** T0 = min(state.created_at, history[0].timestamp), as recorded. */
  workflow_started_at: string;
  anchors: string[];
  tracked_state: string;
}

/** The workflow start T0: the earlier of Created At and the first history entry. */
export function workflowStartedAt(state: Pick<WorkflowState, "created_at" | "history">): string {
  const first = state.history[0]?.timestamp;
  return first && Date.parse(first) < Date.parse(state.created_at) ? first : state.created_at;
}

/**
 * Structural and time checks a commit must pass before it becomes the workflow
 * baseline: git repository, existing commit object, HEAD ancestry (shallow clones
 * reject with an unshallow hint), ancestor of every controlled evidence anchor, not
 * already containing this workflow's tracked state file, and a self-reported
 * committer date no later than the workflow start. The time check only guards
 * against mistakes; committer dates are chosen by the committer.
 */
export function checkBaselineCandidate(projectRoot: string, state: WorkflowState, commit: string): { error: string } | { candidate: BaselineCandidate } {
  const inside = git(projectRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.error) return { error: `git is unavailable (${inside.error.message}); orchestrate baseline requires a git repository` };
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return { error: "the project is not a git repository; orchestrate baseline requires git" };
  const head = currentHeadCommit(projectRoot);
  if (head === BASELINE_UNAVAILABLE) return { error: "the git repository has no HEAD commit; commit first, then register the baseline" };

  const ancestry = commitIsAncestorOfHead(projectRoot, commit, "commit");
  if (!ancestry.ok) return { error: ancestry.error };

  const anchors: string[] = [];
  for (const file of scanEvidenceFiles(projectRoot)) {
    if (file.error) return { error: `evidence ${file.path} ${file.error}; evidence anchors cannot be verified` };
    const evidence = asRecord(file.value);
    if (asRecord(evidence?.producer)?.mode !== "controlled") continue;
    const anchor = asRecord(evidence?.source_revision)?.commit;
    if (typeof anchor !== "string" || !COMMIT_ID_PATTERN.test(anchor)) {
      return { error: `controlled evidence ${file.path} has source_revision.commit ${JSON.stringify(anchor)}, which cannot serve as an evidence anchor` };
    }
    if (anchor === commit || anchors.includes(anchor)) {
      if (!anchors.includes(anchor)) anchors.push(anchor);
      continue;
    }
    const result = git(projectRoot, ["merge-base", "--is-ancestor", commit, anchor]);
    if (result.error) return { error: `evidence anchor ${anchor} cannot be verified: git is unavailable (${result.error.message})` };
    if (result.status !== 0) return { error: `commit ${commit} is not an ancestor of evidence anchor ${anchor} (${file.path}); the baseline must predate all evidence of this workflow` };
    anchors.push(anchor);
  }

  let trackedState = "untracked";
  const tracked = git(projectRoot, ["ls-files", "--error-unmatch", "--", STATE_PATH_IN_TREE]);
  if (tracked.error) return { error: `git is unavailable (${tracked.error.message})` };
  if (tracked.status === 0) {
    const shown = git(projectRoot, ["show", `${commit}:${STATE_PATH_IN_TREE}`]);
    if (shown.status !== 0) {
      trackedState = "absent";
    } else {
      const workflowId = /^- Workflow ID:\s*(.*)$/m.exec(shown.stdout)?.[1]?.replace(/^`|`$/g, "").trim();
      if (workflowId === state.workflow_id) {
        return { error: `commit ${commit} already contains this workflow's state file (${STATE_PATH_IN_TREE}, Workflow ID ${state.workflow_id}); the baseline must predate the workflow` };
      }
      trackedState = `other workflow ${workflowId || "(unreadable)"}`;
    }
  }

  const dates = git(projectRoot, ["show", "-s", "--format=%cI%n%aI", commit]);
  if (dates.status !== 0) return { error: `cannot read the dates of commit ${commit}: ${dates.stderr.trim()}` };
  const [committerDate = "", authorDate = ""] = dates.stdout.trim().split(/\r?\n/);
  const startedAt = workflowStartedAt(state);
  const committed = Date.parse(committerDate);
  if (Number.isNaN(committed)) return { error: `commit ${commit} has an unreadable committer date ${JSON.stringify(committerDate)}` };
  if (committed > Date.parse(startedAt)) {
    return { error: `commit ${commit} committer date ${committerDate} (self-reported) is later than the workflow start ${startedAt}; the baseline must predate the workflow` };
  }
  return { candidate: { commit, head, committer_date: committerDate, author_date: authorDate, workflow_started_at: startedAt, anchors, tracked_state: trackedState } };
}

// ---------------------------------------------------------------------------
// Adoption checks (orchestrate baseline --adopt --module, 4.10.0)
// ---------------------------------------------------------------------------

/** Rules an adoption commit is exempted from, as recorded in the BASELINE_ADOPTED audit entry. */
export const ADOPTION_EXEMPTED_RULES: readonly string[] = [
  "committer date no later than the workflow start (T0)",
  "commit must not contain this workflow's state file",
];
/** Rules of --set an adoption commit satisfies in a different form. */
export const ADOPTION_REPLACED_RULES: readonly string[] = [
  "ancestor of every evidence anchor -> the module holds no RED / BASELINE / GREEN evidence",
];

/**
 * Git checks of one adoption commit, in the workflow repository (`key` undefined) or a
 * nested repository: a git work tree with a HEAD, not a shallow clone, an existing
 * commit object that is HEAD or one of its ancestors, and (when `notAfter` is given) a
 * self-reported committer date no later than it (the first tdd start of the module).
 * The workflow-start (T0) and state-file rules of --set do not apply.
 */
export function checkAdoptionCandidate(projectRoot: string, commit: string, notAfter?: string, key?: string): { error: string } | { head: string; committer_date: string } {
  const cwd = key ? join(root(projectRoot), ...key.split("/")) : projectRoot;
  const prefix = key ? `${key}/: ` : "";
  if (!key) {
    const repository = gitWorkTreeError(projectRoot);
    if (repository) return { error: `${repository}; orchestrate baseline --adopt requires a git repository` };
  }
  const head = currentHeadCommit(cwd);
  if (head === BASELINE_UNAVAILABLE) return { error: `${prefix}the repository has no HEAD commit; commit first` };
  if (isShallow(cwd)) return { error: `${prefix}${UNSHALLOW_HINT}` };
  if (!COMMIT_ID_PATTERN.test(commit)) return { error: `${prefix}commit ${JSON.stringify(commit)} must be a 40- or 64-character lowercase hex commit id` };
  const ancestry = commitIsAncestorOfHead(cwd, commit, `${prefix}commit`);
  if (!ancestry.ok) return { error: ancestry.error };
  const dates = git(cwd, ["show", "-s", "--format=%cI", commit]);
  if (dates.status !== 0) return { error: `${prefix}cannot read the dates of commit ${commit}: ${dates.stderr.trim()}` };
  const committerDate = dates.stdout.trim();
  const committed = Date.parse(committerDate);
  if (Number.isNaN(committed)) return { error: `${prefix}commit ${commit} has an unreadable committer date ${JSON.stringify(committerDate)}` };
  if (notAfter !== undefined && committed > Date.parse(notAfter)) {
    return { error: `${prefix}commit ${commit} committer date ${committerDate} (self-reported) is later than the first tdd start of the module ${notAfter}; adoption must predate the module's tdd` };
  }
  return { head, committer_date: committerDate };
}

/**
 * RED / BASELINE / GREEN evidence of a module (any stage, any unit), project-relative.
 * An unreadable or symlinked evidence entry under the module counts as held (fail closed).
 *
 * 4.10.1: a `not_required` record carrying `ucd_exemption`, directly under a unit named
 * in `exemptUnits` (units with an empty UC-D subset and a `ucd_exemption`), observed no
 * code and is reported in `exempt` instead of `held`. Every other record stays held.
 */
export function modulePhaseEvidence(projectRoot: string, moduleId: string, exemptUnits: ReadonlySet<string> = new Set()): { held: string[]; exempt: string[] } {
  const pattern = new RegExp("^\\.aidlc/evidence/[^/]+/" + escapeExpression(moduleId) + "/(?:.+/)?(?:red|baseline|green)-test-evidence\\.json" + "$");
  const unitPattern = new RegExp("^\\.aidlc/evidence/[^/]+/" + escapeExpression(moduleId) + "/([^/]+)/(?:red|baseline|green)-test-evidence\\.json" + "$");
  const held: string[] = [];
  const exempt: string[] = [];
  for (const file of scanEvidenceFiles(projectRoot)) {
    if (file.error !== undefined) {
      if (pattern.test(file.path) || file.path.includes("/" + moduleId + "/")) held.push(file.path);
      continue;
    }
    if (!pattern.test(file.path)) continue;
    const unitId = unitPattern.exec(file.path)?.[1];
    const record = asRecord(file.value);
    const exemption = record?.ucd_exemption;
    const exempted = unitId !== undefined && exemptUnits.has(unitId) && record?.status === "not_required" && !!exemption && typeof exemption === "object" && !Array.isArray(exemption);
    (exempted ? exempt : held).push(file.path);
  }
  return { held, exempt };
}

// ---------------------------------------------------------------------------
// Usage check (orchestrate baseline --replace)
// ---------------------------------------------------------------------------

export interface BaselineUsage {
  used: boolean;
  findings: string[];
  /** e.g. "U1=clear U2=used U3=clear U4=clear (workflows scanned: 3)" */
  summary: string;
  workflows: number;
}

/**
 * Whether the current baseline has been used, over the parent and every module /
 * integration sub-workflow: U1 a tdd / code-generation / code-review / build-and-test
 * instance is completed or active; U2 a completed test-case-derivation instance has
 * I13 evidence with a non-empty `characterization`; U3 any evidence records a
 * `baseline_commit`; U4 any evidence file cannot be parsed (treated as used).
 */
export function baselineUsage(projectRoot: string): BaselineUsage {
  const loaded = loadWorkflowParts(projectRoot);
  const findings: Record<"U1" | "U2" | "U3" | "U4", string[]> = { U1: [], U2: [], U3: [], U4: [] };
  const evidence = scanEvidenceFiles(projectRoot);
  const byPath = new Map(evidence.map((file) => [file.path, file]));
  for (const part of loaded.parts.values()) {
    const key = workflowRefKey(part.ref);
    for (const instance of [...part.state.completed_stage_instances, ...Object.keys(part.state.active_instances || {})]) {
      if (BASELINE_CONSUMING_STAGES.has(instance.split("@", 1)[0])) findings.U1.push(`${key}: ${instance}`);
    }
    for (const instance of part.state.completed_stage_instances.filter((value) => value.split("@", 1)[0] === "test-case-derivation")) {
      const moduleId = /@module:([a-z0-9][a-z0-9-]*)/.exec(instance)?.[1];
      const path = moduleId
        ? `.aidlc/evidence/test-case-derivation/${moduleId}/test-case-derivation.json`
        : ".aidlc/evidence/test-case-derivation/test-case-derivation.json";
      const file = byPath.get(path);
      if (file && !file.error && nonEmpty(asRecord(file.value)?.characterization)) findings.U2.push(`${key}: ${instance} (${path})`);
    }
  }
  for (const file of evidence) {
    if (file.error) findings.U4.push(`${file.path} ${file.error}`);
    else if (hasKey(file.value, "baseline_commit")) findings.U3.push(file.path);
  }
  const workflows = loaded.parts.size;
  const ids = ["U1", "U2", "U3", "U4"] as const;
  return {
    used: ids.some((id) => findings[id].length > 0),
    findings: ids.flatMap((id) => findings[id].map((item) => `${id} ${item}`)),
    summary: `${ids.map((id) => `${id}=${findings[id].length ? "used" : "clear"}`).join(" ")} (workflows scanned: ${workflows})`,
    workflows,
  };
}
