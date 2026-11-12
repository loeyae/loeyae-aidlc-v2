import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { observationFixture, put, saveObservationEvidence } from "./helpers/observation-fixture";
import { runObservations, observationsDirective } from "../core/tools/aidlc-observations";
import { assertions, candidateSnapshot, currentObservations } from "../core/tools/aidlc-observation-inputs";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
const scratch = mkdtempSync(join(tmpdir(), "aidlc-observations-")),
  env = { ...process.env },
  children: any[] = [];
let count = 0;
async function test(name: string, fn: () => unknown) {
  await fn();
  count++;
  console.log("PASS " + name);
}
const boot = async (name: string, mutate?: any) => {
  const f = observationFixture(scratch, name, { mutate });
  const child = await f.start();
  children.push(child);
  await f.issue();
  assert.equal(f.run().admission_result, "ready");
  return f;
};
try {
  await test("Core assertions compare actual operands; missing fields and order failures fail", () => {
    assert.equal(
      assertions([{ assertion_id: "a", pointer: "/rows", op: "ordered-by", expected: ["at", "id"] }], {
        rows: [
          { at: 1, id: 2 },
          { at: 1, id: 1 },
        ],
      })[0].passed,
      false,
    );
    assert.equal(assertions([{ assertion_id: "a", pointer: "/no", op: "equal", expected: null }], {})[0].passed, false);
    assert.throws(
      () => assertions([{ assertion_id: "a", pointer: "/ok", op: "script", expected: true }], {}),
      /SCHEMA/,
    );
  });
  const f = await boot("orders");
  let report: any;
  await test("dependency preflight does not execute command-only matrix or mint a full pass", async () => {
    const r = await runObservations(f.root, "fixtures/observation-plan.json", true);
    assert.equal(r.status, "not-applicable");
    assert.equal(r.observations.length, 0);
    assert.equal(existsSync(join(f.root, ".aidlc/evidence/autonomous-observations")), false);
  });
  await test("actual ordered pagination, boundary sizes, empty results and real upstream timeout pass", async () => {
    report = await runObservations(f.root, "fixtures/observation-plan.json");
    assert.equal(
      report.status,
      "passed",
      JSON.stringify(
        report.observations.map((o: any) => JSON.parse(readFileSync(join(f.root, o.raw_output_ref.path), "utf8"))),
      ),
    );
    saveObservationEvidence(f, report, resolve(process.env.AIDLC_EVAL_DIR || "docs/evals/autonomy/p1-07", "orders-actual"));
    assert.equal(report.business_verified, false);
    for (const o of report.observations) {
      const raw = JSON.parse(readFileSync(join(f.root, o.raw_output_ref.path), "utf8"));
      assert.equal(raw.assertion_results.length, 7);
      assert.deepEqual(JSON.parse(raw.stdout).sizes, [50, 50, 20]);
      assert.equal(JSON.parse(raw.stdout).timeout, "ETIMEDOUT");
    }
  });
  await test("candidate is derived from the actual committed clean repository, never authoring dirty=false", () => {
    assert.equal(report.candidate_ref.repositories[0].dirty, false);
    assert.match(report.candidate_ref.repositories[0].commit, /^[a-f0-9]{40,64}$/);
    assert.equal(currentObservations(f.root, f.current()).status, "passed");
  });
  await test("raw observation tampering invalidates the signature-bound artifact closure", () => {
    const p = join(f.root, report.raw_refs[0].path),
      before = readFileSync(p);
    writeFileSync(p, "{}");
    assert.throws(() => currentObservations(f.root, f.current()), /ARTIFACT_CHANGED/);
    writeFileSync(p, before);
  });
  await test("an expired lease cannot reuse a signed successful observation", () => {
    const clock = Date.now;
    try {
      Date.now = () => Date.parse(report.valid_until) + 1;
      assert.throws(() => currentObservations(f.root, f.current()), /STALE/);
    } finally {
      Date.now = clock;
    }
  });
  await test("current observations also revalidate the live frozen grant inputs", () => {
    const p = join(f.root, "fixtures/admission-plan.json"),
      saved = readFileSync(p);
    try {
      writeFileSync(p, saved + "\nChanged design\n");
      assert.throws(() => currentObservations(f.root, f.current()), /EXECUTION_GRANT_INVALID.*baseline changed/);
    } finally {
      writeFileSync(p, saved);
    }
  });
  await test("environment value drift invalidates an otherwise passed observation", () => {
    const before = process.env.OBS_ORIGIN;
    process.env.OBS_ORIGIN = "http://127.0.0.1:1";
    assert.throws(() => currentObservations(f.root, f.current()), /ENVIRONMENT_CHANGED/);
    process.env.OBS_ORIGIN = before;
  });
  await test("unsigned pointer and self-declared passed rows cannot mint observations", async () => {
    const p = join(f.root, ".aidlc/evidence/autonomous-observations/publish/1/current.json"),
      saved = readFileSync(p);
    writeFileSync(p, JSON.stringify({ status: "passed", candidate_ref: report.candidate_ref }));
    assert.throws(() => currentObservations(f.root, f.current()), /issuer|signature|receipt|signed/i);
    writeFileSync(p, saved);
  });
  await test("changed source is dirty and old observations are unusable", async () => {
    const p = join(f.root, "src/orders.cjs"),
      saved = readFileSync(p);
    writeFileSync(p, saved + "\n// drift\n");
    assert.throws(() => candidateSnapshot(f.root, ["src/orders.cjs"]), /DIRTY/);
    assert.throws(() => currentObservations(f.root, f.current()), /DIRTY|CHANGED/);
    writeFileSync(p, saved);
  });
  await test("a different commit cannot reuse prior observations even with identical source", () => {
    const r = spawnSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-qm",
        "new candidate",
      ],
      { cwd: f.root },
    );
    assert.equal(r.status, 0);
    assert.throws(() => currentObservations(f.root, f.current()), /CANDIDATE_CHANGED/);
  });
  for (const [name, mutate, pattern] of [
    ["omitted-check", (p: any) => p.checks.pop(), /MATRIX_INCOMPLETE/],
    [
      "assert-true-only",
      (p: any) => (p.checks[0].assertions = [{ assertion_id: "pretend", pointer: "/ok", op: "equal", expected: true }]),
      /SUBSTANTIVE/,
    ],
    ["unknown-op", (p: any) => (p.checks[0].assertions[0].op = "eval"), /SCHEMA/],
    ["unknown-plan-field", (p: any) => (p.passed = true), /unsupported/],
  ] as any[]) {
    await test("reject " + name, async () => {
      const x = await boot(name, mutate);
      await assert.rejects(() => runObservations(x.root, "fixtures/observation-plan.json"), pattern);
    });
  }
  await test("a real command returning wrong values produces failed controlled evidence", async () => {
    const x = await boot("wrong-values", (p: any) => (p.checks[0].assertions[0].expected = [20, 50, 50]));
    const r = await runObservations(x.root, "fixtures/observation-plan.json");
    assert.equal(r.status, "failed");
    assert.equal(r.observations[0].status, "failed");
    assert.equal(currentObservations(x.root, x.current()).status, "failed");
  });
  await test("read-only inspection of an unadopted workflow does not fabricate a pass", async () => {
    const r = await observationsDirective(scratch, ["inspect"]);
    assert.equal(r.autonomous_observations.status, "unverified");
    const cli = f.cli(["autonomy", "observe", "inspect"]);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.equal(JSON.parse(cli.stdout).autonomous_observations.status, "unverified");
  });
  console.log(
    `Observations: ${count} scenarios passed; real local functions/HTTP, simulated reception/operator authority`,
  );
} finally {
  for (const c of children) {
    c.kill();
    await new Promise<void>((r) => c.once("close", () => r()));
  }
  for (const k of ["OBS_ORIGIN", "AIDLC_SESSION_BINDING", "AIDLC_EXECUTION_GRANT", "AIDLC_AUTONOMY_HOST"])
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir()));
  rmSync(scratch, { recursive: true, force: true });
}
