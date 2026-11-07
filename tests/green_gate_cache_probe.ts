import assert from "node:assert/strict";
import { readFileSync, writeFileSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { checkPhaseSensors, loadGraph, makeInstance } from "../core/tools/aidlc-orchestrate";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
import { gateCacheStats, withRevisionMemoization, withRevisionInvalidation } from "../core/tools/aidlc-revision";
const root = process.cwd(), state = loadWorkflowState(root)!;
const stage = loadGraph().stages.find(stage => stage.slug === "code-generation")!;
const instance = makeInstance(stage, "unit", { module_id: "project", unit_id: "default" });
const options = { onlySensors: ["green-test-evidence"], allowDownstreamReportDrift: true };
const check = () => checkPhaseSensors(instance, state, options);
const green = ".aidlc/evidence/code-generation/project/default/green-test-evidence.json";
const i13 = ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json";
withRevisionMemoization(() => {
  assert.deepEqual(check(), []);
  const before = gateCacheStats();
  assert.deepEqual(check(), []);
  assert.equal(gateCacheStats().hits, before.hits + 1, "second full GREEN gate uses a successful verdict");
  for (const path of [green, i13, ".aidlc/commands/code-generation.json", "tests/behavior.test.cjs"]) {
    const absolute = join(root, path), original = readFileSync(absolute, "utf8"), stamp = statSync(absolute);
    const changed = path === green ? original.replace('"status": "passed"', '"status": "failed"')
      : path === i13 ? original.replace("UC-D-001", "UC-D-999")
      : path.endsWith(".json") ? original.replace("observe.cjs", "invalid.cjs") : original.replace("true", "null");
    assert.notEqual(changed, original, path);
    writeFileSync(absolute, changed); utimesSync(absolute, stamp.atime, stamp.mtime);
    const stats = gateCacheStats();
    assert(check().length > 0, `${path} changes invalidate success even with restored mtime`);
    assert(check().length > 0, "failed verdicts are never reused");
    assert.equal(gateCacheStats().hits, stats.hits);
    writeFileSync(absolute, original); utimesSync(absolute, stamp.atime, stamp.mtime);
    assert.deepEqual(check(), []);
  }
  const beforeMode = gateCacheStats();
  checkPhaseSensors(instance, state, { ...options, requireHistoricalPhaseInputs: true });
  assert.equal(gateCacheStats().hits, beforeMode.hits, "historical mode cannot reuse a current verdict");
  const originalGreen = readFileSync(join(root, green), "utf8"), now = Date.now(), realNow = Date.now;
  try {
    Date.now = () => now;
    writeFileSync(join(root, green), JSON.stringify({ ...JSON.parse(originalGreen), timestamp: new Date(now).toISOString(), freshness: { kind: "external", reason: "expiry regression", max_age_ms: 1000 } }));
    assert.deepEqual(check(), []);
    assert.deepEqual(check(), []);
    Date.now = () => now + 1001;
    assert(check().some(failure => failure.message.includes("stale")), "a cached success cannot extend an explicit freshness window");
  } finally { Date.now = realNow; writeFileSync(join(root, green), originalGreen); }
  const stats = gateCacheStats();
  withRevisionInvalidation(() => {});
  assert.deepEqual(check(), []);
  assert.equal(gateCacheStats().hits, stats.hits, "a known mutation invalidates successful gates");
});
const stats = gateCacheStats(); assert.deepEqual(check(), []); assert.equal(gateCacheStats().hits, stats.hits, "another request cannot reuse the result");
console.log(JSON.stringify({ status: "passed", stats: gateCacheStats() }));
