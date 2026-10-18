import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";
import { CONTENT_BOUND_EVIDENCE, evidenceTimeError } from "../core/tools/aidlc-evidence-policy";
import { frontendPlatformPayload } from "../core/tools/aidlc-frontend-platform";
import { loadGraph } from "../core/tools/aidlc-orchestrate";

const repo = resolve(import.meta.dirname, ".."), tsx = join(repo, "node_modules/tsx/dist/cli.mjs");
const scratch = mkdtempSync(join(tmpdir(), "aidlc-mars250-"));
const put = (root: string, path: string, value: unknown) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value)); };
const get = (root: string, path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));
function run(root: string, args: string[], ok = true, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [tsx, join(repo, "bin/cli.ts"), ...args], { cwd: root, encoding: "utf8", env: { ...fixtureEnvironment(root, args), ...env } });
  assert.equal(result.status === 0, ok, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function activate(root: string, slug: string) {
  const state = loadWorkflowState(root)!;
  state.current_stage = slug; state.current_phase = slug === "test-case-derivation" ? "inception" : "construction";
  state.current_stage_instance = slug === "test-case-derivation" ? `${slug}@module:project` : `${slug}@module:project@unit:default`;
  state.current_module = "project";
  if (slug !== "test-case-derivation") state.current_unit = "default"; else delete state.current_unit;
  saveFixtureState(root, state);
}
function project(name: string) {
  const root = join(scratch, name); mkdirSync(root);
  put(root, "README.md", "Policy regression\n");
  for (const args of [["init", "-q"], ["add", "README.md"], ["-c", "user.name=Regression", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline"]]) assert.equal(spawnSync("git", args, { cwd: root }).status, 0);
  saveFixtureState(root, createInitialState("express", "4.22.2", `mars250-${name}`, [], "policy regression"));
  return root;
}
function gate(root: string, sensors: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [tsx, join(repo, "tests/mars249_sensor_runner.ts"), sensors, "--select-stage"], { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); return JSON.parse(result.stdout);
}
const specPath = "docs/aidlc/modules/project/construction/default/frontend-platform-spec.md";
const uiEvidence = ".aidlc/evidence/ui-implementation-bridge/project/default/frontend-platform-spec.json";
const componentsPath = "docs/aidlc/modules/project/inception/application-design/frontend-components.md";
const platformPath = "docs/aidlc/modules/project/inception/application-design.md";
const layout = "## 布局原语\n| 视觉意图 | 目标组件 |\n|---|---|\n| 垂直排列 | View |\n";
const components = "## 组件映射参考\n| UI 概念 | 目标组件 |\n|---|---|\n| 标题 | Text |\n| 提交 | Button |\n";
const css = "## CSS/样式约束\n| 禁止写法 | 原因 | 替代方案 |\n|---|---|---|\n| display:grid | 运行时不支持 | flex |\n";
const spec = "# 平台规范\nREQ-UI-001: 提交页面\n运行时: React Native\n组件库: Native\n样式方案: StyleSheet\n" + layout + components + css;
try {
  // Actual producer → main gate/reuse planner → public report, with only 1/2/1 rows.
  const ui = project("small-ui");
  put(ui, "docs/aidlc/ideation/module-manifest.json", { schema_version: 1, modules: [{ module_id: "project", name: "UI", service_id: "svc" }] });
  put(ui, "docs/aidlc/modules/project/inception/unit-manifest.json", { schema_version: 1, module_id: "project", units: [{ unit_id: "default", name: "Page", service_id: "svc", conditional_stages: ["ui-implementation-bridge"] }] });
  const uiState = loadWorkflowState(ui)!; uiState.scope = "feature"; saveFixtureState(ui, uiState);
  put(ui, specPath, spec); put(ui, componentsPath, components); put(ui, platformPath, layout + css);
  activate(ui, "ui-implementation-bridge");
  run(ui, ["evidence", "run", "--stage", "ui-implementation-bridge", "--sensor", "frontend-platform-spec"]);
  const observed = get(ui, uiEvidence);
  assert.deepEqual(observed.component_mapping, ["标题 | Text", "提交 | Button"]);
  assert.equal(gate(ui, "frontend-platform-spec").failures.length, 0);
  observed.timestamp = new Date(Date.now() - 25 * 3600_000).toISOString(); put(ui, uiEvidence, observed);
  const aged = gate(ui, "frontend-platform-spec");
  assert.equal(aged.plan.verify.length, 1, JSON.stringify(aged));
  for (const timestamp of ["2026-02-30T00:00:00Z", new Date(Date.now() + 3600_000).toISOString()]) {
    put(ui, uiEvidence, { ...observed, timestamp }); assert.ok(gate(ui, "frontend-platform-spec").failures.length);
  }
  put(ui, uiEvidence, { ...observed, checker: { ...observed.checker, argv_digest: "f".repeat(64) } });
  assert.ok(gate(ui, "frontend-platform-spec").failures.length, "checker command binding rejects drift");
  put(ui, uiEvidence, { ...observed, producer: { ...observed.producer, mode: "manual" } });
  assert.ok(gate(ui, "frontend-platform-spec").failures.length, "invalid provenance rejects");
  put(ui, uiEvidence, observed);
  for (const bad of [spec.replace("| 提交 | Button |\n", ""), "component button form layout flex row CSS CSS CSS", spec.replace("| 提交 | Button |", "| 提交 | ... |"), spec.replace("| 标题 | Text |", "| 标题 | text |"), spec + "| display:grid | 运行时不支持 | flex |\n"]) {
    put(ui, specPath, bad); run(ui, ["evidence", "run", "--stage", "ui-implementation-bridge", "--sensor", "frontend-platform-spec"], false);
    assert.ok(gate(ui, "frontend-platform-spec").failures.length);
  }
  put(ui, specPath, spec);
  put(ui, componentsPath, components + "| 搜索 | SearchInput |\n");
  assert.ok(gate(ui, "frontend-platform-spec").failures.length, "new actual design component requires mapping");
  put(ui, componentsPath, components);
  const state = loadWorkflowState(ui)!; state.completed_stages = ["code-generation"]; state.completed_stage_instances = ["code-generation@module:project@unit:default"]; saveFixtureState(ui, state);
  run(ui, ["orchestrate", "report", "--stage", "ui-implementation-bridge", "--result", "completed"]);
  assert.ok(loadWorkflowState(ui)!.completed_stage_instances.includes("ui-implementation-bridge@module:project@unit:default"));

  const legacy = project("legacy-tables"); put(legacy, specPath, spec);
  assert.equal(frontendPlatformPayload(legacy, specPath, "project").coverage_basis, "legacy-spec-tables");
  put(legacy, componentsPath, "# 当前页面\n" + components + "\n# 其他页面\n" + components.replace("提交", "删除"));
  put(legacy, specPath, `- design_source: ${componentsPath}#当前页面\n${spec}`);
  assert.equal(frontendPlatformPayload(legacy, specPath, "project").coverage_basis, "approved-source-tables", "unit scope does not force unrelated page mappings");

  // Real template producer evidence also survives 25h; its inputs still bind.
  const templates = project("templates");
  const templateState = loadWorkflowState(templates)!;
  templateState.current_stage = "build-and-test-templates"; templateState.current_stage_instance = "build-and-test-templates"; saveFixtureState(templates, templateState);
  for (const name of ["build-instructions.md", "unit-test-instructions.md"]) put(templates, `docs/aidlc/construction/build-and-test/${name}`, "# Instructions\nRun node check.cjs for the current local library.\n");
  run(templates, ["evidence", "run", "--stage", "build-and-test-templates", "--sensor", "template-completeness"]);
  const templateEvidence = ".aidlc/evidence/build-and-test-templates/template-completeness.json", t = get(templates, templateEvidence);
  put(templates, templateEvidence, { ...t, timestamp: observed.timestamp });
  assert.equal(gate(templates, "template-completeness").plan.verify.length, 1);
  put(templates, "docs/aidlc/construction/build-and-test/build-instructions.md", "# Changed build command\nnode other.cjs\n");
  assert.ok(gate(templates, "template-completeness").failures.length);

  // Reuse uses explicit ownership, shared paths/transitive dependencies and environment.
  const root = project("scoped-check");
  const unitManifest = "docs/aidlc/modules/project/inception/unit-manifest.json";
  put(root, "docs/aidlc/ideation/module-manifest.json", { schema_version: 1, modules: [
    { module_id: "project", name: "Current", service_id: "svc", paths: ["src/current", "src/dependency", "src/private"], contract_paths: ["shared"] },
    { module_id: "unrelated", name: "Other", service_id: "other", paths: ["unrelated-module"] },
  ] });
  put(root, unitManifest, { schema_version: 1, module_id: "project", units: [
    { unit_id: "default", name: "Current", service_id: "svc", evidence_inputs: { version: 1, paths: ["src/current"], shared_paths: ["shared"], depends_on_units: ["dependency"] } },
    { unit_id: "dependency", name: "Dependency", service_id: "svc", evidence_inputs: { version: 1, paths: ["src/dependency"], shared_paths: [], depends_on_units: [] } },
    { unit_id: "private", name: "Private", service_id: "svc", evidence_inputs: { version: 1, paths: ["src/private"], shared_paths: [], depends_on_units: [] } },
  ] });
  for (const path of ["src/current/config.json", "src/dependency/config.json", "src/private/config.json", "shared/config.json"]) put(root, path, { valid: true });
  put(root, "docs/aidlc/modules/project/inception/requirements.md", "REQ-CONFIG-001: configuration declarations only.\n");
  put(root, "docs/aidlc/modules/project/inception/application-design/test-cases/non-applicable.json", { schema_version: "1", status: "not_applicable", reason_code: "pure-configuration", reason: "configuration only", approval_ref: "approved:REQ-CONFIG-001", alternative_validation: "validate configuration", validation_command: "node check.cjs", source_refs: ["REQ-CONFIG-001"] });
  put(root, "check.cjs", "const fs=require('fs');JSON.parse(fs.readFileSync('src/current/config.json'));fs.mkdirSync('.aidlc',{recursive:true});fs.appendFileSync('.aidlc/executions','check\\n');console.log('valid');\n");
  const command = { id: "check", role: "check", argv: ["node", "check.cjs"], evidence_inputs: { environment: ["CONFIG_MODE"] } };
  function config(slug: string, cmd = command) { put(root, `.aidlc/commands/${slug}.json`, { version: "1", stage: slug, commands: [cmd] }); }
  const count = () => readFileSync(join(root, ".aidlc/executions"), "utf8").trim().split("\n").length;
  activate(root, "test-case-derivation"); run(root, ["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation"]);
  config("tdd"); config("code-generation");
  activate(root, "tdd"); run(root, ["evidence", "run", "--stage", "tdd", "--sensor", "red-test-evidence"]);
  const red = get(root, ".aidlc/evidence/tdd/project/default/red-test-evidence.json");
  activate(root, "code-generation");
  function green(env: NodeJS.ProcessEnv = {}) { run(root, ["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"], true, env); }
  green(); assert.equal(count(), 1);
  put(root, "unrelated-module/README.md", "unrelated change\n"); put(root, "src/private/config.json", { private: 2 });
  green({ UNRELATED_ENV: "notes" }); assert.equal(count(), 1, "declared unrelated inputs/environment do not rerun");
  assert.equal(get(root, ".aidlc/evidence/code-generation/project/default/green-test-evidence.json").alternative_validation_execution.reused_from, red.alternative_validation_execution.observation_id);
  for (const path of ["src/current/config.json", "shared/config.json", "src/dependency/config.json", "package-lock.json"]) {
    const before = count(); put(root, path, { revision: before }); green(); assert.equal(count(), before + 1, `relevant input ${path} reruns`);
  }
  assert.equal(gate(root, "green-test-evidence").failures.length, 0, "current declaration and environment pass the same gate");
  const envDrift = gate(root, "green-test-evidence", { CONFIG_MODE: "changed" });
  assert.match(JSON.stringify(envDrift.failures), /inputs\/environment\/declaration changed/, "gate/reuse planner reject relevant environment drift");
  let before = count(); green({ CONFIG_MODE: "changed" }); assert.equal(count(), before + 1);
  config("code-generation", { ...command, argv: ["node", "check.cjs", "--changed"] });
  before = count(); green(); assert.equal(count(), before + 1, "command change reruns");
  const advanced = loadWorkflowState(root)!; const baseline = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  assert.equal(spawnSync("git", ["-c", "user.name=Regression", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "advance generation"], { cwd: root }).status, 0);
  const nextBaseline = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  advanced.baseline_commit = nextBaseline; advanced.baseline_source = "advanced"; advanced.baseline_history = [baseline, nextBaseline]; saveFixtureState(root, advanced);
  before = count(); green(); assert.equal(count(), before + 1, "baseline generation change reruns");
  assert.ok(readdirSync(join(root, ".aidlc/alternative-observations")).every(name => !readFileSync(join(root, ".aidlc/alternative-observations", name), "utf8").includes('"CONFIG_MODE","changed"')), "environment values are hashed");

  // No ownership declaration: unknown files and unknown environment remain bound.
  rmSync(join(root, "docs/aidlc/ideation/module-manifest.json"));
  rmSync(join(root, unitManifest));
  green(); before = count(); put(root, "unrelated-module/README.md", "unknown dependency change\n"); green(); assert.equal(count(), before + 1);
  config("code-generation", { ...command, evidence_inputs: undefined } as unknown as typeof command);
  green(); before = count(); green({ UNKNOWN_ENV: "changed" }); assert.equal(count(), before + 1);
  const cacheRecords = readdirSync(join(root, ".aidlc/alternative-observations")).map(name => get(root, `.aidlc/alternative-observations/${name}`));
  assert.ok(cacheRecords.some(record => record.binding.inputs.mode === "conservative-worktree"));
  put(root, "check.cjs", "const fs=require('fs');fs.appendFileSync('src/current/config.json',' ');fs.appendFileSync('.aidlc/executions','check\\n');console.log('valid');");
  const cached = readdirSync(join(root, ".aidlc/alternative-observations")).length;
  green(); green(); assert.equal(readdirSync(join(root, ".aidlc/alternative-observations")).length, cached, "mutating checks never seed reusable observations");

  // Existing suite has no UC-D annotation; a controlled observer reuses its method
  // mapping and reports real assertion results. Missing selected coverage still fails.
  const behavior = project("existing-suite");
  put(behavior, "docs/aidlc/modules/project/inception/requirements.md", "REQ-1: Given a user, When submitting, Then return successful submission.\n");
  put(behavior, "docs/aidlc/modules/project/inception/application-design/test-cases/_index.md", "# Cases\nUC-D-001 status: ready source_ref: REQ-1\n");
  put(behavior, "docs/aidlc/modules/project/inception/application-design/test-cases/UC-D-001.md", "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# Submit\nGiven a user When submitting Then return successful submission.\n");
  put(behavior, "behavior.cjs", "module.exports = () => false;\n");
  put(behavior, "legacy-suite.cjs", "exports.existingSubmissionTest=()=>require('assert').strictEqual(require('./behavior.cjs')(),true);\n");
  put(behavior, "observer.cjs", "const fs=require('fs');let failed=false;try{require('./legacy-suite.cjs').existingSubmissionTest()}catch(e){if(e.code!=='ERR_ASSERTION')throw e;failed=true}console.log(JSON.stringify({phase:process.env.AIDLC_PHASE,status:failed?'failed':'passed',compile_status:'passed',environment_status:'passed',tests_total:1,tests_failed:failed?1:0,traceability_complete:true,failure_class:failed?'behavior':undefined,failure_signature:failed?'submission returned false':undefined,uc_mapping:fs.existsSync('.aidlc/omit-mapping')?[]:[{use_case:'UC-D-001',test_methods:['legacy-suite.cjs#existingSubmissionTest']}]}));process.exit(failed?1:0);\n");
  activate(behavior, "test-case-derivation"); run(behavior, ["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation"]);
  for (const [stage, role] of [["tdd", "red"], ["code-generation", "green"]]) put(behavior, `.aidlc/commands/${stage}.json`, { version: "1", stage, commands: [{ id: role, role, argv: ["node", "observer.cjs"] }] });
  activate(behavior, "tdd"); run(behavior, ["evidence", "run", "--stage", "tdd", "--sensor", "red-test-evidence"]);
  put(behavior, "behavior.cjs", "module.exports = () => true;\n");
  activate(behavior, "code-generation"); put(behavior, ".aidlc/omit-mapping", "omit selected coverage");
  run(behavior, ["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"], false);
  rmSync(join(behavior, ".aidlc/omit-mapping"));
  run(behavior, ["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
  assert.equal(gate(behavior, "green-test-evidence").failures.length, 0, "existing real suite mapping is reusable without annotations");

  for (const sensor of CONTENT_BOUND_EVIDENCE) {
    assert.equal(evidenceTimeError({ timestamp: observed.timestamp }, sensor), null, sensor);
    assert.ok(evidenceTimeError({ timestamp: observed.timestamp, freshness: { kind: "external", max_age_ms: 3600_000, reason: "remote state" } }, sensor));
    assert.ok(evidenceTimeError({ timestamp: "2026-02-30T00:00:00Z" }, sensor));
  }
  assert.ok(evidenceTimeError({ timestamp: observed.timestamp }, "recovery-evidence"));
  assert.ok(evidenceTimeError({ timestamp: observed.timestamp }, "unknown-external-sensor"));
  const graph = loadGraph();
  assert.equal(graph.stages.find(stage => stage.slug === "code-generation")!.approval, "notify");
  for (const slug of ["application-design", "operations-authorization"]) assert.equal(graph.stages.find(stage => stage.slug === slug)!.approval, "block");
  assert.equal(graph.stages.find(stage => stage.slug === "ui-implementation-bridge")!.condition, "needs_ui_implementation_bridge");
  console.log("MARS-250 real producers, static age policy, actual UI coverage, scoped alternative observations and gate bindings passed");
} finally { rmSync(scratch, { recursive: true, force: true }); }
