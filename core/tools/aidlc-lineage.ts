/**
 * aidlc-lineage.ts — workflow lineage protection (4.13.0, MARS-98).
 *
 * A workflow lineage is identified by the Workflow ID of aidlc/active/aidlc-state.md
 * (the global workflow, equal to the registry's Global Workflow ID after a split).
 * The control plane is plain Markdown merged by git, so a second lineage — created on
 * a checkout that predates the first one's split, then merged with "keep local" — used
 * to replace the team's progress silently. This module reads git to find:
 *
 * - lineages in the history of HEAD (`git log --full-history -G`) and at the tips of
 *   local and remote-tracking branches (`git grep`) that are neither the active
 *   lineage, nor archived (aidlc/archive/<id>-<timestamp>), nor explicitly retired
 *   (`- Retired Lineages:` of the global state);
 * - state files whose Revision is lower than one already committed for the same
 *   workflow ID (a "keep local" merge that rolled progress back).
 *
 * Everything here is read-only and silent outside a git work tree.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { runSync } from "./aidlc-spawn";
import { parseLightWorkflowState } from "./aidlc-light-state";
import { parseRegistry } from "./aidlc-workflow-layout";

export const STATE_PATH = "aidlc/active/aidlc-state.md";
export const REGISTRY_PATH = "aidlc/active/registry.md";
const ID_LINE = /^- (?:Global |Split From )?Workflow ID:[ \t]*(\S+)[ \t]*$/;
/** Commits per `git grep` call; keeps the argv well below the Windows command-line limit. */
const GREP_CHUNK = 200;

export interface LineageSighting {
  /** "history": committed in the history of HEAD; "ref": active at the tip of a branch. */
  source: "history" | "ref";
  commit: string;
  ref?: string;
  /** The sighting carries a split registry with this lineage as Global Workflow ID. */
  split?: boolean;
}

export interface LineageConflict {
  workflow_id: string;
  sightings: LineageSighting[];
  /** Newest commit in the history of HEAD whose global state or registry carries this lineage. */
  last_present_commit?: string;
  /** Short progress summary read from the last present commit (registry rows or the single state). */
  progress?: string[];
}

export interface RevisionRegression {
  path: string;
  workflow_id: string;
  current_revision: number;
  committed_revision: number;
  commit: string;
  restore_command: string;
}

function git(root: string, args: string[]): { ok: boolean; status: number | null; stdout: string } {
  const result = runSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  return { ok: result.status === 0 && !result.error, status: result.status, stdout: String(result.stdout || "") };
}

/** True when `root` is inside a git work tree with at least one commit. */
export function gitHistoryAvailable(root: string): boolean {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") return false;
  return git(root, ["rev-parse", "--verify", "-q", "HEAD"]).ok;
}

/** Lineage IDs of workflows archived by `orchestrate archive` (aidlc/archive/<id>-<timestamp>). */
export function archivedLineages(root: string): Set<string> {
  const dir = resolve(root, "aidlc", "archive");
  if (!existsSync(dir)) return new Set();
  const ids = new Set<string>();
  for (const name of readdirSync(dir)) {
    const match = /^(.+)-\d{8}T\d{6}Z$/.exec(name);
    if (match) ids.add(match[1]);
  }
  return ids;
}

/** Lineages committed in the history of HEAD, newest introducing commit first. */
export function historyLineages(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const log = git(root, ["log", "--full-history", "--no-color", "--no-ext-diff", "--no-renames", "-U0", "-p", "--format=%x01%H", "-GWorkflow ID: ", "HEAD", "--", STATE_PATH, REGISTRY_PATH]);
  if (!log.ok) return result;
  for (const block of log.stdout.split("\x01").slice(1)) {
    const [commit, ...lines] = block.split(/\r?\n/);
    for (const line of lines) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      const match = ID_LINE.exec(line.slice(1));
      if (match && !result.has(match[1])) result.set(match[1], commit.trim());
    }
  }
  return result;
}

interface GrepHit {
  commit: string;
  path: string;
  line: string;
}

/** `git grep` of fixed patterns in the trees of the given commits, limited to `paths`. */
function grepCommits(root: string, commits: string[], patterns: string[], paths: string[]): GrepHit[] {
  const hits: GrepHit[] = [];
  for (let index = 0; index < commits.length; index += GREP_CHUNK) {
    const chunk = commits.slice(index, index + GREP_CHUNK);
    const args = ["grep", "--full-name", "--no-color", "-I", ...patterns.flatMap((pattern) => ["-e", pattern]), ...chunk, "--", ...paths];
    const result = git(root, args);
    // Exit status 1 means no match.
    if (!result.ok && result.status !== 1) continue;
    for (const raw of result.stdout.split(/\r?\n/)) {
      const match = /^([0-9a-f]{7,64}):([^:]+):(.*)$/.exec(raw);
      if (match) hits.push({ commit: match[1], path: match[2], line: match[3] });
    }
  }
  return hits;
}

/** Path of `relativePath` (relative to the project root) as `git grep --full-name` prints it. */
function fullName(root: string, relativePath: string): string {
  const prefix = git(root, ["rev-parse", "--show-prefix"]);
  return `${prefix.ok ? prefix.stdout.trim() : ""}${relativePath}`;
}

/** Active lineages at the tips of local and remote-tracking branches. */
export function refLineages(root: string): Map<string, LineageSighting[]> {
  const result = new Map<string, LineageSighting[]>();
  const refs = git(root, ["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads", "refs/remotes"]);
  if (!refs.ok) return result;
  const byCommit = new Map<string, string[]>();
  for (const line of refs.stdout.split(/\r?\n/)) {
    const [commit, ref] = line.trim().split(" ");
    if (!commit || !ref || ref.endsWith("/HEAD")) continue;
    byCommit.set(commit, [...(byCommit.get(commit) || []), ref]);
  }
  const registry = fullName(root, REGISTRY_PATH);
  const hits = grepCommits(root, [...byCommit.keys()], ["^- Workflow ID: ", "^- Global Workflow ID: "], [STATE_PATH, REGISTRY_PATH]);
  for (const hit of hits) {
    const match = ID_LINE.exec(hit.line);
    if (!match) continue;
    const split = hit.path === registry;
    for (const ref of byCommit.get(hit.commit) || []) {
      const list = result.get(match[1]) || [];
      const existing = list.find((item) => item.ref === ref);
      if (existing) existing.split = existing.split || split;
      else list.push({ source: "ref", commit: hit.commit, ref, split });
      result.set(match[1], list);
    }
  }
  return result;
}

function lastPresent(root: string, workflowId: string): { commit?: string; progress?: string[] } {
  const commits = git(root, ["rev-list", "--full-history", "HEAD", "--", STATE_PATH, REGISTRY_PATH]);
  if (!commits.ok) return {};
  const list = commits.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hits = grepCommits(root, list, [`^- Workflow ID: ${workflowId}`, `^- Global Workflow ID: ${workflowId}`], [STATE_PATH, REGISTRY_PATH]);
  const present = new Set(hits.filter((hit) => ID_LINE.exec(hit.line)?.[1] === workflowId).map((hit) => hit.commit));
  const commit = list.find((item) => present.has(item));
  return commit ? { commit, progress: progressAt(root, commit) } : {};
}

function showFile(root: string, commit: string, path: string): string | null {
  const result = git(root, ["show", `${commit}:./${path}`]);
  return result.ok ? result.stdout : null;
}

/** 4.13.0: a file of a commit (null when the commit or the path does not exist). */
export function committedFile(root: string, commit: string, path: string): string | null {
  return showFile(root, commit, path);
}

/** The full commit ID of a revision expression, or null. */
export function resolveCommit(root: string, revision: string): string | null {
  if (!/^[0-9A-Za-z][0-9A-Za-z._\/~^-]*$/.test(revision)) return null;
  const result = git(root, ["rev-parse", "--verify", "-q", `${revision}^{commit}`]);
  return result.ok ? result.stdout.trim() : null;
}

function progressAt(root: string, commit: string): string[] | undefined {
  const registry = showFile(root, commit, REGISTRY_PATH);
  if (registry) {
    try {
      const parsed = parseRegistry(registry.replace(/\r\n/g, "\n"));
      // 4.13.0 registries keep identity rows only; progress is read from each module state.
      return parsed.modules.map((row) => {
        const text = showFile(root, commit, row.state_path);
        if (!text) return `${row.module_id}: no state`;
        try {
          const state = parseLightWorkflowState(text.replace(/\r\n/g, "\n"));
          return `${row.module_id}: revision ${state.revision}, ${state.status}, current ${state.current_stage_instance || state.current_stage || "-"}`;
        } catch {
          return `${row.module_id}: unreadable state`;
        }
      });
    } catch { /* fall back to the state summary */ }
  }
  const state = showFile(root, commit, STATE_PATH);
  if (!state) return undefined;
  try {
    const parsed = parseLightWorkflowState(state.replace(/\r\n/g, "\n"));
    return [`revision ${parsed.revision}, ${parsed.status}, current ${parsed.current_stage_instance || parsed.current_stage || "-"}, ${parsed.completed_stage_instances.length} completed instances`];
  } catch {
    return undefined;
  }
}

/**
 * Lineages other than `current` found in git (the history of HEAD, and with `refs`
 * also the branch tips), minus archived and retired ones.
 */
export function lineageConflicts(root: string, options: { current?: string; retired?: readonly string[]; refs?: boolean }): LineageConflict[] {
  if (!gitHistoryAvailable(root)) return [];
  const excluded = new Set<string>([...archivedLineages(root), ...(options.retired || [])]);
  if (options.current) excluded.add(options.current);
  const sightings = new Map<string, LineageSighting[]>();
  for (const [id, commit] of historyLineages(root)) {
    if (!excluded.has(id)) sightings.set(id, [{ source: "history", commit }]);
  }
  if (options.refs) {
    for (const [id, list] of refLineages(root)) {
      if (!excluded.has(id)) sightings.set(id, [...(sightings.get(id) || []), ...list]);
    }
  }
  return [...sightings.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([workflow_id, list]) => {
    const present = list.some((item) => item.source === "history") ? lastPresent(root, workflow_id) : {};
    return {
      workflow_id,
      sightings: list,
      ...(present.commit ? { last_present_commit: present.commit } : {}),
      ...(present.progress ? { progress: present.progress } : {}),
    };
  });
}

export function describeConflict(conflict: LineageConflict): string {
  const where = conflict.sightings.map((item) => item.source === "ref" ? `${item.ref}${item.split ? " (split)" : ""}` : `history ${item.commit.slice(0, 12)}`).join(", ");
  const last = conflict.last_present_commit ? `; last present at ${conflict.last_present_commit}` : "";
  const progress = conflict.progress?.length ? `; progress: ${conflict.progress.join("; ")}` : "";
  return `${conflict.workflow_id} (seen in ${where}${last}${progress})`;
}

/** Remediation shared by every lineage error. */
export function lineageRemedy(current: string | undefined, conflicts: LineageConflict[]): string {
  const ids = conflicts.map((item) => item.workflow_id).join(",");
  const restore = conflicts.find((item) => item.last_present_commit);
  return `Two workflow lineages cannot be merged automatically; decide which one is authoritative. ` +
    `Keep ${current ? `the active ${current}` : "the new workflow"}: orchestrate state retire --lineage ${ids} --user-input Approve --reason "<why>". ` +
    (restore && current ? `Or restore ${restore.workflow_id}: git checkout ${restore.last_present_commit} -- aidlc/active, then orchestrate state retire --lineage ${current} --user-input Approve --reason "<why>". ` : "") +
    `Details: orchestrate state verify.`;
}

function scalarOf(markdown: string, label: string): string | undefined {
  return new RegExp(`^- ${label}:[ \\t]*(\\S+)[ \\t]*$`, "m").exec(markdown)?.[1];
}

/** Every workflow state file of the active layout, relative to the project root. */
function activeStateFiles(root: string): string[] {
  const files = [STATE_PATH, "aidlc/active/integration/aidlc-state.md"];
  const modules = resolve(root, "aidlc", "active", "modules");
  if (existsSync(modules)) for (const name of readdirSync(modules).sort()) files.push(`aidlc/active/modules/${name}/aidlc-state.md`);
  return files.filter((path) => existsSync(resolve(root, path)));
}

/**
 * State files whose Revision is lower than a revision already committed (in the
 * history of HEAD) for the same workflow ID.
 */
export function revisionRegressions(root: string): RevisionRegression[] {
  if (!gitHistoryAvailable(root)) return [];
  const regressions: RevisionRegression[] = [];
  for (const path of activeStateFiles(root)) {
    const markdown = readFileSync(join(root, path), "utf8");
    const workflowId = scalarOf(markdown, "Workflow ID");
    const revision = Number(scalarOf(markdown, "Revision"));
    if (!workflowId || !Number.isInteger(revision)) continue;
    const commits = git(root, ["rev-list", "--full-history", "HEAD", "--", path]);
    if (!commits.ok) continue;
    const list = commits.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const perCommit = new Map<string, { id?: string; revision?: number }>();
    for (const hit of grepCommits(root, list, ["^- Workflow ID: ", "^- Revision: "], [path])) {
      const entry = perCommit.get(hit.commit) || {};
      const id = /^- Workflow ID:[ \t]*(\S+)/.exec(hit.line)?.[1];
      const rev = /^- Revision:[ \t]*(\d+)/.exec(hit.line)?.[1];
      if (id) entry.id = id;
      if (rev) entry.revision = Number(rev);
      perCommit.set(hit.commit, entry);
    }
    let best: { commit: string; revision: number } | undefined;
    for (const commit of list) {
      const entry = perCommit.get(commit);
      if (entry?.id !== workflowId || entry.revision === undefined) continue;
      if (!best || entry.revision > best.revision) best = { commit, revision: entry.revision };
    }
    if (best && best.revision > revision) {
      regressions.push({
        path,
        workflow_id: workflowId,
        current_revision: revision,
        committed_revision: best.revision,
        commit: best.commit,
        restore_command: `git show ${best.commit}:./${path}`,
      });
    }
  }
  return regressions;
}
