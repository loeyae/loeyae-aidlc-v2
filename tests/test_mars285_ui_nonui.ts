import { createUiGenerationAcceptance, createUiGenerationLock, reverifyUiGenerationFreshness } from "./mars244_fixture_writers";
import { fixtureEnvironment, saveFixtureState as saveWorkflowState } from "./mars243_fixture_session";
/**
 * MARS-285: post-acceptance non-UI changes have a legal path. The page-plan '## 非UI映射'
 * (non-UI mapping) section registers REQ/FR/US/STORY/AC ids that deliberately map to no page;
 * registered changes become the auditable `non_ui_changes` state instead of `unmapped_changes`,
 * pass `ui accept`/`ui reverify`, and a targeted reverification must bind exactly those ids.
 * Unregistered ids keep failing closed; pre-registry (legacy) checkpoint records still verify.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { designResourceStyle, resolveDesignResource } from "../core/tools/aidlc-design-resource";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { buildUiImpactMatrix, canonicalJson, parseNonUiDeclarations, readUiPagePlan, uiGenerationCheckpointsPath, verifyUiGenerationAcceptance } from "../core/tools/aidlc-ui-governance";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars285-ui-"));
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
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8", env: fixtureEnvironment(project, args) });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

const pagePlanHead = `# UI 页面计划

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
`;

function pagePlan(registry: string[]): string {
  if (registry.length === 0) return `${pagePlanHead}\n## 未决项\n无\n`;
  return `${pagePlanHead}
## 非UI映射
| 编号 | 理由 | 登记人 |
|------|------|--------|
| ${registry[0]} | 库存逻辑措辞修正，不涉及任何界面 | loeye |
${registry.slice(1).map((row) => `| ${row} | 与上述措辞修正同批回写，不涉及界面 | loeye |`).join("\n")}

## 未决项
无
`;
}

function requirements(nonUi = false, unregistered = false): string {
  return `# Requirements

## REQ-001 FR-001
首页必须展示可验证内容。

## REQ-002 FR-002
详情页必须展示新增业务字段。
${nonUi ? "\n## REQ-003 FR-003\n库存逻辑措辞修正，不涉及任何界面。\n" : ""}${unregistered ? "\n## REQ-004\n未登记的非 UI 措辞修正。\n" : ""}`;
}

function stories(drift = "", nonUi = false): string {
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
${nonUi ? `\n## US-003\n来源: FR-003\n库存口径的措辞修正，不涉及界面。\n\n### AC-003\n库存口径修正后的验收描述保持不变。\n` : ""}`;
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

function reverificationSection(runId: string, pages: string, nonUiChanges?: string): string {
  return `\n## UI freshness reverification ${runId}\n- run_id: ${runId}\n- completed_at: 2026-10-14T03:00:00.000Z\n- result: passed\n- pages: ${pages}${nonUiChanges === undefined ? "" : `\n- non_ui_changes: ${nonUiChanges}`}\n`;
}

function setCrossValidationState(project: string): void {
  const state = loadWorkflowState(project) || createInitialState("feature", "4.13.2", "workflow-mars285-ui", [], "MARS-285 non-UI registry");
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

try {
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["config", "core.autocrlf", "false"]);
  write(project, `${moduleRoot}/requirements.md`, requirements());
  write(project, `${moduleRoot}/user-stories.md`, stories());
  write(project, `${moduleRoot}/ui-design/page-plan.md`, pagePlan([]));
  write(project, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules: [{ module_id: moduleId, name: "Module A", service_id: "service-a" }] }, null, 2)}\n`);
  write(project, "README.md", "MARS-285 fixture\n");
  writeHtmlArtifacts(project);
  write(project, reportPath, baseReport);
  const c0 = commitAll(project, "UI inputs");
  git(project, ["update-ref", "refs/remotes/origin/main", c0]);

  createUiGenerationLock(project, { moduleId, route: "html-mock", now: "2026-10-12T03:10:00.000Z" });
  createUiGenerationAcceptance(project, { moduleId, route: "html-mock", reportPath });
  commitAll(project, "lock and accept");
  verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES);

  // 1. Unit behaviour: registered ids leave `unmapped_changes` and land in `non_ui_changes`.
  const declared = ["REQ-003", "FR-003", "US-003", "AC-003"];
  const matrix = buildUiImpactMatrix(readUiPagePlan(project, `${moduleRoot}/ui-design/page-plan.md`), { requirements: ["REQ-003", "FR-003", "REQ-999"], stories: ["US-003"], acs: ["AC-003"] }, declared);
  assert.equal(matrix.all_changes_mapped, false, "REQ-999 is not registered");
  assert.deepEqual(matrix.unmapped_changes.requirements, ["REQ-999"]);
  assert.deepEqual(matrix.non_ui_changes.requirements, ["FR-003", "REQ-003"]);
  assert.deepEqual(matrix.non_ui_changes.stories, ["US-003"]);
  assert.deepEqual(matrix.non_ui_changes.acs, ["AC-003"]);
  assert.deepEqual(parseNonUiDeclarations(pagePlan(declared)), ["AC-003", "FR-003", "REQ-003", "US-003"]);
  assert.throws(() => parseNonUiDeclarations("## 非UI映射\n| PAGE-001 | 已有页面被误登记 | loeye |\n"), /must not declare page ids/);

  // 2. A mapped change first (control): the classic reverify path is untouched — including the
  //    first reverification with zero prior checkpoints, which used to deadlock before MARS-285.
  write(project, `${moduleRoot}/user-stories.md`, stories("\n详情新增退款字段。"));
  assert.throws(() => verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES), /does not match current source revisions/);
  write(project, reportPath, baseReport + reverificationSection("UIF-001", "PAGE-002"));
  const mapped = run(project, ["ui", "reverify", "--module", moduleId, "--route", "html-mock", "--review-report", reportPath]);
  assert.equal(mapped.status, 0, `${mapped.stdout}\n${mapped.stderr}`);
  const mappedJson = JSON.parse(mapped.stdout) as Record<string, unknown>;
  assert.deepEqual((mappedJson.non_ui_changes as string[]) ?? [], [], "mapped reverifications carry no non-UI binding");

  // 3. Legacy tolerance: a checkpoint record shaped before MARS-285 (no non_ui fields at all)
  //    still verifies after re-digesting its canonical body.
  const checkpointsFile = join(project, uiGenerationCheckpointsPath(moduleId));
  const legacyCheckpoints = JSON.parse(readFileSync(checkpointsFile, "utf8")) as { checkpoints: Array<Record<string, unknown>> };
  const legacyCheckpoint = legacyCheckpoints.checkpoints[0];
  delete (legacyCheckpoint.impact_matrix as Record<string, unknown>).non_ui_changes;
  delete (legacyCheckpoint.review as Record<string, unknown>).non_ui_changes;
  delete (legacyCheckpoint.baseline as Record<string, unknown>).non_ui_ids;
  delete (legacyCheckpoint.current as Record<string, unknown>).non_ui_ids;
  const { digest: _legacyDigest, ...legacyBody } = legacyCheckpoint;
  legacyCheckpoint.digest = sha256(canonicalJson(legacyBody));
  writeFileSync(checkpointsFile, `${JSON.stringify(legacyCheckpoints, null, 2)}\n`, "utf8");
  verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES);

  // 4. The MARS-285 scenario: rewrite requirement text that maps to no page, register the ids
  //    in the page-plan '## 非UI映射' section, and reverify with a review that binds them.
  const registry = ["REQ-003 FR-003", "US-003 AC-003"];
  write(project, `${moduleRoot}/requirements.md`, requirements(true));
  write(project, `${moduleRoot}/user-stories.md`, stories("\n详情新增退款字段。", true));
  write(project, `${moduleRoot}/ui-design/page-plan.md`, pagePlan(registry));
  assert.throws(() => verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES), /does not match current source revisions/);
  assert.throws(() => reverifyUiGenerationFreshness(project, { moduleId, route: "html-mock", reportPath }), /exactly one new '## UI freshness reverification/);
  write(project, reportPath, baseReport + reverificationSection("UIF-001", "PAGE-002") + reverificationSection("UIF-002", "none", "REQ-003, FR-003, US-003, AC-003"));
  const nonUi = run(project, ["ui", "reverify", "--module", moduleId, "--route", "html-mock", "--review-report", reportPath]);
  assert.equal(nonUi.status, 0, `${nonUi.stdout}\n${nonUi.stderr}`);
  const nonUiJson = JSON.parse(nonUi.stdout) as Record<string, unknown>;
  assert.deepEqual(nonUiJson.non_ui_changes, ["AC-003", "FR-003", "REQ-003", "US-003"], "ids are reported in canonical sorted order");
  assert.deepEqual(nonUiJson.affected_pages, [], "registered non-UI changes affect no page");
  assert.equal(nonUiJson.review_run_id, "UIF-002");
  const verifiedNonUi = verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES);
  assert.equal(verifiedNonUi.freshness_checkpoints, 2);
  assert.equal(verifiedNonUi.targeted_reverification_runs, 2);
  const recorded = JSON.parse(readFileSync(checkpointsFile, "utf8")) as { checkpoints: Array<{ impact_matrix: { non_ui_changes: { requirements: string[]; stories: string[]; acs: string[] } }; review: { run_id: string; non_ui_changes?: string[] } }> };
  const nonUiCheckpoint = recorded.checkpoints[1];
  assert.deepEqual(nonUiCheckpoint.impact_matrix.non_ui_changes.requirements, ["FR-003", "REQ-003"]);
  assert.deepEqual(nonUiCheckpoint.impact_matrix.non_ui_changes.stories, ["US-003"]);
  assert.deepEqual(nonUiCheckpoint.impact_matrix.non_ui_changes.acs, ["AC-003"]);
  assert.equal(nonUiCheckpoint.review.run_id, "UIF-002");
  assert.deepEqual(nonUiCheckpoint.review.non_ui_changes, ["AC-003", "FR-003", "REQ-003", "US-003"], "the checkpoint records the review binding to the exact non-UI ids");

  setCrossValidationState(project);
  const crossGate = run(project, ["check", "--sensor", "inception-consistency", "--module", moduleId]);
  assert.equal(crossGate.status, 0, `inception-consistency after a registered non-UI reverify\n${crossGate.stdout}\n${crossGate.stderr}`);
  assert.equal((JSON.parse(crossGate.stdout) as Record<string, unknown>).ui_freshness_verified, true);

  // 5. Unregistered ids still fail closed, with a message that matches the implemented registry.
  write(project, `${moduleRoot}/requirements.md`, requirements(true, true));
  write(project, reportPath, baseReport + reverificationSection("UIF-001", "PAGE-002") + reverificationSection("UIF-002", "none", "REQ-003, FR-003, US-003, AC-003") + reverificationSection("UIF-003", "none", "REQ-003, FR-003, US-003, AC-003, REQ-004"));
  assert.throws(() => reverifyUiGenerationFreshness(project, { moduleId, route: "html-mock", reportPath }), /unmapped requirement changes \(.*requirements: REQ-004\); map them to pages in the page-plan or register them in its '## 非UI映射' \(non-UI mapping\) section before reverification/);

  // 6. A registration without the matching review binding is rejected.
  write(project, `${moduleRoot}/ui-design/page-plan.md`, pagePlan([...registry, "REQ-004"]));
  write(project, reportPath, baseReport + reverificationSection("UIF-001", "PAGE-002") + reverificationSection("UIF-002", "none", "REQ-003, FR-003, US-003, AC-003") + reverificationSection("UIF-003", "none"));
  assert.throws(() => reverifyUiGenerationFreshness(project, { moduleId, route: "html-mock", reportPath }), /non_ui_changes must exactly match the registered non-UI changes: REQ-004/);

  // 7. With the binding in place the second non-UI reverify passes and the section is frozen.
  write(project, reportPath, baseReport + reverificationSection("UIF-001", "PAGE-002") + reverificationSection("UIF-002", "none", "REQ-003, FR-003, US-003, AC-003") + reverificationSection("UIF-003", "none", "REQ-004"));
  assert.equal(reverifyUiGenerationFreshness(project, { moduleId, route: "html-mock", reportPath }).sequence, 3);
  verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES);
  const frozenReport = readFileSync(join(project, reportPath), "utf8");
  write(project, reportPath, frozenReport.replace("- non_ui_changes: REQ-004", "- non_ui_changes: REQ-004, REQ-003"));
  assert.throws(() => verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES), /changed after the checkpoint was recorded/);
  write(project, reportPath, frozenReport);
  verifyUiGenerationAcceptance(project, moduleId, "html-mock", PAGES);

  // 8. The impact-matrix CLI honours the registry and the declaration cannot cover pages.
  const matrixCli = run(project, ["ui", "impact-matrix", "--module", moduleId, "--page-plan", `${moduleRoot}/ui-design/page-plan.md`, "--changed-requirements", "REQ-004,REQ-999"]);
  assert.notEqual(matrixCli.status, 0);
  assert.match(`${matrixCli.stdout}\n${matrixCli.stderr}`, /REQ-999/);
  const registeredCli = run(project, ["ui", "impact-matrix", "--module", moduleId, "--page-plan", `${moduleRoot}/ui-design/page-plan.md`, "--changed-requirements", "REQ-004"]);
  assert.equal(registeredCli.status, 0, `${registeredCli.stdout}\n${registeredCli.stderr}`);
  assert.match(registeredCli.stdout, /已登记非UI变化：REQ-004/);

  console.log("MARS-285 non-UI registry tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
