import { createHash } from "crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "fs";
import { relative, resolve } from "path";
import { spawnSync } from "child_process";

export interface SourceRevision {
  commit: string;
  dirty: boolean | null;
  worktree_digest: string | null;
}

function normalized(path: string): string {
  return path.replace(/\\/g, "/");
}

function excluded(path: string): boolean {
  const value = normalized(path);
  return value === ".aidlc" || value.startsWith(".aidlc/") || value === "docs/aidlc/aidlc-state.json";
}

export function readSourceRevision(projectRoot: string): SourceRevision {
  const root = realpathSync(resolve(projectRoot));
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", shell: false });
  if (revision.status !== 0 || typeof revision.stdout !== "string") {
    return { commit: "unavailable", dirty: null, worktree_digest: null };
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
    return { commit: revision.stdout.trim(), dirty, worktree_digest: null };
  }

  const digest = createHash("sha256");
  for (const path of files.stdout.split("\0").filter(Boolean).map(normalized).filter((path) => !excluded(path)).sort()) {
    const absolute = resolve(root, path);
    const rel = normalized(relative(root, absolute));
    if (rel === ".." || rel.startsWith("../") || !existsSync(absolute)) continue;
    const stat = lstatSync(absolute);
    digest.update(path).update("\0");
    if (stat.isSymbolicLink()) {
      digest.update("symlink\0").update(readlinkSync(absolute)).update("\0");
    } else if (stat.isFile()) {
      digest.update("file\0").update(createHash("sha256").update(readFileSync(absolute)).digest()).update("\0");
    }
  }
  return { commit: revision.stdout.trim(), dirty, worktree_digest: digest.digest("hex") };
}
