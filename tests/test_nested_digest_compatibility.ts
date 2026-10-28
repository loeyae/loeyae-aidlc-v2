import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { readSourceRevision } from "../core/tools/aidlc-revision";
import { fixture, git, write } from "./mars244_fixture";

const f = fixture();
try {
  const nested = join(f.root, "nested");
  write(f.root, "nested/source.txt", "tracked and dirty\n");
  git(nested, "init", "-q"); git(nested, "add", "."); git(nested, "commit", "-qm", "nested");
  write(f.root, "nested/source.txt", "tracked and dirty changed\n");
  write(f.root, "nested/new.txt", "untracked\n");
  const scoped = readSourceRevision(f.root, { label: "nested-only", exclude: path => !path.startsWith("nested/") }, ["nested"]);
  const expected = (prefix: string) => {
    const digest = createHash("sha256");
    for (const [name, content] of [["new.txt", "untracked\n"], ["source.txt", "tracked and dirty changed\n"]]) {
      digest.update(`${prefix}${name}\0file\0`).update(createHash("sha256").update(content).digest()).update("\0");
    }
    return digest.digest("hex");
  };
  assert.equal(scoped.repos?.nested.worktree_digest, expected(""));
  assert.equal(scoped.scope_digest, expected("nested/"));
  assert.equal(scoped.repos?.nested.dirty, true);
  console.log("PASS nested scoped and worktree digests preserve dirty and untracked content");
} finally { rmSync(f.root, { recursive: true, force: true }); }
