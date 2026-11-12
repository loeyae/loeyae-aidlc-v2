import assert from "node:assert/strict";
import { mock } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import tty from "node:tty";
import readline from "node:readline/promises";
import { createAutonomyFixture } from "./helpers/autonomy-fixture";
import { autonomyDigest } from "../core/tools/aidlc-autonomy-files";
import { admissionDirective, admissionProjection, previewAutonomousAdmission, runAutonomousAdmission, type AdmissionHostAdapter } from "../core/tools/aidlc-autonomous-admission";
import { captureOperatorApproval, assertAdmissionReceipt, readIssuedGrant, storeAdmissionReport, withGrantControl } from "../core/tools/aidlc-grant-store";
import { bindExecutionGrant, checkCurrentExecutionGrant, issueExecutionGrant, prepareExecutionGrant, prepareGrantRevocation, revokeExecutionGrant } from "../core/tools/aidlc-execution-grant";
import { bindSession, captureScopeSession, claimToken } from "../core/tools/aidlc-session";
import { loadWorkflowState, renderLightWorkflowState, withSessionPublication } from "../core/tools/aidlc-light-state";

type Row = Record<string, any>;
const scratch = mkdtempSync(join(tmpdir(), "aidlc-admission-")), inherited = { ...process.env };
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
function put(root: string, path: string, value: unknown) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value)); }
function tree(root: string, prefix = ""): Row { return Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(e => { const p = prefix ? `${prefix}/${e.name}` : e.name; return e.isDirectory() ? Object.entries(tree(root, p)) : [[p, hash(readFileSync(join(root, p)))]]; })); }
async function approve(root: string, payload: Row) {
  const t = mock.method(tty, "isatty", () => true), o = mock.method(process.stdout, "write", () => true);
  const r = mock.method(readline, "createInterface", () => ({ question: async () => `Approve ${autonomyDigest(payload)}`, close() {} }) as any);
  try { return await captureOperatorApproval(root, payload); } finally { r.mock.restore(); o.mock.restore(); t.mock.restore(); }
}
function fixture(name: string, modify?: (plan: Row, f: ReturnType<typeof createAutonomyFixture>) => void) {
  delete process.env.AIDLC_EXECUTION_GRANT; delete process.env.AIDLC_AUTONOMY_HOST;
  const f = createAutonomyFixture(scratch, name), base = "docs/aidlc/modules/orders/inception", planPath = "fixtures/admission-plan.json";
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: f.root, encoding: "utf8" }).status, 0);
  const input = (path: string) => ({ repository_id: "project", path, digest_mode: "raw-file", digest: hash(readFileSync(join(f.root, path))) });
  put(f.root, "fixtures/environment.json", { service: "fixture", isolated: true }); put(f.root, "fixtures/data.json", { rows: [1, 2, 3] });
  // This executes a real bounded fixture assertion. It does not test either business pilot.
  put(f.root, "fixtures/preflight.cjs", "const assert=require('node:assert/strict'); const fs=require('node:fs'); assert.deepEqual(JSON.parse(fs.readFileSync('fixtures/data.json')).rows,[1,2,3]); console.log('fixture baseline available');\n");
  const plan: Row = { schema: "aidlc.admission-plan/v1", batch_id: "publish", scope_revision: 1, lifetime_seconds: 300,
    reception: [{ module_id: "orders", ui: "none", source_refs: [f.input] }],
    commands: [{ command_id: "fixture-baseline", argv: [process.execPath, "fixtures/preflight.cjs"], timeout_ms: 5000, input_refs: [input("fixtures/preflight.cjs"), input("fixtures/data.json")] }],
    validation_bindings: ["recoverable", "ready"].map(check_id => ({ check_id, covers: [f.item("AC-001")], command_id: "fixture-baseline", assertion: "Fixture only: three ordered values are available; business acceptance remains unverified", kind: "behavior" })),
    resources: [{ kind: "environment", input_ref: input("fixtures/environment.json") }, { kind: "test-data", input_ref: input("fixtures/data.json") }], environment_variables: [] };
  modify?.(plan, f);
  put(f.root, `${base}/user-stories.md`, "# Fixture user story\n"); put(f.root, `${base}/development-handoff.md`, "# Fixture development handoff\n");
  const pkg = [f.input.path, `${base}/user-stories.md`, `${base}/development-handoff.md`];
  put(f.root, `${base}/cross-validation-report.md`, "# Seeded reception fixture\n```aidlc-quality\n" + JSON.stringify({ version: "1", delivery_scope: "publish", inputs: [f.input.path], package: pkg.map(path => ({ path, kind: "canonical" })), development_acceptance: `${base}/acceptance-review.json` }) + "\n```\n");
  const inputs = pkg.map(path => ({ path, sha256: input(path).digest }));
  put(f.root, `${base}/technical-review.json`, { workflow_id: f.current().workflow_id, module_id: "orders", reviewer: "seeded-fixture-developer", conclusion: "supported", findings: [], inputs,
    autonomous_reception: { batch_id: "publish", scope_revision: 1, ui: plan.reception[0].ui, source_refs: plan.reception[0].source_refs, unresolved_decisions: [] } });
  put(f.root, `${base}/acceptance-review.json`, { workflow_id: f.current().workflow_id, module_id: "orders", accepted_by: "seeded-fixture-developer", technical_review: `${base}/technical-review.json`, inputs });
  put(f.root, planPath, plan); f.batch.baseline_inputs.push(input(planPath)); f.freeze();
  const request: Row = { run_id: randomUUID(), lifetime_seconds: 600, allowed_operations: ["workflow-write", "stage-report", "decision-record", "evidence-publish", "validation-execute", "design-write", "code-write", "test-write"],
    host: { host_id: "unit-test-fixture-adapter", version: "1", entrypoint: process.execPath, config_digest: "a".repeat(64) }, resource_limits: { wall_time_seconds: 600, max_equivalent_retries: 2, max_active_units: 1 },
    integration_permissions: { candidate_commit: false, candidate_integrate: false, push: false, protected_branch_write: false, deploy: false }, write_paths: ["src", "tests", "docs/aidlc"] };
  const issue = async () => { const p = prepareExecutionGrant(f.root, request), ref = issueExecutionGrant(f.root, p, await approve(f.root, p as unknown as Row)); process.env.AIDLC_AUTONOMY_HOST = JSON.stringify(request.host); process.env.AIDLC_EXECUTION_GRANT = JSON.stringify(bindExecutionGrant(f.root).ref); return ref; };
  const bindUnit = (stage = "code-generation") => {
    const state = f.current(); state.completed_stage_instances.push("units-generation@module:orders"); put(f.root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(state));
    const binding = bindSession(f.root, { instance: `${stage}@module:orders@unit:publish`, owner: "agent", session: "test-session", expected: claimToken(undefined) }).binding; process.env.AIDLC_SESSION_BINDING = JSON.stringify(binding); return binding;
  };
  /** Test-only native adapter. Its observations are protocol fixtures, not Codex/model/browser proof. */
  const adapter: AdmissionHostAdapter = { observe(challenge) {
    const path = `fixtures/native-probe-${challenge.nonce}.json`; put(f.root, path, { ...challenge, fixture: true });
    return { nonce: challenge.nonce, host: challenge.host, observed_at: new Date().toISOString(), valid_until: new Date(Date.now() + 300_000).toISOString(), limits: challenge.limits,
      capabilities: Object.fromEntries(challenge.required_capabilities.map(key => [key, { status: "supported" as const, probe_refs: [input(path) as any] }])) };
  } };
  const run = (a: AdmissionHostAdapter | undefined = adapter) => runAutonomousAdmission(f.root, planPath, a);
  const edit = (path: string, fn: (r: Row) => void) => { const r = JSON.parse(readFileSync(join(f.root, path), "utf8")); fn(r); put(f.root, path, r); };
  return { ...f, plan, planPath, input, base, issue, bindUnit, adapter, run, edit };
}
let count = 0;
let visited=0,executed=0;
const selection=process.env.AIDLC_ADMISSION_TEST_RANGE,range=selection?.match(/^(\d+):(\d+)$/);if(selection&&!range)throw Error('Invalid engineering test range');
async function test(name: string, fn: () => unknown) {visited++;if(range&&(visited<Number(range[1])||visited>Number(range[2])))return;const start=Date.now();await fn();count++;executed++;console.log(`PASS ${name} [case ${visited}, ${Date.now()-start}ms]`);}
const check = (r: Row, id: string) => r.checks.find((c: Row) => c.check_id === id);
try {
  await test("preview has no command/probe/receipt/key/claim effects and requires a real grant", () => {
    const f = fixture("preview"), before = tree(f.root), r = previewAutonomousAdmission(f.root, f.planPath);
    assert.equal(r.admission_result, "not-ready"); assert.match(check(r, "execution-grant").reason, /actual managed/); assert.equal(check(r, "execution-preflight").status, "unverified"); assert.deepEqual(tree(f.root), before);
  });
  await test("ordinary authoring cannot mint a managed receipt", () => {
    const f = fixture("forge"); assert.throws(() => storeAdmissionReport(f.root, f.current(), { admission_result: "ready" }), /publication transaction/);
    const path = ".aidlc/evidence/autonomous-admission/publish/1/current.json"; put(f.root, path, { admission_result: "ready", signature: "invented" }); assert.equal(admissionProjection(f.root).admission_result, "not-ready");
  });
  await test("active grant alone cannot pass first code/test/shared-contract controls", async () => {
    const f = fixture("grant-only"); await f.issue(); f.bindUnit();
    for (const op of ["code-write", "test-write"] as const) assert.throws(() => checkCurrentExecutionGrant(f.root, [op], "src/code.ts"), /ADMISSION_NOT_READY/);
    assert.throws(() => withSessionPublication(f.root, { kind: "global" }, "code-generation@module:orders@unit:publish", () => put(f.root, "src/unexpected", "bad")), /ADMISSION_NOT_READY/); assert.equal(existsSync(join(f.root, "src/unexpected")), false);
  });
  await test("adoption without a grant blocks actual controlled implementation publication, while design reception remains available", () => {
    for (const stage of ["shared-contract-baseline", "tdd", "code-generation"]) {
      const f = fixture(`unissued-${stage}`); f.bindUnit(stage);
      assert.throws(() => captureScopeSession(f.root, { stage, module_id: "orders", unit_id: "publish" }), /ADMISSION_NOT_READY/);
      assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/new.ts"), /ADMISSION_NOT_READY/);
      assert.throws(() => withSessionPublication(f.root, { kind: "global" }, `${stage}@module:orders@unit:publish`, () => put(f.root, "unexpected", "bad")), /ADMISSION_NOT_READY/);
      assert.equal(existsSync(join(f.root, "unexpected")), false);
    }
    const f = fixture("pre-design"); f.bindUnit("functional-design"); assert.ok(captureScopeSession(f.root, { stage: "functional-design", module_id: "orders", unit_id: "publish" }));
  });
  await test("real fixture preflight plus trusted fixture adapter yields signed ready with fixed denominator", async () => {
    const f = fixture("ready"), ref = await f.issue(), r = f.run();
    assert.equal(r.admission_result, "ready", JSON.stringify(r.checks)); assert.ok(r.receipt_ref); assert.equal(r.command_observations[0].exit_code, 0); assert.equal(r.business_verified, false);
    assert.ok(Array.isArray(r.capability_probe_refs) && r.capability_probe_refs.length); assert.ok(Array.isArray(r.environment_refs) && r.environment_refs.every((ref: Row) => ref.digest_mode === "raw-file")); assert.equal(r.host_observation.host.host_id, "unit-test-fixture-adapter");
    assert.equal(assertAdmissionReceipt(f.root, f.current())!.admission_result, "ready"); assert.deepEqual(readIssuedGrant(f.root, ref).grant.baseline_digest, f.current().autonomy_batch!.scope_digest);
    f.bindUnit(); checkCurrentExecutionGrant(f.root, ["code-write"], "src/code.ts"); checkCurrentExecutionGrant(f.root, ["test-write"], "tests/code.ts");
    assert.equal(withSessionPublication(f.root, { kind: "global" }, "code-generation@module:orders@unit:publish", () => "fixture-publication"), "fixture-publication");
  });
  await test("pending human review and future decision outputs allow ready-with-delegated-decisions", async () => {
    const f = fixture("delegated"); await f.issue();
    const coordinator = process.env.AIDLC_SESSION_BINDING!;
    f.bindUnit("functional-design"); f.record(f.decision()); process.env.AIDLC_SESSION_BINDING = coordinator;
    const r = f.run(); assert.equal(r.admission_result, "ready-with-delegated-decisions", JSON.stringify(r.checks)); assert.equal(r.delegated_decision_refs.length, 1);
  });
  await test("CLI presence and self-declared JSON cannot substitute for a native host probe", async () => {
    const f = fixture("no-native"); await f.issue(); const r = runAutonomousAdmission(f.root, f.planPath);
    assert.equal(r.admission_result, "not-ready"); assert.equal(check(r, "host-capabilities").status, "unverified"); assert.ok(r.receipt_ref); assert.equal(admissionProjection(f.root).admission_result, "not-ready");
  });
  await test("missing real grant run writes no receipt or issuer", () => {
    const f = fixture("no-grant"), before = tree(f.root), r = f.run(); assert.equal(r.admission_result, "not-ready"); assert.equal(r.receipt_ref, null); assert.deepEqual(tree(f.root), before);
  });
  const cases: [string, (p: Row, f: ReturnType<typeof createAutonomyFixture>) => void, string, RegExp][] = [
    ["unmapped acceptance", p => { p.validation_bindings.forEach((b: Row) => b.covers = []); }, "validation-plan", /covers/],
    ["omitted matrix check", p => { p.validation_bindings.pop(); }, "validation-plan", /complete frozen/],
    ["missing assertion", p => { p.validation_bindings[0].assertion = ""; }, "validation-plan", /assertion/],
    ["shell dispatch", p => { p.commands[0].argv[0] = process.env.ComSpec || "cmd.exe"; }, "validation-plan", /shell|absolute/],
    ["unbounded command", p => { p.commands[0].timeout_ms = 100000; }, "validation-plan", /bounded/],
    ["missing data", p => { p.resources = p.resources.filter((r: Row) => r.kind !== "test-data"); }, "environment", /test-data/],
    ["unknown UI", p => { p.reception[0].ui = "unknown"; }, "design-reception", /unknown/],
    ["UI missing frozen baseline", p => { p.reception[0].ui = "required"; }, "design-reception", /ui_baseline/],
    ["missing required environment", p => { p.environment_variables = ["AIDLC_ADMISSION_FIXTURE_MISSING"]; }, "environment", /unavailable/],
    ["unsupported plan fields", p => { p.checks = [{ status: "passed" }]; }, "scope-policy", /unsupported/],
  ];
  for (const [name, modify, key, pattern] of cases) await test(`not-ready: ${name}`, async () => { const f = fixture(`invalid-${count}`, modify); await f.issue(); const r = f.run(); assert.equal(r.admission_result, "not-ready"); assert.match(check(r, key).reason, pattern); });
  await test("unresolved core product question has no fallback and blocks reception", async () => {
    const f = fixture("question"); f.edit(`${f.base}/technical-review.json`, r => r.autonomous_reception.unresolved_decisions = ["missing-product-answer"]); await f.issue(); const r = f.run(); assert.equal(r.admission_result, "not-ready"); assert.match(check(r, "design-reception").reason, /no lawful fallback/);
  });
  await test("stale technical review is rejected independently from authoring supported", async () => {
    const f = fixture("stale-review"); put(f.root, `${f.base}/user-stories.md`, "# Changed story\n"); await f.issue(); const r = f.run(); assert.equal(r.admission_result, "not-ready"); assert.match(check(r, "design-reception").reason, /stale/);
  });
  await test("actual command failure is not-ready and keeps the command observation", async () => {
    const f = fixture("command-failure", p => { p.commands[0].argv = [process.execPath, "-e", "process.exit(7)"]; }); await f.issue(); const r = f.run(); assert.equal(r.admission_result, "not-ready"); assert.equal(r.command_observations[0].exit_code, 7); assert.match(check(r, "execution-preflight").reason, /failed/);
  });
  await test("command timeout is bounded and cannot count as a successful preflight", async () => {
    const f = fixture("timeout", p => { p.commands[0].argv = [process.execPath, "-e", "setInterval(()=>{},1000)"]; p.commands[0].timeout_ms = 50; }); await f.issue(); const r = f.run(); assert.equal(r.admission_result, "not-ready"); assert.match(check(r, "execution-preflight").reason, /ETIMEDOUT/);
  });
  await test("native probe nonce, configuration, unsupported and freshness failures block", async () => {
    for (const field of ["nonce", "host", "stale", "unknown"]) {
      const f = fixture(`probe-${field}`); await f.issue(); const adapter: AdmissionHostAdapter = { observe(c) { const r = f.adapter.observe(c); if (field === "nonce") r.nonce = "replay"; if (field === "host") r.host = {}; if (field === "stale") r.valid_until = new Date(0).toISOString(); if (field === "unknown") r.capabilities["model-turn"].status = "unknown"; return r; } };
      assert.equal(f.run(adapter).admission_result, "not-ready");
    }
  });
  await test("frozen UI sources/viewports/states require actual browser capability observations", async () => {
    const f = fixture("ui-capability", (p, f) => {
      put(f.root, "fixtures/page.html", '<!doctype html><html lang="en"><head><title>Fixture</title></head><body><button>Publish</button></body></html>'); put(f.root, "fixtures/page.css", "button { color: black; }\n");
      const input = (path: string) => ({ repository_id: "project", path, digest_mode: "raw-file", digest: hash(readFileSync(join(f.root, path))) });
      f.batch.ui_refs = [f.item("AC-001")]; f.policy.hard_constraints.push(f.item("AC-001"));
      p.reception[0].ui = "required"; p.reception[0].ui_baseline = { design_refs: [f.input, input("fixtures/page.html")], asset_refs: [input("fixtures/page.css")], viewports: [{ width: 1440, height: 900 }], states: ["ready", "error"], tolerances: { max_diff_ratio: 0.01 } };
      p.validation_bindings[0].kind = "ui-visual"; p.validation_bindings[1].kind = "ui-interaction";
    }); await f.issue();
    const r = f.run({ observe(c) { assert.ok(c.required_capabilities.includes("browser-screenshot")); const r = f.adapter.observe(c); r.capabilities["browser-screenshot"].status = "unsupported"; return r; } });
    assert.equal(check(r, "design-reception").status, "passed", check(r, "design-reception").reason); assert.equal(r.admission_result, "not-ready"); assert.match(check(r, "host-capabilities").reason, /browser-screenshot/);
    assert.equal(f.run().admission_result, "ready"); assert.equal(admissionProjection(f.root).business_verified, false);
  });
  await test("changed receipt bytes cannot retain the signed pointer", async () => {
    const f = fixture("tamper"); await f.issue(); const r = f.run(); f.edit(r.receipt_ref.path, r => r.admission_result = "ready-with-delegated-decisions"); assert.throws(() => assertAdmissionReceipt(f.root, f.current()), /tampered/);
  });
  await test("changed command/data/review inputs invalidate a receipt before first implementation", async () => {
    for (const path of ["fixtures/preflight.cjs", "fixtures/data.json", "docs/aidlc/modules/orders/inception/technical-review.json"]) {
      const f = fixture(`drift-${count}-${path.includes('data')}`); await f.issue(); f.run(); put(f.root, path, "changed\n"); assert.throws(() => assertAdmissionReceipt(f.root, f.current()), /baseline changed/); count++;
    }
  });
  await test("changed declared environment invalidates a ready receipt", async () => {
    process.env.AIDLC_ADMISSION_TEST_ENV = "original"; const f = fixture("env", p => p.environment_variables = ["AIDLC_ADMISSION_TEST_ENV"]); await f.issue(); f.run(); process.env.AIDLC_ADMISSION_TEST_ENV = "changed"; assert.throws(() => assertAdmissionReceipt(f.root, f.current()), /environment changed/); delete process.env.AIDLC_ADMISSION_TEST_ENV;
  });
  await test("checker drift is detected even inside caller memoization, using an isolated installed copy", async () => {
    const f = fixture("checker-drift"); await f.issue(); const r = f.run(), repository = resolve(import.meta.dirname, ".."), install = join(scratch, "checker-install");
    mkdirSync(join(install, "core"), { recursive: true }); cpSync(join(repository, "core/tools"), join(install, "core/tools"), { recursive: true }); cpSync(join(repository, "package.json"), join(install, "package.json"));
    symlinkSync(join(repository, "node_modules"), join(install, "node_modules"), "junction");
    const store = await import(pathToFileURL(join(install, "core/tools/aidlc-grant-store.ts")).href), checker = await import(pathToFileURL(join(install, "core/tools/aidlc-checker-identity.ts")).href);
    checker.withSemanticCheckerIdentityMemoization(() => {
      const before = checker.semanticCheckerDigest(); assert.equal(before, r.checker_digest);
      put(install, "core/tools/changed-checker.json", { changed: true }); assert.equal(checker.semanticCheckerDigest(), before, "caller cache is deliberately stale");
      assert.throws(() => store.assertAdmissionReceipt(f.root, f.current()), /checker\/decision\/environment changed/);
    });
  });
  await test("environment drift inside the native probe cannot be rebound after observation", async () => {
    process.env.AIDLC_ADMISSION_TEST_ENV = "original"; const f = fixture("env-during", p => p.environment_variables = ["AIDLC_ADMISSION_TEST_ENV"]); await f.issue();
    const r = f.run({ observe(c) { const observation = f.adapter.observe(c); process.env.AIDLC_ADMISSION_TEST_ENV = "changed"; return observation; } });
    assert.equal(r.admission_result, "not-ready"); assert.match(r.publication_error, /environment changed/); delete process.env.AIDLC_ADMISSION_TEST_ENV;
  });
  await test("a new lawful decision invalidates reception and can be rechecked without renewing authorization", async () => {
    const f = fixture("decision-drift"), ref = await f.issue(), coordinator = process.env.AIDLC_SESSION_BINDING!, first = f.run();
    assert.equal(first.admission_result, "ready"); f.bindUnit("functional-design"); f.record(f.decision()); process.env.AIDLC_SESSION_BINDING = coordinator;
    assert.throws(() => assertAdmissionReceipt(f.root, f.current()), /decision\/environment changed/);
    assert.equal(f.run().admission_result, "ready-with-delegated-decisions"); assert.deepEqual(f.current().execution_grant_ref, ref);
  });
  await test("recording decision implementation/validation outputs does not invalidate unchanged design admission", async () => {
    const f = fixture("decision-outputs"); await f.issue(); const coordinator = process.env.AIDLC_SESSION_BINDING!;
    const binding = f.bindUnit("functional-design"), d = f.decision(); f.record(d); process.env.AIDLC_SESSION_BINDING = coordinator;
    const r = f.run(); assert.equal(r.admission_result, "ready-with-delegated-decisions");
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(binding); const completed = f.complete(d); completed.revision = 2; f.record(completed); process.env.AIDLC_SESSION_BINDING = coordinator;
    assert.equal(assertAdmissionReceipt(f.root, f.current())!.receipt_ref && admissionProjection(f.root).admission_result, "ready-with-delegated-decisions");
  });
  await test("authorized restoration of a missing resource needs no second operator decision", async () => {
    const f = fixture("repair"), bytes = readFileSync(join(f.root, "fixtures/data.json")), ref = await f.issue();
    put(f.root, "fixtures/data.json", "wrong bytes"); assert.equal(f.run().admission_result, "not-ready");
    put(f.root, "fixtures/data.json", bytes.toString()); assert.equal(f.run().admission_result, "ready"); assert.deepEqual(f.current().execution_grant_ref, ref);
  });
  await test("new conflicting native claim invalidates prior admission", async () => {
    const f = fixture("claim-drift"); await f.issue(); f.run(); const state = f.current();
    state.active_instances["tdd@module:orders@unit:other"] = { ...state.active_instances["workspace-detection"], instance_id: "tdd@module:orders@unit:other", session_id: "another-session" };
    put(f.root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(state)); assert.throws(() => assertAdmissionReceipt(f.root, f.current()), /conflicting/); assert.equal(f.run().admission_result, "not-ready");
  });
  await test("expiry and revocation dominate a previously ready receipt", async () => {
    const f = fixture("expired"); await f.issue(); const r = f.run(), clock = mock.method(Date, "now", () => Date.parse(r.valid_until)); try { assert.throws(() => assertAdmissionReceipt(f.root, f.current()), /expired/); } finally { clock.mock.restore(); }
    const g = fixture("revoked"); await g.issue(); g.run(); const request = prepareGrantRevocation(g.root, "fixture cancellation", 1); revokeExecutionGrant(g.root, request, await approve(g.root, request)); assert.throws(() => assertAdmissionReceipt(g.root, g.current()), /revoked/);
  });
  await test("changed sources during preflight prevent managed publication", async () => {
    const f = fixture("during", p => p.commands[0].argv = [process.execPath, "-e", "require('node:fs').writeFileSync('fixtures/data.json','changed')"]); await f.issue(); const r = f.run(); assert.equal(r.admission_result, "not-ready"); assert.match(r.publication_error, /baseline changed/); assert.equal(existsSync(join(f.root, ".aidlc/evidence/autonomous-admission/publish/1/current.json")), false);
  });
  await test("strict CLI accepts no injected passed checks and inspect is read-only", async () => {
    const f = fixture("cli"); await f.issue(); assert.throws(() => admissionDirective(f.root, ["run", "--input", f.planPath, "--passed"]), /use admission/); const before = tree(f.root); assert.equal(admissionDirective(f.root, ["inspect"]).autonomous_admission.admission_result, "not-ready"); assert.deepEqual(tree(f.root), before);
    const cli = f.cli(["autonomy", "admission", "run", "--input", f.planPath, "--preview"]); assert.equal(cli.status, 0, cli.stderr); assert.equal(JSON.parse(cli.stdout).autonomous_admission.admission_result, "not-ready"); assert.deepEqual(tree(f.root), before);
  });
  await test("legacy workflows get no added authority and no admission requirement", () => {
    const f = createAutonomyFixture(scratch, "legacy"); assert.equal(admissionProjection(f.root).enabled, false); assert.equal(assertAdmissionReceipt(f.root, f.current()), undefined); checkCurrentExecutionGrant(f.root, ["code-write"], "src/legacy.ts");
  });
  assert.ok(executed>0,'Requested test range must execute cases');console.log(`Autonomous admission: ${count} scenarios passed; cases ${executed}/${visited}, range ${selection||'all'} (native adapters and reception reviews are unit-test fixtures; no real business/host verified)`);
} finally {
  for (const key of ["AIDLC_SESSION_BINDING", "AIDLC_EXECUTION_GRANT", "AIDLC_AUTONOMY_HOST", "AIDLC_ADMISSION_TEST_ENV"]) if (inherited[key] === undefined) delete process.env[key]; else process.env[key] = inherited[key];
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir())); assert.ok(scratch.startsWith(join(tmpdir(), "aidlc-admission-"))); rmSync(scratch, { recursive: true, force: true });
}
