import { createHash } from "crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "fs";
import { relative, resolve } from "path";
import { spawnSync } from "child_process";

export interface SourceRevision {
  commit: string;
  dirty: boolean | null;
  worktree_digest: string | null;
  scope?: string;
  scope_digest?: string | null;
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

export function readSourceRevision(projectRoot: string, scope?: DigestScope): SourceRevision {
  const scoped = scope && scope.label !== "worktree" ? scope : undefined;
  const root = realpathSync(resolve(projectRoot));
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", shell: false });
  if (revision.status !== 0 || typeof revision.stdout !== "string") {
    return { commit: "unavailable", dirty: null, worktree_digest: null, ...(scoped ? { scope: scoped.label, scope_digest: null } : {}) };
  }

  const status = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  const statusEntries = typeof status.stdout === "string" ? status.stdout.split("\0").filter(Boolean) : [];
  const dirty = status.status === 0 ? statusEntries.some((entry) => {
    const candidate = entry.slice(3).split(" -> ").pop() || "";
    return !excluded(candidate);
  }) : null;

  const files = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (files.status !== 0 || typeof files.stdout !== "string") {
    return { commit: revision.stdout.trim(), dirty, worktree_digest: null, ...(scoped ? { scope: scoped.label, scope_digest: null } : {}) };
  }

  const digest = createHash("sha256");
  const scopeDigest = scoped ? createHash("sha256") : undefined;
  for (const path of files.stdout.split("\0").filter(Boolean).map(normalized).filter((path) => !excluded(path)).sort()) {
    const absolute = resolve(root, path);
    const rel = normalized(relative(root, absolute));
    if (rel === ".." || rel.startsWith("../") || !existsSync(absolute)) continue;
    const stat = lstatSync(absolute);
    const inScope = Boolean(scopeDigest && !scoped!.exclude(path));
    const targets = inScope ? [digest, scopeDigest!] : [digest];
    for (const target of targets) target.update(path).update("\0");
    if (stat.isSymbolicLink()) {
      const link = readlinkSync(absolute);
      for (const target of targets) target.update("symlink\0").update(link).update("\0");
    } else if (stat.isFile()) {
      const content = createHash("sha256").update(readFileSync(absolute)).digest();
      for (const target of targets) target.update("file\0").update(content).update("\0");
    }
  }
  return {
    commit: revision.stdout.trim(),
    dirty,
    worktree_digest: digest.digest("hex"),
    ...(scoped ? { scope: scoped.label, scope_digest: scopeDigest!.digest("hex") } : {}),
  };
}


/** SHA-1 (40) or SHA-256 (64) object id; anything else (refs, options, "unavailable") is not a commit id. */
export const COMMIT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Errors when `recorded` is not the current HEAD or one of its ancestors. Used where the
 * worktree is allowed to drift (RED re-check at GREEN completion) but history is not.
 * Fails closed: a malformed id, an unknown commit, a non-ancestor, or git being
 * unavailable all produce an error. Non-git projects ("unavailable") need an exact match.
 */
export function commitAncestryErrors(projectRoot: string, recorded: string, current: string): string[] {
  if (recorded === "unavailable" || current === "unavailable") {
    return recorded === current ? [] : [`source_revision.commit ${recorded} does not match current HEAD ${current}`];
  }
  if (!COMMIT_ID_PATTERN.test(recorded)) return ["source_revision.commit must be a 40- or 64-character hex commit id"];
  const root = realpathSync(resolve(projectRoot));
  const result = spawnSync("git", ["merge-base", "--is-ancestor", recorded, "HEAD"], { cwd: root, encoding: "utf8", shell: false });
  if (result.error) return [`source_revision.commit ${recorded} cannot be verified: git is unavailable (${result.error.message})`];
  if (result.status === 0) return [];
  return [`source_revision.commit ${recorded} is not the current HEAD or one of its ancestors`];
}
