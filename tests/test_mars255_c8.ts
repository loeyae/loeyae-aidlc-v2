import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";
import { parseTestStats } from "../core/tools/aidlc-test-stats";

const repo = resolve(import.meta.dirname, ".."), tsx = join(repo, "node_modules/tsx/dist/cli.mjs");
const scratch = mkdtempSync(join(tmpdir(), "aidlc-mars255-"));
const put = (root: string, path: string, value: unknown) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value)); };
const read = (root: string, path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));
const configPath = ".aidlc/commands/build-and-test.json", evidencePath = ".aidlc/evidence/build-and-test/build-test-evidence.json";
const check = { id: "check", role: "check", argv: ["node", "--check", "router.cjs"] };
const test = { id: "test", role: "test", argv: ["node", "--test", "--test-reporter=tap", "tests/native.test.cjs"] };
const build = { id: "build", role: "build", argv: ["node", "build.cjs"] };
const compiler = join(repo, "node_modules/typescript/bin/tsc");
const noEmitCheck = { ...check, argv: ["node", compiler, "--allowJs", "--checkJs", "--noEmit", "router.cjs"] };
const policy = { module_id: "project", runtime: "native-node", approval_ref: "approved:REQ-1", build: { status: "not_applicable", reason: "CommonJS executed directly by Node; no generated artifacts or transpiler" }, check: { status: "not_applicable", reason: "No independent static check policy; assertions exercise the CommonJS source" } };
const declaration = { module_id: "project", package_json: "package.json", roles: ["build"] };
function config(root: string, commands: unknown[] = [check, test], declarations: unknown = [declaration]) { put(root, configPath, { version: "1", stage: "build-and-test", commands, ...(declarations === null ? {} : { role_applicability: declarations }) }); }
function run(root: string, args: string[], ok = true, target = repo) {
  const r = spawnSync(process.execPath, [tsx, join(target, "bin/cli.ts"), ...args], { cwd: root, encoding: "utf8", env: fixtureEnvironment(root, args) });
  assert.equal(r.status, ok ? 0 : 2, `${args.join(" ")}\n${r.stdout}\n${r.stderr}`); return r;
}
function produce(root: string, ok = true, extra: string[] = [], target = repo) { return run(root, ["evidence", "run", "--stage", "build-and-test", ...extra], ok, target); }
function gate(root: string, ok = true) {
  const r = spawnSync(process.execPath, [tsx, join(repo, "tests/mars249_sensor_runner.ts"), "build-test-evidence"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); const data = JSON.parse(r.stdout);
  assert.equal(data.failures.length === 0, ok, JSON.stringify(data)); return data;
}
function fixture(name: string) {
  const root = join(scratch, name); mkdirSync(root);
  put(root, "router.cjs", "module.exports = () => ['health'];\n");
  put(root, "tests/native.test.cjs", "const {test}=require('node:test');const assert=require('node:assert/strict');test('REQ-1 UC-D-001 removes legacy route',()=>assert.deepEqual(require('../router.cjs')(),['health']));\n");
  put(root, "package.json", { scripts: { test: "node --test tests/native.test.cjs", check: "node --check router.cjs" }, aidlc_validation: policy });
  put(root, "docs/aidlc/modules/project/inception/requirements.md", "REQ-1: Given a router When discovery runs Then the legacy route is absent.\n");
  const cases = "docs/aidlc/modules/project/inception/application-design/test-cases";
  put(root, `${cases}/_index.md`, "# Index\nUC-D-001 status: ready source_ref: REQ-1\n");
  put(root, `${cases}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\nGiven a router When discovery runs Then the legacy route is absent.\n");
  for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline"]]) assert.equal(spawnSync("git", args, { cwd: root }).status, 0);
  const state = createInitialState("express", "4.22.6", `mars255-${name}`, [], "C8 native Node regression");
  state.current_stage = "test-case-derivation"; state.current_stage_instance = "test-case-derivation@module:project"; state.current_module = "project"; saveFixtureState(root, state);
  run(root, ["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation"]);
  assert.equal(read(root, ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json").status, "required");
  const current = loadWorkflowState(root)!; current.current_stage = "build-and-test"; current.current_stage_instance = "build-and-test"; current.current_phase = "construction"; delete current.current_module; saveFixtureState(root, current);
  config(root); return root;
}
try {
  const root = fixture("native");
  // Optional comparison runs the same real producer against the untouched main checkout.
  if (process.argv.includes("--baseline")) {
    const main = resolve(repo, "../loeyae-aidlc-v2");
    assert.match(produce(root, false, [], main).stderr, /include build, test, and check/);
    put(root, "build.cjs", "require('node:fs').mkdirSync('out',{recursive:true});require('node:fs').copyFileSync('router.cjs','out/router.cjs');\n");
    config(root, [build, check, test], null);
    assert.match(produce(root, false, [], main).stderr, /no test counts were parsed/);
    console.log("PASS baseline: both reported producer failures reproduced on main");
    rmSync(join(root, "build.cjs")); rmSync(join(root, "out"), { recursive: true });
    config(root);
  }
  produce(root); gate(root);
  const evidence = read(root, evidencePath);
  assert.deepEqual(evidence.tests, { total: 1, passed: 1, failed: 0, skipped: 0 });
  assert.equal(evidence.applicability, undefined, "business I13 is never marked no-behavior");
  assert.deepEqual(evidence.commands.map((c: { role: string }) => c.role), ["check", "test"]);
  console.log("PASS native business: real I13 required → two real commands → actual C8 gate + summary");

  // Source/config/command drift invalidates evidence and is repairable by controlled re-execution.
  const pkg = read(root, "package.json");
  put(root, "package.json", { ...pkg, description: "source drift" }); gate(root, false); produce(root); gate(root);
  config(root, [{ ...check, argv: [...check.argv, "--changed"] }, test]); gate(root, false); config(root);
  const changed = read(root, configPath); changed.freshness = { unexpected: true }; put(root, configPath, changed); gate(root, false); config(root);
  produce(root); const saved = read(root, evidencePath);
  put(root, evidencePath, { ...saved, tests: { ...saved.tests, passed: 2, total: 2 } }); gate(root, false); put(root, evidencePath, saved);
  put(root, "router.cjs", "module.exports=()=>[];\n"); gate(root, false); produce(root, false); put(root, "router.cjs", "module.exports = () => ['health'];\n");
  for (const invalid of [{}, { ...policy, approval_ref: "" }, { ...policy, build: { status: "not_applicable", reason: "" } }, { ...policy, module_id: "someone-else" }]) {
    put(root, "package.json", { ...pkg, aidlc_validation: invalid }); produce(root, false);
  }
  put(root, "package.json", { ...pkg, scripts: { ...pkg.scripts, build: "node build.cjs" } }); produce(root, false);
  put(root, "package.json", { ...pkg, devDependencies: { typescript: "5" } }); produce(root, false);
  put(root, "package.json", pkg); config(root, [check, test], []); produce(root, false);
  config(root, [check, test], [{ ...declaration, roles: ["test"] }]); produce(root, false);
  config(root, [check, test], null); produce(root, false);
  config(root); produce(root); gate(root);
  config(root, [check, test, { id: "required-test", role: "test", argv: ["node", "-e", "process.exit(1)"] }]);
  produce(root, false, ["--command-id", "test", "--command-id", "check"]);
  produce(root, false); config(root);
  console.log("PASS source/config/commands drift, empty/unapproved/contradictory exemption, and summary tampering block");

  // The compiler really runs, with real CommonJS inputs and no fabricated build.
  const typedPkg = { ...pkg, devDependencies: { typescript: "5.9.3" }, scripts: { ...pkg.scripts, check: "tsc --allowJs --checkJs --noEmit router.cjs" } };
  if (process.argv.includes("--baseline-256")) {
    const main = resolve(repo, "../loeyae-aidlc-v2");
    put(root, "package.json", typedPkg); config(root, [noEmitCheck, test]);
    assert.match(produce(root, false, [], main).stderr, /build exemption contradicts configured tooling/);
    put(root, "package.json", pkg); config(root, [check, { ...test, argv: ["node", "--test", "--test-reporter=tap", "--experimental-test-coverage", "tests/native.test.cjs"] }]);
    assert.match(produce(root, false, [], main).stderr, /no test counts were parsed/);
    console.log("PASS MARS-256 baseline: main 4.22.7 real producer rejects both noEmit and native coverage (exit 2)");
  }
  put(root, "package.json", typedPkg); config(root, [noEmitCheck, test]); produce(root); gate(root);
  put(root, "package-lock.json", { lockfileVersion: 3, packages: {} }); gate(root, false); produce(root); gate(root);
  put(root, "package-lock.json", { lockfileVersion: 3, packages: {}, changed: true }); gate(root, false); produce(root); gate(root);
  rmSync(join(root, "package-lock.json")); gate(root, false); produce(root); gate(root);
  assert.deepEqual(read(root, evidencePath).tests, { total: 1, passed: 1, failed: 0, skipped: 0 });
  assert.equal(read(root, evidencePath).commands.some((c: {role: string}) => c.role === "build"), false);
  assert.equal(existsSync(join(root, "router.js")), false);
  put(root, "router.cjs", "module.exports=()=>['health'];\n/** @type {number} */ const invalid='type error';\n"); produce(root, false);
  put(root, "router.cjs", "module.exports = () => ['health'];\n"); produce(root); gate(root);
  put(root, "package.json", { ...typedPkg, aidlc_validation: { ...policy, approval_ref: "approved:changed" } }); gate(root, false);
  put(root, "package.json", typedPkg); gate(root);
  const projectCheck = { ...check, argv: ["node", compiler, "--project", "tsconfig.json"] };
  const checkConfig = { compilerOptions: { allowJs: true, checkJs: true, noEmit: true }, files: ["router.cjs"] };
  put(root, "tsconfig.base.json", "{ // shared static-check options\n\"compilerOptions\": {\"noEmit\": true,},\n}\n");
  put(root, "tsconfig.json", { ...checkConfig, extends: "./tsconfig.base.json" });
  put(root, "package.json", { ...typedPkg, scripts: { ...pkg.scripts, check: `node "${compiler}" --project tsconfig.json` } });
  config(root, [projectCheck, test]); produce(root); gate(root);
  // Every consumed config byte participates in revalidation, even semantically neutral edits.
  put(root, "tsconfig.base.json", { compilerOptions: { noEmit: true }, note: "drift" }); gate(root, false); produce(root); gate(root);
  for (const options of [{ noEmit: false }, { noEmit: true, outDir: "out" }, { noEmit: true, declaration: true }, { noEmit: true, incremental: true }]) {
    put(root, "tsconfig.json", { ...checkConfig, compilerOptions: { ...checkConfig.compilerOptions, ...options } }); gate(root, false); produce(root, false);
  }
  put(root, "tsconfig.json", checkConfig);
  for (const extra of [["--noEmit", "false"], ["--outDir", "out"], ["--build"], ["--unknown-flag"]]) {
    config(root, [{ ...projectCheck, argv: [...projectCheck.argv, ...extra] }, test]); produce(root, false);
  }
  put(root, "tsconfig.json", { ...checkConfig, extends: "unverified-package/config" }); produce(root, false);
  put(root, "tsconfig.json", { ...checkConfig, references: [{ path: "compiled" }] }); produce(root, false);
  put(root, "tsconfig.json", checkConfig);
  for (const scripts of [{ ...typedPkg.scripts, prepare: "node build.cjs" }, { ...typedPkg.scripts, check: "tsc --noEmit && node other.cjs" }, { ...typedPkg.scripts, check: "custom-typecheck-wrapper" }]) {
    put(root, "package.json", { ...typedPkg, scripts }); config(root, [{ ...check, argv: ["npm", "run", "check"] }, test]); produce(root, false);
  }
  put(root, "package.json", { ...typedPkg, scripts: { ...typedPkg.scripts, check: "tsc router.cjs --allowJs --outDir out" } });
  config(root, [noEmitCheck, test]); produce(root, false);
  rmSync(join(root, "tsconfig.json")); rmSync(join(root, "tsconfig.base.json"));
  put(root, "package.json", pkg); config(root); produce(root); gate(root);
  console.log("PASS real TypeScript direct/noEmit and npm script/JSONC/local inheritance; config/argv drift, actual emit/output, prepare, wrappers and ambiguous configs block");

  // Existing projects with real builds retain the default, and failed/omitted builds block.
  put(root, "package.json", { scripts: { build: "node build.cjs", test: "node --test" } });
  put(root, "build.cjs", "require('node:fs').mkdirSync('out',{recursive:true});require('node:fs').copyFileSync('router.cjs','out/router.cjs');\n");
  config(root, [build, check, test], null); produce(root); gate(root);
  produce(root, false, ["--command-id", "test", "--command-id", "check"]);
  put(root, "build.cjs", "process.exit(1);\n"); produce(root, false);
  console.log("PASS real build required, success accepted, missing/failed build blocked");

  const compiledBuild = { ...build, argv: ["node", compiler, "--allowJs", "--outDir", "compiled-out", "router.cjs"] };
  put(root, "package.json", { devDependencies: { typescript: "5.9.3" }, scripts: { build: "tsc --allowJs --outDir compiled-out router.cjs" } });
  config(root, [compiledBuild, noEmitCheck, test], null); produce(root); gate(root);
  assert.match(readFileSync(join(root, "compiled-out/router.cjs"), "utf8"), /health/);
  config(root, [{ ...compiledBuild, argv: [...compiledBuild.argv, "--invalid-build-option"] }, noEmitCheck, test], null); produce(root, false);
  console.log("PASS actual TypeScript artifact compilation required and accepted; real compiler build failure blocks");

  // Project aggregation cannot apply one native module's exemption to a build module.
  put(root, "package.json", typedPkg);
  put(root, "docs/aidlc/ideation/module-manifest.json", { schema_version: 1, modules: [{ module_id: "project", name: "Native", service_id: "native", paths: ["router.cjs"] }, { module_id: "compiled", name: "Compiled", service_id: "compiled", paths: ["compiled"] }] });
  mkdirSync(join(root, "compiled")); config(root, [noEmitCheck, test]); produce(root, false);
  put(root, "build.cjs", "require('node:fs').mkdirSync('out',{recursive:true});require('node:fs').copyFileSync('router.cjs','out/router.cjs');\n");
  config(root, [build, noEmitCheck, test]); produce(root); gate(root);
  produce(root, false, ["--command-id", "test", "--command-id", "check"]);
  rmSync(join(root, "docs/aidlc/ideation/module-manifest.json"));
  console.log("PASS mixed modules preserve required build and prevent command subset bypass");

  // A separately approved absence of independent checks does not manufacture a lint command.
  put(root, "package.json", { ...pkg, scripts: { test: pkg.scripts.test } });
  config(root, [test], [{ ...declaration, roles: ["build", "check"] }]); produce(root); gate(root);
  put(root, "tests/native.test.cjs", "const {test}=require('node:test');test.skip('not run',()=>{});test.todo('future');\n"); produce(root, false);
  put(root, "tests/native.test.cjs", "const {test}=require('node:test');test('fail',()=>{throw Error('real failure')});\n"); produce(root, false);
  put(root, "tests/native.test.cjs", "const {test}=require('node:test');test('cancel',{timeout:10},()=>new Promise(()=>{}));\n"); produce(root, false);
  put(root, "tests/native.test.cjs", "const {describe,test}=require('node:test');describe('suite',()=>{test('one',()=>{});test.skip('skip',()=>{});test.todo('todo');describe('nested',()=>test('two',()=>{}));});describe.skip('skipped suite',()=>{});\n");
  put(root, "tests/second.test.cjs", "require('node:test').test('three',()=>{});\n");
  config(root, [{ ...test, argv: [...test.argv, "tests/second.test.cjs"] }], [{ ...declaration, roles: ["build", "check"] }]); produce(root); gate(root);
  assert.deepEqual(read(root, evidencePath).tests, { total: 5, passed: 3, failed: 0, skipped: 2 });
  const tap = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "tests/native.test.cjs", "tests/second.test.cjs"], { cwd: root, encoding: "utf8" }).stdout;
  const stats = parseTestStats(tap)!; assert.equal(stats.passed, 3);
  for (const invalid of [tap + tap, tap.replace(/# duration_ms.*\n?$/, ""), tap.replace("# pass 3", "# pass 99"), tap.replace("# tests 5", "# tests 6").replace("# pass 3", "# pass 4"), tap.replace("# skipped 1", "# skipped 0").replace("# pass 3", "# pass 4"), tap.replace("# fail 0", "# fail 1"), tap.replace(/\n1\.\.\d+\n# tests/, "\n1..99\n# tests"), tap.replace("TAP version 13", "TAP version 13\nBail out!"), "passed", "log says passed", "TAP version 13\n1 passed"]) assert.equal(parseTestStats(invalid), null, invalid);
  assert.deepEqual(parseTestStats("1 passed"), { total: 1, passed: 1, failed: 0, skipped: 0 });
  console.log("PASS Node TAP nested suites + multiple files count leaves once; failures/cancelled/zero-pass block; todo+skip excluded from passed; duplicates/truncation/inconsistency rejected");

  const coverageTest = { ...test, argv: ["node", "--test", "--test-reporter=tap", "--experimental-test-coverage", "tests/native.test.cjs", "tests/second.test.cjs"] };
  config(root, [coverageTest], [{ ...declaration, roles: ["build", "check"] }]);
  const coverageRun = spawnSync(process.execPath, coverageTest.argv.slice(1), { cwd: root, encoding: "utf8" });
  assert.equal(coverageRun.status, 0); const coverage = coverageRun.stdout;
  assert.deepEqual(parseTestStats(coverage), stats, coverage); produce(root); gate(root);
  for (const invalid of [coverage + tap, coverage + coverage, coverage + "# unknown trailer\n", coverage.replace("# end of coverage report", ""), coverage.replace("# start of coverage report", "# unknown report"), coverage.replace(/# all files[^\n]*/, "# all files | 101.00 | 100.00 | 100.00 |"), coverage.replace("# pass 3", "# pass 99"), coverage.replace("# end of coverage report", "# pass 0\n# end of coverage report")]) assert.equal(parseTestStats(invalid), null, invalid);
  for (const source of ["test.skip('skip',()=>{});test.todo('todo');", "test('fail',()=>{throw Error('failure')});", "test('cancel',{timeout:10},()=>new Promise(()=>{}));"]) {
    put(root, "tests/native.test.cjs", `const {test}=require('node:test');${source}\n`);
    config(root, [{ ...test, argv: ["node", "--test", "--test-reporter=tap", "--experimental-test-coverage", "tests/native.test.cjs"] }], [{ ...declaration, roles: ["build", "check"] }]); produce(root, false);
  }
  console.log("PASS actual Node coverage + nested/multifile/skip/todo counts; truncated/unknown/duplicate/contradictory tables and failed/cancelled/zero-pass coverage block");

  // Exercise the public completion boundary with real I13, RED and GREEN evidence.
  for (const mode of ["default", "noEmit", "coverage", "combined"]) {
  const completed = fixture(`completion-${mode}`);
  if (mode === "noEmit" || mode === "combined") {
    put(completed, "package.json", { ...typedPkg }); config(completed, [noEmitCheck, test]);
  }
  if (mode === "coverage" || mode === "combined") config(completed, [mode === "combined" ? noEmitCheck : check, { ...test, argv: ["node", "--test", "--test-reporter=tap", "--experimental-test-coverage", "tests/native.test.cjs"] }]);
  put(completed, "router.cjs", "module.exports=require('./src/router.cjs');\n");
  put(completed, "src/router.cjs", "module.exports=()=>[];\n");
  put(completed, "tests/observe.cjs", "const assert=require('node:assert/strict');let failed=0;try{assert.deepEqual(require('../router.cjs')(),['health']);}catch{failed=1;}console.log(JSON.stringify({phase:process.env.AIDLC_PHASE,status:failed?'failed':'passed',compile_status:'passed',environment_status:'passed',tests_total:1,tests_failed:failed,traceability_complete:true,...failed?{failure_class:'behavior',failure_signature:'health route missing'}:{},uc_mapping:[{use_case:'UC-D-001',test_methods:['tests/native.test.cjs']}]}));process.exit(failed);\n");
  put(completed, "docs/aidlc/modules/project/construction/default/code-review.md", "# Review\nSpec passed; Standards passed; reviewer: regression. REQ-1 UC-D-001 router discovery verified; no blocking findings.\n");
  put(completed, "docs/aidlc/construction/build-test-report.md", "# Validation\nREQ-1 UC-D-001 CommonJS runs directly with Node. Approved build not_applicable; syntax check and native Node assertions pass.\n");
  put(completed, "docs/aidlc/construction/build-and-test/build-and-test-summary.md", "# Summary\nREQ-1 UC-D-001 syntax check and native TAP test passed, 1 passed, 0 failed. No independent build according to package policy.\n");
  function active(stage: string, module = false) {
    const state = loadWorkflowState(completed)!; state.current_stage = stage; state.current_stage_instance = stage + (module ? "@module:project@unit:default" : "");
    state.current_module = module ? "project" : undefined; state.current_unit = module ? "default" : undefined; saveFixtureState(completed, state);
  }
  for (const [stage, role] of [["tdd", "red"], ["code-generation", "green"]]) put(completed, `.aidlc/commands/${stage}.json`, { version: "1", stage, commands: [{ id: role, role, argv: ["node", "tests/observe.cjs"] }] });
  active("tdd", true);
  run(completed, ["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation", "--instance", "test-case-derivation@module:project", "--refresh"]);
  run(completed, ["evidence", "run", "--stage", "tdd", "--sensor", "red-test-evidence"]);
  put(completed, "src/router.cjs", "module.exports=()=>['health'];\n");
  active("code-generation", true);
  run(completed, ["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation", "--instance", "test-case-derivation@module:project", "--refresh"]);
  run(completed, ["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
  active("build-and-test");
  const ready = loadWorkflowState(completed)!;
  ready.completed_stages = ["workspace-detection", "test-case-derivation", "tdd", "code-generation", "code-review"];
  ready.completed_stage_instances = ["workspace-detection", "test-case-derivation@module:project", "tdd@module:project@unit:default", "code-generation@module:project@unit:default", "code-review@module:project@unit:default"]; saveFixtureState(completed, ready);
  produce(completed); gate(completed);
  const execution = read(completed, evidencePath).producer.execution_id;
  if (mode === "noEmit" || mode === "combined") {
    put(completed, "tsconfig.build.json", { compilerOptions: { outDir: "dist" } }); gate(completed, false);
    run(completed, ["orchestrate", "report", "--stage", "build-and-test", "--result", "completed"], false);
    assert.ok(!loadWorkflowState(completed)!.completed_stage_instances.includes("build-and-test"));
    rmSync(join(completed, "tsconfig.build.json")); gate(completed);
    // The rejected report observed the temporary source configuration. Refresh
    // that semantic observation after restoring sources, never rewrite evidence.
    run(completed, ["evidence", "run", "--stage", "build-and-test", "--sensor", "test-quality"]);
  }
  run(completed, ["orchestrate", "report", "--stage", "build-and-test", "--result", "completed"]);
  assert.ok(loadWorkflowState(completed)!.completed_stage_instances.includes("build-and-test"));
  assert.equal(read(completed, evidencePath).producer.execution_id, execution, "report reuses valid C8 commands without manufacturing a build");
  console.log(`PASS public C8 report (${mode}) completed with real I13/RED/GREEN, gate and valid command reuse${mode === "noEmit" || mode === "combined" ? "; conflicting build config blocks report" : ""}`);
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
