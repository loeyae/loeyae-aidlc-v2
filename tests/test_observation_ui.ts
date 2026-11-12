import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { prepareDesign, observationFixture, saveObservationEvidence } from "./helpers/observation-fixture";
import { runObservations } from "../core/tools/aidlc-observations";
import { currentObservations, compareScreenshots } from "../core/tools/aidlc-observation-inputs";
import { finalizeBatch } from "../core/tools/aidlc-batch-result";
const scratch = mkdtempSync(join(tmpdir(), "aidlc-observation-ui-")),
  env = { ...process.env },
  children: any[] = [];
let count = 0;
async function test(name: string, fn: () => unknown) {
  await fn();
  count++;
  console.log("PASS " + name);
}
try {
  const designRoot = join(scratch, "frozen-design");
  mkdirSync(designRoot);
  const baselines = await prepareDesign(designRoot);
  const boot = async (name: string, options: any = {}) => {
    const f = observationFixture(scratch, name, { ui: true, designRoot, baselines, ...options });
    children.push(await f.start());
    await f.issue();
    const a = f.run();
    assert.equal(a.admission_result, "ready", JSON.stringify(a.checks));
    return f;
  };
  const f = await boot("publish");
  let report: any;
  await test("real browser covers two viewports, ready/draft/published/error/retry and actual backend rules", async () => {
    report = await runObservations(f.root, "fixtures/observation-plan.json");
    assert.equal(
      report.status,
      "passed",
      JSON.stringify(
        report.observations
          .filter((o: any) => o.status !== "passed")
          .map((o: any) => JSON.parse(readFileSync(join(f.root, o.raw_output_ref.path), "utf8"))),
      ),
    );
    assert.equal(report.observations.length, 13);
    saveObservationEvidence(f, report, resolve(process.env.AIDLC_EVAL_DIR || "docs/evals/autonomy/p1-07", "publish-actual"));
    for (const o of report.observations.filter((o: any) => o.kind === "ui")) {
      const raw = JSON.parse(readFileSync(join(f.root, o.raw_output_ref.path), "utf8"));
      assert.equal(raw.visual.passed, true);
      assert.ok(raw.dom.includes("PAGE-001"));
      assert.ok(raw.network.some((n: any) => n.status === 200));
    }
  });
  await test("actual UI and functional passes cannot bypass Native UI design acceptance and alignment", () => {
    const r=finalizeBatch(f.root);
    assert.equal(r.engineering_result,"blocked");
    assert.equal(r.batch_completed,false);
    assert.ok(r.native.failures.some((e:any)=>e.sensor==="ui-choice"));
  });
  await test("pixel comparison rejects shifted layout and invalid PNG instead of trusting a filename", () => {
    const a = readFileSync(join(designRoot, baselines["ready-800"])),
      b = readFileSync(join(designRoot, baselines["published-800"]));
    assert.equal(
      compareScreenshots(a, b, {
        pixel_delta: 0,
        max_diff_ratio: 0.1,
        regions: [
          { region_id: "button", rect: { x: 250, y: 110, width: 150, height: 60 }, pixel_delta: 0, max_diff_ratio: 0 },
        ],
      }).passed,
      false,
    );
    assert.throws(() => compareScreenshots(Buffer.from("fake.png"), b, { pixel_delta: 0, max_diff_ratio: 0 }));
  });
  await test("screenshot mutation invalidates an otherwise passed observation", () => {
    const img = report.raw_refs.find((r: any) => r.path.endsWith(".png")),
      path = join(f.root, img.path),
      old = readFileSync(path);
    writeFileSync(path, Buffer.from("changed"));
    assert.throws(() => currentObservations(f.root, f.current()), /ARTIFACT_CHANGED/);
    writeFileSync(path, old);
  });
  for (const [name, mutate] of [
    ["omitted-ui-check", (p: any) => p.checks.splice(0, 1)],
    ["unfrozen-viewport", (p: any) => (p.checks[0].viewport.width = 1024)],
    [
      "missing-critical-selector",
      (p: any) => {
        const c = p.checks[0];
        c.initial_expectations = c.initial_expectations.filter((r: any) => r.selector !== "#result");
        c.expectations = c.expectations.filter((r: any) => r.selector !== "#result");
        for (const s of c.steps) s.expectations = s.expectations.filter((r: any) => r.selector !== "#result");
      },
    ],
    ["omitted-action", (p: any) => (p.checks[0].steps = [])],
    ["changed-tolerance", (p: any) => (p.checks[0].tolerance = { pixel_delta: 32, max_diff_ratio: 0.1 })],
  ] as any[]) {
    await test("reject " + name, async () => {
      const x = await boot(name, { cases: ["published"], viewports: [{ width: 800, height: 600 }], mutate });
      await assert.rejects(() => runObservations(x.root, "fixtures/observation-plan.json"), /INCOMPLETE|FROZEN/);
    });
  }
  await test("actual missing critical UI and broken interaction cannot pass visual/functional checks", async () => {
    const x = await boot("broken-ui", {
      cases: ["published"],
      viewports: [{ width: 800, height: 600 }],
      mutate: (p: any, f: any) => {
        const file = join(f.root, "src/web.html");
        writeFileSync(file, readFileSync(file, "utf8").replace('id="publish"', 'id="missing"'));
      },
    });
    const r = await runObservations(x.root, "fixtures/observation-plan.json");
    assert.equal(r.status, "failed");
    assert.equal(r.observations.find((o: any) => o.kind === "ui").status, "failed");
  });
  console.log(
    `UI observations: ${count} scenarios passed; actual Chrome/CDP screenshots, input and local HTTP; authority is a fixture`,
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
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
