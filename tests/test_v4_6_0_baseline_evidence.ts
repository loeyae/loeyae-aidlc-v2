/**
 * 4.6.0-3 S3a (MARS-49) regression suite: the tdd stage BASELINE evidence
 * (`baseline-test-evidence`, command role `baseline`), its controlled producer and
 * the tdd gate for RED (`new` UC-Ds) and BASELINE (`characterization` UC-Ds).
 *
 * Every fixture is driven through the public CLI (`orchestrate`, `evidence run`) and
 * the gate probe; evidence is only ever produced by the controlled producer and then,
 * for the fail-closed gate cases, tampered with on purpose.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadWorkflowState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const probe = join(repository, "tests", "gate_probe.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-460-s3a-"));
const sections: string[] = [];
const failed: string[] = [];
const OLD_DATE = "2024-01-01T00:00:00Z";
const TDD = "tdd@module:project@unit:default";
const RED_PATH = ".aidlc/evidence/tdd/project/default/red-test-evidence.json";
const BASELINE_PATH = ".aidlc/evidence/tdd/project/default/baseline-test-evidence.json";
const I13_PATH = ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json";

type Run = { status: number; out: string; stdout: string; json: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.AIDLC_ACTIVE_MODULE;
  delete env.AIDLC_ACTIVE_UNIT;
  delete env.AIDLC_ACTIVE_STAGE;
  delete env.AIDLC_PHASE;
  return env;
}

function parsed(stdout: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function run(project: string, args: string[]): Run {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8", env: cleanEnv() });
  const stdout = result.stdout || "";
  return { status: result.status ?? 1, stdout, out: `${stdout}\n${result.stderr || ""}`, json: parsed(stdout) };
}

function ok(project: string, args: string[]): Run {
  const result = run(project, args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.out}`);
  assert.notEqual(result.json.kind, "error", `${args.join(" ")}\n${result.out}`);
  return result;
}

/** tdd gate failures for one sensor, joined; "" when the gate accepts. */
function gate(project: string, sensor: string): string {
  const result = spawnSync(process.execPath, [tsx, probe, TDD, "sensors", sensor], { cwd: project, encoding: "utf8", env: cleanEnv() });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const value = JSON.parse(result.stdout.trim().split(/\r?\n/).pop() || "{}") as { failures?: string[]; error?: string };
  if (value.error) return `probe error: ${value.error}`;
  return (value.failures || []).join("\n");
}

function write(project: string, path: string, content: string): void {
  const target = join(project, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function readJson(project: string, path: string): Json {
  return JSON.parse(readFileSync(join(project, path), "utf8")) as Json;
}

function writeJson(project: string, path: string, value: unknown): void {
  write(project, path, `${JSON.stringify(value, null, 2)}\n`);
}

function git(project: string, args: string[], date = OLD_DATE): string {
  const result = spawnSync("git", args, {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "AI-DLC",
      GIT_AUTHOR_EMAIL: "aidlc@example.invalid",
      GIT_COMMITTER_NAME: "AI-DLC",
      GIT_COMMITTER_EMAIL: "aidlc@example.invalid",
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function digestArgv(argv: string[]): string {
  return createHash("sha256").update(JSON.stringify(argv)).digest("hex");
}

/** Collects fail-closed expectations so one run reports every case that was accepted. */
function rejections(): { expect: (label: string, output: string, pattern: RegExp) => void; assertAll: () => void } {
  const gaps: string[] = [];
  return {
    expect(label, output, pattern) {
      if (!pattern.test(output)) gaps.push(`${label}: expected rejection ${pattern}, got: ${output.trim() ? output.trim().slice(-700) : "ACCEPTED (no failures)"}`);
      else if (process.env.AIDLC_TEST_VERBOSE) console.log(`    rejected ${label}: ${output.trim().slice(-300)}`);
    },
    assertAll() {
      assert.equal(gaps.length, 0, `fail-closed cases not rejected:\n- ${gaps.join("\n- ")}`);
    },
  };
}

async function section(name: string, body: () => void | Promise<void>): Promise<void> {
  try {
    await body();
    sections.push(name);
    console.log(`  ok ${name}`);
  } catch (error) {
    failed.push(name);
    console.log(`  FAIL ${name}\n${error instanceof Error ? error.stack || error.message : String(error)}`);
  }
}

const EXPORTER = "def export_orders(client):\n    return paginate(client.fetch_orders())\n\n\ndef paginate(rows, size=50):\n    return [rows[index:index + size] for index in range(0, len(rows), size)]\n";
const REQUIREMENTS = "# 需求\n\n## REQ-001 导出分页与超时重试\n\ntrack: [nfr]\n\n业务规则：订单导出接口按 50 条分页返回；下游超时时最多重试 3 次，3 次内成功则返回订单列表。\n";
const CASES = "docs/aidlc/modules/project/inception/application-design/test-cases";

function newCase(id: string): string {
  return `---\nid: ${id}\nstatus: ready\nsource_ref: REQ-001\n---\n# ${id} 导出超时重试\n\nGiven 下游首次超时，When 调用 export_orders，Then 重试后返回订单。\n`;
}

function characterizationCase(id: string): string {
  return `---\nid: ${id}\nstatus: ready\nsource_ref: REQ-001\ntdd_mode: characterization\ncode_refs:\n  - app/exporter.py::export_orders\n  - app/exporter.py::paginate\nreason: 重构前锁定导出现有分页行为\napproval_ref: REVIEW-2026-10-02-01\n---\n# ${id} 导出分页\n\nGiven 下游返回 120 条订单，When 调用 export_orders，Then 返回 3 页。\n`;
}

/**
 * Deterministic observer: prints the observation configured for the requested phase
 * in tests/observation.json and exits with the configured code. Each run leaves a
 * marker file (under .aidlc/, outside the worktree digest) so the tests can prove\n * whether the command ran.
 */
const OBSERVER = `const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const phase = process.env.AIDLC_PHASE;
mkdirSync(".aidlc/test-markers", { recursive: true });
writeFileSync(".aidlc/test-markers/ran-" + phase + ".txt", "ran");
const config = JSON.parse(readFileSync("tests/observation.json", "utf8"))[phase];
console.log(JSON.stringify({ phase, ...config.observation }));
process.exit(config.exit);
`;

type Mapping = Array<{ use_case: string; test_methods: string[] }>;

function mapping(ids: string[]): Mapping {
  return ids.map((id) => ({ use_case: id, test_methods: [`tests/test_exporter.py::test_${id.toLowerCase().replace(/-/g, "_")}`] }));
}

function observations(newIds: string[], characterizationIds: string[], overrides: { baselineExit?: number; baselineFailed?: number } = {}): Json {
  const failedCount = overrides.baselineFailed ?? 0;
  return {
    RED: { exit: 1, observation: { status: "failed", failure_class: "behavior", failure_signature: "export_orders raised TimeoutError without retrying", compile_status: "passed", environment_status: "passed", tests_total: Math.max(newIds.length, 1), tests_failed: Math.max(newIds.length, 1), traceability_complete: true, uc_mapping: mapping(newIds) } },
    BASELINE: { exit: overrides.baselineExit ?? 0, observation: { status: failedCount > 0 ? "failed" : "passed", compile_status: "passed", environment_status: "passed", tests_total: Math.max(characterizationIds.length, 1), tests_failed: failedCount, traceability_complete: true, uc_mapping: mapping(characterizationIds) } },
  };
}

type Role = "red" | "baseline";

function tddAllowlist(roles: Role[], stage = "tdd"): string {
  return JSON.stringify({ version: "1", stage, commands: roles.map((role) => ({ id: `uc-${role}`, role, argv: ["node", "tests/observe.cjs"] })) });
}

let counter = 0;

interface Fixture {
  project: string;
  commits: string[];
  baseline: string;
}

/**
 * Git project with legacy Python sources under `app/` (no `src/`), committed before
 * `next --scope` records the workflow baseline; the workflow is driven through I13
 * (controlled evidence) to the active tdd instance.
 */
function tddProject(scope: string, newIds: string[], characterizationIds: string[], roles: Role[]): Fixture {
  const project = join(scratch, `p${++counter}-${scope}`);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["checkout", "-q", "-b", "main"]);
  write(project, "README.md", "# Orders\n");
  write(project, "app/__init__.py", "\"\"\"Orders.\"\"\"\n");
  write(project, "app/exporter.py", EXPORTER);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", "c1 legacy exporter"], "2024-01-01T00:00:00Z");
  const commits = [git(project, ["rev-parse", "HEAD"])];
  write(project, "README.md", "# Orders service\n");
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-qm", "c2 readme"], "2024-01-02T00:00:00Z");
  commits.push(git(project, ["rev-parse", "HEAD"]));
  write(project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: ["app"] })}\n`);
  ok(project, ["orchestrate", "next", "--scope", scope, "--work", "4.6.0 S3a baseline evidence fixture"]);
  const baseline = String(loadWorkflowState(project)!.baseline_commit);
  assert.equal(baseline, commits[1], "next --scope records HEAD as the workflow baseline");

  const expect = (instance: string) => {
    const directive = ok(project, ["orchestrate", "next"]).json;
    assert.equal(directive.stage_instance, instance, JSON.stringify(directive, null, 2));
  };
  expect("workspace-detection");
  ok(project, ["orchestrate", "report", "--stage", "workspace-detection", "--result", "completed", "--instruction-ack", "workspace-detection"]);
  expect("state-template");
  ok(project, ["orchestrate", "report", "--stage", "state-template", "--result", "completed", "--instruction-ack", "state-template"]);
  expect("test-case-derivation@module:project");
  write(project, "docs/aidlc/modules/project/inception/requirements.md", REQUIREMENTS);
  const ids = [...newIds, ...characterizationIds].sort();
  write(project, `${CASES}/_index.md`, `# UC-D 索引\n\n${ids.map((id) => `- ${id} 订单导出（source_ref: REQ-001）`).join("\n")}\n`);
  for (const id of newIds) write(project, `${CASES}/${id}.md`, newCase(id));
  for (const id of characterizationIds) write(project, `${CASES}/${id}.md`, characterizationCase(id));
  ok(project, ["orchestrate", "report", "--stage", "test-case-derivation", "--result", "completed"]);
  expect(TDD);

  write(project, "tests/test_exporter.py", `# REQ-001 ${ids.join(" ")}\nfrom app.exporter import export_orders\n`);
  write(project, "tests/observe.cjs", OBSERVER);
  writeJson(project, "tests/observation.json", observations(newIds, characterizationIds));
  write(project, ".aidlc/commands/tdd.json", tddAllowlist(roles));
  return { project, commits, baseline };
}

function produce(project: string, sensor: string, extra: string[] = []): Run {
  return run(project, ["evidence", "run", "--stage", "tdd", "--sensor", sensor, ...extra]);
}

function reportTdd(project: string): Run {
  return run(project, ["orchestrate", "report", "--stage", "tdd", "--result", "completed"]);
}

function clearPhaseFiles(project: string): void {
  for (const path of [RED_PATH, BASELINE_PATH, ".aidlc/test-markers/ran-RED.txt", ".aidlc/test-markers/ran-BASELINE.txt"]) rmSync(join(project, path), { force: true });
}

/** Run `check` against a tampered copy of an evidence file and restore the original afterwards. */
function tampered(project: string, path: string, mutate: (value: Json) => Json, sensor: string): string {
  const original = readFileSync(join(project, path), "utf8");
  try {
    writeJson(project, path, mutate(JSON.parse(original) as Json));
    return gate(project, sensor);
  } finally {
    writeFileSync(join(project, path), original, "utf8");
  }
}

try {
  // ---------------------------------------------------------------- positive
  await section("positive: refactor with only characterization UC-Ds — RED not_required, BASELINE passed, tdd completes", () => {
    const { project, baseline } = tddProject("refactor", [], ["UC-D-003"], ["baseline"]);
    const completed = reportTdd(project);
    assert.equal(completed.status, 0, completed.out);
    assert.notEqual(completed.json.kind, "error", completed.out);
    assert.ok(loadWorkflowState(project)!.completed_stage_instances.includes(TDD), "tdd instance completed");
    const red = readJson(project, RED_PATH);
    assert.equal(red.status, "not_required");
    assert.equal(red.phase, "RED");
    assert.deepEqual(red.ucd_ids, []);
    assert.equal(red.producer.mode, "controlled");
    assert.equal(existsSync(join(project, ".aidlc/test-markers/ran-RED.txt")), false, "RED not_required runs no command");
    const value = readJson(project, BASELINE_PATH);
    assert.equal(value.phase, "BASELINE");
    assert.equal(value.status, "passed");
    assert.equal(value.tests_failed, 0);
    assert.equal(value.baseline_commit, baseline);
    assert.deepEqual(value.uc_mapping.map((entry: Json) => entry.use_case), ["UC-D-003"]);
    const blob = git(project, ["rev-parse", `${baseline}:app/exporter.py`]);
    assert.deepEqual(value.code_ref_digests, [{ path: "app/exporter.py", baseline_blob: blob, worktree_blob: blob }]);
    assert.equal(value.observed_command.id, "uc-baseline");
    assert.equal(value.observed_command.phase, "BASELINE");
    assert.equal(value.observed_command.exit_code, 0);
    assert.equal(value.observed_command.argv_digest, digestArgv(["node", "tests/observe.cjs"]));
    assert.equal(value.checker.id, "builtin:baseline-test-evidence");
    assert.equal(value.checker.argv_digest, digestArgv(["BASELINE-observation", value.observed_command.argv_digest]));
    assert.equal(value.producer.mode, "controlled");
  });

  await section("positive: bugfix mixing new and characterization UC-Ds — RED and BASELINE both observed, tdd completes", () => {
    const { project } = tddProject("bugfix", ["UC-D-001"], ["UC-D-003"], ["red", "baseline"]);
    const completed = reportTdd(project);
    assert.equal(completed.status, 0, completed.out);
    assert.notEqual(completed.json.kind, "error", completed.out);
    const red = readJson(project, RED_PATH);
    assert.equal(red.status, "failed");
    assert.deepEqual(red.uc_mapping.map((entry: Json) => entry.use_case), ["UC-D-001"]);
    const value = readJson(project, BASELINE_PATH);
    assert.equal(value.status, "passed");
    assert.deepEqual(value.uc_mapping.map((entry: Json) => entry.use_case), ["UC-D-003"]);
  });

  await section("positive: no tdd_mode — RED unchanged, BASELINE not_required without a baseline command; legacy I13 without ucd_modes", () => {
    const { project } = tddProject("refactor", ["UC-D-001"], [], ["red"]);
    const completed = reportTdd(project);
    assert.equal(completed.status, 0, completed.out);
    assert.notEqual(completed.json.kind, "error", completed.out);
    assert.equal(readJson(project, RED_PATH).status, "failed");
    const value = readJson(project, BASELINE_PATH);
    assert.equal(value.status, "not_required");
    assert.equal(value.phase, "BASELINE");
    assert.deepEqual(value.ucd_ids, []);
    assert.equal(value.producer.mode, "controlled");
    assert.equal(value.checker.id, "builtin:baseline-test-evidence");
    assert.equal(existsSync(join(project, ".aidlc/test-markers/ran-BASELINE.txt")), false, "BASELINE not_required runs no command");
    // Pre-4.6 I13 evidence (no ucd_modes) means every UC-D is new: the same RED and
    // not_required BASELINE still pass the gate.
    const i13 = readJson(project, I13_PATH);
    delete i13.ucd_modes;
    writeJson(project, I13_PATH, i13);
    assert.equal(gate(project, "red-test-evidence"), "");
    assert.equal(gate(project, "baseline-test-evidence"), "");
  });

  // ---------------------------------------------------------------- producer
  await section("producer: a code ref changed before BASELINE is rejected before the command runs, without evidence", () => {
    const checks = rejections();
    const { project } = tddProject("bugfix", ["UC-D-001"], ["UC-D-003"], ["red", "baseline"]);
    write(project, "app/exporter.py", `${EXPORTER}\nMAX_RETRIES = 3\n`);
    clearPhaseFiles(project);
    const result = produce(project, "baseline-test-evidence");
    checks.expect("modified code ref", result.status === 0 ? "" : result.out, /app\/exporter\.py[\s\S]*(differs|changed|does not match)[\s\S]*baseline/i);
    checks.expect("no BASELINE evidence", existsSync(join(project, BASELINE_PATH)) ? "written" : "not written", /^not written$/);
    checks.expect("baseline command not run", existsSync(join(project, ".aidlc/test-markers/ran-BASELINE.txt")) ? "ran" : "not run", /^not run$/);
    rmSync(join(project, "app/exporter.py"));
    const removed = produce(project, "baseline-test-evidence");
    checks.expect("deleted code ref", removed.status === 0 ? "" : removed.out, /app\/exporter\.py/);
    checks.expect("deleted code ref: no BASELINE evidence", existsSync(join(project, BASELINE_PATH)) ? "written" : "not written", /^not written$/);
    checks.assertAll();
  });

  await section("producer: BASELINE must exit 0 with tests_failed=0 and a single role: baseline command of stage tdd", () => {
    const checks = rejections();
    const { project } = tddProject("bugfix", ["UC-D-001"], ["UC-D-003"], ["red", "baseline"]);
    const attempt = (label: string, pattern: RegExp) => {
      rmSync(join(project, BASELINE_PATH), { force: true });
      const result = produce(project, "baseline-test-evidence");
      checks.expect(label, result.status === 0 ? "" : result.out, pattern);
      checks.expect(`${label}: no evidence`, existsSync(join(project, BASELINE_PATH)) ? "written" : "not written", /^not written$/);
    };
    writeJson(project, "tests/observation.json", observations(["UC-D-001"], ["UC-D-003"], { baselineExit: 1 }));
    attempt("baseline command exits 1", /BASELINE command uc-baseline must exit 0; got 1/);
    writeJson(project, "tests/observation.json", observations(["UC-D-001"], ["UC-D-003"], { baselineExit: 0, baselineFailed: 1 }));
    attempt("baseline exits 0 but reports tests_failed=1", /BASELINE evidence must be passed with tests_failed=0/);
    writeJson(project, "tests/observation.json", observations(["UC-D-001"], ["UC-D-003"]));
    write(project, ".aidlc/commands/tdd.json", tddAllowlist(["red"]));
    attempt("allowlist without role: baseline", /exactly one baseline command/);
    write(project, ".aidlc/commands/tdd.json", JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "uc-red", role: "red", argv: ["node", "tests/observe.cjs"] }, { id: "uc-baseline", role: "baseline", argv: ["node", "tests/observe.cjs"] }, { id: "uc-baseline-2", role: "baseline", argv: ["node", "tests/other.cjs"] }] }));
    attempt("allowlist with two baseline commands", /exactly one baseline command/);
    write(project, ".aidlc/commands/tdd.json", tddAllowlist(["red", "baseline"], "code-generation"));
    attempt("allowlist locked to another stage", /command allowlist stage must be "tdd"/);
    write(project, ".aidlc/commands/tdd.json", tddAllowlist(["red", "baseline"]));
    rmSync(join(project, BASELINE_PATH), { force: true });
    ok(project, ["evidence", "run", "--stage", "tdd", "--sensor", "baseline-test-evidence"]);
    assert.equal(readJson(project, BASELINE_PATH).status, "passed", "restored allowlist produces BASELINE again");
    checks.assertAll();
  });

  await section("producer M1: --config naming another file is refused for --sensor baseline-test-evidence and --all-sensors, without evidence", () => {
    const checks = rejections();
    const { project } = tddProject("bugfix", ["UC-D-001"], ["UC-D-003"], ["red", "baseline"]);
    write(project, "other.json", tddAllowlist(["red", "baseline"]));
    const lockedTo = /evidence binds only the default allowlist lookup[\s\S]*\.aidlc\/commands\/tdd\.json/;
    clearPhaseFiles(project);
    const single = produce(project, "baseline-test-evidence", ["--config", "other.json"]);
    checks.expect("--sensor baseline-test-evidence --config other.json", single.status === 0 ? "" : single.out, /BASELINE evidence binds only the default allowlist lookup[\s\S]*\.aidlc\/commands\/tdd\.json/);
    checks.expect("--sensor: no BASELINE evidence", existsSync(join(project, BASELINE_PATH)) ? "written" : "not written", /^not written$/);
    checks.expect("--sensor: baseline command not run", existsSync(join(project, ".aidlc/test-markers/ran-BASELINE.txt")) ? "ran" : "not run", /^not run$/);
    clearPhaseFiles(project);
    const all = run(project, ["evidence", "run", "--stage", "tdd", "--all-sensors", "--config", "other.json"]);
    checks.expect("--all-sensors --config other.json", all.status === 0 ? "" : all.out, lockedTo);
    checks.expect("--all-sensors: no RED or BASELINE evidence", [RED_PATH, BASELINE_PATH].filter((path) => existsSync(join(project, path))).join(", ") || "none", /^none$/);
    checks.expect("--all-sensors: no command run", [".aidlc/test-markers/ran-RED.txt", ".aidlc/test-markers/ran-BASELINE.txt"].filter((path) => existsSync(join(project, path))).join(", ") || "none", /^none$/);
    const allowed = produce(project, "baseline-test-evidence", ["--config", ".aidlc/commands/tdd.json"]);
    assert.equal(allowed.status, 0, allowed.out);
    checks.assertAll();
  });

  // ---------------------------------------------------------------- gate
  await section("gate: BASELINE and RED content is bound to the I13 ucd_modes, the baseline blobs and the allowlist", () => {
    const checks = rejections();
    const { project, commits, baseline } = tddProject("bugfix", ["UC-D-001"], ["UC-D-003"], ["red", "baseline"]);
    ok(project, ["evidence", "run", "--stage", "tdd", "--all-sensors"]);
    assert.equal(gate(project, "red-test-evidence"), "", "controlled RED passes");
    assert.equal(gate(project, "baseline-test-evidence"), "", "controlled BASELINE passes");
    const BASE = "baseline-test-evidence";
    const RED = "red-test-evidence";
    const baselineBlob = git(project, ["rev-parse", `${baseline}:app/exporter.py`]);
    const otherBlob = git(project, ["rev-parse", `${commits[0]}:README.md`]);

    // code_ref_digests: tampered to look consistent.
    checks.expect("code_ref_digests forged consistently with another blob", tampered(project, BASELINE_PATH, (value) => ({ ...value, code_ref_digests: [{ path: "app/exporter.py", baseline_blob: otherBlob, worktree_blob: otherBlob }] }), BASE), /code_ref_digests app\/exporter\.py baseline_blob .* does not match .* at the workflow baseline/);
    checks.expect("code_ref_digests worktree_blob differs", tampered(project, BASELINE_PATH, (value) => ({ ...value, code_ref_digests: [{ path: "app/exporter.py", baseline_blob: baselineBlob, worktree_blob: otherBlob }] }), BASE), /worktree_blob .* must equal baseline_blob/);
    checks.expect("code_ref_digests missing a code ref", tampered(project, BASELINE_PATH, (value) => ({ ...value, code_ref_digests: [] }), BASE), /code_ref_digests must cover exactly/);

    // uc_mapping coverage.
    checks.expect("BASELINE uc_mapping misses the characterization UC-D", tampered(project, BASELINE_PATH, (value) => ({ ...value, uc_mapping: mapping(["UC-D-009"]) }), BASE), /BASELINE uc_mapping must cover exactly the tdd_mode characterization UC-Ds[\s\S]*UC-D-003/);
    checks.expect("BASELINE uc_mapping includes a new UC-D", tampered(project, BASELINE_PATH, (value) => ({ ...value, uc_mapping: mapping(["UC-D-001", "UC-D-003"]) }), BASE), /BASELINE uc_mapping must cover exactly the tdd_mode characterization UC-Ds[\s\S]*UC-D-001/);
    checks.expect("RED uc_mapping includes a characterization UC-D", tampered(project, RED_PATH, (value) => ({ ...value, uc_mapping: mapping(["UC-D-001", "UC-D-003"]) }), RED), /RED uc_mapping must cover exactly the tdd_mode new UC-Ds[\s\S]*UC-D-003/);
    checks.expect("RED uc_mapping misses the new UC-D", tampered(project, RED_PATH, (value) => ({ ...value, uc_mapping: [{ use_case: "UC-D-002", test_methods: ["t"] }] }), RED), /RED uc_mapping must cover exactly the tdd_mode new UC-Ds[\s\S]*UC-D-001/);

    // not_required misuse.
    checks.expect("BASELINE not_required while a characterization UC-D exists", tampered(project, BASELINE_PATH, (value) => ({ ...value, status: "not_required", ucd_ids: [] }), BASE), /BASELINE may be not_required only when I13 declares no tdd_mode characterization UC-D/);
    checks.expect("RED not_required while a new UC-D exists", tampered(project, RED_PATH, (value) => ({ ...value, status: "not_required", ucd_ids: [] }), RED), /RED may be not_required only when I13 declares no tdd_mode new UC-D/);

    // Observation result.
    checks.expect("BASELINE observed exit_code 1", tampered(project, BASELINE_PATH, (value) => ({ ...value, observed_command: { ...value.observed_command, exit_code: 1 } }), BASE), /observed_command\.exit_code must be 0/);
    checks.expect("BASELINE tests_failed 1", tampered(project, BASELINE_PATH, (value) => ({ ...value, tests_failed: 1 }), BASE), /BASELINE must be passed with tests_failed=0/);

    // G1 binding.
    const otherDigest = digestArgv(["node", "tests/other.cjs"]);
    checks.expect("observed argv_digest swapped for another valid digest", tampered(project, BASELINE_PATH, (value) => ({ ...value, observed_command: { ...value.observed_command, argv_digest: otherDigest }, checker: { ...value.checker, argv_digest: digestArgv(["BASELINE-observation", otherDigest]) } }), BASE), /observed_command\.argv_digest does not match the allowlisted baseline command/);
    checks.expect("checker.argv_digest not derived from observed_command", tampered(project, BASELINE_PATH, (value) => ({ ...value, checker: { ...value.checker, argv_digest: digestArgv(["RED-observation", value.observed_command.argv_digest]) } }), BASE), /checker\.argv_digest does not match the BASELINE observation/);
    checks.expect("producer.mode manual", tampered(project, BASELINE_PATH, (value) => ({ ...value, producer: { ...value.producer, mode: "manual" } }), BASE), /producer\.mode must be "controlled"/);
    const allowlist = readFileSync(join(project, ".aidlc/commands/tdd.json"), "utf8");
    write(project, ".aidlc/commands/tdd.json", tddAllowlist(["red"]));
    checks.expect("allowlist without role: baseline", gate(project, BASE), /cannot bind observed_command to the baseline command allowlist[\s\S]*exactly one baseline command/);
    write(project, ".aidlc/commands/tdd.json", JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "uc-red", role: "red", argv: ["node", "tests/observe.cjs"] }, { id: "uc-baseline", role: "baseline", argv: ["node", "tests/observe.cjs"] }, { id: "uc-baseline-2", role: "baseline", argv: ["node", "tests/other.cjs"] }] }));
    checks.expect("allowlist with two baseline commands", gate(project, BASE), /exactly one baseline command/);
    write(project, ".aidlc/commands/tdd.json", tddAllowlist(["red", "baseline"], "code-generation"));
    checks.expect("allowlist locked to another stage", gate(project, BASE), /command allowlist stage must be "tdd"/);
    write(project, ".aidlc/commands/tdd.json", allowlist);
    assert.equal(gate(project, BASE), "", "restored allowlist binds BASELINE again");
    checks.assertAll();
  });

  await section("gate: baseline_commit agrees across state, I13 and evidence, and stays reachable from HEAD", () => {
    const checks = rejections();
    const { project, commits, baseline } = tddProject("bugfix", ["UC-D-001"], ["UC-D-003"], ["red", "baseline"]);
    ok(project, ["evidence", "run", "--stage", "tdd", "--sensor", "baseline-test-evidence"]);
    const BASE = "baseline-test-evidence";
    assert.equal(gate(project, BASE), "");
    checks.expect("evidence baseline_commit differs", tampered(project, BASELINE_PATH, (value) => ({ ...value, baseline_commit: commits[0] }), BASE), /baseline_commit .* does not match the workflow baseline/);
    checks.expect("I13 baseline_commit differs", tampered(project, I13_PATH, (value) => ({ ...value, baseline_commit: commits[0] }), BASE), /I13 baseline_commit/);
    const state = loadWorkflowState(project) as WorkflowState;
    saveWorkflowState(project, { ...state, baseline_commit: commits[0], baseline_source: "replaced" }, undefined, { baselineWrite: true });
    checks.expect("state baseline replaced after BASELINE", gate(project, BASE), /does not match the workflow baseline/);
    saveWorkflowState(project, { ...(loadWorkflowState(project) as WorkflowState), baseline_commit: baseline, baseline_source: state.baseline_source }, undefined, { baselineWrite: true });
    assert.equal(gate(project, BASE), "", "restored state baseline");
    // A rebase rewrites history and orphans the baseline commit.
    git(project, ["reset", "-q", "--hard", commits[0]]);
    write(project, "README.md", "# Orders service (rewritten)\n");
    git(project, ["add", "README.md"]);
    git(project, ["commit", "-qm", "c2 rewritten"], "2024-01-02T00:00:00Z");
    checks.expect("baseline orphaned by a rebase", gate(project, BASE), /workflow baseline commit .* is not the current HEAD or one of its ancestors/);
    checks.assertAll();
  });

  if (failed.length > 0) {
    console.log(`4.6.0 S3a baseline evidence regression tests FAILED: ${failed.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log(`4.6.0 S3a baseline evidence regression tests passed (${sections.length} sections)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
