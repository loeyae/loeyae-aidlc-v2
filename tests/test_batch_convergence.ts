import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { batchFixture } from "./helpers/batch-fixture";
import { ref, saveObservationEvidence } from "./helpers/observation-fixture";
import { finalizeBatch, projectBatchResult } from "../core/tools/aidlc-batch-result";
import { runObservations } from "../core/tools/aidlc-observations";
import { observationHash } from "../core/tools/aidlc-observation-inputs";
const scratch = mkdtempSync(join(tmpdir(), "aidlc-batch-convergence-")),
  env = { ...process.env };
let f: any,
  count = 0;
async function test(name: string, fn: () => unknown) {
  await fn();
  count++;
  console.log("PASS " + name);
}
const mutate = (p: string, change: (b: Buffer) => Buffer | string, fn: () => void) => {
  const b = readFileSync(p);
  try {
    writeFileSync(p, change(b));
    fn();
  } finally {
    writeFileSync(p, b);
  }
};
try {
  f = await batchFixture(scratch, "actual-native", { future: true });
  let verified: any;
  await test("actual Native producers and final matrix verify only the selected delivery unit", () => {
    verified = finalizeBatch(f.root);
    assert.equal(
      verified.engineering_result,
      "verified",
      JSON.stringify(verified.checks.filter((c: any) => c.status !== "passed")),
    );
    assert.equal(verified.batch_completed, true);
    assert.equal(verified.workflow_completed, false);
    assert.equal(f.current().status, "running");
    assert.equal(
      verified.native.checked.some((c: any) => c.stage_instance.includes("@unit:future")),
      false,
    );
    assert.equal(verified.native.global_review_required, false);
    assert.equal(projectBatchResult(f.root).current_status, "current");
  });
  await test("identical convergence is idempotent and does not append state/audit", () => {
    const state = readFileSync(join(f.root, "aidlc/active/aidlc-state.md")),
      audit = readFileSync(join(f.root, "aidlc/active/audit.md"));
    const again = finalizeBatch(f.root);
    assert.equal(again.idempotent, true);
    assert.deepEqual(again.result_ref, verified.result_ref);
    assert.deepEqual(readFileSync(join(f.root, "aidlc/active/aidlc-state.md")), state);
    assert.deepEqual(readFileSync(join(f.root, "aidlc/active/audit.md")), audit);
  });
  await test("candidate and evidence changes make applicability stale while preserving historical verified", () => {
    for (const path of [
      "src/orders.cjs",
      verified.native.refs.find((r: any) => r.sensor === "build-test-evidence").path,
      verified.acceptance_observations[0].raw_output_ref.path,
    ])
      mutate(
        join(f.root, path),
        (b) => b + "\n ",
        () => {
          const r = projectBatchResult(f.root);
          assert.equal(r.engineering_result, "verified");
          assert.equal(r.current_status, "stale");
          assert.equal(r.batch_completed, false);
        },
      );
  });
  await test("command configuration drift cannot retain current completion", () =>
    mutate(
      join(f.root, ".aidlc/commands/build-and-test.json"),
      (b) => b + "\n",
      () => assert.equal(projectBatchResult(f.root).current_status, "stale"),
    ));
  await test("expired current observation cannot retain current completion", () => {
    const clock = Date.now;
    try {
      Date.now = () => Date.parse(verified.valid_until) + 1;
      assert.equal(projectBatchResult(f.root).current_status, "stale");
    } finally {
      Date.now = clock;
    }
  });
  await test("public summary exposes batch result independently from workflow completion", () => {
    const r = f.cli(["state", "summary"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const b = JSON.parse(r.stdout).delivery_summary.autonomous_batch_result;
    assert.equal(b.engineering_result, "verified");
    assert.equal(b.batch_completed, true);
    assert.equal(b.workflow_completed, false);
  });
  await test("a real failed current assertion publishes failed instead of recycling verified", async () => {
    await fetch(process.env.OBS_ORIGIN + "/control?fail=1");
    const o = await runObservations(f.root, "fixtures/observation-plan.json");
    assert.equal(o.status, "failed");
    const r = finalizeBatch(f.root);
    assert.equal(r.engineering_result, "failed");
    assert.equal(r.batch_completed, false);
    await fetch(process.env.OBS_ORIGIN + "/control?fail=0");
    f.observations = await runObservations(f.root, "fixtures/observation-plan.json");
    assert.equal(finalizeBatch(f.root).engineering_result, "verified");
  });
  await test("missing complete matrix publishes incomplete without inventing observations", () => {
    const path = join(f.root, ".aidlc/evidence/autonomous-observations/publish/1/current.json");
    mutate(
      path,
      () => '{"schema":"invalid"}',
      () => {
        const r = finalizeBatch(f.root);
        assert.equal(r.engineering_result, "incomplete", JSON.stringify(r.checks));
        assert.equal(r.batch_completed, false);
      },
    );
    assert.equal(finalizeBatch(f.root).engineering_result, "verified");
  });
  await test("required artifact damage cannot retain current completion after repair", () => {
    mutate(
      join(f.root, "delivery/candidate.txt"),
      () => "",
      () => assert.notEqual(finalizeBatch(f.root).engineering_result, "verified"),
    );
    assert.equal(projectBatchResult(f.root).current_status, "stale");
    assert.equal(finalizeBatch(f.root).engineering_result, "verified");
  });
  await test("unit binding cannot publish a global batch result", () => {
    f.bind("code-review@module:orders@unit:publish");
    try {
      assert.throws(() => finalizeBatch(f.root), /GLOBAL_COORDINATOR/);
    } finally {
      process.env.AIDLC_SESSION_BINDING = f.coordinator;
    }
  });
  const d = f.decision();
  d.policy_clause = "category:layout";
  d.question = "Preserve the public async exportOrders signature?";
  d.chosen_option = "Keep the existing async exportOrders API";
  d.action = "choose-compatible-layout";
  d.source_refs = [f.item("GAP-002"), f.item("REQ-001"), f.item("AC-001")];
  d.affected_refs = [f.item("GAP-002")];
  d.implementation_refs = [ref(f.root, "src/orders.cjs")];
  d.validation_refs = [
    {
      check_id: "ready",
      sensor: "build-test-evidence",
      stage_instance: "build-and-test",
      path: "fixtures/pretend.json",
      digest: observationHash(readFileSync(join(f.root, "fixtures/pretend.json"))),
      workflow_id: f.current().workflow_id,
      batch_id: "publish",
    },
  ];
  const refresh = async () => {
    f.commit();
    await f.restart();
    process.env.AIDLC_SESSION_BINDING = f.coordinator;
    const a = f.run();
    assert.equal(a.admission_result, "ready-with-delegated-decisions", JSON.stringify(a.checks));
    for (const [stage, sensors] of [
      ["code-generation", ["green-test-evidence", "test-quality", "traceability-matrix", "structural-invariants"]],
      ["code-review", ["review-evidence", "test-quality", "traceability-matrix"]],
    ] as any[])
      for (const sensor of sensors) f.produce(stage, sensor, "publish");
    f.produce("build-and-test", "build-test-evidence");
    f.produce("build-and-test", "test-quality");
    process.env.AIDLC_SESSION_BINDING = f.coordinator;
    f.observations = await runObservations(f.root, "fixtures/observation-plan.json");
  };
  await test("ordinary passed JSON cannot verify a delegated implementation", async () => {
    f.bind("code-review@module:orders@unit:publish");
    f.record(d);
    await refresh();
    const r = finalizeBatch(f.root);
    assert.equal(r.engineering_result, "blocked");
    assert.ok(r.checks.some((c: any) => String(c.reason).includes("DECISION_NATIVE_REF_NOT_VERIFIED")));
  });
  await test("pending human review allows verified with real current-candidate decision evidence", async () => {
    const old = f.observations;
    d.revision = 2;
    d.validation_refs = [
      {
        check_id: "ready",
        sensor: "runtime-observation",
        stage_instance: old.producer.stage_instance,
        path: old.receipt_ref.path,
        digest: observationHash(readFileSync(join(f.root, old.receipt_ref.path))),
        workflow_id: f.current().workflow_id,
        batch_id: "publish",
      },
    ];
    f.bind("code-review@module:orders@unit:publish");
    f.record(d);
    await refresh();
    verified = finalizeBatch(f.root);
    assert.equal(verified.engineering_result, "verified", JSON.stringify(verified.checks));
    assert.equal(verified.human_review_summary.status, "pending");
    assert.equal(verified.human_review_summary.pending, 1);
    assert.equal(verified.decision_refs[0].record_status, "verified");
    assert.notEqual(
      verified.decision_refs[0].validation_refs[0].path,
      verified.decision_refs[0].current_validation[0].receipt_ref.path,
    );
    const out = resolve(process.env.AIDLC_EVAL_DIR || "docs/evals/autonomy/p1-08", "orders-converged");
    mkdirSync(out, { recursive: true });
    saveObservationEvidence(f, f.observations, out);
    writeFileSync(join(out, "batch-result.json"), readFileSync(join(f.root, verified.result_ref.path)));
    for (const r of verified.source_refs) {
      const dest = join(out, "batch-inputs", r.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(join(f.root, r.path)));
    }
    writeFileSync(
      join(out, "decision-declared-observation.json"),
      readFileSync(join(f.root, verified.decision_refs[0].validation_refs[0].path)),
    );
    writeFileSync(join(out, "batch-state.md"), readFileSync(join(f.root, "aidlc/active/aidlc-state.md")));
    for (const r of verified.native.refs) {
      const dest = join(out, "native", r.path.replace(".aidlc/evidence/", ""));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(join(f.root, r.path)));
    }
  });
  console.log(
    `Batch convergence: ${count} scenarios passed; real producers/services, simulated H3/reviewer and seeded stage rows`,
  );
} catch (e) {
  console.error("PRIMARY_FAILURE", e);
  throw e;
} finally {
  if (f?.child && f.child.exitCode === null) {
    f.child.kill();
    await new Promise<void>((r) => f.child.once("close", () => r()));
  }
  for (const k of ["OBS_ORIGIN", "AIDLC_SESSION_BINDING", "AIDLC_EXECUTION_GRANT", "AIDLC_AUTONOMY_HOST"])
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir()));
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    console.error("CLEANUP_REQUIRED", scratch, String(e));
  }
}
