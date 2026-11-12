import assert from "node:assert/strict";
import fs from "node:fs";
import { join, resolve } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { fixture, cli, git } from "./mars244_fixture";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { assertSessionClaim, loadWorkflowState, renderLightWorkflowState, saveWorkflowState, sessionBinding } from "../core/tools/aidlc-light-state";
import { gitChangeView, readScopedSourceRevision, readSourceRevision, withRevisionMemoization } from "../core/tools/aidlc-revision";
import { validateGrantInputs, withGrantInputSnapshot } from "../core/tools/aidlc-grant-store";
import { loadWorkflowPart } from "../core/tools/aidlc-workflow-layout";

const inherited = { ...process.env }, roots: string[] = [], results: string[] = [];
const test = (name: string, f: () => void) => { f(); results.push(name); console.log("PASS " + name); };
const ref = { kind: "module" as const, module_id: "shop" };
const api = "code-generation@module:shop@unit:api", web = "code-generation@module:shop@unit:web";
try {
  delete process.env.AIDLC_SESSION_BINDING;
  const f = fixture(api, true); roots.push(f.root);
  const owner = bindSession(f.root, { instance: api, owner: "api", session: "api", expected: claimToken(undefined) });
  process.env.AIDLC_SESSION_BINDING = JSON.stringify(owner.binding);
  const stale = loadWorkflowState(f.root, ref)!;
  bindSession(f.root, { instance: web, owner: "web", session: "web", expected: claimToken(undefined) });
  test("independent claim changes rebase without writing unchanged progress", () => {
    const before = fs.readFileSync(join(f.root, f.statePath)), audit = fs.readFileSync(join(f.root, "aidlc/active/modules/shop/audit.md"));
    saveWorkflowState(f.root, stale, ref);
    assert.ok(stale.active_instances[web]);
    assert.deepEqual(fs.readFileSync(join(f.root, f.statePath)), before);
    assert.deepEqual(fs.readFileSync(join(f.root, "aidlc/active/modules/shop/audit.md")), audit);
  });
  test("normal renewal preserves binding, expired recovery rotates it", () => {
    const current = loadWorkflowState(f.root, ref)!;
    const renewed = bindSession(f.root, { instance: api, owner: "api", session: "api", expected: claimToken(current.active_instances[api]) });
    assert.equal(renewed.binding.generation, owner.binding.generation);
    assertSessionClaim(f.root, loadWorkflowState(f.root, ref)!, api, owner.binding);
    const expired = loadWorkflowState(f.root, ref)!;
    expired.active_instances[api].expires_at = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(join(f.root, f.statePath), renderLightWorkflowState(expired));
    const recovered = bindSession(f.root, { instance: api, owner: "api", session: "api", expected: claimToken(expired.active_instances[api]) });
    assert.notEqual(recovered.binding.generation, owner.binding.generation);
    assert.throws(() => assertSessionClaim(f.root, loadWorkflowState(f.root, ref)!, api, owner.binding), /transferred|conflicts/);
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(recovered.binding);
  });
  test("overlapping ownership cannot be rebased", () => {
    const old = loadWorkflowState(f.root, ref)!;
    bindSession(f.root, { instance: api, owner: "new", session: "new", expected: claimToken(old.active_instances[api]), humanInstructionRef: "test:explicit-transfer" });
    old.work_description = "stale writer";
    assert.throws(() => saveWorkflowState(f.root, old, ref), /revision conflict|transferred|conflicts/);
  });
  test("malformed binding has an actionable diagnostic", () => {
    for (const value of ["null", "[]", "false", "{bad"]) assert.throws(() => sessionBinding(value), /invalid session binding/);
  });
  test("exact ownership lookup ignores damaged sibling state but checks target identity", () => {
    fs.writeFileSync(join(f.root, "aidlc/active/modules/other/aidlc-state.md"), "broken sibling");
    assert.equal(loadWorkflowPart(f.root, ref)!.state.workflow_id, f.state.workflow_id);
    const path = join(f.root, f.statePath), prior = fs.readFileSync(path);
    const state = loadWorkflowState(f.root, ref)!; state.workflow_id = "wrong-workflow";
    fs.writeFileSync(path, renderLightWorkflowState(state));
    assert.throws(() => loadWorkflowPart(f.root, ref), /identity/);
    fs.writeFileSync(path, prior);
  });

  test("Git comparison survives corrupt state and binding without claiming completion", () => {
    fs.writeFileSync(join(f.root, f.statePath), "broken state");
    process.env.AIDLC_SESSION_BINDING = "null";
    fs.writeFileSync(join(f.root, "src/shop/api/code.ts"), "changed");
    fs.writeFileSync(join(f.root, "src/shop/api/new.ts"), "new");
    fs.unlinkSync(join(f.root, "src/shop/web/code.ts"));
    const view = gitChangeView(f.root, undefined, ["src/shop"]);
    assert.deepEqual(view.files.map(f => [f.path, f.kind]), [["src/shop/api/code.ts", "file"], ["src/shop/api/new.ts", "file"], ["src/shop/web/code.ts", "deleted"]]);
    assert.equal(view.files[1].untracked, true);
    assert.equal(view.completion, "not_evaluated");
    assert.equal(view.approval, "not_inferred");
    const result = cli(f.root, ["orchestrate", "state", "changes", "--paths", '["src/shop"]']);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(JSON.parse(result.stdout).git_changes.change_digest, view.change_digest);
    assert.equal(fs.readFileSync(join(f.root, f.statePath), "utf8"), "broken state");
  });
  test("Git comparison rejects options and escaping paths", () => {
    assert.throws(() => gitChangeView(f.root, "--help"), /COMMIT_ID/);
    for (const p of ["../outside", "/outside", ".git/config", "src/../../outside", "C:/outside"]) assert.throws(() => gitChangeView(f.root, undefined, [p]), /PATH_INVALID/);
  });
  test("Git comparison sees committed changes since the design baseline", () => {
    const base = git(f.root, "rev-parse", "HEAD");
    git(f.root, "add", "src/shop"); git(f.root, "commit", "-qm", "implementation");
    assert.equal(gitChangeView(f.root, base, ["src/shop"]).files.length, 3);
    assert.equal(gitChangeView(f.root, undefined, ["src/shop"]).files.length, 0);
  });

  test("scoped comparison equals full digest but never reads unrelated bytes", () => {
    const unrelated = join(f.root, "src/other-large.bin"); fs.writeFileSync(unrelated, Buffer.alloc(4 * 1024 * 1024, 1));
    const scope = { label: "test:api", exclude: (p: string) => !p.startsWith("src/shop/api/") };
    const full = readSourceRevision(f.root, scope);
    const original = fs.readFileSync; let reads = 0;
    fs.readFileSync = ((p: any, ...args: any[]) => { if (resolve(String(p)) === resolve(unrelated)) reads++; return (original as any)(p, ...args); }) as typeof original;
    syncBuiltinESMExports();
    try {
      const scoped = withRevisionMemoization(() => readScopedSourceRevision(f.root, scope));
      assert.equal(scoped.scope_digest, full.scope_digest);
      assert.equal(scoped.worktree_digest, null);
      assert.equal(reads, 0);
      fs.writeFileSync(join(f.root, "src/shop/api/new.ts"), "changed again");
      assert.notEqual(readScopedSourceRevision(f.root, scope).scope_digest, full.scope_digest);
    } finally { fs.readFileSync = original; syncBuiltinESMExports(); }
  });
  test("projected inputs and nested repositories retain the same scoped identity", () => {
    const nested = join(f.root, "nested"); fs.mkdirSync(nested); fs.writeFileSync(join(nested, "a.txt"), "nested");
    git(nested, "init", "-q"); git(nested, "add", "."); git(nested, "commit", "-qm", "nested");
    const scope = { label: "test:projected", exclude: (p: string) => !p.startsWith("nested/") && p !== "package-lock.json", projectedInputs: { "package-lock.json": "validated projection" } };
    const full = readSourceRevision(f.root, scope, ["nested"]), narrow = readScopedSourceRevision(f.root, scope, ["nested"]);
    assert.equal(narrow.scope_digest, full.scope_digest);
    assert.equal(narrow.repos!.nested.commit, full.repos!.nested.commit);
    assert.equal(narrow.repos!.nested.worktree_digest, null);
    assert.equal(readScopedSourceRevision(f.root, { label: "worktree", exclude: () => false }).worktree_digest, readSourceRevision(f.root).worktree_digest);
  });
  test("grant input snapshots are local to one preparation and invalidate between requests", () => {
    const p = "src/shop/api/new.ts", body = fs.readFileSync(join(f.root, p));
    const inputs: any = [{ path: p, digest: createHash("sha256").update(body).digest("hex") }];
    const original = fs.readFileSync; let reads = 0;
    fs.readFileSync = ((file: any, ...args: any[]) => { if (resolve(String(file)) === resolve(join(f.root, p))) reads++; return (original as any)(file, ...args); }) as typeof original;
    syncBuiltinESMExports();
    try {
      withGrantInputSnapshot(() => { validateGrantInputs(f.root, inputs); validateGrantInputs(f.root, inputs); });
      assert.equal(reads, 1);
      fs.writeFileSync(join(f.root, p), "new request input");
      assert.throws(() => withGrantInputSnapshot(() => validateGrantInputs(f.root, inputs)), /baseline changed/);
    } finally { fs.readFileSync = original; syncBuiltinESMExports(); }
  });
  console.log(JSON.stringify({ short_boundaries: results.length, real_model_runs: 0, real_h5: 0 }));
} finally {
  for (const key of Object.keys(process.env)) if (!(key in inherited)) delete process.env[key];
  Object.assign(process.env, inherited);
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
