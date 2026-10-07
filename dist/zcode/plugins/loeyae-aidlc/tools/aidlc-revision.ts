import { createHash, type Hash } from "crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "fs";
import { join, relative, resolve } from "path";
import { runSync } from "./aidlc-spawn";

/** Revision of one nested source repository (4.9.0), computed in that repository. */
export interface RepoRevision {
  commit: string;
  dirty: boolean | null;
  worktree_digest: string | null;
}

export interface SourceRevision {
  commit: string;
  dirty: boolean | null;
  worktree_digest: string | null;
  scope?: string;
  scope_digest?: string | null;
  /** 4.9.0: one entry per declared nested repository, keyed by its project-relative path. */
  repos?: Record<string, RepoRevision>;
}

/**
 * A digest scope narrows which files bind a piece of evidence. `worktree` keeps
 * the historical whole-worktree binding; any other label is content-addressed
 * over the files the exclusion predicate keeps.
 */
export interface DigestScope {
  label: string;
  exclude: (path: string) => boolean;
}

function normalized(path: string): string {
  return path.replace(/\\/g, "/");
}

function excluded(path: string): boolean {
  const value = normalized(path);
  return value === ".aidlc" || value.startsWith(".aidlc/") || value === "aidlc" || value.startsWith("aidlc/");
}

function digestFile(root: string, path: string, label: string, targets: Hash[]): void {
  const absolute = resolve(root, path);
  const rel = normalized(relative(root, absolute));
  if (rel === ".." || rel.startsWith("../") || !existsSync(absolute)) return;
  const stat = lstatSync(absolute);
  for (const target of targets) target.update(label).update("\0");
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(absolute);
    for (const target of targets) target.update("symlink\0").update(link).update("\0");
  } else if (stat.isFile()) {
    const content = createHash("sha256").update(readFileSync(absolute)).digest();
    for (const target of targets) target.update("file\0").update(content).update("\0");
  }
}

function listedFiles(root: string): string[] | null {
  const files = runSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (files.status !== 0 || typeof files.stdout !== "string") return null;
  return files.stdout.split("\0").filter(Boolean).map(normalized);
}

function dirtyOf(root: string, ignore: (path: string) => boolean): boolean | null {
  const status = runSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  const statusEntries = typeof status.stdout === "string" ? status.stdout.split("\0").filter(Boolean) : [];
  return status.status === 0 ? statusEntries.some((entry) => {
    const candidate = entry.slice(3).split(" -> ").pop() || "";
    return !ignore(candidate);
  }) : null;
}

/**
 * Revision of one nested repository: its HEAD, whether `git status` reports anything
 * (untracked files included) and a digest over `git ls-files -co --exclude-standard`
 * of that repository, keyed by repository-relative paths. Files of the nested
 * repository whose project-relative path is in `scoped` also feed `scopeDigest`.
 */
function nestedRevision(projectRoot: string, key: string, scope?: { exclude: (path: string) => boolean; digest: Hash }): RepoRevision {
  const repoRoot = join(projectRoot, key);
  const revision = runSync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: repoRoot, encoding: "utf8", shell: false });
  const head = typeof revision.stdout === "string" ? revision.stdout.trim() : "";
  if (revision.error || revision.status !== 0 || !COMMIT_ID_PATTERN.test(head)) return { commit: "unavailable", dirty: null, worktree_digest: null };
  const dirty = dirtyOf(repoRoot, () => false);
  const files = listedFiles(repoRoot);
  if (!files) return { commit: head, dirty, worktree_digest: null };
  const digest = createHash("sha256");
  for (const path of files.sort()) {
    const projectPath = `${key}/${path}`;
    const targets = scope && !scope.exclude(projectPath) ? [digest, scope.digest] : [digest];
    if (targets.length === 1) {
      digestFile(repoRoot, path, path, targets);
    } else {
      // The worktree digest keys repository-relative paths, the scope digest project-relative ones.
      digestFile(repoRoot, path, path, [digest]);
      digestFile(repoRoot, path, projectPath, [scope!.digest]);
    }
  }
  return { commit: head, dirty, worktree_digest: digest.digest("hex") };
}

/**
 * Source revision of the workflow repository. `nested` (4.9.0) lists the declared
 * nested repositories: each gets its own `repos` entry, and their files inside the
 * digest scope also feed `scope_digest`. Without `nested` (or with none) the result is
 * the 4.8.1 structure and algorithm, byte for byte; re-checks of evidence without
 * `source_revision.repos` always call it that way.
 */
export function readSourceRevision(projectRoot: string, scope?: DigestScope, nested?: readonly string[]): SourceRevision {
  const scoped = scope && scope.label !== "worktree" ? scope : undefined;
  const root = realpathSync(resolve(projectRoot));
  const revision = runSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", shell: false });
  if (revision.status !== 0 || typeof revision.stdout !== "string") {
    return { commit: "unavailable", dirty: null, worktree_digest: null, ...(scoped ? { scope: scoped.label, scope_digest: null } : {}) };
  }

  const dirty = dirtyOf(root, excluded);
  const files = listedFiles(root);
  if (!files) {
    return { commit: revision.stdout.trim(), dirty, worktree_digest: null, ...(scoped ? { scope: scoped.label, scope_digest: null } : {}) };
  }

  const digest = createHash("sha256");
  const scopeDigest = scoped ? createHash("sha256") : undefined;
  const nestedKeys = [...(nested || [])].sort();
  const inNested = (path: string) => nestedKeys.some((key) => path === key || path === `${key}/` || path.startsWith(`${key}/`));
  for (const path of files.filter((path) => !excluded(path)).sort()) {
    const inScope = Boolean(scopeDigest && !scoped!.exclude(path));
    // An untracked nested repository is listed as one `<key>/` entry; its files feed the
    // scope digest below, so the directory entry itself stays out of it (4.9.0 only).
    const targets = inScope && !(nestedKeys.length > 0 && inNested(path)) ? [digest, scopeDigest!] : [digest];
    digestFile(root, path, path, targets);
  }
  const repos: Record<string, RepoRevision> = {};
  for (const key of nestedKeys) repos[key] = nestedRevision(root, key, scoped ? { exclude: scoped.exclude, digest: scopeDigest! } : undefined);
  return {
    commit: revision.stdout.trim(),
    dirty,
    worktree_digest: digest.digest("hex"),
    ...(scoped ? { scope: scoped.label, scope_digest: scopeDigest!.digest("hex") } : {}),
    ...(nestedKeys.length > 0 ? { repos } : {}),
  };
}


/** SHA-1 (40) or SHA-256 (64) object id; anything else (refs, options, "unavailable") is not a commit id. */
export const COMMIT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Errors when `recorded` is not the current HEAD or one of its ancestors. Used where the
 * worktree is allowed to drift (RED re-check at GREEN completion) but history is not.
 * Fails closed: a malformed id, an unknown commit, a non-ancestor, or git being
 * unavailable all produce an error. Non-git projects ("unavailable") need an exact match.
 * `field` (4.9.0) names the checked field, e.g. `source_revision.repos.app.commit`;
 * `repoRoot` is then the nested repository.
 */
export function commitAncestryErrors(projectRoot: string, recorded: string, current: string, field = "source_revision.commit"): string[] {
  if (recorded === "unavailable" || current === "unavailable") {
    return recorded === current ? [] : [`${field} ${recorded} does not match current HEAD ${current}`];
  }
  if (!COMMIT_ID_PATTERN.test(recorded)) return [`${field} must be a 40- or 64-character hex commit id`];
  const root = realpathSync(resolve(projectRoot));
  const result = runSync("git", ["merge-base", "--is-ancestor", recorded, "HEAD"], { cwd: root, encoding: "utf8", shell: false });
  if (result.error) return [`${field} ${recorded} cannot be verified: git is unavailable (${result.error.message})`];
  if (result.status === 0) return [];
  return [`${field} ${recorded} is not the current HEAD or one of its ancestors`];
}
