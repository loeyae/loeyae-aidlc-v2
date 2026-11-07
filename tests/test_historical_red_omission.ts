import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";
import { redOmissionDigest } from "../core/tools/aidlc-red-omission";

const repo = resolve(import.meta.dirname, ".."), tsx = join(repo, "node_modules/tsx/dist/cli.mjs");
const root = mkdtempSync(join(tmpdir(), "aidlc-red-omission-"));
const greenPath = ".aidlc/evidence/code-generation/project/default/green-test-evidence.json";
const redPath = ".aidlc/evidence/tdd/project/default/red-test-evidence.json";
const qualityPath = ".aidlc/evidence/code-generation/project/default/test-quality.json";
const put = (path: string, value: unknown) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
};
const bytes = (path: string) => readFileSync(join(root, path), "utf8");
const json = (path: string) => JSON.parse(bytes(path));
function run(args: string[], ok = true, env?: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [tsx, join(repo, "bin/cli.ts"), ...args], { cwd: root, encoding: "utf8", env: env || fixtureEnvironment(root, args) });
  const out = result.stdout + result.stderr;
  assert.equal(result.status === 0, ok, `${args.join(" ")}\n${out}`);
  return out;
}
function active(stage: string, unit = "default") {
  const state = loadWorkflowState(root)!;
  Object.assign(state, { current_stage: stage, current_stage_instance: `${stage}@module:project${stage === "test-case-derivation" ? "" : `@unit:${unit}`}`,
    current_module: "project", current_unit: stage === "test-case-derivation" ? undefined : unit, current_phase: stage === "test-case-derivation" ? "inception" : "construction" });
  saveFixtureState(root, state);
}
function git(...args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function gate(instance: string, sensor: string, historical = false) {
  const result = spawnSync(process.execPath, [tsx, join(repo, "tests/omission_gate_probe.ts"), instance, sensor, ...(historical ? ["historical"] : [])], { cwd: root, encoding: "utf8", env: { ...process.env, AIDLC_SESSION_BINDING: "" } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout); assert.equal(parsed.error, undefined, result.stdout);
  return parsed.failures.join("\n") as string;
}
try {
  put(".gitignore", ".aidlc/\naidlc/\n");
  put("docs/aidlc/ideation/module-manifest.json", { schema_version: 1, modules: [{ module_id: "project", name: "Project", service_id: "project", paths: ["src"] }] });
  put("docs/aidlc/modules/project/inception/unit-manifest.json", { schema_version: 1, module_id: "project", units: ["default", "other"].map(unit_id => ({ unit_id, name: unit_id, service_id: "project", req_refs: ["REQ-1"] })) });
  put("README.md", "Historical omission recovery\n");
  put("src/behavior.cjs", "module.exports=()=>false;\n");
  put("scripts/observe.cjs", "require('../tests/behavior.test.cjs');\n");
  put("tests/behavior.test.cjs", "const fs=require('node:fs'),assert=require('node:assert/strict');fs.appendFileSync('.aidlc/phase-executions',process.env.AIDLC_PHASE+'\\n');let failed=0;try{assert.equal(require('../src/behavior.cjs')(),true);}catch{failed=1;}console.log(JSON.stringify({phase:process.env.AIDLC_PHASE,status:failed?'failed':'passed',compile_status:'passed',environment_status:'passed',tests_total:1,tests_failed:failed,traceability_complete:true,...failed?{failure_class:'behavior',failure_signature:'approved behavior absent'}:{},uc_mapping:[{use_case:'UC-D-001',test_methods:['tests/behavior.test.cjs']}]}));process.exit(failed);\n");
  put("docs/aidlc/modules/project/inception/requirements.md", "REQ-1: Given a caller When checking behavior Then return true.\n");
  const cases = "docs/aidlc/modules/project/inception/application-design/test-cases";
  put(`${cases}/_index.md`, "UC-D-001 status: ready source_ref: REQ-1\n");
  put(`${cases}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\nunit_refs: [default, other]\n---\nGiven a caller When checking behavior Then return true.\n");
  const construction = "docs/aidlc/modules/project/construction/default";
  put(`${construction}/plans/code-generation-plan.md`, "# Plan\nREQ-1 UC-D-001 implement behavior returning true and verify tests/behavior.test.cjs.\n");
  put(`${construction}/implementation-summary.md`, "# Summary\nREQ-1 UC-D-001 implemented in src/behavior.cjs and verified by tests/behavior.test.cjs.\n");
  put("docs/aidlc/modules/project/construction/other/plans/code-generation-plan.md", bytes(`${construction}/plans/code-generation-plan.md`));
  put("docs/aidlc/modules/project/construction/other/implementation-summary.md", bytes(`${construction}/implementation-summary.md`));
  for (const [stage, role] of [["tdd", "red"], ["code-generation", "green"]]) put(`.aidlc/commands/${stage}.json`, { version: "1", stage, commands: [{ id: role, role, argv: ["node", "scripts/observe.cjs"] }] });
  git("init", "-q"); git("config", "user.name", "Regression"); git("config", "user.email", "test@example.invalid"); git("add", "."); git("commit", "-qm", "baseline");
  const baseline = git("rev-parse", "HEAD");
  const initial = createInitialState("express", "4.26.0", undefined, [], "historical RED omission recovery");
  initial.baseline_commit = baseline; initial.baseline_source = "created";
  initial.completed_stages = ["units-generation"];
  initial.completed_stage_instances = ["units-generation@module:project"];
  saveFixtureState(root, initial);
  active("test-case-derivation"); run(["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation"]);
  console.log("PASS fixture controlled I13 produced");
  active("tdd", "other");
  for (const sensor of ["red-test-evidence", "baseline-test-evidence"]) run(["evidence", "run", "--stage", "tdd", "--sensor", sensor]);
  active("tdd"); run(["evidence", "run", "--stage", "tdd", "--sensor", "baseline-test-evidence"]);
  put("src/behavior.cjs", "// REQ-1 UC-D-001\nmodule.exports=()=>true;\n"); git("add", "src"); git("commit", "-qm", "completed implementation without registered RED");
  const completion = git("rev-parse", "HEAD");
  active("code-generation", "other");
  const ready = loadWorkflowState(root)!;
  ready.completed_stages = ["workspace-detection", "state-template", "units-generation", "test-case-derivation", "tdd"];
  ready.completed_stage_instances = ["workspace-detection", "state-template", "units-generation@module:project", "test-case-derivation@module:project", "tdd@module:project@unit:default", "tdd@module:project@unit:other"];
  saveFixtureState(root, ready);
  run(["evidence", "run", "--stage", "code-generation"]);
  run(["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  active("code-generation");
  const produceQuality = ["evidence", "run", "--stage", "code-generation", "--sensor", "test-quality"];
  run(["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
  assert.match(run(produceQuality, false), /RED evidence is missing and no approved historical-omission record exists[\s\S]*--historical-omission/);
  const approvedGreen = bytes(greenPath), observedBefore = bytes(".aidlc/phase-executions");
  const omissionArgs = ["evidence", "run", "--stage", "tdd", "--module", "project", "--unit", "default", "--sensor", "red-test-evidence", "--refresh", "--historical-omission"];
  assert.match(run(omissionArgs, false), /requires --approval-ref/);
  assert.equal(existsSync(join(root, redPath)), false);
  const approval = ["--approval-ref", "fixture:human-approval-1", "--approved-by", "Fixture Reviewer", "--approved-at", "2026-11-07T10:00:00+08:00"];
  const downstreamEnv = fixtureEnvironment(root, produceQuality);
  run([...omissionArgs, ...approval], true, downstreamEnv);
  const approvedRed = bytes(redPath), omission = json(redPath);
  assert.equal(omission.status, "not_recorded"); assert.equal(omission.observed_command, undefined);
  assert.equal(omission.workflow_id, loadWorkflowState(root)!.workflow_id);
  assert.equal(gate("tdd@module:project@unit:default", "red-test-evidence", true), "");
  run(produceQuality);
  const quality = json(qualityPath);
  assert.equal(quality.status, "passed"); assert.equal(quality.red_status, "not_recorded"); assert.equal(quality.red_seen, false);
  assert.equal(quality.red_omission[0].approval_ref, approval[1]);
  assert.equal(JSON.parse(run(["check", "--sensor", "red-test-evidence", "--module", "project", "--unit", "default"])).status, "not_recorded");
  assert.equal(gate("code-generation@module:project@unit:default", "test-quality"), "");
  run(["evidence", "run", "--stage", "code-generation"]);
  assert.equal(bytes(greenPath), approvedGreen, "stage-wide run preserves approved GREEN bytes");
  assert.equal(bytes(".aidlc/phase-executions"), observedBefore, "omission and stage-wide recovery never rerun tests");
  run(["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  assert.ok(loadWorkflowState(root)!.completed_stage_instances.includes("code-generation@module:project@unit:default"));
  const advance = ["orchestrate", "baseline", "--advance", completion, "--expect", baseline, "--user-input", "Approve", "--reason", "fixture completed unit"];
  assert.equal(JSON.parse(run([...advance, "--dry-run"])).dry_run, true);
  run(advance);
  assert.equal(loadWorkflowState(root)!.baseline_commit, completion);
  assert.equal(gate("tdd@module:project@unit:default", "red-test-evidence", true), "", "baseline advance does not expire unchanged approved GREEN");
  put("src/later-unit.cjs", "module.exports='later unit';\n");
  assert.equal(gate("code-review@module:project@unit:default", "delivery"), "", "review stays on the completed unit epoch, excluding later source changes");
  rmSync(join(root, "src/later-unit.cjs"));
  console.log("PASS historical omission -> stage evidence -> report -> baseline dry-run and advance");

  // Project close-out mixes a real RED owner and an omitted RED owner.
  const aggregate = loadWorkflowState(root)!;
  Object.assign(aggregate, { current_stage: "build-and-test", current_stage_instance: "build-and-test", current_module: undefined, current_unit: undefined });
  saveFixtureState(root, aggregate);
  run(["evidence", "run", "--stage", "build-and-test", "--sensor", "test-quality"]);
  const aggregateQuality = json(".aidlc/evidence/build-and-test/test-quality.json");
  assert.equal(aggregateQuality.tests_total, 2); assert.equal(aggregateQuality.red_omission.length, 1); assert.equal(aggregateQuality.red_seen, false);
  assert.equal(gate("build-and-test", "test-quality"), "");
  const otherRedPath = ".aidlc/evidence/tdd/project/other/red-test-evidence.json", otherRed = bytes(otherRedPath);
  rmSync(join(root, otherRedPath));
  assert.match(gate("build-and-test", "test-quality"), /Evidence not found/);
  put(otherRedPath, otherRed);
  active("code-review");
  console.log("PASS mixed real RED and historical omission preserve per-unit obligations at project close-out");

  // Consumer revalidation must reject revoked approvals even after quality was published.
  rmSync(join(root, redPath));
  assert.match(gate("code-generation@module:project@unit:default", "test-quality"), /historical-omission record is missing/);
  assert.match(run([...produceQuality, "--module", "project", "--unit", "default", "--refresh"], false), /no approved historical-omission record exists/);
  put(redPath, approvedRed);
  const tamper = (change: (record: any) => void, expected: RegExp) => {
    const record = JSON.parse(approvedRed); change(record);
    // Recompute the public checksum to prove semantic validation, not just checksum mismatch.
    record.checker.argv_digest = redOmissionDigest(record); put(redPath, record);
    assert.match(gate("tdd@module:project@unit:default", "red-test-evidence", true), expected);
    assert.match(gate("code-generation@module:project@unit:default", "test-quality"), /RED_OMISSION_INVALID/);
    put(redPath, approvedRed);
  };
  tamper(record => record.green_evidence.sha256 = "f".repeat(64), /GREEN sha256 changed/);
  tamper(record => record.ucd_ids = ["UC-D-999"], /UC-D set/);
  tamper(record => record.ucd_ids = ["UC-D-001", "UC-D-001"], /UC-D set/);
  for (const key of ["workflow_id", "module_id", "unit_id"]) tamper(record => record[key] = "other", new RegExp(`${key} does not match`));
  tamper(record => record.approval_ref = " ", /approval_ref must be non-empty/);
  tamper(record => record.approved_by = "", /approved_by must be non-empty/);
  tamper(record => delete record.approved_at, /approved_at must be/);
  tamper(record => record.approved_at = "yesterday", /approved_at must be/);
  tamper(record => record.approved_at = "2026-02-30T10:00:00Z", /invalid calendar date/);
  tamper(record => record.green_evidence.path = ".aidlc/evidence/code-generation/project/other/green-test-evidence.json", /canonical GREEN path/);
  tamper(record => record.status = "passed", /invalid phase, status/);
  tamper(record => record.status = "not_required", /invalid phase, status/);
  tamper(record => record.observed_command = { exit_code: 1 }, /cannot claim an observed RED/);
  put(greenPath, { ...JSON.parse(approvedGreen), tests_failed: 1 });
  assert.match(gate("tdd@module:project@unit:default", "red-test-evidence", true), /GREEN sha256 changed|GREEN gate/);
  put(greenPath, approvedGreen);
  const i13Path = ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json", i13Before = bytes(i13Path);
  const changedI13 = JSON.parse(i13Before); changedI13.ucd_modes = { "UC-D-001": "characterization" }; put(i13Path, changedI13);
  assert.match(gate("tdd@module:project@unit:default", "red-test-evidence", true), /requires tdd_mode new|I13 unit semantics|UC-D set/);
  put(i13Path, i13Before);
  console.log("PASS missing/revoked approvals, changed GREEN, UC-D set, I13 semantics and forged RED observations fail closed");

  // Explicitly refreshing the real GREEN creates new bytes, requiring a new human approval.
  run(["evidence", "run", "--stage", "code-generation", "--module", "project", "--unit", "default", "--sensor", "green-test-evidence", "--refresh"]);
  assert.notEqual(bytes(greenPath), approvedGreen);
  assert.match(gate("tdd@module:project@unit:default", "red-test-evidence", true), /GREEN sha256 changed/);
  run([...omissionArgs, ...approval]);
  const renewed = json(redPath);
  assert.equal(bytes(renewed.supersedes.path), approvedRed, "renewal archives exact original approval bytes");
  assert.equal(gate("tdd@module:project@unit:default", "red-test-evidence", true), "");
  const archived = bytes(renewed.supersedes.path);
  put(renewed.supersedes.path, `${archived}\n`);
  assert.match(gate("tdd@module:project@unit:default", "red-test-evidence", true), /superseded approval archive is missing or changed/);
  put(renewed.supersedes.path, archived);
  put(redPath, { ...omission, status: "failed", evidence_mode: "original" });
  const originalBefore = bytes(redPath);
  assert.match(run([...omissionArgs, ...approval], false), /cannot replace original RED/);
  assert.equal(bytes(redPath), originalBefore);
  put(redPath, "null");
  assert.match(run([...omissionArgs, ...approval], false), /cannot replace original RED/);
  assert.equal(bytes(redPath), "null", "corrupt existing records cannot be silently replaced");
  console.log("PASS explicit GREEN refresh expires approval; renewal archives prior approval and refuses to replace real RED");
} finally {
  // root is the exact temporary directory created by this fixture.
  rmSync(root, { recursive: true, force: true });
}
