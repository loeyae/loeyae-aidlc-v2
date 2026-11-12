import { createHash, type Hash } from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "fs";
import { join, relative, resolve } from "path";
import { runSync } from "./aidlc-spawn";
import { markProgress } from "./aidlc-progress";

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
  /** Validated versioned projections of shared manifests for a unit's inputs.
   * The full bytes still feed worktree_digest; only scope_digest is projected. */
  projectedInputs?: Readonly<Record<string, string>>;
}

function normalized(path: string): string {
  return path.replace(/\\/g, "/");
}

function excluded(path: string): boolean {
  const value = normalized(path);
  // The engine's own control plane (aidlc / .aidlc) and the git merge-strategy files it
  // provisions (.gitattributes / .gitignore, MARS-117) are infrastructure, not source;
  // they never bind evidence provenance, so writing them never invalidates a digest.
  return value === ".aidlc" || value.startsWith(".aidlc/") || value === "aidlc" || value.startsWith("aidlc/")
    || value === ".gitattributes" || value === ".gitignore";
}

function digestFile(root: string, path: string, label: string, targets: Hash[]): void {
  digestFileTargets(root, path, targets.map(target => ({ target, label })));
}

function digestFileTargets(root: string, path: string, targets: { target: Hash; label: string }[]): void {
  const absolute = resolve(root, path);
  const rel = normalized(relative(root, absolute));
  if (rel === ".." || rel.startsWith("../") || !existsSync(absolute)) return;
  const stat = lstatSync(absolute);
  for (const { target, label } of targets) target.update(label).update("\0");
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(absolute);
    for (const { target } of targets) target.update("symlink\0").update(link).update("\0");
  } else if (stat.isFile()) {
    const content = createHash("sha256").update(readFileSync(absolute)).digest();
    for (const { target } of targets) target.update("file\0").update(content).update("\0");
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

// ---------------------------------------------------------------------------
// Scoped revision memoization (MARS-277)
//
// One `next`/`report` invocation re-validates many evidence records that share the
// same digest scope; without memoization every check re-runs `git ls-files` and
// re-hashes the whole scope. Caching is explicitly scoped: it is only active inside
// `withRevisionMemoization`, which the engine wraps around its admission-gate
// passes — spans where it knows the digested tree cannot change. Anything that can
// change the tree the digests cover (an executed project command) must call
// invalidateRevisionCache(); engine writes stay inside the excluded control plane
// (aidlc/ .aidlc/) and never need to. Outside a scope, every call computes, so
// in-process file writes between two readSourceRevision calls are always observed.
// Independent async requests own separate stores, including semantic subprocess
// entrypoints. Canonical GREEN validation can also reuse a successful verdict
// after independently rebuilding its complete mutable control-input key.
// ---------------------------------------------------------------------------

interface RevisionContext { active: boolean; cache: Map<string, SourceRevision>; successfulGates: Set<string> }
const revisionContexts = new AsyncLocalStorage<RevisionContext>();
const activeRevisionContexts = new Set<RevisionContext>();
const revisionStats = { calls: 0, computations: 0 };
const gateStats = { calls: 0, computations: 0, hits: 0 };

/** Only success is memoized. Callers must freshly bind all non-source inputs. */
export function memoizedSuccessfulGate<T>(key: string | null, validate: () => T | null): T | null {
  gateStats.calls++;
  const context = revisionContexts.getStore();
  if (key && context?.active && context.successfulGates.has(key)) { gateStats.hits++; return null; }
  gateStats.computations++;
  const result = validate();
  if (key && context?.active && result === null) context.successfulGates.add(key);
  return result;
}
export function gateCacheStats(): Readonly<typeof gateStats> { return { ...gateStats }; }
export function validationMemoizationActive(): boolean { return revisionContexts.getStore()?.active === true; }

/**
 * Runs `fn` with revision memoization enabled, then drops the cache. Async-safe:
 * the scope ends when the returned promise settles. Scopes may nest; the cache is
 cleared when the outermost one ends.
 */
export function withRevisionMemoization<T>(fn: () => T): T {
  if (revisionContexts.getStore()?.active) return fn();
  const context: RevisionContext = { active: true, cache: new Map(), successfulGates: new Set() };
  activeRevisionContexts.add(context);
  return revisionContexts.run(context, () => {
    const settle = (): void => { context.active = false; context.cache.clear(); context.successfulGates.clear(); activeRevisionContexts.delete(context); };
    try {
      const result = fn();
      if (result && typeof (result as { then?: unknown }).then === "function") {
        return Promise.resolve(result).then(value => { settle(); return value; }, error => { settle(); throw error; }) as T;
      }
      settle();
      return result;
    } catch (error) {
      settle();
      throw error;
    }
  });
}

/** A known mutation invalidates every active request; their snapshots remain isolated. */
export function invalidateRevisionCache(): void {
  for (const context of activeRevisionContexts) { context.cache.clear(); context.successfulGates.clear(); }
}

/** A process may change inputs even when it fails, times out or overflows. */
export function withRevisionInvalidation<T>(operation: () => T): T {
  invalidateRevisionCache();
  try {
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === "function") {
      return Promise.resolve(result).then(value => { invalidateRevisionCache(); return value; }, error => { invalidateRevisionCache(); throw error; }) as T;
    }
    invalidateRevisionCache();
    return result;
  } catch (error) {
    invalidateRevisionCache();
    throw error;
  }
}

/** Calls vs. real computations since process start; tests use this to prove dedup. */
export function revisionCacheStats(): { calls: number; computations: number; hits: number } {
  return { calls: revisionStats.calls, computations: revisionStats.computations, hits: revisionStats.calls - revisionStats.computations };
}

function cacheKey(root: string, scope: DigestScope | undefined, nested: readonly string[] | undefined): string {
  const projections = createHash("sha256").update(JSON.stringify(Object.entries(scope?.projectedInputs || {}).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
  return `${root}\0${scope ? scope.label : "worktree"}\0${projections}\0${[...(nested || [])].sort().join(",")}`;
}

/** HEAD commit of the workflow repository, without hashing the tree. */
export function currentHead(projectRoot: string): string {
  const root = realpathSync(resolve(projectRoot));
  const revision = runSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", shell: false });
  return revision.status === 0 && typeof revision.stdout === "string" ? revision.stdout.trim() : "unavailable";
}

/**
 * Revision of one nested repository: its HEAD, whether `git status` reports anything
 * (untracked files included) and a digest over `git ls-files -co --exclude-standard`
 * of that repository, keyed by repository-relative paths. Files of the nested
 * repository whose project-relative path is in `scoped` also feed `scopeDigest`.
 */
function nestedRevision(projectRoot: string, key: string, scope?: { exclude: (path: string) => boolean; digest: Hash }, scopedOnly = false): RepoRevision {
  const progress = revisionProgress(`nested repository ${key}`);
  progress("waiting for git revision and status");
  const repoRoot = join(projectRoot, key);
  const revision = runSync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: repoRoot, encoding: "utf8", shell: false });
  const head = typeof revision.stdout === "string" ? revision.stdout.trim() : "";
  if (revision.error || revision.status !== 0 || !COMMIT_ID_PATTERN.test(head)) return { commit: "unavailable", dirty: null, worktree_digest: null };
  const dirty = dirtyOf(repoRoot, () => false);
  const files = listedFiles(repoRoot);
  if (!files) return { commit: head, dirty, worktree_digest: null };
  progress(`hashing ${files.length} files`);
  const digest = createHash("sha256");
  let count = 0;
  for (const path of files.sort()) {
    const projectPath = `${key}/${path}`;
    if (scopedOnly) {
      if (scope && !scope.exclude(projectPath)) digestFile(repoRoot, path, projectPath, [scope.digest]);
      continue;
    }
    const targets = scope && !scope.exclude(projectPath) ? [digest, scope.digest] : [digest];
    if (targets.length === 1) {
      digestFile(repoRoot, path, path, targets);
    } else {
      // The worktree digest keys repository-relative paths, the scope digest project-relative ones.
      digestFileTargets(repoRoot, path, [{ target: digest, label: path }, { target: scope!.digest, label: projectPath }]);
    }
    if (++count % 250 === 0) progress(`hashed ${count}/${files.length} files`, true);
  }
  progress(`completed ${count} files`);
  return { commit: head, dirty, worktree_digest: scopedOnly ? null : digest.digest("hex") };
}

/**
 * Source revision of the workflow repository. `nested` (4.9.0) lists the declared
 * nested repositories: each gets its own `repos` entry, and their files inside the
 * digest scope also feed `scope_digest`. Without `nested` (or with none) the result is
 * the 4.8.1 structure and algorithm, byte for byte; re-checks of evidence without
 * `source_revision.repos` always call it that way.
 */
export function readSourceRevision(projectRoot: string, scope?: DigestScope, nested?: readonly string[], scopedOnly = false): SourceRevision {
  const scoped = scope && scope.label !== "worktree" ? scope : undefined;
  scopedOnly = scopedOnly && !!scoped;
  const root = realpathSync(resolve(projectRoot));
  const key = cacheKey(root, scoped, nested) + (scopedOnly ? ":scope-only" : ":full");
  revisionStats.calls++;
  const context = revisionContexts.getStore();
  if (context?.active) {
    const cached = context.cache.get(key);
    if (cached) return structuredClone(cached);
    const computed = computeSourceRevision(projectRoot, scoped, nested, scopedOnly);
    revisionStats.computations++;
    context.cache.set(key, computed);
    return structuredClone(computed);
  }
  revisionStats.computations++;
  return computeSourceRevision(projectRoot, scoped, nested, scopedOnly);
}

/** For comparison only: intentionally omits whole-worktree digests. Producers and
 * final candidate barriers keep readSourceRevision's complete provenance. */
export function readScopedSourceRevision(projectRoot: string, scope: DigestScope, nested?: readonly string[]): SourceRevision {
  return readSourceRevision(projectRoot, scope, nested, true);
}

function computeSourceRevision(projectRoot: string, scoped: DigestScope | undefined, nested: readonly string[] | undefined, scopedOnly = false): SourceRevision {
  const root = realpathSync(resolve(projectRoot));
  const progress = revisionProgress(`main repository ${root}`);
  progress(`waiting for git revision and status; scope=${scoped?.label || "worktree"}`);
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
  // Policy projections bind even when a project ignores its AI-DLC documents
  // in Git. Git tracking is not authority to omit validated input declarations.
  const projections = Object.entries(scoped?.projectedInputs || {}).sort(([a], [b]) => a.localeCompare(b));
  if (projections.length) scopeDigest!.update("aidlc-projected-inputs/v1\0");
  for (const [path, body] of projections) {
    scopeDigest!.update(path).update("\0file\0").update(createHash("sha256").update(body).digest()).update("\0");
  }
  const nestedKeys = [...(nested || [])].sort();
  progress(`hashing ${files.length} listed files; nested repositories=${nestedKeys.length}`);
  const inNested = (path: string) => nestedKeys.some((key) => path === key || path === `${key}/` || path.startsWith(`${key}/`));
  let count = 0;
  for (const path of files.filter((path) => !excluded(path)).sort()) {
    if (++count % 250 === 0) progress(`hashed ${count}/${files.length} files`, true);
    const inScope = Boolean(scopeDigest && !scoped!.exclude(path));
    const projection = scoped?.projectedInputs?.[path];
    if (scopedOnly) {
      if (inScope && projection === undefined && !(nestedKeys.length > 0 && inNested(path))) digestFile(root, path, path, [scopeDigest!]);
      continue;
    }
    if (inScope && projection !== undefined) {
      digestFile(root, path, path, [digest]);
      continue;
    }
    // An untracked nested repository is listed as one `<key>/` entry; its files feed the
    // scope digest below, so the directory entry itself stays out of it (4.9.0 only).
    const targets = inScope && !(nestedKeys.length > 0 && inNested(path)) ? [digest, scopeDigest!] : [digest];
    digestFile(root, path, path, targets);
  }
  const repos: Record<string, RepoRevision> = {};
  progress(`main scan complete: ${count} files`);
  for (const key of nestedKeys) repos[key] = nestedRevision(root, key, scoped ? { exclude: scoped.exclude, digest: scopeDigest! } : undefined, scopedOnly);
  progress("source digest complete");
  return {
    commit: revision.stdout.trim(),
    dirty,
    worktree_digest: scopedOnly ? null : digest.digest("hex"),
    ...(scoped ? { scope: scoped.label, scope_digest: scopeDigest!.digest("hex") } : {}),
    ...(nestedKeys.length > 0 ? { repos } : {}),
  };
}

function revisionProgress(label: string): (message: string, throttle?: boolean) => void {
  const started = Date.now(); let last = 0;
  return (message, throttle = false) => {
    markProgress(label.startsWith("nested repository") ? 6 : 5);
    if (process.env.AIDLC_PROGRESS !== "1" || (throttle && Date.now() - last < 5000)) return;
    last = Date.now();
    process.stderr.write(`[aidlc] ${label}: ${message}; elapsed=${((last - started) / 1000).toFixed(1)}s; last_progress=${new Date(last).toISOString()}\n`);
  };
}


/** SHA-1 (40) or SHA-256 (64) object id; anything else (refs, options, "unavailable") is not a commit id. */
export const COMMIT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Disposable content view. Never reads workflow state, binds a session or infers approval. */
export function gitChangeView(projectRoot: string, from?: string, paths: string[] = []) {
  const root = realpathSync(projectRoot);
  if (from !== undefined && !COMMIT_ID_PATTERN.test(from)) throw Error("GIT_BASELINE_REQUIRES_COMMIT_ID");
  if (!Array.isArray(paths) || paths.length > 128 || paths.some(p => typeof p !== "string" || !p || p.includes("\\") || p.startsWith("/") || /[\x00-\x1f:]/.test(p) || p.split("/").some(c => !c || c === "." || c === ".." || c.toLowerCase() === ".git"))) throw Error("GIT_CHANGE_PATH_INVALID");
  const git = (args: string[]): string => {
    const r = runSync("git", args, { cwd: root, encoding: "utf8", shell: false });
    if (r.status !== 0 || typeof r.stdout !== "string") throw Error("GIT_CHANGE_READ_FAILED");
    return r.stdout;
  };
  if (realpathSync(git(["rev-parse", "--show-toplevel"]).trim()) !== root) throw Error("GIT_CHANGE_REQUIRES_REPOSITORY_ROOT");
  const head = git(["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  const baseline = from || head;
  git(["cat-file", "-e", `${baseline}^{commit}`]);
  const selected = [...new Set(paths)].sort();
  const specs = selected.map(p => `:(literal)${p}`);
  const changed = git(["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", baseline, "--", ...specs]).split("\0").filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...specs]).split("\0").filter(Boolean);
  const conflicts = git(["ls-files", "--unmerged", "-z", "--", ...specs]).split("\0").filter(Boolean).map(row => row.slice(row.indexOf("\t") + 1));
  const files = [...new Set([...changed, ...untracked])].sort().map(p => {
    // Git may return paths through a nested symlink; never follow an ancestor.
    const segments = p.split("/");
    let cursor = root;
    for (const segment of segments.slice(0, -1)) {
      cursor = join(cursor, segment);
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw Error("GIT_CHANGE_SYMLINK_ANCESTOR");
    }
    const absolute = join(root, p);
    let kind: string = "deleted", content_digest: string | null = null;
    // lstat also sees a dangling symlink; existsSync alone does not.
    try {
      const stat = lstatSync(absolute);
      kind = stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : "directory";
      if (kind !== "directory") content_digest = createHash("sha256").update(kind === "symlink" ? readlinkSync(absolute) : readFileSync(absolute)).digest("hex");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return { path: p, kind, untracked: untracked.includes(p), content_digest };
  });
  return { schema: "aidlc.git-change-view/v1", baseline_commit: baseline, head_commit: head, paths: selected, files,
    conflicts: [...new Set(conflicts)].sort(), requires_nested_inspection: files.filter(f => f.kind === "directory").map(f => f.path),
    change_digest: createHash("sha256").update(JSON.stringify({ baseline, selected, files })).digest("hex"),
    completion: "not_evaluated", approval: "not_inferred", read_only: true };
}

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
