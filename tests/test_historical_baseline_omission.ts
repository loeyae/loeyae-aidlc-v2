import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { omissionHash, tddOmissionDigest } from "../core/tools/aidlc-red-omission";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";

const repo = resolve(import.meta.dirname, ".."), tsx = join(repo, "node_modules/tsx/dist/cli.mjs");
const root = mkdtempSync(join(tmpdir(), "aidlc-baseline-omission-"));
const basePath = ".aidlc/evidence/tdd/project/default/baseline-test-evidence.json";
const redPath = ".aidlc/evidence/tdd/project/default/red-test-evidence.json";
const greenPath = ".aidlc/evidence/code-generation/project/default/green-test-evidence.json";
const qualityPath = ".aidlc/evidence/code-generation/project/default/test-quality.json";
const i13Path = ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json";
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
function gate(instance: string, sensor: string, historical = false, currentEpoch = false) {
  const result = spawnSync(process.execPath, [tsx, join(repo, "tests/omission_gate_probe.ts"), instance, sensor, historical ? "historical" : "", currentEpoch ? "current" : ""], { cwd: root, encoding: "utf8", env: { ...process.env, AIDLC_SESSION_BINDING: "" } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout).failures.join("\n") as string;
}
const tdd = "tdd@module:project@unit:default", codegen = "code-generation@module:project@unit:default";
const produceQuality = ["evidence", "run", "--stage", "code-generation", "--sensor", "test-quality"];
const omissionArgs = ["evidence", "run", "--stage", "tdd", "--module", "project", "--unit", "default", "--sensor", "baseline-test-evidence", "--refresh", "--historical-omission"];
const approval = ["--approval-ref", "fixture:baseline-approval", "--approved-by", "Fixture Reviewer", "--approved-at", "2026-11-08T10:00:00+08:00"];
try {
  put(".gitignore", ".aidlc/\naidlc/\n");
  put("docs/aidlc/ideation/module-manifest.json", { schema_version: 1, modules: [{ module_id: "project", name: "Project", service_id: "project", paths: ["src"] }] });
  put("docs/aidlc/modules/project/inception/unit-manifest.json", { schema_version: 1, module_id: "project", units: ["default", "other"].map(unit_id => ({ unit_id, name: unit_id, service_id: "project", req_refs: ["REQ-1"] })) });
  put("src/behavior.cjs", "module.exports=()=>({existing:1,added:false});\n");
  put("scripts/observe.cjs", "require('../tests/behavior.test.cjs');\n");
  put("tests/behavior.test.cjs", `const fs=require('node:fs'),assert=require('node:assert/strict'),phase=process.env.AIDLC_PHASE;
fs.appendFileSync('.aidlc/phase-executions',phase+'\\n');const value=require('../src/behavior.cjs')();let failed=0;
try{assert.equal(value.existing,1);if(phase!=='BASELINE')assert.equal(value.added,true);}catch{failed=1;}
const ids=phase==='RED'?['UC-D-001']:phase==='BASELINE'?['UC-D-002']:['UC-D-001','UC-D-002'];
console.log(JSON.stringify({phase,status:failed?'failed':'passed',compile_status:'passed',environment_status:'passed',tests_total:ids.length,tests_failed:failed,traceability_complete:true,...failed?{failure_class:'behavior',failure_signature:'new behavior absent'}:{},uc_mapping:ids.map(use_case=>({use_case,test_methods:['tests/behavior.test.cjs']}))}));process.exit(failed);
`);
  put("docs/aidlc/modules/project/inception/requirements.md", "REQ-1: Given a caller When extending behavior Then preserve existing and add new behavior.\n");
  const cases = "docs/aidlc/modules/project/inception/application-design/test-cases";
  put(`${cases}/_index.md`, "UC-D-001 UC-D-002 status: ready source_ref: REQ-1\n");
  put(`${cases}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\nunit_refs: [default, other]\n---\nGiven a caller When extending behavior Then added is true.\n");
  put(`${cases}/UC-D-002.md`, "---\nid: UC-D-002\nstatus: ready\nsource_ref: REQ-1\nunit_refs: [default, other]\ntdd_mode: characterization\ncode_refs:\n  - src/behavior.cjs\nreason: Preserve existing behavior\napproval_ref: fixture:characterization-design\n---\nGiven a caller When checking behavior Then existing equals one.\n");
  for (const unit of ["default", "other"]) {
    const construction = `docs/aidlc/modules/project/construction/${unit}`;
    put(`${construction}/plans/code-generation-plan.md`, "# Plan\nREQ-1 UC-D-001 UC-D-002 extend src/behavior.cjs, preserve existing behavior and verify tests/behavior.test.cjs.\n");
    put(`${construction}/implementation-summary.md`, "# Summary\nREQ-1 UC-D-001 UC-D-002 implemented in src/behavior.cjs and verified by tests/behavior.test.cjs.\n");
  }
  put(".aidlc/commands/tdd.json", { version: "1", stage: "tdd", commands: ["red", "baseline"].map(role => ({ id: role, role, argv: ["node", "scripts/observe.cjs"] })) });
  put(".aidlc/commands/code-generation.json", { version: "1", stage: "code-generation", commands: [{ id: "green", role: "green", argv: ["node", "scripts/observe.cjs"] }] });
  git("init", "-q"); git("config", "user.name", "Regression"); git("config", "user.email", "test@example.invalid"); git("add", "."); git("commit", "-qm", "original baseline");
  const baseline = git("rev-parse", "HEAD");
  const initial = createInitialState("express", "4.26.2", undefined, [], "historical BASELINE omission recovery");
  Object.assign(initial, { baseline_commit: baseline, baseline_source: "created", completed_stages: ["units-generation"], completed_stage_instances: ["units-generation@module:project"] });
  saveFixtureState(root, initial);
  active("test-case-derivation"); run(["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation"]);
  active("tdd", "other");
  for (const sensor of ["red-test-evidence", "baseline-test-evidence"]) run(["evidence", "run", "--stage", "tdd", "--sensor", sensor]);
  const otherBasePath = ".aidlc/evidence/tdd/project/other/baseline-test-evidence.json", otherBase = bytes(otherBasePath);
  active("tdd"); run(["evidence", "run", "--stage", "tdd", "--sensor", "red-test-evidence"]);
  put("src/behavior.cjs", "// REQ-1 UC-D-001 UC-D-002\nmodule.exports=()=>({existing:1,added:true});\n");
  git("add", "src"); git("commit", "-qm", "completed implementation without BASELINE evidence");
  const completion = git("rev-parse", "HEAD");
  assert.match(run(["evidence", "run", "--stage", "tdd", "--sensor", "baseline-test-evidence"], false), /BASELINE refuses to run: code ref .*changed since/);
  assert.equal(existsSync(join(root, basePath)), false);
  active("code-generation", "other");
  const ready = loadWorkflowState(root)!;
  ready.completed_stages = ["workspace-detection", "state-template", "units-generation", "test-case-derivation", "tdd"];
  ready.completed_stage_instances = ["workspace-detection", "state-template", "units-generation@module:project", "test-case-derivation@module:project", tdd, "tdd@module:project@unit:other"];
  saveFixtureState(root, ready);
  run(["evidence", "run", "--stage", "code-generation"]);
  run(["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  active("code-generation"); run(["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
  assert.match(run(produceQuality, false), /BASELINE evidence is missing and no approved historical-omission record exists[\s\S]*--sensor baseline-test-evidence/);
  const approvedGreen = bytes(greenPath), executions = bytes(".aidlc/phase-executions");
  assert.match(run(omissionArgs, false), /requires --approval-ref/);
  const downstreamEnv = fixtureEnvironment(root, produceQuality);
  run([...omissionArgs, ...approval], true, downstreamEnv);
  const approvedBase = bytes(basePath), omission = json(basePath);
  assert.equal(omission.status, "not_recorded"); assert.equal(omission.phase, "BASELINE");
  assert.equal(omission.baseline_commit, baseline); assert.deepEqual(omission.ucd_ids, ["UC-D-002"]);
  assert.equal(omission.baseline_refs[0].worktree_blob, undefined);
  for (const key of ["observed_command", "code_ref_digests", "tests_total", "tests_failed"]) assert.equal(omission[key], undefined);
  assert.equal(gate(tdd, "baseline-test-evidence", true), "");
  assert.equal(JSON.parse(run(["check", "--sensor", "baseline-test-evidence", "--module", "project", "--unit", "default"])).status, "not_recorded");
  run(produceQuality);
  assert.equal(json(qualityPath).baseline_seen, false); assert.equal(json(qualityPath).baseline_status, "not_recorded");
  assert.equal(json(qualityPath).red_seen, true); assert.equal(json(qualityPath).baseline_omission[0].approval_ref, approval[1]);
  assert.equal(gate(codegen, "test-quality"), "");
  run(["evidence", "run", "--stage", "code-generation"]);
  assert.equal(bytes(greenPath), approvedGreen); assert.equal(bytes(".aidlc/phase-executions"), executions);
  console.log("PASS changed original code blocks BASELINE replay; explicit approved omission restores code-generation without rerunning GREEN");

  const tamper = (change: (record: any) => void, expected: RegExp) => {
    const record = JSON.parse(approvedBase); change(record); record.checker.argv_digest = tddOmissionDigest(record); put(basePath, record);
    assert.match(gate(tdd, "baseline-test-evidence", true), expected);
    assert.match(gate(codegen, "test-quality"), /BASELINE_OMISSION_INVALID/);
    put(basePath, approvedBase);
  };
  tamper(record => record.green_evidence.sha256 = "f".repeat(64), /GREEN sha256 changed/);
  tamper(record => record.ucd_ids = ["UC-D-001"], /UC-D set/);
  for (const key of ["workflow_id", "module_id", "unit_id"]) tamper(record => record[key] = "other", new RegExp(`${key} does not match`));
  tamper(record => record.approval_ref = " ", /approval_ref must be non-empty/);
  tamper(record => delete record.approved_at, /approved_at must be/);
  tamper(record => record.status = "passed", /invalid phase, status/);
  tamper(record => record.status = "not_required", /invalid phase, status/);
  tamper(record => record.baseline_commit = completion, /does not match.*baseline/);
  tamper(record => record.baseline_refs = [], /must cover exactly/);
  tamper(record => record.baseline_refs[0].baseline_blob = "f".repeat(40), /does not match/);
  tamper(record => record.baseline_refs[0].worktree_blob = record.baseline_refs[0].baseline_blob, /no observed worktree_blob/);
  tamper(record => record.baseline_repos = { unknown: baseline }, /does not match any epoch/);
  tamper(record => record.baseline_kind = "adoption", /baseline_kind/);
  tamper(record => record.observed_command = { exit_code: 0 }, /cannot claim an observed BASELINE/);
  put(greenPath, { ...JSON.parse(approvedGreen), tests_failed: 1 });
  const falseApproval = JSON.parse(approvedBase);
  falseApproval.green_evidence.sha256 = omissionHash(bytes(greenPath));
  falseApproval.checker.argv_digest = tddOmissionDigest(falseApproval); put(basePath, falseApproval);
  assert.match(gate(tdd, "baseline-test-evidence", true), /GREEN gate/);
  put(greenPath, approvedGreen); put(basePath, approvedBase);
  const i13Before = bytes(i13Path), changedI13 = json(i13Path);
  changedI13.ucd_modes["UC-D-002"] = "new"; put(i13Path, changedI13);
  assert.match(gate(tdd, "baseline-test-evidence", true), /requires tdd_mode characterization|I13 unit semantics|UC-D set/); put(i13Path, i13Before);
  rmSync(join(root, basePath));
  assert.match(gate(codegen, "test-quality"), /BASELINE_OMISSION_INVALID/);
  assert.match(run(produceQuality, false), /no approved historical-omission record exists/); put(basePath, approvedBase);
  console.log("PASS missing approval and tampered GREEN, UC-D scope, identity, approval, baseline chain/blob and fake observations fail closed");

  // RED and BASELINE exceptions are independent; both retain not_recorded summaries.
  rmSync(join(root, redPath));
  const redArgs = omissionArgs.map(value => value === "baseline-test-evidence" ? "red-test-evidence" : value);
  run([...redArgs, ...approval]); run(produceQuality);
  assert.equal(json(qualityPath).red_status, "not_recorded"); assert.equal(json(qualityPath).baseline_status, "not_recorded");
  run(["evidence", "run", "--stage", "code-generation"]);
  run(["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  const advance = ["orchestrate", "baseline", "--advance", completion, "--expect", baseline, "--user-input", "Approve", "--reason", "fixture completed unit"];
  run([...advance, "--dry-run"]); run(advance);
  assert.equal(loadWorkflowState(root)!.baseline_commit, completion);
  assert.equal(gate(tdd, "baseline-test-evidence", true), "", "completed historical evidence remains valid after an authorized baseline advance");
  assert.match(gate(tdd, "baseline-test-evidence", true, true), /current epoch.*BASELINE and GREEN must complete within one epoch/);
  assert.equal(gate(codegen, "test-quality"), "");
  console.log("PASS simultaneous RED/BASELINE omissions -> report -> baseline advance -> downstream historical validation");

  const aggregate = loadWorkflowState(root)!;
  Object.assign(aggregate, { current_stage: "build-and-test", current_stage_instance: "build-and-test", current_module: undefined, current_unit: undefined }); saveFixtureState(root, aggregate);
  run(["evidence", "run", "--stage", "build-and-test", "--sensor", "test-quality"]);
  const aggregateQuality = json(".aidlc/evidence/build-and-test/test-quality.json");
  assert.equal(aggregateQuality.baseline_seen, false); assert.equal(aggregateQuality.baseline_omission.length, 1);
  assert.equal(gate("build-and-test", "test-quality"), "");
  rmSync(join(root, otherBasePath)); assert.match(gate("build-and-test", "test-quality"), /Evidence not found/); put(otherBasePath, otherBase);
  active("code-review");
  put("src/later-unit.cjs", "module.exports='later unit';\n");
  assert.equal(gate("code-review@module:project@unit:default", "delivery"), ""); rmSync(join(root, "src/later-unit.cjs"));
  console.log("PASS mixed real BASELINE/omission close-out preserves other units' obligations and delivery range");

  // Renewal archives the exact approval; it cannot overwrite true baseline evidence.
  run(["evidence", "run", "--stage", "code-generation", "--module", "project", "--unit", "default", "--sensor", "green-test-evidence", "--refresh"]);
  assert.match(gate(tdd, "baseline-test-evidence", true), /GREEN sha256 changed/);
  run([...omissionArgs, ...approval]);
  const renewed = json(basePath);
  assert.equal(bytes(renewed.supersedes.path), approvedBase);
  const archived = bytes(renewed.supersedes.path); put(renewed.supersedes.path, `${archived}\n`);
  assert.match(gate(tdd, "baseline-test-evidence", true), /superseded approval archive is missing or changed/); put(renewed.supersedes.path, archived);
  active("code-generation", "other");
  assert.match(run([...omissionArgs.map(value => value === "default" ? "other" : value), ...approval], false), /cannot replace original BASELINE/);
  assert.equal(bytes(otherBasePath), otherBase);
  console.log("PASS explicit GREEN refresh expires approval; renewal archives prior bytes and refuses to overwrite real BASELINE");
} finally {
  rmSync(root, { recursive: true, force: true });
}
