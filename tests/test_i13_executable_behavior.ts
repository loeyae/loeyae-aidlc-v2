import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { EXECUTABLE_BEHAVIOR, hasExecutableBehavior } from "../core/tools/aidlc-executable-behavior";

// Regression: I13 used `\b(?:...|验收|...)`; `\b` is an ASCII word boundary, so Chinese
// keywords preceded by Chinese text, punctuation, a space or line start never matched.
// A valid non-applicable.json now takes precedence over the keyword check.

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-i13-behavior-"));
const MODULE = "project";

const VALID_EXEMPTION = {
  schema_version: "1",
  status: "not_applicable",
  reason_code: "pure-declaration",
  reason: "模块仅包含声明",
  approval_ref: "APPROVAL-1",
  alternative_validation: "schema lint",
  validation_command: "npm run lint",
  source_refs: ["docs/aidlc/modules/project/inception/requirements.md"],
};

type Fixture = { requirements?: string; cases?: boolean; exemption?: string | Record<string, unknown> };

function run(project: string, args: string[]): { status: number; output: string; stdout: string } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout || "", output: `${result.stdout || ""}\n${result.stderr || ""}` };
}

let counter = 0;
function makeProject(fixture: Fixture): string {
  const project = join(scratch, `p${++counter}`);
  const inception = join(project, "docs", "aidlc", "modules", MODULE, "inception");
  const cases = join(inception, "application-design", "test-cases");
  mkdirSync(cases, { recursive: true });
  writeFileSync(join(project, "README.md"), "I13 executable behavior regression\n", "utf8");
  if (fixture.requirements !== undefined) writeFileSync(join(inception, "requirements.md"), fixture.requirements, "utf8");
  if (fixture.cases) {
    writeFileSync(join(cases, "_index.md"), "# UC-D index\n- UC-D-001 订单导出\n", "utf8");
    writeFileSync(join(cases, "UC-D-001-export.md"), "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001 订单导出\n", "utf8");
  }
  if (fixture.exemption !== undefined) {
    const body = typeof fixture.exemption === "string" ? fixture.exemption : JSON.stringify(fixture.exemption);
    writeFileSync(join(cases, "non-applicable.json"), body, "utf8");
  }
  const state = createInitialState("express", "4.5.0", `workflow-${counter}`, [], "I13 executable behavior regression");
  state.completed_stages = ["workspace-detection", "state-template"];
  state.completed_stage_instances = ["workspace-detection", "state-template"];
  state.current_stage = "test-case-derivation";
  state.current_phase = "inception";
  state.current_stage_instance = `test-case-derivation@module:${MODULE}`;
  state.current_module = MODULE;
  saveWorkflowState(project, state);
  return project;
}

function check(fixture: Fixture, sensor = "test-case-derivation"): { status: number; output: string; evidence: Record<string, unknown> | null; project: string } {
  const project = makeProject(fixture);
  const result = run(project, ["check", "--sensor", sensor, "--module", MODULE]);
  let evidence: Record<string, unknown> | null = null;
  try { evidence = JSON.parse(result.stdout) as Record<string, unknown>; } catch { evidence = null; }
  return { status: result.status, output: result.output, evidence, project };
}

function expectRequired(fixture: Fixture, label: string): void {
  const result = check(fixture);
  assert.equal(result.status, 0, `${label}: ${result.output}`);
  assert.equal(result.evidence?.status, "required", `${label}: ${result.output}`);
}

function expectNotApplicable(fixture: Fixture, label: string): Record<string, unknown> {
  const result = check(fixture);
  assert.equal(result.status, 0, `${label}: ${result.output}`);
  assert.equal(result.evidence?.status, "not_applicable", `${label}: ${result.output}`);
  return result.evidence as Record<string, unknown>;
}

function expectFailure(fixture: Fixture, pattern: RegExp, label: string): void {
  const result = check(fixture);
  assert.notEqual(result.status, 0, `${label}: expected failure, got ${result.output}`);
  assert.match(result.output, pattern, label);
  assert.notEqual(result.evidence?.status, "required", `${label}: must not fall back to required`);
}

try {
  // 1. Unit: English matching is identical to the original regex.
  const ORIGINAL = /\b(?:Given|When|Then|Scenario|API|endpoint|接口|业务行为|业务规则|状态转换|验收|service method|可执行)/i;
  const english = ["Given x", "API", "APIs", "REST endpoints", "Scenarios", "Thenceforth", "myAPI", "service method call", "when ready"];
  for (const input of english) assert.equal(hasExecutableBehavior(input), ORIGINAL.test(input), `english parity: ${input}`);
  for (const input of ["Given x", "API", "APIs", "REST endpoints", "Scenarios", "Thenceforth"]) assert.ok(EXECUTABLE_BEHAVIOR.test(input), `english hit: ${input}`);
  assert.equal(hasExecutableBehavior("myAPI"), false);

  // 2. Unit: Chinese keywords match regardless of the preceding character.
  for (const input of ["验收标准", "需求：验收标准", "REQ-1 验收", "业务规则：A", "接口定义", "REQ-1验收"]) assert.ok(hasExecutableBehavior(input), `chinese hit: ${input}`);
  assert.equal(hasExecutableBehavior("纯声明配置"), false);

  // 3. E2E: Chinese-only behavior requirements reach the UC-D branch (no exemption).
  expectRequired({ requirements: "# Requirements\nREQ-1 订单导出：验收标准为导出在 30 秒内完成。\n", cases: true }, "中文标点 + 验收");
  expectRequired({ requirements: "# Requirements\n订单导出接口需要支持重试\n", cases: true }, "中文 + 接口");
  expectRequired({ requirements: "# Requirements\nREQ-1 业务规则 超时后重试\n", cases: true }, "空格 + 业务规则");
  expectRequired({ requirements: "验收标准为 30 秒内完成\n", cases: true }, "行首 + 验收");

  // 4. E2E negative: pure declaration without keywords still requires non-applicable.json.
  expectFailure({ requirements: "# Requirements\nREQ-1 纯声明配置\n" }, /I13 requires structured non-applicable evidence/, "纯声明无豁免");

  // 5. E2E: a valid exemption takes precedence over keywords.
  const negated = expectNotApplicable({ requirements: "# Requirements\n本模块不包含可执行业务行为\n", exemption: VALID_EXEMPTION }, "否定表述 + 豁免");
  assert.equal(negated.reason_code, VALID_EXEMPTION.reason_code);
  assert.equal(negated.approval_ref, VALID_EXEMPTION.approval_ref);
  assert.deepEqual(negated.source_refs, VALID_EXEMPTION.source_refs);
  assert.deepEqual(negated.test_case_files, []);
  expectNotApplicable({ requirements: "# Requirements\nREQ-1 订单导出验收\n", exemption: VALID_EXEMPTION }, "中文关键词 + 豁免");
  expectNotApplicable({ requirements: "# Requirements\nScenario: Given 订单 When 导出 Then 完成\n", exemption: VALID_EXEMPTION }, "英文关键词 + 豁免");
  expectNotApplicable({ requirements: "# Requirements\nREQ-1 订单导出验收\n", exemption: VALID_EXEMPTION, cases: true }, "豁免 + ready UC-D");

  // 6. E2E: an invalid exemption never falls back to the UC-D branch.
  const { approval_ref: _omitted, ...missingApproval } = VALID_EXEMPTION;
  expectFailure({ requirements: "# Requirements\nREQ-1验收\n", exemption: missingApproval, cases: true }, /non-applicable\.approval_ref must be a non-empty string/, "豁免缺 approval_ref");
  expectFailure({ requirements: "# Requirements\nREQ-1验收\n", exemption: { ...VALID_EXEMPTION, status: "required" }, cases: true }, /schema_version=1 and status=not_applicable/, "豁免 status 错误");
  expectFailure({ requirements: "# Requirements\nREQ-1验收\n", exemption: "{\"schema_version\": \"1\",", cases: true }, /is not valid JSON/, "豁免 JSON 截断");
  expectFailure({ requirements: "# Requirements\nREQ-1验收\n", exemption: "null", cases: true }, /must contain a JSON object/, "豁免为 null");
  expectFailure({ requirements: "# Requirements\nREQ-1验收\n", exemption: "[]", cases: true }, /must contain a JSON object/, "豁免为数组");

  // 7. E2E: negated wording without exemption or cases now reports the missing index.
  expectFailure({ requirements: "# Requirements\n本模块不包含可执行业务行为\n" }, /I13 requires test case index/, "否定表述无豁免无用例");

  // 8. E2E: the source-artifact precondition still runs first.
  expectFailure({ exemption: VALID_EXEMPTION }, /at least one requirement, story, application-design, or clarification source artifact/, "无源文件");

  // 9. E2E downstream: a not_applicable I13 keeps test-quality not_applicable.
  const exempt = check({ requirements: "# Requirements\nREQ-1 订单导出验收\n", exemption: VALID_EXEMPTION });
  assert.equal(exempt.evidence?.status, "not_applicable", exempt.output);
  const evidenceDir = join(exempt.project, ".aidlc", "evidence", "test-case-derivation", MODULE);
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "test-case-derivation.json"), JSON.stringify(exempt.evidence), "utf8");
  const quality = run(exempt.project, ["check", "--sensor", "test-quality", "--module", MODULE, "--unit", "unit-a"]);
  assert.equal(quality.status, 0, quality.output);
  assert.equal((JSON.parse(quality.stdout) as Record<string, unknown>).status, "not_applicable", quality.output);

  console.log("I13 executable behavior regression tests passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
