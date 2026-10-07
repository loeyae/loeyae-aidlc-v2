/**
 * 4.11.0 (MARS-94) regression suite.
 *
 * 1. traceability-matrix code_refs layer converges per unit: the unit-manifest
 *    `req_refs` of the active unit, else the REQs of its UC-D subset, else the module set;
 *    a ucd_exemption unit (empty UC-D subset) has no code_refs/tests layer; the code
 *    layer only reads the module's own source roots; build-and-test (no unit) reconciles
 *    the module set.
 * 2. Buffered subprocesses share one 64 MB limit; an overflow (ENOBUFS) is reported as
 *    its own `kind: "error"` naming the child, never folded into a gate failure.
 *
 * Checks run through the public CLI (`check`, `evidence run`, `orchestrate report`).
 * The I13 record of section 1 is a fixture input of the matrix checker (it only reads
 * `status` / `ucd_ids` / `ucd_units`), not gate-accepted evidence.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-4110-"));
const sections: string[] = [];
const failed: string[] = [];

const M01 = "m01";
const M02 = "m02";
const IN = `docs/aidlc/modules/${M01}/inception`;
const CASES = `${IN}/application-design/test-cases`;
const I13 = `.aidlc/evidence/test-case-derivation/${M01}/test-case-derivation.json`;
const GLOBAL_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
const EXEMPTION = { reason_code: "pure-declaration", reason: "u-b 只声明跨单元契约，不含业务行为", approval_ref: "REVIEW-2026-10-07-01", alternative_validation: "契约结构校验", validation_command: ["node", "-e", "0"] };

type Run = { status: number; stdout: string; out: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["AIDLC_ACTIVE_MODULE", "AIDLC_ACTIVE_UNIT", "AIDLC_ACTIVE_STAGE", "AIDLC_PHASE", "AIDLC_MODULE", "AIDLC_SUBPROCESS_MAX_BUFFER"]) delete env[key];
  return { ...env, ...extra };
}

function run(project: string, args: string[], env: NodeJS.ProcessEnv = {}): Run {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8", env: cleanEnv(env), maxBuffer: 64 * 1024 * 1024 });
  const stdout = result.stdout || "";
  return { status: result.status ?? 1, stdout, out: `${stdout}\n${result.stderr || ""}` };
}

function ok(project: string, args: string[], env: NodeJS.ProcessEnv = {}): Run {
  const result = run(project, args, env);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.out}`);
  return result;
}

function write(project: string, path: string, content: string): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), content, "utf8");
}

function git(cwd: string, args: string[], input?: string): string {
  const result = spawnSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return (result.stdout || "").trim();
}

function commit(project: string, message: string): void {
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", message]);
}

async function section(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    sections.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failed.push(name);
    console.error(`FAIL ${name}\n${error instanceof Error ? error.stack || error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// 1. code_refs unit scope
// ---------------------------------------------------------------------------

type UnitSpec = { id: string; req_refs?: unknown; exempt?: boolean };

function unitManifest(project: string, units: UnitSpec[]): void {
  write(project, `${IN}/unit-manifest.json`, `${JSON.stringify({
    schema_version: 1,
    module_id: M01,
    units: units.map((unit) => ({
      unit_id: unit.id,
      name: `Unit ${unit.id}`,
      service_id: "order-service",
      ...(unit.req_refs !== undefined ? { req_refs: unit.req_refs } : {}),
      ...(unit.exempt ? { ucd_exemption: EXEMPTION } : {}),
    })),
  }, null, 2)}\n`);
}

/** I13 fixture: UC-D-001 belongs to u-a (unit_refs); u-b owns no UC-D. */
function i13(project: string, ucdUnits: Record<string, string[]> | null): void {
  rmSync(join(project, I13), { force: true });
  if (ucdUnits === null) return;
  write(project, I13, `${JSON.stringify({ status: "required", ucd_ids: ["UC-D-001"], ucd_modes: { "UC-D-001": "new" }, ucd_units: ucdUnits }, null, 2)}\n`);
}

/**
 * Module m01 (source root services/m01) with REQ-001 and REQ-002, both carried by every
 * layer before code_refs. Only REQ-001 is in m01's code; REQ-002 appears in the code of
 * module m02 (services/m02), which must never count for m01.
 */
function matrixProject(name: string): string {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({
    schema_version: 1,
    modules: [
      { module_id: M01, name: "Orders", service_id: "order-service", paths: ["services/m01"] },
      { module_id: M02, name: "Billing", service_id: "billing-service", paths: ["services/m02"] },
    ],
  }));
  write(project, `${IN}/requirements.md`, "# Requirements\n\n## REQ-001 Order export retry\ntrack: [backend]\nRetries on timeout.\n\n## REQ-002 Export audit\ntrack: [backend]\nEvery export is audited.\n");
  write(project, `${IN}/user-stories.md`, "# User stories\n\n## STORY-001 Retry (REQ-001)\n- AC-01 retry succeeds\n\n## STORY-002 Audit (REQ-002)\n- AC-02 audit row written\n");
  write(project, `${IN}/application-design.md`, "# Application design\n\n- ExportService implements REQ-001 and REQ-002.\n");
  write(project, `${CASES}/_index.md`, "# UC-D index\n\n- UC-D-001 retry (source_ref: REQ-001)\n- REQ-002 is covered by the contract unit u-b.\n");
  write(project, `${CASES}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-001\ntdd_mode: new\nunit_refs: [u-a]\n---\n# UC-D-001 retry\n\nGiven REQ-001, When the export times out, Then it retries.\n");
  write(project, "services/m01/export_retry.py", "# REQ-001 UC-D-001 retry on timeout\ndef retry(job):\n    return job\n");
  write(project, "services/m02/audit.py", "# REQ-002 audit (module m02)\ndef audit(job):\n    return job\n");
  write(project, "tests/test_export.py", "# REQ-001 REQ-002 UC-D-001\ndef test_uc_d_001():\n    assert True\n");
  unitManifest(project, [{ id: "u-a", req_refs: ["REQ-001"] }, { id: "u-b", exempt: true }]);
  i13(project, { "UC-D-001": ["u-a"] });
  commit(project, "fixture");
  const state: WorkflowState = createInitialState("feature", "4.11.0", `workflow-${name}`, [], "MARS-94 code_refs unit scope");
  state.completed_stages = [...GLOBAL_STAGES];
  state.completed_stage_instances = [...GLOBAL_STAGES];
  saveWorkflowState(project, state);
  return project;
}

function matrix(project: string, stage: string, unit?: string): Json {
  const result = ok(project, ["check", "--sensor", "traceability-matrix", "--module", M01, ...(unit ? ["--unit", unit] : [])], { AIDLC_ACTIVE_STAGE: stage });
  return JSON.parse(result.stdout) as Json;
}

function codeBroken(record: Json): string[] {
  return (record.broken_rows as string[]).filter((row) => /BROKEN@code_refs|UNKNOWN_REQ_REF/.test(row));
}

// ---------------------------------------------------------------------------
// 2. ENOBUFS
// ---------------------------------------------------------------------------

/**
 * A requirements-analysis workflow whose declared nested repository app/ has a
 * `git ls-files` output of more than 2 MB (index entries marked skip-worktree, so the
 * fixture needs no files on disk and the repository stays clean).
 */
function overflowProject(name: string): string {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  write(project, ".gitignore", "app/\n");
  write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [{ module_id: M01, name: "Orders", service_id: "order-service" }] }));
  write(project, "docs/aidlc/ideation/scenario-module-mapping.md", "# Scenario module mapping\nREQ-001 order export belongs to m01.\n");
  write(project, `${IN}/requirements.md`, "# Requirements\n\n## REQ-001 Order export retry\ntrack: [backend]\nThe order export retries on timeout, with enough detail for review.\n");
  write(project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: [{ path: "app", repo: "nested" }] })}\n`);
  write(project, ".aidlc/commands/requirements-analysis.json", JSON.stringify({
    version: "1",
    stage: "requirements-analysis",
    commands: [{ id: "traceability-matrix", role: "semantic", sensor: "traceability-matrix", argv: ["loeyae-aidlc", "check", "--sensor", "traceability-matrix"] }],
  }));
  commit(project, "workflow repository");

  const app = join(project, "app");
  mkdirSync(app, { recursive: true });
  git(app, ["init", "-q"]);
  write(project, "app/export_retry.py", "# REQ-001 retry on timeout\ndef retry(job):\n    return job\n");
  git(app, ["add", "-A"]);
  const blob = git(app, ["hash-object", "-w", "export_retry.py"]);
  const segment = "x".repeat(100);
  const entries: string[] = [];
  for (let index = 0; index < 22000; index += 1) entries.push(`100644 ${blob}\tbulk/${segment}/f${index}.py`);
  git(app, ["update-index", "--index-info"], `${entries.join("\n")}\n`);
  git(app, ["update-index", "--skip-worktree", "--stdin"], `${entries.map((entry) => entry.split("\t")[1]).join("\n")}\n`);
  git(app, ["commit", "-qm", "a1 large repository"]);
  const listed = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: app, maxBuffer: 64 * 1024 * 1024 });
  assert.ok(listed.stdout.length > 2 * 1024 * 1024, `fixture git ls-files output is ${listed.stdout.length} bytes`);

  const state: WorkflowState = createInitialState("feature", "4.11.0", `workflow-${name}`, [], "MARS-94 subprocess buffer");
  state.completed_stages = [...GLOBAL_STAGES];
  state.completed_stage_instances = [...GLOBAL_STAGES];
  state.skipped_stage_instances = [`reverse-engineering@module:${M01}`];
  state.current_stage = "requirements-analysis";
  state.current_phase = "inception";
  state.current_stage_instance = `requirements-analysis@module:${M01}`;
  state.current_module = M01;
  saveWorkflowState(project, state);
  return project;
}

try {
  await section("code_refs: req_refs scope the unit; other modules' code never covers", () => {
    const project = matrixProject("req-refs");
    const unitA = matrix(project, "code-generation", "u-a");
    assert.deepEqual(codeBroken(unitA), [], JSON.stringify(unitA.broken_rows));
    assert.deepEqual(unitA.unit_scope.code_refs_layer_reqs, ["REQ-001"]);
    assert.equal(unitA.unit_scope.code_refs_source, "req_refs");
    assert.deepEqual(unitA.unit_scope.tests_layer_reqs, ["REQ-001"]);

    // REQ-002 is marked only in services/m02: the module-scoped scan must not count it.
    unitManifest(project, [{ id: "u-a", req_refs: ["REQ-001", "REQ-002"] }, { id: "u-b", exempt: true }]);
    const widened = matrix(project, "code-generation", "u-a");
    assert.deepEqual(codeBroken(widened), ["REQ-002: BROKEN@code_refs"], JSON.stringify(widened.broken_rows));
  });

  await section("code_refs: UC-D subset fallback without req_refs", () => {
    const project = matrixProject("ucd-subset");
    unitManifest(project, [{ id: "u-a" }, { id: "u-b", exempt: true }]);
    const unitA = matrix(project, "code-generation", "u-a");
    assert.deepEqual(codeBroken(unitA), [], JSON.stringify(unitA.broken_rows));
    assert.deepEqual(unitA.unit_scope.code_refs_layer_reqs, ["REQ-001"]);
    assert.equal(unitA.unit_scope.code_refs_source, "ucd_subset");
  });

  await section("code_refs: ucd_exemption unit has no code_refs/tests layer", () => {
    const project = matrixProject("exemption");
    const unitB = matrix(project, "code-generation", "u-b");
    assert.deepEqual(unitB.broken_rows, [], JSON.stringify(unitB.broken_rows));
    assert.equal(unitB.unit_scope.code_refs_layer, "not_applicable(ucd_exemption)");
    assert.equal(unitB.unit_scope.tests_layer, "not_applicable(ucd_exemption)");
    assert.deepEqual(unitB.unit_scope.exemption, { reason_code: "pure-declaration" });
    assert.deepEqual(unitB.unit_scope.code_refs_layer_reqs, []);
    assert.deepEqual(unitB.unit_scope.ucd_ids, []);
    // Other layers still apply: a REQ lost at the story layer stays broken for u-b.
    write(project, `${IN}/user-stories.md`, "# User stories\n\n## STORY-001 Retry (REQ-001)\n- AC-01 retry succeeds\n");
    const lost = matrix(project, "code-generation", "u-b");
    assert.deepEqual(lost.broken_rows, ["REQ-002: BROKEN@stories"], JSON.stringify(lost.broken_rows));
  });

  await section("code_refs: build-and-test reconciles the module set", () => {
    const project = matrixProject("close-out");
    const closeOut = matrix(project, "build-and-test");
    assert.deepEqual(codeBroken(closeOut), ["REQ-002: BROKEN@code_refs"], JSON.stringify(closeOut.broken_rows));
    assert.equal(closeOut.unit_scope, undefined, "no unit context: no unit_scope");
    write(project, "services/m01/audit.py", "# REQ-002 audit row\ndef audit(job):\n    return job\n");
    const fixed = matrix(project, "build-and-test");
    assert.deepEqual(codeBroken(fixed), [], JSON.stringify(fixed.broken_rows));
  });

  await section("code_refs: compatibility without req_refs and ucd_units", () => {
    const project = matrixProject("compat");
    unitManifest(project, [{ id: "u-a" }, { id: "u-b" }]);
    i13(project, null);
    const unitA = matrix(project, "code-generation", "u-a");
    const moduleView = matrix(project, "code-generation");
    assert.equal(unitA.unit_scope, undefined, "no req_refs and no ucd_units: no unit_scope");
    assert.deepEqual(unitA.broken_rows, moduleView.broken_rows);
    assert.deepEqual(Object.keys(unitA).sort(), Object.keys(moduleView).sort());
    assert.deepEqual(codeBroken(unitA), ["REQ-002: BROKEN@code_refs"]);
  });

  await section("code_refs: req_refs are validated", () => {
    const project = matrixProject("validation");
    unitManifest(project, [{ id: "u-a", req_refs: ["REQ-001", "REQ-009"] }, { id: "u-b", exempt: true }]);
    const unknown = matrix(project, "code-generation", "u-a");
    assert.ok(unknown.broken_rows.some((row: string) => row.startsWith("REQ-009: UNKNOWN_REQ_REF@unit-manifest")), JSON.stringify(unknown.broken_rows));
    for (const invalid of [[], ["order-1"], ["REQ-001", "REQ-001"], "REQ-001"]) {
      unitManifest(project, [{ id: "u-a", req_refs: invalid }, { id: "u-b", exempt: true }]);
      const result = run(project, ["check", "--sensor", "traceability-matrix", "--module", M01, "--unit", "u-a"], { AIDLC_ACTIVE_STAGE: "code-generation" });
      assert.notEqual(result.status, 0, `req_refs ${JSON.stringify(invalid)} must be rejected`);
      assert.match(result.out, /units\[0\]\.req_refs/, result.out);
    }
  });

  await section("ENOBUFS: report with a >2 MB nested git ls-files does not overflow", () => {
    const project = overflowProject("enobufs-large");
    ok(project, ["evidence", "run", "--stage", "requirements-analysis"]);
    const report = run(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--result", "completed"]);
    assert.doesNotMatch(report.out, /ENOBUFS/, report.out.slice(-2000));
    assert.equal(report.status, 0, `status ${report.status}\n${report.out.slice(-3000)}`);
    assert.match(report.stdout, /Stage \\"requirements-analysis\\" completed/, report.stdout);
  });

  await section("ENOBUFS: an overflow names the subprocess as its own error", () => {
    const project = overflowProject("enobufs-small");
    const limit = { AIDLC_SUBPROCESS_MAX_BUFFER: String(256 * 1024) };
    const report = run(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--result", "completed"], limit);
    assert.notEqual(report.status, 0, report.out.slice(-2000));
    const directive = JSON.parse(report.stdout) as Json;
    assert.equal(directive.kind, "error");
    assert.match(String(directive.message), /^🚫 Subprocess output overflow \(ENOBUFS\): git ls-files /, String(directive.message));
    assert.deepEqual(directive.subprocess, { argv: ["git", "ls-files"], max_buffer: 256 * 1024 });
    assert.doesNotMatch(String(directive.message), /sensor checks failed|Cannot complete stage/);
    // Raising the limit again completes the stage: the overflow left nothing half-done.
    ok(project, ["evidence", "run", "--stage", "requirements-analysis"]);
    const retried = ok(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--result", "completed"]);
    assert.match(retried.stdout, /Stage \\"requirements-analysis\\" completed/, retried.stdout);
  });
} finally {
  if (!process.env.AIDLC_KEEP_SCRATCH) rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${sections.length} passed, ${failed.length} failed`);
if (failed.length > 0) {
  console.error(`Failed: ${failed.join(", ")}`);
  process.exit(1);
}
