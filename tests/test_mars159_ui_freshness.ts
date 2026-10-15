/**
 * MARS-159 A: UI lock / acceptance freshness no longer compares the repository-level
 * upstream pointer. Unrelated commits advancing origin/main keep an accepted module valid;
 * real source changes go through the controlled, append-only `ui refresh` / `ui reverify`
 * checkpoint chain; tampering and unmapped changes fail closed; full acceptance stays single.
 */
import assert from "node:assert/strict";
import { designResourceStyle, resolveDesignResource } from "../core/tools/aidlc-design-resource";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import {
  createUiGenerationAcceptance,
  createUiGenerationLock,
  refreshUiGenerationFreshness,
  reverifyUiGenerationFreshness,
  uiGenerationCheckpointsPath,
  verifyUiGenerationAcceptance,
  verifyUiGenerationLockAtBaseline,
} from "../core/tools/aidlc-ui-governance";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars159-ui-"));
const moduleId = "module-a";
const moduleRoot = `docs/aidlc/modules/${moduleId}/inception`;
const reportPath = `${moduleRoot}/cross-validation-report.md`;
const PAGES = ["PAGE-001", "PAGE-002"];

function write(project: string, path: string, content: string): void {
  const target = join(project, path);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, path.endsWith(".html") ? `<head>${designResourceStyle(resolveDesignResource(project, moduleId))}</head>${content}` : content, "utf8");
}

function git(project: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
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

const pagePlan = `# UI 页面计划

## 页面清单
| ID | 端 | 页面名称 | 类型 | 来源 | 改造基础 | 目标代码文件 | 角色与权限 | 状态差异 |
|----|----|----------|------|------|----------|--------------|------------|----------|
| PAGE-001 | Web | 首页 | 新增页面 | REQ-001 FR-001 US-001 AC-001 | — | 待 Construction 确定 | 用户 | 默认 |
| PAGE-002 | Web | 详情 | 新增页面 | REQ-002 FR-002 US-002 AC-002 | — | 待 Construction 确定 | 用户 | 默认 |

## 页面内容契约
| 页面 ID | 可见字段/组件 | 输入与展示约束 | 条件可见性 | 来源引用 |
|---------|---------------|----------------|------------|----------|
| PAGE-001 | 标题 | 必填 | 始终 | REQ-001 FR-001 US-001 AC-001 |
| PAGE-002 | 详情 | 只读 | 始终 | REQ-002 FR-002 US-002 AC-002 |

## 操作闭环
| 来源页面 | 按钮/入口 | 目标页面或反馈 | 来源引用 |
|----------|-----------|----------------|----------|
| PAGE-001 | 查看 | PAGE-001 | US-001 |
| PAGE-002 | 关闭 | 原地反馈 | US-002 |

## 跨端数据流
| 产生端/页面 | 数据或动作 | 消费端/页面 | 来源引用 |
|-------------|------------|-------------|----------|
| PAGE-001 | 查看 | PAGE-001 | US-001 |

## 未决项
无
`;

const requirements = `# Requirements

## REQ-001 FR-001
首页必须展示可验证内容。

## REQ-002 FR-002
详情页必须展示新增业务字段。
`;

function stories(drift = "", extra = ""): string {
  return `# Stories

## US-001
来源: FR-001
用户可以查看首页。

### AC-001
首页显示成功。

## US-002
来源: FR-002
用户可以查看详情。${drift}

### AC-002
详情字段显示成功。
${extra}`;
}

function writeHtmlArtifacts(project: string): void {
  write(project, `${moduleRoot}/ui-mock/web-page-specs.md`, "# Specs\nPAGE-001\nPAGE-002\n");
  write(project, `${moduleRoot}/ui-mock/page-001.html`, `<main id="mock-PAGE-001"><h1>PAGE-001</h1><button>查看</button></main>\n`);
  write(project, `${moduleRoot}/ui-mock/page-002.html`, `<main id="mock-PAGE-002"><h1>PAGE-002</h1><button>返回</button></main>\n`);
  const pages = PAGES.map((pageId, index) => ({
    page_id: pageId,
    page_specs: `${moduleRoot}/ui-mock/web-page-specs.md`,
    html: `${moduleRoot}/ui-mock/page-00${index + 1}.html`,
    mock_box_id: `mock-${pageId}`,
    requirements: [`REQ-00${index + 1}`],
    stories: [`US-00${index + 1}`],
  }));
  write(project, `${moduleRoot}/ui-mock/ui-mock-manifest.json`, `${JSON.stringify({
    schema_version: "1",
    design_mode: "html-mock",
    page_plan: `${moduleRoot}/ui-design/page-plan.md`,
    phases: {
      skeleton: { status: "validated", page_ids: PAGES, reviewed_at: "2026-10-12T03:00:00.000Z" },
      content: { status: "validated", page_ids: PAGES, reviewed_at: "2026-10-12T03:00:00.000Z" },
    },
    pages,
    unresolved: [],
  }, null, 2)}\n`);
}

const baseReport = `# Cross validation

REQ-001 FR-001 US-001 AC-001 PAGE-001
REQ-002 FR-002 US-002 AC-002 PAGE-002

## Machine consistency summary
- status: passed
- unresolved_conflicts: 0
- prd_route: not-selected
- ui_route: html-mock

## UI requirement freshness
- checked_at: 2026-10-12T03:20:00.000Z
- synchronized_pages: none

## UI full acceptance
- run_id: UIA-001
- completed_at: 2026-10-12T03:21:00.000Z
- result: passed
- reviewed_pages: PAGE-001, PAGE-002
- issue_pages: none
`;

function reverificationSection(runId: string, pages: string): string {
  return `\n## UI freshness reverification ${runId}\n- run_id: ${runId}\n- completed_at: 2026-10-13T03:00:00.000Z\n- result: passed\n- pages: ${pages}\n`;
}

function setCrossValidationState(project: string): void {
  const state = loadWorkflowState(project) || createInitialState("feature", "4.13.2", "workflow-mars159-ui", [], "MARS-159 UI freshness");
  state.current_phase = "inception";
  state.current_stage = "cross-validation";
  state.current_stage_instance = `cross-validation@module:${moduleId}`;
  state.current_module = moduleId;
  state.completed_stages = ["workspace-detection", "module-division", "requirements-analysis", "user-stories", "ui-mock", "ui-page-planning", "ui-mock-generation"];
  state.completed_stage_instances = ["workspace-detection", "module-division", `requirements-analysis@module:${moduleId}`, `user-stories@module:${moduleId}`, `ui-mock@module:${moduleId}`, `ui-page-planning@module:${moduleId}`, `ui-mock-generation@module:${moduleId}`];
  if (!state.history.some((entry) => entry.stage === "ui-mock" && entry.module_id === moduleId)) {
    state.history.push({ timestamp: "2026-10-12T03:00:00.000Z", stage: "ui-mock", instance_id: `ui-mock@module:${moduleId}`, module_id: moduleId, result: "completed", user_input: "html-mock" });
  }
  saveWorkflowState(project, state);
}

try {
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["config", "core.autocrlf", "false"]);
  write(project, `${moduleRoot}/requirements.md`, requirements);
  write(project, `${moduleRoot}/user-stories.md`, stories());
  write(project, `${moduleRoot}/ui-design/page-plan.md`, pagePlan);
  write(project, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules: [{ module_id: moduleId, name: "Module A", service_id: "service-a" }] }, null, 2)}\n`);
  write(project, "README.md", "MARS-159 fixture\n");
  writeHtmlArtifacts(project);
  write(project, reportPath, baseReport);
  const c0 = commitAll(project, "UI inputs");
  git(project, ["update-ref", "refs/remotes/origin/main", c0]);

  createUiGenerationLock(project, { moduleId, route: "html-mock", now: "2026-10-12T03:10:00.000Z" });
  createUiGenerationAcceptance(project, { moduleId, route: "html-mock", reportPath });
  commitAll(project, "lock and accept");

  // 1. Unrelated module advances origin/main: lock and acceptance stay valid, no second accept.
  write(project, "docs/aidlc/modules/module-b/inception/requirements.md", "# B\n## REQ-B01\nunrelated\n");
  const c1 = commitAll(project, "module-b merged to main");
  git(project, ["update-ref", "refs/remotes/origin/main", c1]);
  const lockCheck = verifyUiGenerationLockAtBaseline(project, moduleId, "html-mock", PAGES);
  assert.equal(lockCheck.upstream_commit, c0);
  assert.equal(lockCheck.observed_upstream_commit, c1);
  assert.equal(lockCheck.superseded_by_acceptance, false);
  const pointerOnly = verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES);
  assert.equal(pointerOnly.current_upstream_commit, c0, "effective upstream stays the recorded one");
  assert.equal(pointerOnly.observed_upstream_commit, c1, "the live pointer is an audit observation");
  assert.equal(pointerOnly.full_acceptance_runs, 1);

  setCrossValidationState(project);
  const crossGate = run(project, ["check", "--sensor", "inception-consistency", "--module", moduleId]);
  assert.equal(crossGate.status, 0, `inception-consistency after pointer-only drift\n${crossGate.stdout}\n${crossGate.stderr}`);
  assert.equal((JSON.parse(crossGate.stdout) as Record<string, unknown>).ui_freshness_verified, true);

  // 2. `ui refresh` appends a pointer-only checkpoint; repeated refresh is a no-op.
  const refreshed = run(project, ["ui", "refresh", "--module", moduleId, "--route", "html-mock"]);
  assert.equal(refreshed.status, 0, `${refreshed.stdout}\n${refreshed.stderr}`);
  const refreshedJson = JSON.parse(refreshed.stdout) as Record<string, unknown>;
  assert.equal(refreshedJson.status, "refreshed");
  assert.equal(refreshedJson.sequence, 1);
  assert.equal(refreshedJson.current_upstream_commit, c1);
  assert.equal(refreshUiGenerationFreshness(project, { moduleId, route: "html-mock" }).status, "unchanged");
  const afterRefresh = verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES);
  assert.equal(afterRefresh.freshness_checkpoints, 1);
  assert.equal(afterRefresh.current_upstream_commit, c1);

  // 3. A hand-edited checkpoint fails closed.
  const checkpointsFile = join(project, uiGenerationCheckpointsPath(moduleId));
  const pristine = readFileSync(checkpointsFile, "utf8");
  writeFileSync(checkpointsFile, pristine.replace(/"created_at": "[^"]+"/, '"created_at": "2020-01-01T00:00:00.000Z"'), "utf8");
  assert.throws(() => verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES), /digest does not match its content/);
  writeFileSync(checkpointsFile, pristine, "utf8");

  // 4. A hand-edited acceptance fails closed (chain no longer links to it).
  const acceptanceFile = join(project, `${moduleRoot}/ui-design/ui-generation-acceptance.json`);
  const acceptanceText = readFileSync(acceptanceFile, "utf8");
  writeFileSync(acceptanceFile, acceptanceText.replace("2026-10-12T03:20:00.000Z", "2026-10-12T03:20:01.000Z"), "utf8");
  assert.throws(() => verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES), /acceptance digest mismatch|does not match/);
  writeFileSync(acceptanceFile, acceptanceText, "utf8");
  verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES);

  // 5. A mapped source change is not pointer-only: verify fails, refresh refuses, reverify
  //    must cover exactly the affected page.
  write(project, `${moduleRoot}/user-stories.md`, stories("\n详情新增退款字段。"));
  assert.throws(() => verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES), /does not match current source revisions/);
  assert.throws(() => refreshUiGenerationFreshness(project, { moduleId, route: "html-mock" }), /use 'ui reverify'/);
  assert.throws(() => reverifyUiGenerationFreshness(project, { moduleId, route: "html-mock", reportPath }), /exactly one new '## UI freshness reverification/);
  write(project, reportPath, baseReport + reverificationSection("UIF-001", "PAGE-001, PAGE-002"));
  assert.throws(() => reverifyUiGenerationFreshness(project, { moduleId, route: "html-mock", reportPath }), /must exactly match affected pages: PAGE-002/);
  write(project, reportPath, baseReport + reverificationSection("UIF-001", "PAGE-002"));
  const reverified = run(project, ["ui", "reverify", "--module", moduleId, "--route", "html-mock", "--review-report", reportPath]);
  assert.equal(reverified.status, 0, `${reverified.stdout}\n${reverified.stderr}`);
  const reverifiedJson = JSON.parse(reverified.stdout) as Record<string, unknown>;
  assert.deepEqual(reverifiedJson.affected_pages, ["PAGE-002"]);
  assert.deepEqual(reverifiedJson.unaffected_pages, ["PAGE-001"], "unaffected pages are neither regenerated nor reviewed");
  assert.equal(reverifiedJson.sequence, 2);
  const afterReverify = verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES);
  assert.equal(afterReverify.full_acceptance_runs, 1);
  assert.equal(afterReverify.freshness_checkpoints, 2);
  assert.equal(afterReverify.targeted_reverification_runs, 1);
  assert.ok(afterReverify.affected_pages.includes("PAGE-002"));
  assert.equal(verifyUiGenerationLockAtBaseline(project, moduleId, "html-mock", PAGES).superseded_by_acceptance, true);

  // 6. The reviewed section cannot be edited after the checkpoint.
  const reportText = readFileSync(join(project, reportPath), "utf8");
  write(project, reportPath, reportText.replace("- completed_at: 2026-10-13T03:00:00.000Z", "- completed_at: 2026-10-13T04:00:00.000Z"));
  assert.throws(() => verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES), /changed after the checkpoint was recorded/);
  write(project, reportPath, reportText);

  // 7. This module's own branch merged into main: upstream converged onto the accepted
  //    local content, which is not drift.
  const c2 = commitAll(project, "module-a story change merged");
  git(project, ["update-ref", "refs/remotes/origin/main", c2]);
  verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES);

  // 8. Real upstream drift of a locked source (another edit on main) fails closed.
  git(project, ["checkout", "-q", "-b", "other-edit"]);
  write(project, `${moduleRoot}/user-stories.md`, stories("\n详情新增退款字段。\n上游又改了详情规则。"));
  const drifted = commitAll(project, "someone else edits module-a stories");
  git(project, ["checkout", "-q", "-"]);
  git(project, ["update-ref", "refs/remotes/origin/main", drifted]);
  assert.throws(() => verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES), /changed locked UI sources/);
  git(project, ["update-ref", "refs/remotes/origin/main", c2]);
  verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES);

  // 9. Unmapped change (a story no page covers) fails closed for reverify.
  write(project, `${moduleRoot}/user-stories.md`, stories("\n详情新增退款字段。", "\n## US-999\n来源: FR-009\n无页面映射的新故事。\n"));
  write(project, reportPath, reportText + reverificationSection("UIF-002", "PAGE-002"));
  assert.throws(() => reverifyUiGenerationFreshness(project, { moduleId, route: "html-mock", reportPath }), /unmapped requirement changes \(.*stories: US-999\)/);
  assert.throws(() => verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES), /does not match current source revisions/);
  write(project, `${moduleRoot}/user-stories.md`, stories("\n详情新增退款字段。"));
  write(project, reportPath, reportText);
  verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES);

  // 10. Full acceptance remains single.
  assert.throws(() => createUiGenerationAcceptance(project, { moduleId, route: "html-mock", reportPath }), /second full acceptance is forbidden/);

  console.log("MARS-159 UI freshness tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
