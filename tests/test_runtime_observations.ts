import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createDependencyFixture } from "./helpers/autonomy-dependency-fixture";
import { put, ref, saveObservationEvidence } from "./helpers/observation-fixture";
import {
  capabilityVersion,
  projectAutonomyDependencies,
  assertAutonomyDependencyAccess,
} from "../core/tools/aidlc-autonomy-dependencies";
import { runObservations } from "../core/tools/aidlc-observations";
import { currentObservations } from "../core/tools/aidlc-observation-inputs";
import { checkCurrentExecutionGrant } from "../core/tools/aidlc-execution-grant";
import { bindSession, claimToken, releaseSession } from "../core/tools/aidlc-session";
const scratch = mkdtempSync(join(tmpdir(), "aidlc-runtime-observations-")),
  inherited = { ...process.env },
  children: any[] = [];
let count = 0;
async function test(name: string, fn: () => unknown) {
  await fn();
  count++;
  console.log("PASS " + name);
}
const service = `const http=require('http'),cp=require('child_process');const commit=cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();let version=process.env.RUNTIME_CAP;
http.createServer(async(req,res)=>{res.setHeader('content-type','application/json');res.setHeader('connection','close');if(req.url.startsWith('/control')){version='changed';return res.end('{}');}if(req.headers.authorization!=='Bearer '+process.env.RUNTIME_TOKEN){res.statusCode=401;return res.end('{}');}if(req.url==='/version')return res.end(JSON.stringify({ready:true,version_digest:version,candidate_commit:commit,owner:'external-team'}));let data='';for await(const b of req)data+=b;const value=JSON.parse(data||'{}');if(value.state==='draft'){res.statusCode=400;return res.end(JSON.stringify({error:'not-ready'}));}res.end(JSON.stringify({state:'published',result:'/result'}));}).listen(0,'127.0.0.1',function(){console.log(this.address().port);});`;
function git(root: string, args: string[]) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
async function boot(name: string, external = false, early = false) {
  let cap: any;
  const f = createDependencyFixture(scratch, name, {
    type: early ? "contract" : "runtime",
    checkpoint: early ? "code-generation" : "build-and-test",
    mutate: (d) => {
      cap = d.cap;
      if (external) {
        const provider = {
          external_id: "publish-service",
          owner: "external-team",
          contract_ref: d.artifact,
          version_ref: d.artifact,
        };
        cap = {
          provider_ref: provider,
          capability_id: "external-publish",
          version_digest: capabilityVersion("external-publish", [d.artifact]),
        };
        d.edge.provider = provider;
        d.edge.capability_ref = cap;
        d.extraCapabilities.push({
          ...d.f.common("capability", "external-publish"),
          capability_id: cap.capability_id,
          provider_ref: provider,
          version_digest: cap.version_digest,
          artifact_refs: [d.artifact],
        });
      }
      put(d.f.root, "src/backend/service.cjs", service);
      put(d.f.root, "fixtures/runtime-environment.json", {
        schema: "aidlc.observation-environment/v1",
        isolated: true,
        endpoints: {
          service: {
            origin: "${RUNTIME_ORIGIN}",
            kind: external ? "external" : "candidate",
            version_path: "/version",
            header_variables: { Authorization: "RUNTIME_AUTH" },
          },
        },
        variables: ["RUNTIME_ORIGIN", "RUNTIME_AUTH"],
        inputs: [],
      });
      const plan = {
        schema: "aidlc.observation-plan/v1",
        batch_id: "publish",
        scope_revision: 1,
        lifetime_seconds: 300,
        environment_ref: ref(d.f.root, "fixtures/runtime-environment.json"),
        candidate_artifact_paths: ["src/backend/service.cjs", "src/backend/api.schema"],
        ui_applicability: { kind: "none", source_refs: [d.f.input] },
        checks: ["recoverable", "ready"].map((id) => ({
          check_id: id,
          kind: "http",
          covers: [d.f.item("AC-001")],
          endpoint: "service",
          path: "/publish",
          method: "POST",
          body: { state: id === "ready" ? "ready" : "draft" },
          expected_status: id === "ready" ? 200 : 400,
          dependency_id: d.edge.dependency_id,
          assertions: [
            {
              assertion_id: "publish-rule",
              pointer: id === "ready" ? "/state" : "/error",
              op: "equal",
              expected: id === "ready" ? "published" : "not-ready",
            },
          ],
        })),
      };
      put(d.f.root, "fixtures/runtime-observation-plan.json", plan);
      d.f.batch.baseline_inputs.push(ref(d.f.root, "fixtures/runtime-observation-plan.json"));
      d.plan.environment_variables = ["RUNTIME_ORIGIN", "RUNTIME_AUTH"];
    },
  });
  git(f.root, ["add", "."]);
  git(f.root, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "runtime candidate",
  ]);
  let serving = f.root;
  if (external) {
    serving = join(scratch, name + "-external-service");
    mkdirSync(serving);
    put(serving, "server.cjs", service);
    git(serving, ["init", "-q"]);
    git(serving, ["add", "."]);
    git(serving, [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "independent external source",
    ]);
  }
  const child = spawn(process.execPath, [external ? "server.cjs" : "src/backend/service.cjs"], {
    cwd: serving,
    env: { ...process.env, RUNTIME_CAP: cap.version_digest, RUNTIME_TOKEN: "isolated-token" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);
  const port = await new Promise<string>((r, j) => {
    const t = setTimeout(() => j(Error("runtime service timeout")), 5000);
    child.stdout.once("data", (b) => {
      clearTimeout(t);
      r(String(b).trim());
    });
    child.once("error", j);
  });
  process.env.RUNTIME_ORIGIN = "http://127.0.0.1:" + port;
  process.env.RUNTIME_AUTH = "Bearer isolated-token";
  await f.issue();
  assert.equal(f.run().admission_result, early ? "not-ready" : "ready");
  return f;
}
try {
  const f = await boot("local");
  await test("contract/GREEN absence cannot fabricate runtime readiness", () => {
    assert.equal(projectAutonomyDependencies(f.root).dependencies[0].readiness, "unverified");
  });
  let report: any;
  await test("actual version-bound HTTP behavior produces runtime_ready for the exact local candidate", async () => {
    report = await runObservations(f.root, "fixtures/runtime-observation-plan.json");
    assert.equal(report.status, "passed");
    assert.equal(projectAutonomyDependencies(f.root).dependencies[0].readiness, "runtime_ready");
    saveObservationEvidence(f, report, resolve(process.env.AIDLC_EVAL_DIR || "docs/evals/autonomy/p1-07", "runtime-actual"));
  });
  await test("the actual consume checkpoint performs a fresh version/health check", () => {
    const b = f.bind("publish");
    assertAutonomyDependencyAccess(f.root, b, ["validation-execute"], undefined, "build-and-test");
  });
  await test("service version drift blocks consumption without rewriting old passed history", async () => {
    await fetch(process.env.RUNTIME_ORIGIN + "/control");
    assert.throws(
      () =>
        assertAutonomyDependencyAccess(
          f.root,
          JSON.parse(process.env.AIDLC_SESSION_BINDING!),
          ["validation-execute"],
          undefined,
          "build-and-test",
        ),
      /live|runtime_ready/,
    );
  });
  const x = await boot("external", true);
  await test("an independently versioned external service is observed with owner/auth/capability identity", async () => {
    const r = await runObservations(x.root, "fixtures/runtime-observation-plan.json");
    assert.equal(r.status, "passed");
    assert.equal(projectAutonomyDependencies(x.root).dependencies[0].readiness, "runtime_ready");
    saveObservationEvidence(x, r, resolve(process.env.AIDLC_EVAL_DIR || "docs/evals/autonomy/p1-07", "external-actual"));
  });
  await test("dirty consumer repair can refresh external preflight without accepting a dirty final candidate", async () => {
    const p = join(x.root, "src/publish/view.ts"),
      old = readFileSync(p);
    try {
      writeFileSync(p, old + "\n// in-progress consumer repair\n");
      await assert.rejects(() => runObservations(x.root, "fixtures/runtime-observation-plan.json"), /DIRTY/);
      const r = await runObservations(x.root, "fixtures/runtime-observation-plan.json", true);
      assert.equal(r.status, "partial");
      assert.equal(r.candidate_ref.repositories[0].dirty, true);
      assert.equal(projectAutonomyDependencies(x.root).dependencies[0].readiness, "runtime_ready");
    } finally {
      writeFileSync(p, old);
    }
  });
  await test("changed authentication cannot reuse a prior external observation", () => {
    process.env.RUNTIME_AUTH = "Bearer invalid";
    assert.equal(projectAutonomyDependencies(x.root).dependencies[0].readiness, "unverified");
    process.env.RUNTIME_AUTH = "Bearer isolated-token";
  });
  await test("a failed current external observation removes readiness rather than retaining old pass", async () => {
    await fetch(process.env.RUNTIME_ORIGIN + "/control");
    const r = await runObservations(x.root, "fixtures/runtime-observation-plan.json");
    assert.equal(r.status, "failed");
    assert.equal(projectAutonomyDependencies(x.root).dependencies[0].readiness, "unverified");
  });
  const early = await boot("external-preflight", true, true);
  await test("external preflight resolves admission dependency self-lock without a full matrix pass", async () => {
    const routeResult = early.cli(["next", "--preview"]),
      route = JSON.parse(routeResult.stdout.trim() || routeResult.stderr.trim());
    assert.equal(route.autonomous_admission.admission_result, "not-ready");
    assert.equal(route.autonomy_dependencies.admission_ready, false);
    await assert.rejects(() => runObservations(early.root, "fixtures/runtime-observation-plan.json"), /ADMISSION/);
    const command = early.cli([
      "autonomy",
      "observe",
      "run",
      "--dependency-preflight",
      "--input",
      "fixtures/runtime-observation-plan.json",
    ]);
    assert.equal(command.status, 0, command.stdout + command.stderr);
    const partial = JSON.parse(command.stdout).autonomous_observations;
    assert.equal(partial.status, "partial");
    assert.equal(partial.coverage, "dependency-preflight");
    assert.equal(projectAutonomyDependencies(early.root).dependencies[0].readiness, "contract_ready");
    assert.equal(early.run().admission_result, "ready");
    saveObservationEvidence(early, partial, resolve(process.env.AIDLC_EVAL_DIR || "docs/evals/autonomy/p1-07", "external-preflight-actual"));
  });
  await test("immutable external contract observation survives ordinary consumer edits and live-checks every write", () => {
    const binding = early.bind("publish"),
      p = join(early.root, "src/publish/view.ts"),
      old = readFileSync(p);
    try {
      writeFileSync(p, old + "\n// consumer implementation\n");
      checkCurrentExecutionGrant(early.root, ["code-write"], "src/publish/view.ts");
      assert.equal(currentObservations(early.root, early.current()).status, "partial");
    } finally {
      writeFileSync(p, old);
    }
  });
  await test("external preflight cannot survive capability input drift", () => {
    const p = join(early.root, "src/backend/api.schema"),
      old = readFileSync(p);
    try {
      writeFileSync(p, old + "\nchanged contract\n");
      assert.throws(() => currentObservations(early.root, early.current()), /CHANGED|changed/);
    } finally {
      writeFileSync(p, old);
    }
  });
  console.log(
    `Runtime observations: ${count} scenarios passed; real isolated local/external HTTP services; authority is simulated`,
  );
} finally {
  for (const c of children) {
    if (c.exitCode === null && !c.signalCode) {
      c.kill();
      await new Promise<void>((r) => c.once("close", () => r()));
    }
  }
  for (const k of [
    "RUNTIME_ORIGIN",
    "RUNTIME_AUTH",
    "AIDLC_SESSION_BINDING",
    "AIDLC_EXECUTION_GRANT",
    "AIDLC_AUTONOMY_HOST",
  ])
    if (inherited[k] === undefined) delete process.env[k];
    else process.env[k] = inherited[k];
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir()));
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
