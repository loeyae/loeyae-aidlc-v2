import { applyExecutionProfile, classifyExecutionProfile } from "../core/tools/aidlc-execution-profile";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";
import { evidenceTimeError } from "../core/tools/aidlc-evidence-policy";

const repo = resolve(import.meta.dirname, "..");
const tsx = join(repo, "node_modules/tsx/dist/cli.mjs");
const scratch = mkdtempSync(join(tmpdir(), "aidlc-mars249-"));
const put = (project: string, path: string, data: unknown) => { mkdirSync(dirname(join(project, path)), { recursive: true }); writeFileSync(join(project, path), typeof data === "string" ? data : JSON.stringify(data)); };
const get = (project: string, path: string) => JSON.parse(readFileSync(join(project, path), "utf8"));
function run(project: string, args: string[], ok = true, environment: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [tsx, join(repo, "bin/cli.ts"), ...args], { cwd: project, encoding: "utf8", env: { ...fixtureEnvironment(project, args), ...environment } });
  if (ok) assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  else assert.notEqual(result.status, 0, `${args.join(" ")} unexpectedly passed`);
  return `${result.stdout}\n${result.stderr}`;
}
function activate(project: string, slug: string) {
  const state = loadWorkflowState(project)!;
  state.current_stage = slug; state.current_phase = slug === "test-case-derivation" ? "inception" : "construction";
  state.current_stage_instance = slug === "build-and-test" ? slug : `${slug}@module:project${slug === "test-case-derivation" ? "" : "@unit:default"}`;
  if (slug === "build-and-test") { delete state.current_module; delete state.current_unit; }
  else { state.current_module = "project"; if (slug !== "test-case-derivation") state.current_unit = "default"; else delete state.current_unit; }
  saveFixtureState(project, state);
}
function project(name: string) {
  const root = join(scratch, name); mkdirSync(root);
  put(root, "README.md", "Regression fixture\n");
  for (const args of [["init", "-q"], ["add", "README.md"], ["-c", "user.name=Regression", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline"]]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr);
  }
  saveFixtureState(root, createInitialState("express", "4.22.1", `mars249-${name}`, [], "validation policy regression"));
  return root;
}
function config(root: string, slug: string, commands: unknown[]) { put(root, `.aidlc/commands/${slug}.json`, { version: "1", stage: slug, commands }); }
const check = { id: "check", role: "check", argv: ["node", "check.cjs"] };
const i13Path = ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json";
const redPath = ".aidlc/evidence/tdd/project/default/red-test-evidence.json";
const greenPath = ".aidlc/evidence/code-generation/project/default/green-test-evidence.json";
const buildPath = ".aidlc/evidence/build-and-test/build-test-evidence.json";
function gate(root: string, sensors: string, historical = false, currentEpoch = false) {
  const result = spawnSync(process.execPath, [tsx, join(repo, "tests/mars249_sensor_runner.ts"), sensors, ...(historical ? ["--historical"] : []), ...(currentEpoch ? ["--current-epoch"] : [])], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}
try {
  const root = project("configuration");
  put(root, "docs/aidlc/modules/project/inception/requirements.md", "REQ-CONFIG-001: configuration declarations only.\n");
  const declaration = { schema_version: "1", status: "not_applicable", reason_code: "pure-configuration", reason: "configuration only", approval_ref: "approved:REQ-CONFIG-001", alternative_validation: "parse configuration", validation_command: "node check.cjs", source_refs: ["REQ-CONFIG-001"] };
  const declarationPath = "docs/aidlc/modules/project/inception/application-design/test-cases/non-applicable.json";
  put(root, declarationPath, declaration);
  put(root, "check.cjs", "const fs=require('fs');const p='.aidlc/executions';fs.mkdirSync('.aidlc',{recursive:true});fs.appendFileSync(p,'check\\n');console.log('configuration valid');\n");
  activate(root, "test-case-derivation");
  run(root, ["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation"]);
  for (const slug of ["tdd", "code-generation", "build-and-test"]) config(root, slug, [check]);
  activate(root, "tdd"); run(root, ["evidence", "run", "--stage", "tdd", "--sensor", "red-test-evidence"]);
  const red = get(root, redPath); assert.equal(red.status, "not_applicable");
  assert.equal(gate(root, "red-test-evidence").failures.length, 0);
  const nextReady = loadWorkflowState(root)!;
  nextReady.execution_profile = applyExecutionProfile({ classified: classifyExecutionProfile({ scope: "express", signals: new Set() }), at: new Date().toISOString() });
  nextReady.completed_stages = ["workspace-detection", "test-case-derivation"];
  nextReady.completed_stage_instances = ["workspace-detection", "test-case-derivation@module:project"];
  saveFixtureState(root, nextReady);
  const nextDirective = JSON.parse(run(root, ["orchestrate", "next"]));
  assert.equal(nextDirective.stage, "tdd");
  assert.ok(nextDirective.evidence_reuse_plan.verify.some((entry: { sensor: string }) => entry.sensor === "red-test-evidence"), "real next agrees with the phase gate");
  activate(root, "code-generation"); run(root, ["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
  assert.equal(get(root, greenPath).alternative_validation_execution.reused_from, red.alternative_validation_execution.observation_id);
  assert.equal(readFileSync(join(root, ".aidlc/executions"), "utf8"), "check\n", "same inputs execute alternative validation once");
  put(root, "config.json", { version: 2 });
  run(root, ["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
  assert.equal(readFileSync(join(root, ".aidlc/executions"), "utf8"), "check\ncheck\n", "source drift executes again");
  config(root, "code-generation", [{ ...check, argv: [...check.argv, "--changed-command"] }]);
  run(root, ["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
  assert.equal(readFileSync(join(root, ".aidlc/executions"), "utf8"), "check\ncheck\ncheck\n", "command drift executes again");
  run(root, ["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"], true, { AIDLC_PHASE: "alternative-environment-change" });
  assert.equal(readFileSync(join(root, ".aidlc/executions"), "utf8"), "check\ncheck\ncheck\ncheck\n", "actual environment changes invalidate the observation");
  activate(root, "build-and-test"); run(root, ["evidence", "run", "--stage", "build-and-test"]);
  const build = get(root, buildPath); assert.deepEqual(build.tests, { total: 0, passed: 0, failed: 0, skipped: 0 });
  assert.equal(gate(root, "build-test-evidence").failures.length, 0, "zero-test configuration passes actual C8 gate");
  build.timestamp = new Date(Date.now() - 25 * 3600_000).toISOString(); put(root, buildPath, build);
  const agedBuild = gate(root, "build-test-evidence"); assert.equal(agedBuild.failures.length, 0); assert.equal(agedBuild.plan.verify.length, 1);
  put(root, declarationPath, { ...declaration, reason: "changed applicability" });
  assert.ok(gate(root, "build-test-evidence").failures.length, "changed applicability is rejected");
  run(root, ["evidence", "run", "--stage", "build-and-test"], false);
  put(root, declarationPath, declaration);
  put(root, "docs/aidlc/modules/project/inception/requirements.md", "REQ-CONFIG-001: Given a user, When submitting, Then save an order.\n");
  assert.ok(gate(root, "build-test-evidence").failures.length, "changed requirement bytes invalidate the old no-behavior approval");
  put(root, "docs/aidlc/modules/project/inception/requirements.md", "REQ-CONFIG-001: configuration declarations only.\n");
  config(root, "build-and-test", [{ ...check, argv: ["node", "-e", "process.exit(0)"] }]);
  assert.ok(gate(root, "build-test-evidence").failures.length, "command drift is rejected");
  config(root, "build-and-test", [check]);
  const forged = { ...build, tests: { total: 1, passed: 0, failed: 0, skipped: 1 } }; put(root, buildPath, forged);
  assert.ok(gate(root, "build-test-evidence").failures.length, "all skipped is rejected");
  put(root, buildPath, build);
  const i13 = get(root, i13Path); put(root, i13Path, { status: "not_applicable" });
  assert.ok(gate(root, "build-test-evidence").failures.length, "empty uncontrolled declaration cannot exempt C8");
  put(root, i13Path, i13);

  // Cross-check the full public report boundary with the real zero-test producer.
  put(root, "src/config.json", { mode: "static" });
  put(root, "docs/aidlc/modules/project/construction/default/code-review.md", "# Review\nSpec passed; Standards passed; reviewer: regression. REQ-CONFIG-001 configuration declarations verified; no blocking findings.\n");
  put(root, "docs/aidlc/construction/build-test-report.md", "# Validation\nREQ-CONFIG-001: approved configuration only. Deterministic parse check passed; build and business tests are not applicable.\n");
  put(root, "docs/aidlc/construction/build-and-test/build-and-test-summary.md", "# Summary\nREQ-CONFIG-001 configuration parsing completed successfully; real test counts are zero according to the approved I13 declaration.\n");
  const ready = loadWorkflowState(root)!;
  ready.completed_stages = ["workspace-detection", "test-case-derivation", "tdd", "code-generation", "code-review"];
  ready.completed_stage_instances = ["workspace-detection", "test-case-derivation@module:project", "tdd@module:project@unit:default", "code-generation@module:project@unit:default", "code-review@module:project@unit:default"];
  saveFixtureState(root, ready);
  run(root, ["evidence", "run", "--stage", "build-and-test"]);
  run(root, ["evidence", "run", "--stage", "build-and-test", "--all-sensors"]);
  const executionsBeforeReport = readFileSync(join(root, ".aidlc/executions"), "utf8");
  run(root, ["orchestrate", "report", "--stage", "build-and-test", "--result", "completed"]);
  assert.equal(readFileSync(join(root, ".aidlc/executions"), "utf8"), executionsBeforeReport, "report repairs only missing semantic evidence, without repeating C8 commands");
  assert.ok(loadWorkflowState(root)!.completed_stage_instances.includes("build-and-test"));

  const business = project("business");
  config(business, "build-and-test", [check]); put(business, "check.cjs", "console.log('valid');"); activate(business, "build-and-test");
  run(business, ["evidence", "run", "--stage", "build-and-test"], false);
  config(business, "build-and-test", [check, { id: "build", role: "build", argv: ["node", "--check", "check.cjs"] }, { id: "test", role: "test", argv: ["node", "-e", "require('assert').strictEqual(1 + 1, 2); console.log('1 passed')"] }]);
  run(business, ["evidence", "run", "--stage", "build-and-test"]);
  assert.equal(get(business, buildPath).tests.passed, 1);
  assert.equal(gate(business, "build-test-evidence").failures.length, 0);
  // Missing declarations still require all default roles; an approved native
  // project policy exempts only its independent build, never business tests.
  const businessConfig = get(business, ".aidlc/commands/build-and-test.json");
  put(business, "package.json", { scripts: { check: "node check.cjs", test: "node test.cjs" }, aidlc_validation: { module_id: "project", runtime: "native-node", approval_ref: "approved:native-runtime", build: { status: "not_applicable", reason: "CommonJS executes directly without compilation or generated artifacts" } } });
  put(business, ".aidlc/commands/build-and-test.json", { ...businessConfig, role_applicability: [{ module_id: "project", package_json: "package.json", roles: ["build"] }], commands: businessConfig.commands.filter((command: { role: string }) => command.role !== "build") });
  run(business, ["evidence", "run", "--stage", "build-and-test"]);
  assert.equal(get(business, buildPath).tests.passed, 1);
  assert.equal(gate(business, "build-test-evidence").failures.length, 0, "approved no-build business still executes real tests/checks");

  const behavior = project("historical-red");
  put(behavior, "docs/aidlc/modules/project/inception/requirements.md", "REQ-1: Given a user, When submitting an order, Then the order is saved.\n");
  put(behavior, "docs/aidlc/modules/project/inception/application-design/test-cases/_index.md", "# Index\nUC-D-001 status: ready source_ref: REQ-1\n");
  put(behavior, "docs/aidlc/modules/project/inception/application-design/test-cases/UC-D-001.md", "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# Submit order\nGiven a user, when submitting then order is saved.\n");
  activate(behavior, "test-case-derivation"); run(behavior, ["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation"]);
  put(behavior, "observe.cjs", "console.log(JSON.stringify({phase:'RED',status:'failed',compile_status:'passed',environment_status:'passed',tests_total:1,tests_failed:1,traceability_complete:true,failure_class:'behavior',failure_signature:'order missing',uc_mapping:[{use_case:'UC-D-001',test_methods:['submitOrder']}]}));process.exit(1);\n");
  config(behavior, "tdd", [{ id: "red", role: "red", argv: ["node", "observe.cjs"] }]);
  activate(behavior, "tdd"); run(behavior, ["evidence", "run", "--stage", "tdd", "--sensor", "red-test-evidence"]);
  assert.equal(gate(behavior, "red-test-evidence").failures.length, 0, "complete fresh RED first passes");
  const observed = get(behavior, redPath); observed.timestamp = new Date(Date.now() - 25 * 3600_000).toISOString(); put(behavior, redPath, observed);
  assert.equal(gate(behavior, "red-test-evidence").failures.length, 0, "same valid RED remains usable after 25h");
  const historicalPlan = gate(behavior, "red-test-evidence").plan;
  assert.equal(historicalPlan.verify.length, 1, JSON.stringify(historicalPlan));
  put(behavior, "source.ts", "export const changed = true;\n");
  assert.ok(gate(behavior, "red-test-evidence").failures.length, "normal source drift rejects historical evidence");
  assert.equal(gate(behavior, "red-test-evidence", true).failures.length, 0, "GREEN predecessor path may tolerate implementation drift");
  config(behavior, "tdd", [{ id: "red", role: "red", argv: ["node", "different.cjs"] }]);
  assert.ok(gate(behavior, "red-test-evidence", true).failures.length, "historical path still binds command");

  const characterized = project("baseline");
  put(characterized, "src/known.js", "module.exports = () => 'known';\n");
  function commitKnown() {
    for (const args of [["add", "src/known.js"], ["-c", "user.name=Regression", "-c", "user.email=test@example.invalid", "commit", "-qm", "known behavior"]]) assert.equal(spawnSync("git", args, { cwd: characterized }).status, 0);
    return spawnSync("git", ["rev-parse", "HEAD"], { cwd: characterized, encoding: "utf8" }).stdout.trim();
  }
  const baseline = commitKnown();
  const baselineState = loadWorkflowState(characterized)!; baselineState.baseline_commit = baseline; baselineState.baseline_source = "created"; saveFixtureState(characterized, baselineState);
  put(characterized, "docs/aidlc/modules/project/inception/requirements.md", "REQ-2: Given the existing behavior, When called, Then return known.\n");
  const caseRoot = "docs/aidlc/modules/project/inception/application-design/test-cases";
  put(characterized, `${caseRoot}/_index.md`, "# Cases\nUC-D-002 status: ready source_ref: REQ-2\n");
  put(characterized, `${caseRoot}/UC-D-002.md`, "---\nid: UC-D-002\nstatus: ready\nsource_ref: REQ-2\ntdd_mode: characterization\ncode_refs: [src/known.js]\nreason: preserve existing behavior\napproval_ref: approved:REQ-2\n---\n# Known behavior\nGiven known behavior When called Then return known.\n");
  activate(characterized, "test-case-derivation"); run(characterized, ["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation"]);
  put(characterized, "observe.cjs", "require('assert').strictEqual(require('./src/known.js')(),'known');console.log(JSON.stringify({phase:process.env.AIDLC_PHASE,status:'passed',compile_status:'passed',environment_status:'passed',tests_total:1,tests_failed:0,traceability_complete:true,uc_mapping:[{use_case:'UC-D-002',test_methods:['knownBehavior']}]}));\n");
  config(characterized, "tdd", [{ id: "baseline", role: "baseline", argv: ["node", "observe.cjs"] }]);
  activate(characterized, "tdd"); run(characterized, ["evidence", "run", "--stage", "tdd", "--sensor", "baseline-test-evidence"]);
  const baselinePath = ".aidlc/evidence/tdd/project/default/baseline-test-evidence.json";
  assert.equal(gate(characterized, "baseline-test-evidence").failures.length, 0);
  const baselineEvidence = get(characterized, baselinePath); baselineEvidence.timestamp = new Date(Date.now() - 25 * 3600_000).toISOString(); put(characterized, baselinePath, baselineEvidence);
  assert.equal(gate(characterized, "baseline-test-evidence").plan.verify.length, 1, "old complete BASELINE reverified");
  config(characterized, "code-generation", [{ id: "green", role: "green", argv: ["node", "observe.cjs"] }]);
  activate(characterized, "code-generation"); run(characterized, ["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
  assert.equal(gate(characterized, "green-test-evidence").failures.length, 0);
  const characterizedGreen = get(characterized, greenPath); characterizedGreen.timestamp = baselineEvidence.timestamp; put(characterized, greenPath, characterizedGreen);
  assert.equal(gate(characterized, "green-test-evidence").plan.verify.length, 1, "old complete GREEN reverified");
  put(characterized, "src/known.js", "module.exports = () => 'changed';\n"); const nextEpoch = commitKnown();
  const advanced = loadWorkflowState(characterized)!; advanced.baseline_commit = nextEpoch; advanced.baseline_source = "advanced"; advanced.baseline_history = [baseline, nextEpoch]; saveFixtureState(characterized, advanced);
  activate(characterized, "tdd"); assert.ok(gate(characterized, "baseline-test-evidence", true, true).failures.length, "current-epoch gate rejects BASELINE from an earlier generation");

  const review = project("suggestions"); activate(review, "code-review");
  put(review, "src/view.ts", "export const view = 'configuration';\n");
  const reviewPath = "docs/aidlc/modules/project/construction/default/code-review.md";
  const report = (critical: number, important: number, suggestion: number, severity = true) => `# Review\nSpec: passed\nStandards: passed\nreviewer: regression\nfiles: src/view.ts\nissues_found: 1\nissues_resolved: 0\nissues_open: 1\n${severity ? `critical_open: ${critical}\nimportant_open: ${important}\nsuggestion_open: ${suggestion}\n` : ""}`;
  put(review, reviewPath, report(0, 0, 1) + "建议不阻断，remaining suggestion is non-blocking.\n");
  run(review, ["evidence", "run", "--stage", "code-review", "--sensor", "review-evidence"]);
  assert.equal(gate(review, "review-evidence").failures.length, 0, "open suggestion passes both axes");
  const reviewEvidencePath = ".aidlc/evidence/code-review/project/default/review-evidence.json";
  const suggestionEvidence = get(review, reviewEvidencePath);
  put(review, reviewEvidencePath, { ...suggestionEvidence, issues_by_severity: { critical_open: 0, important_open: 1, suggestion_open: 0 } });
  assert.ok(gate(review, "review-evidence").failures.length, "completion gate rejects open important finding");
  put(review, reviewEvidencePath, { ...suggestionEvidence, issues_by_severity: undefined });
  assert.ok(gate(review, "review-evidence").failures.length, "legacy unknown severity remains blocking");
  put(review, reviewEvidencePath, { ...suggestionEvidence, issues_open: 0, issues_resolved: 1, issues_by_severity: undefined });
  assert.equal(gate(review, "review-evidence").failures.length, 0, "all-resolved legacy evidence stays compatible");
  for (const [critical, important, suggestion, severity] of [[1, 0, 0, true], [0, 1, 0, true], [0, 0, 1, false]] as const) {
    put(review, reviewPath, report(critical, important, suggestion, severity));
    run(review, ["evidence", "run", "--stage", "code-review", "--sensor", "review-evidence"], false);
  }
  for (const sensor of ["red-test-evidence", "green-test-evidence", "baseline-test-evidence", "build-test-evidence"]) {
    assert.equal(evidenceTimeError({ timestamp: new Date(Date.now() - 25 * 3600_000).toISOString() }, sensor), null);
    assert.ok(evidenceTimeError({ timestamp: "2026-02-30T00:00:00Z" }, sensor));
    assert.ok(evidenceTimeError({ timestamp: new Date(Date.now() + 3600_000).toISOString() }, sensor));
    assert.ok(evidenceTimeError({ timestamp: new Date(Date.now() - 25 * 3600_000).toISOString(), freshness: { kind: "external", max_age_ms: 3600_000, reason: "remote integration" } }, sensor));
  }
  console.log("MARS-249 applicability, real producer/gates, historical RED, reuse and review regressions passed");
} finally { rmSync(scratch, { recursive: true, force: true }); }
