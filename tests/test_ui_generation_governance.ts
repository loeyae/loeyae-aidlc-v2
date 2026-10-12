import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import {
  buildUiImpactMatrix,
  createUiGenerationAcceptance,
  createUiGenerationLock,
  parseUiPagePlanContent,
  verifyUiGenerationAcceptance,
  verifyUiGenerationLockAtBaseline,
} from "../core/tools/aidlc-ui-governance";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-ui-governance-"));
const moduleId = "module-a";
const moduleRoot = `docs/aidlc/modules/${moduleId}/inception`;

function write(project: string, path: string, content: string): void {
  const target = join(project, path);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function git(project: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "AI-DLC",
      GIT_AUTHOR_EMAIL: "aidlc@example.invalid",
      GIT_COMMITTER_NAME: "AI-DLC",
      GIT_COMMITTER_EMAIL: "aidlc@example.invalid",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return (result.stdout || "").trim();
}

function commitAll(project: string, message: string): string {
  git(project, ["add", "."]);
  git(project, ["commit", "-qm", message]);
  return git(project, ["rev-parse", "HEAD"]);
}

function run(project: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function pagePlan(second = false): string {
  return `# UI 页面计划

## 页面清单
| ID | 端 | 页面名称 | 类型 | 来源 | 改造基础 | 目标代码文件 | 角色与权限 | 状态差异 |
|----|----|----------|------|------|----------|--------------|------------|----------|
| PAGE-001 | Web | 首页 | 新增页面 | REQ-001 FR-001 US-001 AC-001 | — | 待 Construction 确定 | 用户 | 默认 |
${second ? "| PAGE-002 | Web | 详情 | 新增页面 | REQ-002 FR-002 US-002 AC-002 | — | 待 Construction 确定 | 用户 | 默认 |\n" : ""}
## 页面内容契约
| 页面 ID | 可见字段/组件 | 输入与展示约束 | 条件可见性 | 来源引用 |
|---------|---------------|----------------|------------|----------|
| PAGE-001 | 标题 | 必填 | 始终 | REQ-001 FR-001 US-001 AC-001 |
${second ? "| PAGE-002 | 详情 | 只读 | 始终 | REQ-002 FR-002 US-002 AC-002 |\n" : ""}
## 操作闭环
| 来源页面 | 按钮/入口 | 目标页面或反馈 | 来源引用 |
|----------|-----------|----------------|----------|
| PAGE-001 | 查看 | PAGE-001 | US-001 |
${second ? "| PAGE-002 | 关闭 | 原地反馈 | US-002 |\n" : ""}
## 跨端数据流
| 产生端/页面 | 数据或动作 | 消费端/页面 | 来源引用 |
|-------------|------------|-------------|----------|
| PAGE-001 | 查看 | PAGE-001 | US-001 |

## 未决项
无
`;
}

function requirements(second = false): string {
  return `# Requirements

## REQ-001 FR-001
首页必须展示可验证内容。
${second ? "\n## REQ-002 FR-002\n详情页必须展示新增业务字段。\n" : ""}`;
}

function stories(second = false, drift = ""): string {
  return `# Stories

## US-001
来源: FR-001
用户可以查看首页。

### AC-001
首页显示成功。
${second ? `\n## US-002\n来源: FR-002\n用户可以查看详情。${drift}\n\n### AC-002\n详情字段显示成功。\n` : ""}`;
}

function writeHtmlArtifacts(project: string, second = false): void {
  write(project, `${moduleRoot}/ui-mock/web-page-specs.md`, `# Specs\nPAGE-001\n${second ? "PAGE-002\n" : ""}`);
  write(project, `${moduleRoot}/ui-mock/page-001.html`, `<main id="mock-PAGE-001"><h1>PAGE-001</h1><button>查看</button></main>\n`);
  if (second) write(project, `${moduleRoot}/ui-mock/page-002.html`, `<main id="mock-PAGE-002"><h1>PAGE-002</h1><button>返回</button></main>\n`);
  const pages = [
    {
      page_id: "PAGE-001",
      page_specs: `${moduleRoot}/ui-mock/web-page-specs.md`,
      html: `${moduleRoot}/ui-mock/page-001.html`,
      mock_box_id: "mock-PAGE-001",
      requirements: ["REQ-001"],
      stories: ["US-001"],
    },
    ...(second ? [{
      page_id: "PAGE-002",
      page_specs: `${moduleRoot}/ui-mock/web-page-specs.md`,
      html: `${moduleRoot}/ui-mock/page-002.html`,
      mock_box_id: "mock-PAGE-002",
      requirements: ["REQ-002"],
      stories: ["US-002"],
    }] : []),
  ];
  write(project, `${moduleRoot}/ui-mock/ui-mock-manifest.json`, `${JSON.stringify({
    schema_version: "1",
    design_mode: "html-mock",
    page_plan: `${moduleRoot}/ui-design/page-plan.md`,
    phases: {
      skeleton: { status: "validated", page_ids: pages.map((page) => page.page_id), reviewed_at: "2026-10-12T03:00:00.000Z" },
      content: { status: "validated", page_ids: pages.map((page) => page.page_id), reviewed_at: "2026-10-12T03:00:00.000Z" },
    },
    pages,
    unresolved: [],
  }, null, 2)}\n`);
}

function writeReport(project: string): void {
  write(project, `${moduleRoot}/cross-validation-report.md`, `# Cross validation

REQ-001 FR-001 US-001 AC-001 PAGE-001
REQ-002 FR-002 US-002 AC-002 PAGE-002

## Machine consistency summary
- status: passed
- unresolved_conflicts: 0
- prd_route: not-selected
- ui_route: html-mock

## UI requirement freshness
- checked_at: 2026-10-12T03:20:00.000Z
- synchronized_pages: PAGE-002

## UI full acceptance
- run_id: UIA-001
- completed_at: 2026-10-12T03:21:00.000Z
- result: issues-found
- reviewed_pages: PAGE-001, PAGE-002
- issue_pages: PAGE-002

## UI targeted reverification UIT-001
- run_id: UIT-001
- completed_at: 2026-10-12T03:22:00.000Z
- result: passed
- pages: PAGE-002
`);
}

function setState(project: string, stage: "ui-page-planning" | "ui-mock-generation" | "cross-validation"): void {
  const state = loadWorkflowState(project) || createInitialState("feature", "4.13.2", "workflow-ui-governance", [], "Validate UI governance");
  state.current_phase = "inception";
  state.current_stage = stage;
  state.current_stage_instance = `${stage}@module:${moduleId}`;
  state.current_module = moduleId;
  state.completed_stages = ["workspace-detection", "module-division", "requirements-analysis", "user-stories", "ui-mock", "ui-page-planning", "ui-mock-generation"];
  state.completed_stage_instances = ["workspace-detection", "module-division", `requirements-analysis@module:${moduleId}`, `user-stories@module:${moduleId}`, `ui-mock@module:${moduleId}`, `ui-page-planning@module:${moduleId}`, `ui-mock-generation@module:${moduleId}`];
  if (!state.history.some((entry) => entry.stage === "ui-mock" && entry.module_id === moduleId)) {
    state.history.push({
      timestamp: "2026-10-12T03:00:00.000Z",
      stage: "ui-mock",
      instance_id: `ui-mock@module:${moduleId}`,
      module_id: moduleId,
      result: "completed",
      user_input: "html-mock",
    });
  }
  saveWorkflowState(project, state);
}

try {
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["config", "user.email", "aidlc@example.invalid"]);
  git(project, ["config", "user.name", "AI-DLC"]);
  write(project, `${moduleRoot}/requirements.md`, requirements());
  write(project, `${moduleRoot}/user-stories.md`, stories());
  write(project, `${moduleRoot}/ui-design/page-plan.md`, pagePlan());
  write(project, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules: [{ module_id: moduleId, name: "Module A", service_id: "service-a" }] }, null, 2)}\n`);
  write(project, "README.md", "UI governance fixture\n");
  const baselineCommit = commitAll(project, "baseline UI inputs");
  git(project, ["update-ref", "refs/remotes/origin/main", baselineCommit]);

  const lock = createUiGenerationLock(project, { moduleId, route: "html-mock", upstreamRef: "origin/main", now: "2026-10-12T03:10:00.000Z" });
  assert.equal(lock.upstream.commit, baselineCommit);
  assert.equal(lock.pages.length, 1);
  const lockCheck = verifyUiGenerationLockAtBaseline(project, moduleId, "html-mock", ["PAGE-001"]);
  assert.match(lockCheck.digest, /^[a-f0-9]{64}$/);

  setState(project, "ui-page-planning");
  const pagePlanGate = run(project, ["check", "--sensor", "ui-artifact-consistency", "--module", moduleId]);
  assert.equal(pagePlanGate.status, 0, `${pagePlanGate.stdout}\n${pagePlanGate.stderr}`);
  const pagePlanEvidence = JSON.parse(pagePlanGate.stdout) as Record<string, unknown>;
  assert.equal(pagePlanEvidence.ui_generation_lock_verified, true);
  const controlledPagePlan = run(project, ["evidence", "run", "--stage", "ui-page-planning"]);
  assert.equal(controlledPagePlan.status, 0, `${controlledPagePlan.stdout}\n${controlledPagePlan.stderr}`);

  write(project, `${moduleRoot}/requirements.md`, requirements(true));
  write(project, `${moduleRoot}/user-stories.md`, stories(true));
  write(project, `${moduleRoot}/ui-design/page-plan.md`, pagePlan(true));
  writeHtmlArtifacts(project, true);
  writeReport(project);
  const currentCommit = commitAll(project, "upstream requirement and UI update");
  git(project, ["update-ref", "refs/remotes/origin/main", currentCommit]);

  const acceptance = createUiGenerationAcceptance(project, {
    moduleId,
    route: "html-mock",
    reportPath: `${moduleRoot}/cross-validation-report.md`,
  });
  assert.equal(acceptance.freshness.baseline_upstream_commit, baselineCommit);
  assert.equal(acceptance.freshness.current_upstream_commit, currentCommit);
  assert.deepEqual(acceptance.freshness.impact_matrix.affected_pages, ["PAGE-002"]);
  assert.equal(acceptance.freshness.impact_matrix.all_changes_mapped, true);
  assert.equal(acceptance.full_acceptance.result, "issues-found");
  assert.equal(acceptance.targeted_reverifications.length, 1);

  const verified = verifyUiGenerationAcceptance(project, moduleId, "html-mock", ["PAGE-001", "PAGE-002"]);
  assert.equal(verified.full_acceptance_runs, 1);
  assert.equal(verified.targeted_reverification_runs, 1);
  assert.deepEqual(verified.affected_pages, ["PAGE-002"]);

  setState(project, "ui-mock-generation");
  const controlledGeneration = run(project, ["evidence", "run", "--stage", "ui-mock-generation"]);
  assert.equal(controlledGeneration.status, 0, `${controlledGeneration.stdout}\n${controlledGeneration.stderr}`);

  assert.throws(
    () => createUiGenerationAcceptance(project, { moduleId, route: "html-mock", reportPath: `${moduleRoot}/cross-validation-report.md` }),
    /second full acceptance is forbidden/,
  );

  setState(project, "cross-validation");
  const crossGate = run(project, ["check", "--sensor", "inception-consistency", "--module", moduleId]);
  assert.equal(crossGate.status, 0, `${crossGate.stdout}\n${crossGate.stderr}`);
  const crossEvidence = JSON.parse(crossGate.stdout) as Record<string, unknown>;
  assert.equal(crossEvidence.ui_freshness_verified, true);
  assert.equal(crossEvidence.ui_full_acceptance_runs, 1);
  assert.equal(crossEvidence.ui_impact_unmapped, 0);

  const controlled = run(project, ["evidence", "run", "--stage", "cross-validation"]);
  assert.equal(controlled.status, 0, `${controlled.stdout}\n${controlled.stderr}`);
  const controlledPath = join(project, ".aidlc/evidence/cross-validation/module-a/inception-consistency.json");
  const controlledEvidence = JSON.parse(readFileSync(controlledPath, "utf8")) as Record<string, unknown>;
  assert.equal((controlledEvidence.producer as Record<string, unknown>).mode, "controlled");
  assert.equal(controlledEvidence.ui_freshness_verified, true);
  assert.equal(controlledEvidence.ui_full_acceptance_runs, 1);
  const reported = run(project, ["orchestrate", "report", "--stage", "cross-validation", "--result", "completed"]);
  assert.equal(reported.status, 0, `${reported.stdout}\n${reported.stderr}`);

  const pages = parseUiPagePlanContent(pagePlan(true));
  const missing = buildUiImpactMatrix(pages, { stories: ["US-999"] });
  assert.equal(missing.all_changes_mapped, false);
  assert.deepEqual(missing.unmapped_changes.stories, ["US-999"]);
  assert.deepEqual(missing.affected_pages, []);
  const missingAc = buildUiImpactMatrix(pages, { acs: ["AC-999"] });
  assert.equal(missingAc.all_changes_mapped, false);
  assert.deepEqual(missingAc.unmapped_changes.acs, ["AC-999"]);

  const missingCli = run(repository, ["ui", "dry-run", "--pages", "3", "--changed-stories", "US-999"]);
  assert.notEqual(missingCli.status, 0);
  assert.match(`${missingCli.stdout}\n${missingCli.stderr}`, /unmapped|no page mapping/i);

  write(project, `${moduleRoot}/user-stories.md`, stories(true, "\n上游在最终验收后又修改了详情规则。"));
  const advancedCommit = commitAll(project, "advance upstream after acceptance");
  git(project, ["update-ref", "refs/remotes/origin/main", advancedCommit]);
  assert.throws(
    () => verifyUiGenerationAcceptance(project, moduleId, "html-mock", ["PAGE-001", "PAGE-002"]),
    /does not match current source revisions|rerun the controlled 'ui accept'/,
  );
  const staleGate = run(project, ["check", "--sensor", "inception-consistency", "--module", moduleId]);
  assert.notEqual(staleGate.status, 0);
  assert.match(`${staleGate.stdout}\n${staleGate.stderr}`, /does not match current source revisions|UI generation acceptance/);

  assert.ok(readFileSync(join(project, `${moduleRoot}/ui-design/ui-generation-lock.json`), "utf8").includes(baselineCommit));
  console.log("UI generation governance tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
