import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";
import { loadRegistry } from "../core/tools/aidlc-workflow-layout";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-v43-module-workflows-"));

const M01 = "m01-trade";
const M03 = "m03-merchant";
const LEGACY_ID = "ad8e646d-5b1c-4c1e-9d2a-4f9f0c7e1a01";
const GLOBAL_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];

function run(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function success(cwd: string, args: string[]): Record<string, unknown> {
  const result = run(cwd, args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function failure(cwd: string, args: string[], pattern: RegExp): void {
  const result = run(cwd, args);
  assert.notEqual(result.status, 0, `${args.join(" ")} should fail\n${result.stdout}`);
  assert.match(`${result.stdout}\n${result.stderr}`, pattern, args.join(" "));
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function write(project: string, path: string, content: string): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), content, "utf8");
}

function commit(project: string, message: string): void {
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", message]);
}

function requirements(moduleId: string, requirement: string): string {
  return `# Requirements\n\n## ${requirement} Core capability\ntrack: [backend]\nThe ${moduleId} module provides its core capability with enough detail for review.\n`;
}

function setCurrent(project: string, instance: string, moduleId: string, stage: string): void {
  const state = loadWorkflowState(project)!;
  state.current_stage = stage;
  state.current_phase = "inception";
  state.current_stage_instance = instance;
  state.current_module = moduleId;
  saveWorkflowState(project, state);
}

/**
 * A legacy single workflow that mirrors the reported incident: m01-trade is parked at
 * requirements-data-model and its requirements-analysis evidence went stale because
 * m03-merchant wrote artifacts afterwards; m03's own evidence is still valid.
 */
function prepareLegacyProject(name: string): string {
  const project = join(root, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  write(project, "README.md", "REQ-BASE module workflow fixture\n");
  write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({
    schema_version: 1,
    modules: [
      { module_id: M01, name: "Trade", service_id: "trade-service" },
      { module_id: M03, name: "Merchant", service_id: "merchant-service" },
    ],
  }));
  write(project, "docs/aidlc/ideation/scenario-module-mapping.md", "# Scenario module mapping\nREQ-001 checkout belongs to m01-trade; REQ-101 store onboarding belongs to m03-merchant.\n");
  write(project, "docs/aidlc/ideation/product-contracts.md", [
    "# 产品级契约索引",
    "",
    "## 契约清单",
    "| 契约 ID | 类型 | 提供方 | 权威来源 | 版本/策略 | 兼容状态 | Owner |",
    "|---------|------|--------|----------|-----------|----------|-------|",
    `| SB01-store-instance | 跨进程同步 API | ${M03} | openapi/store.yaml | v1 | 兼容 | merchant-team |`,
    "",
    "## 消费者状态",
    "| 契约 ID | 消费者 | 影响 | 状态 | 验证证据 |",
    "|---------|--------|------|------|----------|",
    `| SB01-store-instance | ${M01} | 下单读取门店 | 待适配 | - |`,
    "",
  ].join("\n"));
  write(project, `docs/aidlc/modules/${M01}/inception/requirements.md`, requirements(M01, "REQ-001"));
  write(project, ".aidlc/evidence-commands.json", JSON.stringify({
    version: "1",
    stage: "requirements-analysis",
    commands: [{ id: "traceability-matrix", role: "semantic", sensor: "traceability-matrix", argv: ["loeyae-aidlc", "check", "--sensor", "traceability-matrix"] }],
  }));
  commit(project, "fixture");

  const state: WorkflowState = createInitialState("feature", "4.1.0", LEGACY_ID, [], "Deliver trade and merchant modules");
  state.completed_stages = [...GLOBAL_STAGES];
  state.completed_stage_instances = [...GLOBAL_STAGES];
  state.skipped_stage_instances = [`reverse-engineering@module:${M01}`, `reverse-engineering@module:${M03}`];
  saveWorkflowState(project, state);

  // m01 finishes requirements-analysis through the real producer and report gates.
  setCurrent(project, `requirements-analysis@module:${M01}`, M01, "requirements-analysis");
  success(project, ["evidence", "run", "--stage", "requirements-analysis"]);
  success(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--result", "completed"]);

  // m03 writes and commits its artifacts afterwards: m01's whole-worktree evidence is now stale.
  write(project, `docs/aidlc/modules/${M03}/inception/requirements.md`, requirements(M03, "REQ-101"));
  commit(project, "merchant requirements");
  setCurrent(project, `requirements-analysis@module:${M03}`, M03, "requirements-analysis");
  success(project, ["evidence", "run", "--stage", "requirements-analysis"]);
  success(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--result", "completed"]);

  // The single workflow parks on m01 exactly like the reported incident (clarification was not needed).
  setCurrent(project, `requirements-data-model@module:${M01}`, M01, "requirements-data-model");
  const parked = loadWorkflowState(project)!;
  parked.skipped_stage_instances.push(`requirement-clarification@module:${M01}`);
  parked.status = "parked";
  saveWorkflowState(project, parked);
  return project;
}

function evidencePath(project: string, moduleId: string): string {
  return join(project, ".aidlc", "evidence", "requirements-analysis", moduleId, "traceability-matrix.json");
}

try {
  // ---------------------------------------------------------------- acceptance 1: split
  const project = prepareLegacyProject("split");
  const legacyBlocked = run(project, ["orchestrate", "next", "--resume"]);
  assert.notEqual(legacyBlocked.status, 0, "the single layout must reproduce the incident");
  assert.match(legacyBlocked.stdout, /requirements-analysis@module:m01-trade[\s\S]*worktree_digest no longer matches/);
  const resumed = loadWorkflowState(project)!;
  resumed.status = "parked";
  saveWorkflowState(project, resumed);

  failure(project, ["orchestrate", "split", "--from", "00000000"], /does not match the active workflow/);
  const plan = success(project, ["orchestrate", "split", "--from", "ad8e646d", "--dry-run"]);
  assert.equal(existsSync(join(project, "aidlc", "active", "registry.md")), false, "dry run must not write");
  assert.deepEqual((plan.stale_evidence as string[]), [`.aidlc/evidence/requirements-analysis/${M01}/traceability-matrix.json`]);

  const split = success(project, ["orchestrate", "split", "--from", "ad8e646d"]);
  const splitEvidence = (split.split as Record<string, Record<string, string[]>>).evidence;
  assert.deepEqual(splitEvidence.anchored, [`.aidlc/evidence/requirements-analysis/${M03}/traceability-matrix.json`]);
  assert.equal(splitEvidence.stale.length, 1);
  assert.match(splitEvidence.stale[0], /m01-trade/);

  const globalState = loadWorkflowState(project)!;
  const m01State = loadWorkflowState(project, { kind: "module", module_id: M01 })!;
  const m03State = loadWorkflowState(project, { kind: "module", module_id: M03 })!;
  const integrationState = loadWorkflowState(project, { kind: "integration" })!;
  assert.equal(globalState.workflow_id, LEGACY_ID);
  assert.equal(globalState.workflow_kind, "global");
  assert.equal(globalState.version, "4.9.1", "Engine Version is written back on save");
  assert.equal(globalState.status, "done");
  assert.deepEqual(globalState.completed_stage_instances, GLOBAL_STAGES);
  assert.ok(globalState.history.every((entry) => !entry.instance_id?.includes("@module:")));
  assert.equal(m03State.workflow_kind, "module");
  assert.equal(m03State.module_id, M03);
  assert.equal(m03State.parent_workflow_id, LEGACY_ID);
  assert.notEqual(m03State.workflow_id, LEGACY_ID);
  assert.equal(m03State.status, "running", "m03 is no longer held by m01's park");
  assert.deepEqual(m03State.completed_stage_instances, [`requirements-analysis@module:${M03}`]);
  assert.deepEqual(m03State.skipped_stage_instances, [`reverse-engineering@module:${M03}`]);
  assert.ok(m03State.history.some((entry) => entry.instance_id === `requirements-analysis@module:${M03}` && entry.result === "completed"));
  assert.equal(m01State.status, "parked");
  assert.equal(m01State.current_stage_instance, `requirements-data-model@module:${M01}`);
  assert.deepEqual(m01State.completed_stage_instances, [`requirements-analysis@module:${M01}`]);
  assert.equal(integrationState.workflow_kind, "integration");
  assert.equal(integrationState.status, "running");
  const m03Text = readFileSync(join(project, "aidlc", "active", "modules", M03, "aidlc-state.md"), "utf8");
  assert.match(m03Text, /- Workflow Kind: module\n- Module: m03-merchant\n- Parent Workflow ID: ad8e646d/);
  assert.match(readFileSync(join(project, "aidlc", "active", "audit.md"), "utf8"), /Event: WORKFLOW_SPLIT/);
  assert.match(readFileSync(join(project, "aidlc", "active", "modules", M01, "audit.md"), "utf8"), /Event: WORKFLOW_CREATED/);
  const registry = loadRegistry(project)!;
  assert.equal(registry.global_workflow_id, LEGACY_ID);
  assert.deepEqual(registry.modules.map((row) => [row.module_id, row.status, row.current_stage]), [[M01, "parked", `requirements-data-model@module:${M01}`], [M03, "running", "-"]]);
  assert.deepEqual(registry.shared_contracts.map((row) => [row.contract_id, row.provider, row.consumers.join(","), row.verified]), [["SB01-store-instance", M03, M01, false]]);
  assert.equal(registry.integration.barrier_ready, false);
  assert.deepEqual(registry.integration.blocking, [`construction:${M01}`, `construction:${M03}`, "contract:SB01-store-instance"]);
  failure(project, ["orchestrate", "split", "--from", "ad8e646d"], /already split/);

  // ---------------------------------------------------------------- acceptance 2: m03 is not blocked by m01
  const m03Next = success(project, ["orchestrate", "next", "--module", M03]);
  assert.equal(m03Next.kind, "run-stage");
  assert.equal(m03Next.stage_instance, `requirement-clarification@module:${M03}`);
  assert.equal(m03Next.workflow, `module:${M03}`);
  assert.match(String(m03Next.handoff_prompt), /orchestrate report --stage requirement-clarification --module m03-merchant --result completed/);
  const routed = success(project, ["orchestrate", "next"]);
  assert.equal(routed.stage_instance, `requirement-clarification@module:${M03}`, "plain next skips the parked module");
  assert.ok((routed.other_workflows as string[]).some((note) => /m01-trade: parked/.test(note)));
  assert.equal(loadWorkflowState(project, { kind: "module", module_id: M01 })!.status, "parked");
  assert.equal(loadRegistry(project)!.modules.find((row) => row.module_id === M03)!.current_stage, `requirement-clarification@module:${M03}`);
  const status = success(project, ["orchestrate", "next", "--status"]);
  assert.match(String(status.message), /\[module:m01-trade\] parked[\s\S]*\[module:m03-merchant\] running/);

  // ---------------------------------------------------------------- acceptance 3: refresh + re-attest
  failure(project, ["evidence", "run", "--stage", "requirements-analysis", "--module", M01], /is not active; it is completed, pass --refresh/);
  failure(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--module", M01, "--result", "completed"], /Cannot re-attest[\s\S]*worktree_digest no longer matches/);
  success(project, ["evidence", "run", "--stage", "requirements-analysis", "--module", M01, "--refresh"]);
  const refreshed = JSON.parse(readFileSync(evidencePath(project, M01), "utf8"));
  assert.equal(refreshed.source_revision.scope, `module:${M01}`);
  assert.match(refreshed.source_revision.scope_digest, /^[a-f0-9]{64}$/);
  assert.equal(refreshed.evidence_version, "1");
  assert.equal(refreshed.stage_instance, `requirements-analysis@module:${M01}`);
  const reattested = success(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--module", M01, "--result", "completed"]);
  assert.equal(reattested.reattested, true);
  const m01AfterReattest = loadWorkflowState(project, { kind: "module", module_id: M01 })!;
  assert.equal(m01AfterReattest.status, "parked", "re-attestation never changes progress");
  assert.ok(m01AfterReattest.history.some((entry) => entry.result === "reattested"));
  const m01Next = success(project, ["orchestrate", "next", "--module", M01, "--resume"]);
  assert.equal(m01Next.stage_instance, `requirements-data-model@module:${M01}`);

  // ---------------------------------------------------------------- acceptance 4: digest isolation
  write(project, `docs/aidlc/modules/${M03}/inception/clarifications.md`, "# Clarifications\nREQ-101 store onboarding hours are confirmed with the merchant team.\n");
  commit(project, "merchant clarifications");
  const isolated = success(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--module", M01, "--result", "completed"]);
  assert.equal(isolated.reattested, true, "an m03 write and commit must not invalidate m01 evidence");
  const m01Requirements = join(project, "docs", "aidlc", "modules", M01, "inception", "requirements.md");
  writeFileSync(m01Requirements, `${readFileSync(m01Requirements, "utf8")}Additional REQ-001 detail.\n`, "utf8");
  failure(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--module", M01, "--result", "completed"], /scope_digest no longer matches the module:m01-trade scope/);
  git(project, ["checkout", "--", `docs/aidlc/modules/${M01}/inception/requirements.md`]);
  success(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--module", M01, "--result", "completed"]);

  // ---------------------------------------------------------------- acceptance 5: sensor scope
  const diagramRoot = `docs/aidlc/modules/${M03}/inception/application-design`;
  mkdirSync(join(project, diagramRoot), { recursive: true });
  cpSync(join(repository, "tests", "fixtures", "diagram-003"), join(project, diagramRoot), { recursive: true });
  const moduleManifest = join(project, diagramRoot, "diagram-003.diagram.json");
  writeFileSync(moduleManifest, JSON.stringify({ ...JSON.parse(readFileSync(moduleManifest, "utf8")), document: `${diagramRoot}/diagram-003.md` }, null, 2), "utf8");
  write(project, "docs/正式/broken.diagram.json", JSON.stringify({ version: 1, diagrams: [{ id: "broken" }] }));
  const defaultMermaid = success(project, ["check", "--sensor", "diagram-contract", "--module", M03]);
  assert.equal(defaultMermaid.status, "not_applicable", "SVG diagrams are not validated until the user selects svg");
  assert.equal(defaultMermaid.source_format, "mermaid");
  failure(project, ["orchestrate", "diagram-format", "--set", "svg"], /--user-input is required/);
  const selected = success(project, ["orchestrate", "diagram-format", "--set", "svg", "--user-input", "流程图请用 SVG"]);
  assert.equal(selected.diagram_format, "svg");
  assert.match(readFileSync(join(project, "aidlc", "active", "aidlc-state.md"), "utf8"), /^- Diagram Format: svg$/m);
  failure(project, ["check", "--sensor", "diagram-contract"], /Semantic checker blocked/);
  const scoped = success(project, ["check", "--sensor", "diagram-contract", "--module", M03]);
  assert.equal(scoped.status, "passed");
  failure(project, ["check", "--sensor", "diagram-contract", "--module", M01], /diagram structured source is missing for module m01-trade/);
  const legacyContext = spawnSync(process.execPath, [tsx, cli, "check", "--sensor", "diagram-contract"], { cwd: project, encoding: "utf8", env: { ...process.env, AIDLC_ACTIVE_MODULE: M03 } });
  assert.notEqual(legacyContext.status, 0, "an env-only module context keeps the historical project-wide discovery");
  success(project, ["orchestrate", "diagram-format", "--set", "mermaid", "--user-input", "改回 Mermaid"]);

  // ---------------------------------------------------------------- park / registry / lazy module
  const parkedM03 = success(project, ["orchestrate", "park", "--module", M03]);
  assert.equal(parkedM03.kind, "parked");
  assert.equal(loadWorkflowState(project, { kind: "module", module_id: M01 })!.status, "running", "parking m03 leaves m01 untouched");
  const contracts = join(project, "docs", "aidlc", "ideation", "product-contracts.md");
  writeFileSync(contracts, readFileSync(contracts, "utf8").replace("| 下单读取门店 | 待适配 |", "| 下单读取门店 | 已验证 |"), "utf8");
  // Module scope still binds a module's evidence to that module's own later writes
  // (clarifications, diagrams); the documented repair is refresh + re-attest.
  failure(project, ["orchestrate", "next", "--module", M03, "--resume"], /scope_digest no longer matches the module:m03-merchant scope/);
  success(project, ["evidence", "run", "--stage", "requirements-analysis", "--module", M03, "--refresh"]);
  success(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--module", M03, "--result", "completed"]);
  const m03Resumed = success(project, ["orchestrate", "next", "--module", M03]);
  assert.equal(m03Resumed.stage_instance, `requirement-clarification@module:${M03}`);
  const verified = loadRegistry(project)!;
  assert.equal(verified.shared_contracts[0].verified, true);
  assert.deepEqual(verified.integration.blocking, [`construction:${M01}`, `construction:${M03}`]);
  success(project, ["module", "select", "--module", M03, "--owner", "carol"]);
  assert.equal(loadRegistry(project)!.modules.find((row) => row.module_id === M03)!.owner, "carol");
  assert.equal(loadWorkflowState(project, { kind: "module", module_id: M03 })!.module_selections[M03].owner, "carol");
  const runtime = success(project, ["runtime", "doctor", "--module", M03]);
  const projection = runtime.projection as Record<string, unknown>;
  assert.equal(projection.layout, "split");
  assert.ok((projection.instances as Array<Record<string, unknown>>).every((instance) => instance.module_id === M03));

  // ---------------------------------------------------------------- auto split on next --module
  const autoProject = prepareLegacyProject("auto-split");
  const autoNext = success(autoProject, ["orchestrate", "next", "--module", M03]);
  assert.equal(autoNext.stage_instance, `requirement-clarification@module:${M03}`);
  assert.ok(existsSync(join(autoProject, "aidlc", "active", "registry.md")));
  assert.equal(loadWorkflowState(autoProject, { kind: "module", module_id: M01 })!.status, "parked");
  failure(autoProject, ["orchestrate", "next", "--module", M01, "--resume"], /requirements-analysis@module:m01-trade[\s\S]*worktree_digest no longer matches[\s\S]*--refresh/);
  failure(autoProject, ["orchestrate", "report", "--stage", "requirement-clarification", "--result", "completed"], /needs --module|Cannot complete|missing|not found/);

  // ---------------------------------------------------------------- acceptance 6: single layout is unchanged
  const legacy = join(root, "legacy");
  mkdirSync(legacy, { recursive: true });
  git(legacy, ["init", "-q"]);
  write(legacy, "README.md", "REQ-LEGACY single workflow\n");
  commit(legacy, "base");
  success(legacy, ["orchestrate", "next", "--scope", "bugfix", "--work", "Fix a legacy defect"]);
  const legacyNext = success(legacy, ["orchestrate", "next"]);
  assert.equal(legacyNext.kind, "run-stage");
  assert.equal(legacyNext.workflow, undefined, "single-layout directives carry no split fields");
  assert.equal(existsSync(join(legacy, "aidlc", "active", "registry.md")), false);
  const legacyText = readFileSync(join(legacy, "aidlc", "active", "aidlc-state.md"), "utf8");
  assert.doesNotMatch(legacyText, /Workflow Kind/);
  assert.match(legacyText, /- Engine Version: 4\.9\.1/);
  failure(legacy, ["orchestrate", "park", "--module", M01], /requires the per-module layout/);
  const legacyPark = success(legacy, ["orchestrate", "park"]);
  assert.match(String(legacyPark.message), /^Workflow parked at stage/);
  failure(legacy, ["orchestrate", "split", "--from", loadWorkflowState(legacy)!.workflow_id], /module-division/);
  const legacyRuntime = success(legacy, ["runtime", "summary"]);
  assert.equal(legacyRuntime.layout, "single");

  console.log("v4.3 per-module workflow acceptance tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
