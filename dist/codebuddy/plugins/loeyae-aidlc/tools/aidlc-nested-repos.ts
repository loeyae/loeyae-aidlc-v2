/**
 * aidlc-nested-repos.ts — nested independent git repositories as source roots (4.9.0).
 *
 * A nested repository is declared only in `.aidlc/source-roots.json` as
 * `{ "path": "<dir>", "repo": "nested" }`. It is project-level topology: a code ref or
 * changed path under `<dir>/` belongs to that repository, whatever module-manifest
 * `paths` say. Nothing is detected automatically; a directory that merely happens to
 * be a git repository root only produces a hint (nestedRepositoryHint).
 *
 * Every git call uses argument arrays with `shell: false` and fails closed.
 */

import { spawnSync } from "child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "fs";
import { join, relative, resolve } from "path";
import { declaredNestedRoots, SOURCE_ROOTS_CONFIG } from "./aidlc-source-roots";

export const WORKFLOW_REPO_KEY = ".";

export interface CodeRefRepo {
  /** Absolute path of the repository the path belongs to. */
  repoRoot: string;
  /** "." for the workflow repository, otherwise the nested repository path. */
  repoKey: string;
  /** Path relative to `repoRoot` (POSIX). */
  relativePath: string;
}

function projectRootOf(projectRoot: string): string {
  return realpathSync(resolve(projectRoot));
}

function gitIn(cwd: string, args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8", shell: false, maxBuffer: 16 * 1024 * 1024 });
}

function under(path: string, key: string): boolean {
  return path === key || path.startsWith(`${key}/`);
}

/**
 * The declared nested repositories, checked on disk (fail closed): every path segment
 * is a real directory (no symbolic link or junction) whose realpath stays inside the
 * project root; `<path>/.git` exists (directory, or a worktree/submodule `.git` file);
 * `git -C <path> rev-parse --show-toplevel` is `<path>` itself; no nested repository
 * contains another; the workflow repository tracks no file under `<path>`.
 * Returns the sorted paths; [] when none is declared (no git call is made then).
 */
export function nestedSourceRepos(projectRoot: string): string[] {
  const declared = declaredNestedRoots(projectRoot);
  if (declared.length === 0) return [];
  const root = projectRootOf(projectRoot);
  const label = (key: string) => `${SOURCE_ROOTS_CONFIG} nested repository ${key}/`;
  for (const key of declared) {
    const segments = key.split("/");
    for (let index = 1; index <= segments.length; index++) {
      const partial = join(root, ...segments.slice(0, index));
      let info;
      try {
        info = lstatSync(partial);
      } catch {
        throw new Error(`${label(key)} does not exist`);
      }
      if (info.isSymbolicLink()) throw new Error(`${label(key)}: ${segments.slice(0, index).join("/")} is a symbolic link or junction; a nested repository must be a real directory inside the project`);
      if (!info.isDirectory()) throw new Error(`${label(key)}: ${segments.slice(0, index).join("/")} is not a directory`);
    }
    const absolute = join(root, ...segments);
    const real = realpathSync(absolute);
    const inside = relative(root, real).replace(/\\/g, "/");
    if (!inside || inside === ".." || inside.startsWith("../") || resolve(root, inside) !== real) {
      throw new Error(`${label(key)} resolves outside the project root (${real})`);
    }
    if (!existsSync(join(absolute, ".git"))) throw new Error(`${label(key)} is not a git repository root: ${key}/.git does not exist`);
    const top = gitIn(absolute, ["rev-parse", "--show-toplevel"]);
    if (top.error) throw new Error(`${label(key)} cannot be verified: git is unavailable (${top.error.message})`);
    const topLevel = top.status === 0 ? top.stdout.trim() : "";
    let topReal = "";
    try {
      topReal = topLevel ? realpathSync(topLevel) : "";
    } catch {
      topReal = "";
    }
    if (topReal !== real) {
      throw new Error(`${label(key)} is not a git repository root: git rev-parse --show-toplevel reports ${JSON.stringify(topLevel || top.stderr.trim())}, not ${key}/`);
    }
    const tracked = gitIn(root, ["ls-files", "-z", "--", key]);
    if (tracked.error || tracked.status !== 0) throw new Error(`${label(key)}: git ls-files of the workflow repository failed: ${tracked.error ? tracked.error.message : tracked.stderr.trim()}`);
    const files = tracked.stdout.split("\0").filter(Boolean);
    if (files.length > 0) {
      throw new Error(`${label(key)} is also tracked by the workflow repository (${files.slice(0, 3).join(", ")}${files.length > 3 ? ", …" : ""}); a file can belong to one repository only — untrack it from the workflow repository (and ignore ${key}/) or drop the nested declaration`);
    }
  }
  for (const key of declared) {
    const outer = declared.find((other) => other !== key && key.startsWith(`${other}/`));
    if (outer) throw new Error(`${label(key)} lies inside the nested repository ${outer}/; nested repositories must not contain each other`);
  }
  return declared;
}

/** Which repository a project-relative path belongs to: the innermost declared nested repository, or the workflow repository. */
export function codeRefRepo(projectRoot: string, path: string, nested: readonly string[]): CodeRefRepo {
  const root = projectRootOf(projectRoot);
  const key = [...nested].sort((left, right) => right.length - left.length).find((candidate) => under(path, candidate));
  if (!key) return { repoRoot: root, repoKey: WORKFLOW_REPO_KEY, relativePath: path };
  return { repoRoot: join(root, ...key.split("/")), repoKey: key, relativePath: path.slice(key.length + 1) };
}

/**
 * Hint for a code ref the workflow repository cannot resolve: the first directory on
 * its path that is an independent git repository (has `.git`) but is not declared
 * nested. Only a hint; behaviour never changes.
 */
export function nestedRepositoryHint(projectRoot: string, path: string): string | undefined {
  const root = projectRootOf(projectRoot);
  const segments = path.split("/");
  for (let index = 1; index < segments.length; index++) {
    const dir = segments.slice(0, index).join("/");
    if (existsSync(join(root, ...segments.slice(0, index), ".git"))) {
      return `${dir}/ is an independent git repository; declare it in ${SOURCE_ROOTS_CONFIG} as { "path": "${dir}", "repo": "nested" }`;
    }
  }
  return undefined;
}

/** The migration command printed while a declared nested repository has no baseline commit. */
export function nestedMigrationCommand(current: string, keys: readonly string[], heads: Record<string, string>): string {
  return `loeyae-aidlc orchestrate baseline --set ${current} --replace --expect ${current} ${keys.map((key) => `--repo ${key}=${heads[key] || "<sha>"}`).join(" ")} --user-input Approve --reason "..."`;
}

/** HEAD of a nested repository, or undefined (no commit / not a repository). */
export function nestedHead(projectRoot: string, key: string): string | undefined {
  const result = gitIn(join(projectRootOf(projectRoot), ...key.split("/")), ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const head = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return !result.error && result.status === 0 && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head) ? head : undefined;
}

/** Error naming declared nested repositories that are not registered in the workflow baseline (pending migration). */
export function pendingNestedError(projectRoot: string, current: string, pending: readonly string[]): string {
  const heads = Object.fromEntries(pending.map((key) => [key, nestedHead(projectRoot, key) || "<sha>"]));
  const names = pending.map((key) => `${key}/`).join(", ");
  // The trailing summary keeps the reason visible where only the tail of a message is shown.
  return `${names} ${pending.length === 1 ? "is" : "are"} declared as a nested source repository but the workflow baseline has no commit for ${pending.length === 1 ? "it" : "them"}; register ${pending.length === 1 ? "it" : "them"} with: ${nestedMigrationCommand(current, pending, heads)} (pending migration of ${names}; orchestrate baseline prints this command)`;
}

// ---------------------------------------------------------------------------
// "Involves a nested repository" (attest / worktree / structural-invariants)
// ---------------------------------------------------------------------------

export type NestedInvolvementReason = "code_ref" | "changed_path" | "evidence_repos";

export interface NestedInvolvement {
  repo: string;
  reason: NestedInvolvementReason;
  detail: string;
}

export interface NestedInvolvementResult {
  /** Declared nested repositories (a hint only; never a reason to refuse). */
  nested_source_roots: string[];
  nested_repos_involved: NestedInvolvement[];
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * Characterization code refs of one module (optionally one unit) from its I13
 * evidence: the unit subset by I13 `ucd_units` (4.8.0), or the module set without
 * them. Missing I13 → []; unreadable I13 throws (fail closed).
 */
export function i13CodeRefPaths(projectRoot: string, moduleId: string, unitId?: string): string[] {
  const path = join(projectRootOf(projectRoot), ".aidlc", "evidence", "test-case-derivation", moduleId, "test-case-derivation.json");
  if (!existsSync(path)) return [];
  let value: Record<string, unknown> | undefined;
  try {
    value = recordOf(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(`I13 evidence of module ${moduleId} cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value) throw new Error(`I13 evidence of module ${moduleId} must be a JSON object`);
  const entries = Array.isArray(value.characterization) ? value.characterization : [];
  const units = recordOf(value.ucd_units);
  const paths: string[] = [];
  for (const entry of entries) {
    const record = recordOf(entry);
    if (!record) continue;
    const ucd = String(record.ucd || "");
    if (unitId && units) {
      const owners = units[ucd];
      if (!Array.isArray(owners) || !owners.includes(unitId)) continue;
    }
    for (const ref of Array.isArray(record.code_refs) ? record.code_refs : []) {
      const refPath = recordOf(ref)?.path;
      if (typeof refPath === "string") paths.push(refPath);
    }
  }
  return [...new Set(paths)].sort();
}

/**
 * Shared "involves a nested repository" decision (4.9.0). A context is involved when
 *   1. code_ref: a characterization code ref of the instance's module/unit subset lies
 *      in a nested repository;
 *   2. changed_path: a compared changed / reviewed / evidence path lies in one;
 *   3. evidence_repos: an attested evidence records `source_revision.repos`.
 * Declared nested source roots alone are reported as `nested_source_roots` only.
 */
export function nestedInvolvement(projectRoot: string, input: {
  module_id?: string;
  unit_id?: string;
  paths?: readonly string[];
  evidence?: ReadonlyArray<{ path: string; value: unknown }>;
}): NestedInvolvementResult {
  const declared = declaredNestedRoots(projectRoot);
  const involved: NestedInvolvement[] = [];
  const repoOf = (path: string) => [...declared].sort((left, right) => right.length - left.length).find((key) => under(path.replace(/\\/g, "/"), key));
  if (declared.length > 0 && input.module_id) {
    for (const path of i13CodeRefPaths(projectRoot, input.module_id, input.unit_id)) {
      const repo = repoOf(path);
      if (repo) involved.push({ repo, reason: "code_ref", detail: path });
    }
  }
  if (declared.length > 0) {
    for (const path of input.paths || []) {
      const repo = repoOf(path);
      if (repo) involved.push({ repo, reason: "changed_path", detail: path });
    }
  }
  for (const file of input.evidence || []) {
    const repos = recordOf(recordOf(recordOf(file.value)?.source_revision)?.repos);
    if (repos) for (const repo of Object.keys(repos).sort()) involved.push({ repo, reason: "evidence_repos", detail: file.path });
  }
  return { nested_source_roots: declared, nested_repos_involved: involved };
}

/** One-line description of the involvement, e.g. `app/ (code_ref app/exporter.py)`. */
export function describeInvolvement(involved: readonly NestedInvolvement[]): string {
  return involved.map((item) => `${item.repo}/ (${item.reason} ${item.detail})`).join(", ");
}
