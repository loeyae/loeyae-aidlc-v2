import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSourceRevision, revisionCacheStats, withRevisionMemoization, withRevisionInvalidation, memoizedSuccessfulGate, gateCacheStats } from "../core/tools/aidlc-revision";
import { runSync } from "../core/tools/aidlc-spawn";

const root = mkdtempSync(join(tmpdir(), "aidlc-validation-revision-"));
const file = join(root, "src/input.ts");
function git(...args: string[]) {
  const result = runSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
}
const delta = (before: ReturnType<typeof revisionCacheStats>) => {
  const after = revisionCacheStats();
  return { calls: after.calls - before.calls, computations: after.computations - before.computations, hits: after.hits - before.hits };
};
try {
  mkdirSync(join(root, "src")); writeFileSync(file, "export const value = 1;\n");
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "test@example.invalid"); git("add", "."); git("commit", "-qm", "initial");
  let before = revisionCacheStats();
  await withRevisionMemoization(async () => {
    const original = readSourceRevision(root);
    original.commit = "caller mutation";
    await Promise.resolve();
    assert.notEqual(readSourceRevision(root).commit, original.commit, "callers cannot mutate the cached snapshot");
    withRevisionMemoization(() => readSourceRevision(root));
  });
  assert.deepEqual(delta(before), { calls: 3, computations: 1, hits: 2 });
  before = revisionCacheStats(); readSourceRevision(root); readSourceRevision(root);
  assert.deepEqual(delta(before), { calls: 2, computations: 2, hits: 0 });

  before = revisionCacheStats();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const first = withRevisionMemoization(async () => { readSourceRevision(root); await waiting; readSourceRevision(root); });
  await withRevisionMemoization(async () => { readSourceRevision(root); await Promise.resolve(); readSourceRevision(root); });
  release(); await first;
  assert.deepEqual(delta(before), { calls: 4, computations: 2, hits: 2 }, "overlapping requests each compute their own snapshot");
  let resume!: () => void;
  const changed = new Promise<void>(resolve => { resume = resolve; });
  const observer = withRevisionMemoization(async () => {
    const prior = readSourceRevision(root).worktree_digest;
    await changed;
    assert.notEqual(readSourceRevision(root).worktree_digest, prior, "another active request's known mutation invalidates this snapshot too");
  });
  withRevisionMemoization(() => withRevisionInvalidation(() => writeFileSync(file, "export const value = 2;\n")));
  resume(); await observer;
  console.log("PASS nested async reads compute once; overlapping requests and callers remain isolated");

  await assert.rejects(withRevisionMemoization(async () => { readSourceRevision(root); throw new Error("rejected request"); }), /rejected request/);
  before = revisionCacheStats(); readSourceRevision(root);
  assert.equal(delta(before).hits, 0, "a rejected request cannot leave memoization enabled");
  let late!: Promise<void>;
  withRevisionMemoization(() => {
    readSourceRevision(root);
    late = new Promise<void>((resolve, reject) => setTimeout(() => {
      try { const snapshot = revisionCacheStats(); readSourceRevision(root); assert.equal(delta(snapshot).hits, 0, "a late callback cannot retain a completed request's cache"); resolve(); } catch (error) { reject(error); }
    }, 1));
  });
  await late;

  withRevisionMemoization(() => {
    const scope = { label: "same-label", exclude: () => false, projectedInputs: { "virtual.json": "one" } };
    const first = readSourceRevision(root, scope).scope_digest;
    const second = readSourceRevision(root, { ...scope, projectedInputs: { "virtual.json": "two" } }).scope_digest;
    assert.notEqual(first, second, "changed input projections cannot share a same-label cache entry");
  });
  console.log("PASS rejected/completed requests release caches and input projection changes invalidate scope keys");

  await withRevisionMemoization(async () => {
    let previous = readSourceRevision(root).worktree_digest;
    for (const status of [0, 2]) {
      const result = withRevisionInvalidation(() => runSync(process.execPath, ["-e", "require('node:fs').writeFileSync(process.argv[1],process.argv[2]);process.exit(Number(process.argv[3]));", file, `export const value = ${status + 3};\n`, String(status)], { cwd: root, encoding: "utf8", shell: false }));
      assert.equal(result.status, status);
      const observed = readSourceRevision(root).worktree_digest;
      assert.notEqual(observed, previous, "successful and failed project commands must expose changed inputs"); previous = observed;
    }
    assert.throws(() => withRevisionInvalidation(() => { writeFileSync(file, "export const value = 99;\n"); throw new Error("command overflow"); }), /command overflow/);
    assert.notEqual(readSourceRevision(root).worktree_digest, previous, "a thrown command must invalidate its prior snapshot");
    previous = readSourceRevision(root).worktree_digest;
    await assert.rejects(withRevisionInvalidation(async () => { await Promise.resolve(); writeFileSync(file, "export const value = 100;\n"); throw new Error("async failure"); }), /async failure/);
    assert.notEqual(readSourceRevision(root).worktree_digest, previous);
    previous = readSourceRevision(root).worktree_digest;
    const timedOut = withRevisionInvalidation(() => {
      writeFileSync(file, "export const value = 101;\n");
      return runSync(process.execPath, ["-e", "setInterval(()=>{},1000);"], { cwd: root, encoding: "utf8", shell: false, timeout: 50 });
    });
    assert.equal(timedOut.error?.code, "ETIMEDOUT");
    assert.notEqual(readSourceRevision(root).worktree_digest, previous, "timeout must expose inputs changed during the operation");
  });
  console.log("PASS successful, failed, thrown, timed-out and async commands invalidate source snapshots");
  let validations = 0;
  const success = () => { validations++; return null; };
  await withRevisionMemoization(async () => {
    memoizedSuccessfulGate("green", success);
    await Promise.resolve();
    memoizedSuccessfulGate("green", success);
    assert.equal(validations, 1);
    withRevisionInvalidation(() => {});
    memoizedSuccessfulGate("green", success);
    assert.equal(validations, 2);
    for (let i = 0; i < 2; i++) assert.equal(memoizedSuccessfulGate("failure", () => { validations++; return "blocked"; }), "blocked");
    assert.equal(validations, 4, "failures always run again");
  });
  memoizedSuccessfulGate("green", success);
  assert.equal(validations, 5, "a completed request discards its successes");
  let resumeGate!: () => void;
  const pendingGate = new Promise<void>(resolve => { resumeGate = resolve; });
  const firstGate = withRevisionMemoization(async () => { memoizedSuccessfulGate("shared", success); await pendingGate; memoizedSuccessfulGate("shared", success); });
  await withRevisionMemoization(async () => { memoizedSuccessfulGate("shared", success); });
  resumeGate(); await firstGate;
  assert.equal(validations, 7, "independent requests cannot inherit another request's success");
  assert(gateCacheStats().hits >= 2);
  console.log("PASS successful gates share request lifetime and mutation boundaries; failures and concurrent requests remain isolated");
} finally {
  rmSync(root, { recursive: true, force: true });
}
