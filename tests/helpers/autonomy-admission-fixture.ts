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
import { createAutonomyFixture } from "./autonomy-fixture";
import { autonomyDigest } from "../../core/tools/aidlc-autonomy-files";
import { admissionDirective, admissionProjection, previewAutonomousAdmission, runAutonomousAdmission, type AdmissionHostAdapter } from "../../core/tools/aidlc-autonomous-admission";
import { captureOperatorApproval, assertAdmissionReceipt, readIssuedGrant, storeAdmissionReport, withGrantControl } from "../../core/tools/aidlc-grant-store";
import { bindExecutionGrant, checkCurrentExecutionGrant, issueExecutionGrant, prepareExecutionGrant, prepareGrantRevocation, revokeExecutionGrant } from "../../core/tools/aidlc-execution-grant";
import { bindSession, captureScopeSession, claimToken } from "../../core/tools/aidlc-session";
import { loadWorkflowState, renderLightWorkflowState, withSessionPublication } from "../../core/tools/aidlc-light-state";

type Row = Record<string, any>;
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
function put(root: string, path: string, value: unknown) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value)); }
function tree(root: string, prefix = ""): Row { return Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(e => { const p = prefix ? `${prefix}/${e.name}` : e.name; return e.isDirectory() ? Object.entries(tree(root, p)) : [[p, hash(readFileSync(join(root, p)))]]; })); }
async function approve(root: string, payload: Row) {
  const t = mock.method(tty, "isatty", () => true), o = mock.method(process.stdout, "write", () => true);
  const r = mock.method(readline, "createInterface", () => ({ question: async () => `Approve ${autonomyDigest(payload)}`, close() {} }) as any);
  try { return await captureOperatorApproval(root, payload); } finally { r.mock.restore(); o.mock.restore(); t.mock.restore(); }
}
export function createAdmissionFixture(scratch: string, name: string, modify?: (plan: Row, f: ReturnType<typeof createAutonomyFixture>) => void, options: {draft?: boolean} = {}) {
  delete process.env.AIDLC_EXECUTION_GRANT; delete process.env.AIDLC_AUTONOMY_HOST;
  const f = createAutonomyFixture(scratch, name), base = "docs/aidlc/modules/orders/inception", planPath = "fixtures/admission-plan.json";
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: f.root, encoding: "utf8" }).status, 0);
  put(f.root, "README.md", "Isolated admission/dependency protocol fixture\n");
  assert.equal(spawnSync("git", ["add", "README.md"], { cwd: f.root, encoding: "utf8" }).status, 0);
  const initialCommit = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture baseline"], { cwd: f.root, encoding: "utf8" }); assert.equal(initialCommit.status, 0, initialCommit.stderr);
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
  // A caller may prepare a complete Native UI package before adoption. Preserve
  // its stories so the immutable design lock and reception reference the same bytes.
  if (!existsSync(join(f.root, `${base}/user-stories.md`))) put(f.root, `${base}/user-stories.md`, "# Fixture user story\n");
  put(f.root, `${base}/development-handoff.md`, "# Fixture development handoff\n");
  const pkg = [f.input.path, `${base}/user-stories.md`, `${base}/development-handoff.md`];
  put(f.root, `${base}/cross-validation-report.md`, "# Seeded reception fixture\n```aidlc-quality\n" + JSON.stringify({ version: "1", delivery_scope: "publish", inputs: [f.input.path], package: pkg.map(path => ({ path, kind: "canonical" })), development_acceptance: `${base}/acceptance-review.json` }) + "\n```\n");
  const inputs = pkg.map(path => ({ path, sha256: input(path).digest }));
  put(f.root, `${base}/technical-review.json`, { workflow_id: f.current().workflow_id, module_id: "orders", reviewer: "seeded-fixture-developer", conclusion: "supported", findings: [], inputs,
    autonomous_reception: { batch_id: "publish", scope_revision: 1, ui: plan.reception[0].ui, source_refs: plan.reception[0].source_refs, unresolved_decisions: [] } });
  put(f.root, `${base}/acceptance-review.json`, { workflow_id: f.current().workflow_id, module_id: "orders", accepted_by: "seeded-fixture-developer", technical_review: `${base}/technical-review.json`, inputs });
  put(f.root, planPath, plan); f.batch.baseline_inputs.push(input(planPath)); if(options.draft)f.draft();else f.freeze();
  const request: Row = { run_id: randomUUID(), lifetime_seconds: 600, allowed_operations: ["workflow-write", "stage-report", "decision-record", "evidence-publish", "validation-execute", "design-write", "code-write", "test-write"],
    host: { host_id: "unit-test-fixture-adapter", version: "1", entrypoint: process.execPath, config_digest: "a".repeat(64) }, resource_limits: { wall_time_seconds: 600, max_equivalent_retries: 2, max_active_units: 1 },
    integration_permissions: { candidate_commit: false, candidate_integrate: false, push: false, protected_branch_write: false, deploy: false }, write_paths: ["src", "tests", "docs/aidlc"] };
  const issue = async () => { const p = prepareExecutionGrant(f.root, request), ref = issueExecutionGrant(f.root, p, await approve(f.root, p as unknown as Row)); process.env.AIDLC_AUTONOMY_HOST = JSON.stringify(request.host); process.env.AIDLC_EXECUTION_GRANT = JSON.stringify(bindExecutionGrant(f.root).ref); return ref; };
  const revoke = async () => {const p=prepareGrantRevocation(f.root,'explicit engineering fixture revocation',1);return revokeExecutionGrant(f.root,p,await approve(f.root,p));};
  const bindUnit = (stage = "code-generation") => {
    const state = f.current(); state.completed_stage_instances.push("units-generation@module:orders"); put(f.root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(state));
    const binding = bindSession(f.root, { instance: `${stage}@module:orders@unit:publish`, owner: "agent", session: "test-session", expected: claimToken(undefined) }).binding; process.env.AIDLC_SESSION_BINDING = JSON.stringify(binding); return binding;
  };
  /** Test-only native adapter. Its observations are protocol fixtures, not Codex/model/browser proof. */
  const adapter: AdmissionHostAdapter = { observe(challenge) {
    const path = `.aidlc/evidence/fixture-host/native-probe-${challenge.nonce}.json`; put(f.root, path, { ...challenge, fixture: true });
    return { nonce: challenge.nonce, host: challenge.host, observed_at: new Date().toISOString(), valid_until: new Date(Date.now() + 300_000).toISOString(), limits: challenge.limits,
      capabilities: Object.fromEntries(challenge.required_capabilities.map(key => [key, { status: "supported" as const, probe_refs: [input(path) as any] }])) };
  } };
  const run = (a: AdmissionHostAdapter | undefined = adapter) => runAutonomousAdmission(f.root, planPath, a);
  const edit = (path: string, fn: (r: Row) => void) => { const r = JSON.parse(readFileSync(join(f.root, path), "utf8")); fn(r); put(f.root, path, r); };
  return { ...f, plan, planPath, input, base, request, issue, revoke, bindUnit, adapter, run, edit };
}
