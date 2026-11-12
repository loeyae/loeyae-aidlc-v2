import assert from "node:assert/strict";
import { mock } from "node:test";
import tty from "node:tty";
import readline from "node:readline/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createAutonomyFixture } from "./helpers/autonomy-fixture";
import { autonomyDigest, projectAutonomyScope } from "../core/tools/aidlc-autonomy";
import { bindExecutionGrant, checkCurrentExecutionGrant, executionGrantProjection, issueExecutionGrant, prepareExecutionGrant, prepareGrantRevocation, revokeExecutionGrant } from "../core/tools/aidlc-execution-grant";
import { captureOperatorApproval, checkExecutionGrant, readIssuedGrant, storeIssuedGrant, withGrantControl, type OperatorApproval } from "../core/tools/aidlc-grant-store";
import { createInitialState, loadWorkflowState, parseLightWorkflowState, renderLightWorkflowState, saveWorkflowState, withSessionPublication } from "../core/tools/aidlc-light-state";
import { bindSession, captureScopeSession, claimToken, publishScope } from "../core/tools/aidlc-session";
import { saveRegistry } from "../core/tools/aidlc-workflow-layout";

type Row = Record<string, any>;
const scratch = mkdtempSync(join(tmpdir(), "aidlc-execution-grant-")), inherited = { ...process.env };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function put(root: string, path: string, value: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); }
function tree(root: string, prefix = ""): Record<string, string> {
  return Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const label = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? Object.entries(tree(root, label)) : [[label, hash(readFileSync(join(root, label)))]];
  }));
}
let scenarios = 0;
const from = process.env.AIDLC_GRANT_TEST_FROM;
let selected = !from;
async function test(name: string, action: () => unknown) { if (!selected && name === from) selected = true; if (!selected) return; await action(); scenarios++; console.log(`PASS ${name}`); }
/** Only the test replaces the native terminal boundary; these are never real human approvals. */
async function approve(root: string, payload: unknown, response?: string): Promise<OperatorApproval> {
  const t = mock.method(tty, "isatty", () => true), out = mock.method(process.stdout, "write", () => true);
  const r = mock.method(readline, "createInterface", () => ({ question: async () => response ?? `Approve ${autonomyDigest(payload)}`, close() {} }) as any);
  try { return await captureOperatorApproval(root, payload as Row); } finally { r.mock.restore(); t.mock.restore(); out.mock.restore(); }
}
function fixture(name: string, setup?: (f: ReturnType<typeof createAutonomyFixture>) => void) {
  delete process.env.AIDLC_EXECUTION_GRANT; delete process.env.AIDLC_AUTONOMY_HOST;
  const f = createAutonomyFixture(scratch, name), git = spawnSync("git", ["init", "-q"], { cwd: f.root, encoding: "utf8" }); assert.equal(git.status, 0, git.stderr); setup?.(f); f.freeze();
  const request: Row = { run_id: randomUUID(), lifetime_seconds: 600, allowed_operations: ["workflow-write", "stage-report", "decision-record", "evidence-publish", "validation-execute", "provider-execute", "design-write", "code-write", "test-write"],
    host: { host_id: "fixture-host", version: "1.0", entrypoint: process.execPath, config_digest: "a".repeat(64) }, resource_limits: { wall_time_seconds: 600, max_equivalent_retries: 2, max_active_units: 1 },
    integration_permissions: { candidate_commit: false, candidate_integrate: false, push: false, protected_branch_write: false, deploy: false }, write_paths: ["src", "tests", "docs/aidlc"] };
  const issue = async () => {
    const payload = prepareExecutionGrant(f.root, request), approval = await approve(f.root, payload), ref = issueExecutionGrant(f.root, payload, approval);
    process.env.AIDLC_AUTONOMY_HOST = JSON.stringify(request.host); const bound = bindExecutionGrant(f.root); process.env.AIDLC_EXECUTION_GRANT = JSON.stringify(bound.ref); return { payload, ref, approval };
  };
  const revoke = async () => { const req = prepareGrantRevocation(f.root, "Fixture operator cancellation", 1); return revokeExecutionGrant(f.root, req, await approve(f.root, req)); };
  return { ...f, request, issue, revoke };
}
try {
  await test("external write checks protect frozen inputs and their parent directories before any filesystem side effect", async () => {
    const f = fixture("frozen-write-target");
    f.request.write_paths.push(f.input.path);
    await f.issue();
    const before = hash(readFileSync(join(f.root, f.input.path)));
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["design-write"], f.input.path), /frozen grant input/);
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["design-write"], "docs/aidlc"), /frozen grant input/);
    if (process.platform === "win32") assert.throws(() => checkCurrentExecutionGrant(f.root, ["design-write"], f.input.path.replace("requirements.md", "REQUIREMENTS.md")), /frozen grant input/);
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["design-write"], f.input.path + "."), /unsafe control path/);
    assert.equal(hash(readFileSync(join(f.root, f.input.path))), before);
  });
  await test("preview reads the fixed policy and produces no files, keys, claims or activation", () => {
    const f = fixture("preview"), before = tree(f.root), payload = prepareExecutionGrant(f.root, f.request);
    assert.equal(payload.successor_policy, "disabled"); assert.equal(payload.executor_constraints.session_id, "test-session"); assert.deepEqual(tree(f.root), before);
    assert.equal(Date.parse(payload.expires_at) - Date.parse(payload.request_started_at), f.request.lifetime_seconds * 1000);
    assert.equal(executionGrantProjection(f.root).enabled, false);
  });
  await test("ordinary JSON and piped input cannot issue a grant", async () => {
    const f = fixture("json"), payload = prepareExecutionGrant(f.root, f.request), before = tree(f.root);
    assert.throws(() => issueExecutionGrant(f.root, payload, { authority_ref: f.authority } as unknown as OperatorApproval), /trusted host approval/); assert.deepEqual(tree(f.root), before);
    const t = mock.method(tty, "isatty", () => false);
    try { await assert.rejects(() => captureOperatorApproval(f.root, payload as unknown as Row), /trusted operator terminal/); } finally { t.mock.restore(); }
    assert.deepEqual(tree(f.root), before);
  });
  await test("a captured exact operator approval issues signed receipts and activates the global reference", async () => {
    const f = fixture("issue"), revision = f.current().revision, { payload, ref } = await f.issue(), state = f.current();
    assert.equal(state.revision, revision + 1); assert.deepEqual(state.execution_grant_ref, ref); assert.equal(state.execution_grant_version, "1");
    assert.ok(existsSync(join(f.root, ".git/aidlc/autonomy/issuer.json"))); assert.equal(existsSync(join(f.root, ".aidlc/autonomy/issuer.json")), false);
    const signed = readIssuedGrant(f.root, ref); assert.equal(signed.revoked, false); assert.equal(signed.grant.executor_constraints.session_id, payload.executor_constraints.session_id);
    assert.deepEqual(parseLightWorkflowState(renderLightWorkflowState(state)).execution_grant_ref, ref);
    checkCurrentExecutionGrant(f.root, ["workflow-write"]); assert.equal(executionGrantProjection(f.root).status, "active");
  });
  await test("revocation blocks both state writes and evidence publication", async () => {
    const f = fixture("revoke"); await f.issue(); await f.revoke(); const before = tree(f.root);
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["workflow-write"]), /revoked/);
    const state = f.current(); state.work_description += " changed";
    assert.throws(() => saveWorkflowState(f.root, state), /revoked/);
    assert.throws(() => withSessionPublication(f.root, { kind: "global" }, "workspace-detection", () => put(f.root, "unexpected", "bad")), /revoked/); assert.deepEqual(tree(f.root), before);
  });
  const invalidRequests: [string, (f: ReturnType<typeof fixture>) => void, RegExp][] = [
    ["authoring passed flag", f => { f.request.approved = true; }, /unsupported fields/],
    ["unknown operation", f => { f.request.allowed_operations.push("all"); }, /unknown operation/],
    ["duplicate operation", f => { f.request.allowed_operations.push("workflow-write"); }, /duplicates/],
    ["missing finite budget", f => { delete f.request.resource_limits.wall_time_seconds; }, /finite safe integer/],
    ["negative retries", f => { f.request.resource_limits.max_equivalent_retries = -1; }, /finite safe integer/],
    ["implicit parallel execution", f => { f.request.resource_limits.max_active_units = 2; }, /one active unit/],
    ["lifetime beyond budget", f => { f.request.lifetime_seconds = 601; }, /finite wall-time/],
    ["unsafe lifetime", f => { f.request.lifetime_seconds = Number.MAX_SAFE_INTEGER; f.request.resource_limits.wall_time_seconds = Number.MAX_SAFE_INTEGER; }, /finite wall-time/],
    ["undeclared integration permission", f => { f.request.allowed_operations.push("push"); }, /explicitly agree/],
    ["permission without operation", f => { f.request.integration_permissions.deploy = true; }, /explicitly agree/],
    ["missing explicit false permission", f => { delete f.request.integration_permissions.protected_branch_write; }, /explicitly agree/],
    ["path escape", f => { f.request.write_paths = ["../outside"]; }, /bounded project-relative/],
    ["control plane write scope", f => { f.request.write_paths = [".git/aidlc"]; }, /control-plane/],
    ["fake host executable", f => { f.request.host.entrypoint = "not-an-executable"; }, /local executable/],
    ["unknown run identity", f => { f.request.run_id = "run-a"; }, /UUID/],
  ];
  for (const [name, change, error] of invalidRequests) await test(`reject request ${name}`, () => {
    const f = fixture(`bad-request-${scenarios}`); change(f); const before = tree(f.root); assert.throws(() => prepareExecutionGrant(f.root, f.request), error); assert.deepEqual(tree(f.root), before);
  });
  await test("the grant's exact requested operations are not implied by general workflow permission", async () => {
    const f = fixture("least-privilege"); f.request.allowed_operations = ["workflow-write"]; await f.issue(); const before = tree(f.root);
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["evidence-publish"]), /not allowed/);
    assert.throws(() => f.record(f.decision()), /not allowed: decision-record/);
    const state = f.current(); state.completed_stage_instances.push("workspace-detection"); assert.throws(() => saveWorkflowState(f.root, state), /not allowed: stage-report/); assert.deepEqual(tree(f.root), before);
  });
  await test("expired grants cannot authorize commands or publish even when the stage claim is live", async () => {
    const f = fixture("expiry"), { ref } = await f.issue(), grant = readIssuedGrant(f.root, ref).grant, before = tree(f.root);
    const clock = mock.method(Date, "now", () => Date.parse(grant.expires_at));
    try { assert.throws(() => checkCurrentExecutionGrant(f.root, ["workflow-write"]), /expired/); assert.equal(executionGrantProjection(f.root).status, "expired"); assert.throws(() => withSessionPublication(f.root, { kind: "global" }, "workspace-detection", () => put(f.root, "bad", "bad")), /expired/); }
    finally { clock.mock.restore(); } assert.deepEqual(tree(f.root), before);
  });
  await test("a clock before signed issuance is rejected without extending validity", async () => {
    const f = fixture("clock"), { ref } = await f.issue(), grant = readIssuedGrant(f.root, ref).grant, clock = mock.method(Date, "now", () => Date.parse(grant.issued_at) - 1);
    try { assert.throws(() => checkCurrentExecutionGrant(f.root, ["workflow-write"]), /clock precedes/); } finally { clock.mock.restore(); }
  });
  await test("ordinary same-session renewal preserves binding and never extends the grant expiry", async () => {
    const f = fixture("generation"), { ref } = await f.issue(), before = readIssuedGrant(f.root, ref).grant.expires_at, old = process.env.AIDLC_SESSION_BINDING!;
    const renewed = bindSession(f.root, { instance: "workspace-detection", owner: "agent", session: "test-session", expected: claimToken(f.current().active_instances["workspace-detection"]) });
    assert.equal(renewed.binding.generation, JSON.parse(old).generation); process.env.AIDLC_SESSION_BINDING = JSON.stringify(renewed.binding); checkCurrentExecutionGrant(f.root, ["workflow-write"]);
    assert.equal(readIssuedGrant(f.root, ref).grant.expires_at, before); process.env.AIDLC_SESSION_BINDING = old; checkCurrentExecutionGrant(f.root, ["workflow-write"]);
  });
  await test("same-session stage changes reuse the grant only after a fresh exact unit bind", async () => {
    const f = fixture("stage"); const seeded = f.current(); seeded.completed_stage_instances.push("units-generation@module:orders"); put(f.root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(seeded));
    const { ref } = await f.issue(), expiry = readIssuedGrant(f.root, ref).grant.expires_at;
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/new.ts"), /exact approved unit/);
    const instance = "code-generation@module:orders@unit:publish", next = bindSession(f.root, { instance, owner: "agent", session: "test-session", expected: claimToken(undefined) });
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(next.binding); assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/new.ts"), /ADMISSION_NOT_READY/); assert.equal(readIssuedGrant(f.root, ref).grant.expires_at, expiry);
  });
  await test("a new session cannot inherit the grant even after an explicit native handoff", async () => {
    const f = fixture("successor"); await f.issue();
    const next = bindSession(f.root, { instance: "workspace-detection", owner: "agent", session: "new-session", expected: claimToken(f.current().active_instances["workspace-detection"]), humanInstructionRef: "fixture-native-user-handoff" });
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(next.binding); assert.throws(() => bindExecutionGrant(f.root), /another session.*successor recovery is disabled/);
    assert.throws(() => prepareExecutionGrant(f.root, f.request), /does not replace\/extend/);
  });
  await test("changing host configuration or leaving the grant unbound is rejected", async () => {
    const f = fixture("host"); await f.issue(); const host = process.env.AIDLC_AUTONOMY_HOST!; process.env.AIDLC_AUTONOMY_HOST = JSON.stringify({ ...f.request.host, config_digest: "b".repeat(64) });
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["workflow-write"]), /host identity/); process.env.AIDLC_AUTONOMY_HOST = host;
    delete process.env.AIDLC_EXECUTION_GRANT; assert.throws(() => checkCurrentExecutionGrant(f.root, ["workflow-write"]), /grant reference|object/);
  });
  await test("approved write paths do not authorize traversal, sibling roots or control files", async () => {
    const f = fixture("paths"); await f.issue(); checkCurrentExecutionGrant(f.root, ["design-write"], "docs/aidlc/design.md");
    for (const path of ["../outside", "C:/outside", "other/file", "src/.git/config", ".aidlc/autonomy/grants/fake"]) assert.throws(() => checkCurrentExecutionGrant(f.root, ["design-write"], path), /unsafe control path|outside approved/);
  });
  await test("grant source and dependency changes invalidate authority without reauthorizing from new JSON", async () => {
    const f = fixture("baseline"); await f.issue(); put(f.root, f.input.path, "# Changed product baseline\n"); const before = tree(f.root);
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["workflow-write"]), /baseline changed/); assert.deepEqual(tree(f.root), before);
    const g = fixture("new-dependency"); await g.issue(); put(g.root, "docs/aidlc/modules/orders/inception/application-design/unit-of-work-dependency.md", "# New dependency\n"); assert.throws(() => checkCurrentExecutionGrant(g.root, ["workflow-write"]), /dependency appeared/);
  });
  await test("in-flight results are refused after revocation while session identity is unchanged", async () => {
    const f = fixture("in-flight"); await f.issue(); const publication = captureScopeSession(f.root, { stage: "workspace-detection" }); await f.revoke(); const before = tree(f.root); let published = false;
    assert.throws(() => publishScope(f.root, publication, () => { published = true; }), /revoked/); assert.equal(published, false); assert.deepEqual(tree(f.root), before);
  });
  await test("deleting a revocation document cannot roll back its trusted Git anchor", async () => {
    const f = fixture("anchor"), { ref } = await f.issue(); await f.revoke(); unlinkSync(join(f.root, `.aidlc/autonomy/grants/${ref.grant_id}/revocation.json`));
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["workflow-write"]), /missing\/linked input/);
  });
  await test("tampered grant bytes and ordinary state edits cannot add or remove authority", async () => {
    const f = fixture("tamper"), { ref } = await f.issue(), path = `.aidlc/autonomy/grants/${ref.grant_id}/grant.json`, state = f.current(), before = tree(f.root);
    delete state.execution_grant_version; delete state.execution_grant_ref; assert.throws(() => saveWorkflowState(f.root, state), /cannot replace\/remove/); assert.deepEqual(tree(f.root), before);
    const grant = JSON.parse(readFileSync(join(f.root, path), "utf8")); grant.allowed_operations.push("deploy"); put(f.root, path, JSON.stringify(grant)); assert.throws(() => readIssuedGrant(f.root, ref), /tampered/);
  });
  await test("a consumed or modified host approval cannot be replayed for a new grant", async () => {
    const f = fixture("payload-change"), payload = prepareExecutionGrant(f.root, f.request), approval = await approve(f.root, payload); payload.allowed_operations.push("deploy"); const before = tree(f.root);
    assert.throws(() => issueExecutionGrant(f.root, payload, approval), /JSON cannot authorize|explicitly agree/); assert.deepEqual(tree(f.root), before);
    const g = fixture("consumed"), issued = await g.issue(), committed = tree(g.root);
    assert.throws(() => withGrantControl(g.root, () => storeIssuedGrant(g.root, issued.payload, issued.approval), true), /JSON cannot authorize/); assert.deepEqual(tree(g.root), committed);
  });
  await test("the grant-control lock excludes concurrent publication/revocation and is not stolen", async () => {
    const f = fixture("control-lock"); await f.issue(); put(f.root, ".aidlc/autonomy/control.lock", "busy"); const before = tree(f.root);
    assert.throws(() => withSessionPublication(f.root, { kind: "global" }, "workspace-detection", () => put(f.root, "bad", "bad")), /EEXIST/); assert.deepEqual(tree(f.root), before);
  });
  await test("revocation remains available after expiry without using the expired runtime credential", async () => {
    const f = fixture("revoke-expired"), { ref } = await f.issue(), expires = readIssuedGrant(f.root, ref).grant.expires_at;
    const clock = mock.method(Date, "now", () => Date.parse(expires)); let req: Row; try { req = prepareGrantRevocation(f.root, "Fixture stop after expiry", 1); } finally { clock.mock.restore(); }
    delete process.env.AIDLC_EXECUTION_GRANT; delete process.env.AIDLC_SESSION_BINDING; const approval = await approve(f.root, req!); revokeExecutionGrant(f.root, req!, approval); assert.equal(executionGrantProjection(f.root).status, "revoked");
  });
  await test("stopping after revocation is a downgrade and cannot resume or complete the workflow", async () => {
    const f = fixture("park"); await f.issue(); await f.revoke(); const state = f.current(); state.status = "parked"; saveWorkflowState(f.root, state); assert.equal(f.current().status, "parked");
    state.status = "running"; assert.throws(() => saveWorkflowState(f.root, state), /revoked/);
  });
  await test("CLI grant preview/inspect do not issue; piped issue and --user-input cannot approve", () => {
    const f = fixture("cli"); put(f.root, "grant-request.json", JSON.stringify(f.request)); const before = tree(f.root);
    const preview = f.cli(["autonomy", "grant", "issue", "--input", "grant-request.json", "--preview"]); assert.equal(preview.status, 0, preview.stdout + preview.stderr); assert.equal(JSON.parse(preview.stdout).execution_grant.execution_authorized, false);
    const inspect = f.cli(["autonomy", "grant", "inspect"]); assert.equal(inspect.status, 0); assert.equal(JSON.parse(inspect.stdout).execution_grant.enabled, false);
    const issue = f.cli(["autonomy", "grant", "issue", "--input", "grant-request.json"]); assert.notEqual(issue.status, 0); assert.match(issue.stdout + issue.stderr, /trusted operator terminal/);
    const fake = f.cli(["autonomy", "grant", "issue", "--input", "grant-request.json", "--user-input", "Approve"]); assert.notEqual(fake.status, 0); assert.deepEqual(tree(f.root), before);
  });
  await test("denial or an expired approval is never interpreted as implicit authorization", async () => {
    const f = fixture("deny"), payload = prepareExecutionGrant(f.root, f.request), before = tree(f.root);
    await assert.rejects(() => approve(f.root, payload, "Deny"), /did not approve/); assert.deepEqual(tree(f.root), before);
    const approval = await approve(f.root, payload), time = Date.now(), clock = mock.method(Date, "now", () => time + 301_000);
    try { assert.throws(() => issueExecutionGrant(f.root, payload, approval), /current, exact trusted host approval/); } finally { clock.mock.restore(); }
    assert.deepEqual(tree(f.root), before);
  });
  await test("the signing key cannot be regenerated by ordinary verification", async () => {
    const f = fixture("missing-key"); await f.issue(); const key = join(f.root, ".git/aidlc/autonomy/issuer.json"); unlinkSync(key);
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["workflow-write"]), /issuer key is missing/); assert.equal(existsSync(key), false);
  });
  await test("handwritten signed-looking metadata cannot activate managed mode", () => {
    const f = fixture("forged-activation"), state = f.current(), id = randomUUID(), run = randomUUID();
    state.execution_grant_version = "1"; state.execution_grant_ref = { version: "1", grant_id: id, run_id: run, digest: "a".repeat(64) };
    put(f.root, `.aidlc/autonomy/grants/${id}/grant.json`, JSON.stringify({ schema: "aidlc.execution-grant/v1", authority_ref: f.authority, issuer_provenance: { key_id: "fake", algorithm: "ed25519", signature: "fake" } }));
    const before = tree(f.root); assert.throws(() => saveWorkflowState(f.root, state), /activation must be explicit/);
    assert.throws(() => saveWorkflowState(f.root, state, { kind: "global" }, { executionGrantActivation: true }), /issuer key is missing/); assert.deepEqual(tree(f.root), before);
  });
  await test("CLI bound checks stay read-only and revocation requires a separate actual approval", async () => {
    const f = fixture("bound-cli"); await f.issue(); const before = tree(f.root);
    for (const args of [["autonomy", "grant", "inspect"], ["autonomy", "grant", "bind"], ["autonomy", "grant", "check", "--operation", "workflow-write"], ["next", "--preview"]]) {
      const result = f.cli(args); assert.equal(result.status, 0, result.stdout + result.stderr); assert.deepEqual(tree(f.root), before);
    }
    const revoke = f.cli(["autonomy", "grant", "revoke", "--expect", "1", "--reason", "Fixture stop"]); assert.notEqual(revoke.status, 0); assert.match(revoke.stdout + revoke.stderr, /trusted operator terminal/); assert.deepEqual(tree(f.root), before);
  });
  await test("decision-only authority does not silently require or grant general workflow writes", async () => {
    const f = fixture("decision-only"), state = f.current();state.completed_stage_instances.push("units-generation@module:orders");put(f.root,"aidlc/active/aidlc-state.md",renderLightWorkflowState(state));
    const coordinator=process.env.AIDLC_SESSION_BINDING,unitBinding=bindSession(f.root,{instance:"code-generation@module:orders@unit:publish",owner:"agent",session:"test-session",expected:claimToken(undefined)}).binding;
    process.env.AIDLC_SESSION_BINDING=coordinator;
    f.request.allowed_operations = ["decision-record"]; await f.issue();
    process.env.AIDLC_SESSION_BINDING=JSON.stringify(unitBinding);
    const path=`.aidlc/proposals/decisions/${state.workflow_id}/retry-a.json`;
    put(f.root, path, JSON.stringify(f.decision())); const result = f.cli(["autonomy", "record", "--input", path, "--expect", hash(readFileSync(join(f.root, "docs/aidlc/handoff.md")))]);
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).autonomy_decisions.decisions.length, 1);
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["workflow-write"]), /not allowed/);
  });
  await test("consume/verify units do not gain code write permission from batch membership", async () => {
    const f = fixture("verify-scope", base => {
      const path = "docs/aidlc/modules/orders/inception/unit-manifest.json", manifest = JSON.parse(readFileSync(join(base.root, path), "utf8"));
      const unit = { ...manifest.units[0], unit_id: "observer", name: "Observer" }; manifest.units.push(unit); put(base.root, path, JSON.stringify(manifest));
      base.batch.units.push({ unit_ref: { ...base.unitRef, unit_id: "observer", definition_digest: autonomyDigest(unit) }, role: "verify", expected_capabilities: [] });
    });
    const state = f.current(); state.completed_stage_instances.push("units-generation@module:orders"); put(f.root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(state)); await f.issue();
    const next = bindSession(f.root, { instance: "code-generation@module:orders@unit:observer", owner: "agent", session: "test-session", expected: claimToken(undefined) }); process.env.AIDLC_SESSION_BINDING = JSON.stringify(next.binding);
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/observer.ts"), /does not authorize implementation/);
  });
  await test("consumed evidence bytes remain part of every publication's grant baseline", async () => {
    const f = fixture("consumed-evidence", base => {
      const path = "docs/aidlc/modules/orders/inception/unit-manifest.json", manifest = JSON.parse(readFileSync(join(base.root, path), "utf8")), unit = { ...manifest.units[0], unit_id: "provider", name: "Provider" };
      manifest.units.push(unit); put(base.root, path, JSON.stringify(manifest)); const ref = { ...base.unitRef, unit_id: "provider", definition_digest: autonomyDigest(unit) };
      put(base.root, "fixtures/provider.txt", "fixture version only; not controlled readiness evidence");
      base.batch.units.push({ unit_ref: ref, role: "consume", expected_capabilities: [{ provider_ref: ref, capability_id: "publish-contract", version_digest: "f".repeat(64) }], evidence_refs: [{ sensor: "contract-baseline", stage_instance: "shared-contract-baseline@module:orders@unit:provider", path: "fixtures/provider.txt", digest: hash(readFileSync(join(base.root, "fixtures/provider.txt"))), workflow_id: base.current().workflow_id }] });
    });
    await f.issue(); put(f.root, "fixtures/provider.txt", "Changed fixture bytes"); assert.throws(() => checkCurrentExecutionGrant(f.root, ["workflow-write"]), /baseline changed/);
  });
  await test("business write preflight needs an exact target; a valid grant never resumes paused work", async () => {
    const f = fixture("paused"); await f.issue(); assert.throws(() => checkCurrentExecutionGrant(f.root, ["design-write"]), /exact target path/);
    const state = f.current(); state.status = "parked"; saveWorkflowState(f.root, state);
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["design-write"], "docs/aidlc/detail.md"), /parked/);
    assert.throws(() => withSessionPublication(f.root, { kind: "global" }, "workspace-detection", () => put(f.root, "bad", "bad")), /parked/);
    state.status = "running"; saveWorkflowState(f.root, state); checkCurrentExecutionGrant(f.root, ["workflow-write"]);
  });
  await test("repeating an already committed revocation is a read, not a new approval prompt", async () => {
    const f = fixture("revoke-idempotent"); await f.issue(); await f.revoke(); const before = tree(f.root);
    const repeat = f.cli(["autonomy", "grant", "revoke", "--expect", "1", "--reason", "Fixture repeated stop"]);
    assert.equal(repeat.status, 0, repeat.stdout + repeat.stderr); assert.equal(JSON.parse(repeat.stdout).execution_grant.already_revoked, true); assert.deepEqual(tree(f.root), before);
  });
  await test("candidate commit permission never implies push, protected-branch write or deployment", async () => {
    const f = fixture("candidate-permissions"); f.request.allowed_operations.push("candidate-commit"); f.request.integration_permissions.candidate_commit = true; await f.issue();
    checkCurrentExecutionGrant(f.root, ["candidate-commit"]);
    for (const op of ["push", "protected-branch-write", "deploy"] as const) assert.throws(() => checkCurrentExecutionGrant(f.root, [op]), /not allowed/);
  });
  await test("an actual approval for one project cannot be transplanted to a different workflow", async () => {
    const f = fixture("project-a"), payload = prepareExecutionGrant(f.root, f.request), approval = await approve(f.root, payload), g = fixture("project-b"), before = tree(g.root);
    assert.throws(() => issueExecutionGrant(g.root, payload, approval), /does not match the actual workflow/); assert.deepEqual(tree(g.root), before);
  });
  await test("one project grant covers only its selected split workflows while retaining each exact claim", async () => {
    const f = fixture("split-grant", base => {
      const global = base.current(), module = createInitialState("feature", undefined, randomUUID(), [], "Module fixture"), integration = createInitialState("feature", undefined, randomUUID(), [], "Integration fixture");
      module.workflow_kind = "module"; module.module_id = "orders"; module.parent_workflow_id = global.workflow_id; module.completed_stage_instances.push("units-generation@module:orders");
      integration.workflow_kind = "integration"; integration.parent_workflow_id = global.workflow_id;
      saveWorkflowState(base.root, module, { kind: "module", module_id: "orders" }); saveWorkflowState(base.root, integration, { kind: "integration" });
      saveRegistry(base.root, { version: "1", global_workflow_id: global.workflow_id, split_from_workflow_id: global.workflow_id, split_at: new Date().toISOString(), updated_at: new Date().toISOString(), modules: [{ module_id: "orders", workflow_id: module.workflow_id, state_path: "aidlc/active/modules/orders/aidlc-state.md", status: "running", current_stage: "-", inception_done: false, construction_done: false, owner: "-" }], integration: { workflow_id: integration.workflow_id, state_path: "aidlc/active/integration/aidlc-state.md", status: "running", current_stage: "-", barrier_ready: false, blocking: [] }, shared_contracts: [], cross_module_requires: [] });
      Object.assign(base.unitRef.workflow_ref, { workflow_id: module.workflow_id, owner_kind: "module", module_id: "orders" });
    });
    const { ref } = await f.issue(), grant = readIssuedGrant(f.root, ref).grant; assert.equal(grant.workflow_refs.length, 3);
    const instance = "code-generation@module:orders@unit:publish", next = bindSession(f.root, { instance, owner: "agent", session: "test-session", expected: claimToken(undefined) }); process.env.AIDLC_SESSION_BINDING = JSON.stringify(next.binding);
    assert.throws(() => checkCurrentExecutionGrant(f.root, ["code-write"], "src/module.ts"), /ADMISSION_NOT_READY/); assert.deepEqual(bindExecutionGrant(f.root).ref, ref);
    assert.throws(() => withSessionPublication(f.root, { kind: "module", module_id: "orders" }, instance, () => "publication-allowed"), /ADMISSION_NOT_READY/);
    assert.equal(loadWorkflowState(f.root, { kind: "module", module_id: "orders" })!.execution_grant_version, undefined);
  });
  assert(selected,"AIDLC_GRANT_TEST_FROM did not match any scenario");
  console.log(`Execution grant: ${scenarios} scenarios passed${from ? ` (suffix from: ${from})` : ""}`);
} finally {
  for (const key of ["AIDLC_SESSION_BINDING", "AIDLC_EXECUTION_GRANT", "AIDLC_AUTONOMY_HOST"]) if (inherited[key] === undefined) delete process.env[key]; else process.env[key] = inherited[key];
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir())); assert.ok(scratch.startsWith(join(tmpdir(), "aidlc-execution-grant-")));
  rmSync(scratch, { recursive: true, force: true });
}
