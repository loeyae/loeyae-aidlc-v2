import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { observationFixture, put } from "./helpers/observation-fixture";
import { runObservations } from "../core/tools/aidlc-observations";
import { finalizeBatch, projectBatchResult } from "../core/tools/aidlc-batch-result";
const scratch = mkdtempSync(join(tmpdir(), "aidlc-batch-result-")),
  env = { ...process.env };
let child: any,
  count = 0;
async function test(name: string, fn: () => unknown) {
  await fn();
  count++;
  console.log("PASS " + name);
}
try {
  const f = observationFixture(scratch, "orders", {
    mutate: (_: any, f: any) => put(f.root, "delivery/candidate.txt", "Actual order candidate delivery input\n"),
  });
  child = await f.start();
  await f.issue();
  assert.equal(f.run().admission_result, "ready");
  await runObservations(f.root, "fixtures/observation-plan.json");
  await test("preview never publishes result, state or audit", () => {
    const state = readFileSync(join(f.root, "aidlc/active/aidlc-state.md")),
      audit = readFileSync(join(f.root, "aidlc/active/audit.md"));
    const r = finalizeBatch(f.root, true);
    assert.notEqual(r.engineering_result, "verified");
    assert.equal(existsSync(join(f.root, ".aidlc/evidence/autonomous-results")), false);
    assert.deepEqual(readFileSync(join(f.root, "aidlc/active/aidlc-state.md")), state);
    assert.deepEqual(readFileSync(join(f.root, "aidlc/active/audit.md")), audit);
  });
  let report: any;
  await test("actual functional pass cannot substitute missing Native gates", () => {
    report = finalizeBatch(f.root);
    assert.notEqual(report.engineering_result, "verified");
    assert.equal(report.batch_completed, false);
    assert.equal(f.current().status, "running");
    assert.equal(f.current().autonomy_batch_result_ref?.result_id, report.result_ref.result_id);
    assert.match(readFileSync(join(f.root, "aidlc/active/audit.md"), "utf8"), /Batch Result:/);
  });
  await test("read-only public inspection validates the signed result", () => {
    const before = readFileSync(join(f.root, "aidlc/active/aidlc-state.md"));
    const r = f.cli(["autonomy", "batch", "inspect"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const b = JSON.parse(r.stdout).autonomous_batch_result;
    assert.equal(b.current_status, "current");
    assert.equal(b.batch_completed, false);
    assert.deepEqual(readFileSync(join(f.root, "aidlc/active/aidlc-state.md")), before);
  });
  await test("receipt tampering loses current completion eligibility", () => {
    const p = join(f.root, report.result_ref.path),
      saved = readFileSync(p);
    try {
      writeFileSync(p, '{"engineering_result":"verified"}');
      assert.equal(projectBatchResult(f.root).current_status, "unknown");
      assert.equal(projectBatchResult(f.root).batch_completed, false);
    } finally {
      writeFileSync(p, saved);
    }
  });
  console.log(`Batch result: ${count} scenarios passed; actual local observations, fixture authority`);
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise<void>((r) => child.once("close", () => r()));
  }
  for (const k of ["OBS_ORIGIN", "AIDLC_SESSION_BINDING", "AIDLC_EXECUTION_GRANT", "AIDLC_AUTONOMY_HOST"])
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir()));
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
