import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, git } from "./mars244_fixture";
import { warmupLightWorktree, prepareLightWorktree } from "../core/tools/aidlc-worktree-light";

const f = fixture("code-generation@module:shop@unit:api");
f.state.unit_selections = {
  "shop:api": { member: "alice", selected_at: new Date().toISOString() },
  "shop:web": { member: "bob", selected_at: new Date().toISOString() },
};
f.persist(); git(f.root, "add", "."); git(f.root, "commit", "-qm", "selections");
const warm = warmupLightWorktree(f.root);
const a = prepareLightWorktree(f.root, "code-generation@module:shop@unit:api", "alice", f.root + "-a");
const b = prepareLightWorktree(f.root, "code-generation@module:shop@unit:web", "bob", f.root + "-b");
const file = "src/shop/api/code.ts";
for (const mutate of [() => writeFileSync(join(a.worktree_path, file), "changed"), () => appendFileSync(join(a.worktree_path, file), "append"), () => writeFileSync(join(a.worktree_path, file), "")]) {
  mutate();
  assert.equal(readFileSync(join(warm.warm_path, file), "utf8"), "api", "warm cache is isolated");
  assert.equal(readFileSync(join(b.worktree_path, file), "utf8"), "api", "other worker is isolated");
}
console.log("PASS warm worktree isolation: independent in-place writes, append and truncation");
