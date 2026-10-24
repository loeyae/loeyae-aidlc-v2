import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";
import { evidenceScopeForInstance, legacyEvidenceScopeForInstance } from "../core/tools/aidlc-workflow-layout";
import { readSourceRevision, revisionCacheStats, withRevisionMemoization } from "../core/tools/aidlc-revision";

// MARS-277 多单元并行回归:同一目录两个单元 session 独立推进(9 个场景),
// 以及受控迁移、越权拒绝与 revision 去重证据。

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars277-"));
const MODULE = "project";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" };

const timings: Array<{ label: string; ms: number }> = [];
let checks = 0;
function check(label: string, condition: unknown, detail?: string): void {
  checks++;
  assert.ok(condition, `${label}${detail ? `\n${detail}` : ""}`);
}

function git(project: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: project, encoding: "utf8", env: GIT_ENV });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return (result.stdout || "").trim();
}

function put(project: string, path: string, data: string): void {
  mkdirSync(join(project, path, ".."), { recursive: true });
  writeFileSync(join(project, path), data, "utf8");
}

function run(project: string, args: string[], binding?: unknown, label?: string): { status: number; stdout: string; stderr: string } {
  const started = Date.now();
  const result = spawnSync(process.execPath, [tsx, cli, ...args], {
    cwd: project,
    encoding: "utf8",
    env: { ...fixtureEnvironment(project, args), ...(binding ? { AIDLC_SESSION_BINDING: JSON.stringify(binding) } : {}) },
  });
  if (label) timings.push({ label, ms: Date.now() - started });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function runParallel(project: string, args: string[], binding: unknown, label: string): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const started = Date.now();
    const child = spawn(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8", env: { ...process.env, AIDLC_SESSION_BINDING: JSON.stringify(binding) } });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", fail);
    child.on("close", (status) => {
      timings.push({ label, ms: Date.now() - started });
      done({ status: status ?? 1, stdout, stderr });
    });
  });
}

function makeProject(name: string): string {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  put(project, "README.md", "MARS-277 parallel unit regression\n");
  git(project, ["init", "-q"]);
  git(project, ["config", "user.name", "AI-DLC"]);
  git(project, ["config", "user.email", "aidlc@example.invalid"]);
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-qm", "base"]);
  const state = createInitialState("express", "4.22.12", `workflow-${name}`, [], "MARS-277 parallel unit regression") as WorkflowState;
  state.completed_stages = ["workspace-detection", "state-template"];
  state.completed_stage_instances = ["workspace-detection", "state-template"];
  saveFixtureState(project, state);
  return project;
}

/** Two units; `declared` controls whether the manifest carries evidence_inputs. */
function makeUnits(project: string, declared: boolean): void {
  const ownership = (paths: string[]) => declared
    ? { evidence_inputs: { version: 1, paths, shared_paths: [], depends_on_units: [] } }
    : {};
  put(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({
    schema_version: 1,
    modules: [{ module_id: MODULE, name: "Project", service_id: "svc", paths: ["src"] }],
  }));
  put(project, `docs/aidlc/modules/${MODULE}/inception/unit-manifest.json`, JSON.stringify({
    schema_version: 1,
    module_id: MODULE,
    units: [
      { unit_id: "u1", name: "Orders", service_id: "svc", ...ownership(["src/orders"]) },
      { unit_id: "u2", name: "Users", service_id: "svc", ...ownership(["src/users"]) },
    ],
  }));
}

function makeI13(project: string): void {
  put(project, `docs/aidlc/modules/${MODULE}/inception/requirements.md`, "# Requirements\nREQ-1 订单导出:验收标准为 30 秒内完成\n");
  const cases = `docs/aidlc/modules/${MODULE}/inception/application-design/test-cases`;
  put(project, `${cases}/_index.md`, "# UC-D index\n- UC-D-001 订单导出\n");
  put(project, `${cases}/UC-D-001-export.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001 订单导出\n");
}

function unitInstance(stage: string, unit: string): string {
  return `${stage}@module:${MODULE}@unit:${unit}`;
}

function bind(project: string, instance: string, owner: string, session: string) {
  const existing = loadWorkflowState(project)!.active_instances[instance];
  return bindSession(project, { instance, owner, session, expected: claimToken(existing) }).binding;
}

function evidenceFile(project: string, stage: string): string {
  const root = join(project, ".aidlc", "evidence", stage);
  const visit = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? visit(path) : entry.name.endsWith(".json") ? [path] : [];
  });
  return visit(root)[0];
}

/** Arrange the shared opening state: I13 produced, completed, both units bound at tdd. */
function openParallelProject(name: string, declared: boolean): { project: string; alice: unknown; bob: unknown } {
  const project = makeProject(name);
  makeUnits(project, declared);
  makeI13(project);
  put(project, "src/orders/behavior.ts", "export const behavior = 'REQ-1 UC-D-001 behavior';\n");
  put(project, "src/users/profile.ts", "export const profile = 'users';\n");
  git(project, ["add", "."]);
  git(project, ["commit", "-qm", "docs"]);

  const state = loadWorkflowState(project)!;
  state.current_stage = "test-case-derivation";
  state.current_phase = "inception";
  state.current_stage_instance = `test-case-derivation@module:${MODULE}`;
  state.current_module = MODULE;
  saveFixtureState(project, state);
  const i13 = run(project, ["evidence", "run", "--stage", "test-case-derivation", "--module", MODULE], undefined, "evidence run I13 (initial)");
  assert.equal(i13.status, 0, `${i13.stdout}\n${i13.stderr}`);

  const advanced = loadWorkflowState(project)!;
  advanced.completed_stages.push("test-case-derivation");
  advanced.completed_stage_instances.push(`test-case-derivation@module:${MODULE}`, `units-generation@module:${MODULE}`);
  advanced.current_stage = "tdd";
  advanced.current_phase = "construction";
  advanced.current_stage_instance = unitInstance("tdd", "u1");
  advanced.current_module = MODULE;
  advanced.current_unit = "u1";
  saveFixtureState(project, advanced);

  const alice = bind(project, unitInstance("tdd", "u1"), "alice", "alice-session");
  const bob = bind(project, unitInstance("tdd", "u2"), "bob", "bob-session");
  return { project, alice, bob };
}

// ---------------------------------------------------------------------------
// 场景 1/9 + 场景 9/9:交错推进互不覆盖状态;并行无需转接或跨会话协调。
// ---------------------------------------------------------------------------
{
  const { project, alice, bob } = openParallelProject("parallel-isolation", true);

  const aliceNext = run(project, ["orchestrate", "next"], alice, "next tdd@u1 (baseline)");
  check("alice's next advances her own unit", aliceNext.status === 0 && JSON.parse(aliceNext.stdout).stage_instance === unitInstance("tdd", "u1"), aliceNext.stdout + aliceNext.stderr);

  const bobNext = run(project, ["orchestrate", "next"], bob, "next tdd@u2 (interleaved)");
  check("bob's next advances his own unit while alice's is current", bobNext.status === 0 && JSON.parse(bobNext.stdout).stage_instance === unitInstance("tdd", "u2"), bobNext.stdout + bobNext.stderr);

  const state = loadWorkflowState(project)!;
  check("alice's global chain position is not overwritten", state.current_stage_instance === unitInstance("tdd", "u1"));
  check("bob's chain position lives in his own unit context", state.unit_contexts?.[projectKey("u2")]?.stage_instance === unitInstance("tdd", "u2"));

  const alicePreview = run(project, ["orchestrate", "next", "--preview"], alice);
  check("bound session preview never routes into another unit", JSON.parse(alicePreview.stdout).stage_instance === unitInstance("tdd", "u1"), alicePreview.stdout);
  const bobPreview = run(project, ["orchestrate", "next", "--preview"], bob);
  check("bob's preview stays on his unit", JSON.parse(bobPreview.stdout).stage_instance === unitInstance("tdd", "u2"), bobPreview.stdout);

  // 场景 2/9 + 3/9:u2 修改私有源文件,无关模块级上游证据(I13)保持有效。
  put(project, "src/users/profile.ts", "export const profile = 'users-v2';\n");
  const afterEdit = run(project, ["orchestrate", "next"], alice, "next tdd@u1 (after u2 private edit)");
  check("u2's private edit does not invalidate the module planning baseline", afterEdit.status === 0, afterEdit.stdout + afterEdit.stderr);

  const record = JSON.parse(readFileSync(evidenceFile(project, "test-case-derivation"), "utf8"));
  check("module-axis evidence records the planning baseline scope", record.source_revision.scope === `inputs-v2:module:${MODULE}:baseline`);

  // 场景 5/9:修改上游实际规划输入(requirements.md)仍触发正确失效。
  put(project, `docs/aidlc/modules/${MODULE}/inception/requirements.md`, "# Requirements\nREQ-1 订单导出:验收标准为 60 秒内完成(修改)\n");
  const afterPlanningEdit = run(project, ["orchestrate", "next"], alice, "next tdd@u1 (after planning input edit)");
  check("planning input edit invalidates the upstream baseline", afterPlanningEdit.status === 2, afterPlanningEdit.stdout + afterPlanningEdit.stderr);
  check(
    "the failure names the baseline scope",
    /scope_digest no longer matches the inputs-v2:module:project:baseline scope/.test(afterPlanningEdit.stdout),
    afterPlanningEdit.stdout,
  );

  // F7:下游 session(bob)在自己 claim 下刷新已完成上游,不接管上游实例。
  const refresh = run(project, ["evidence", "run", "--stage", "test-case-derivation", "--module", MODULE, "--refresh"], bob, "evidence run I13 --refresh (downstream session)");
  check("a downstream session refreshes the completed upstream under its own claim", refresh.status === 0, refresh.stdout + refresh.stderr);
  const refreshed = JSON.parse(readFileSync(evidenceFile(project, "test-case-derivation"), "utf8"));
  check("refreshed evidence is re-anchored to the baseline scope", refreshed.source_revision.scope === `inputs-v2:module:${MODULE}:baseline`);
  check("refresh did not take over alice's claim", loadWorkflowState(project)!.active_instances[unitInstance("tdd", "u1")]?.owner === "alice");

  const recovered = run(project, ["orchestrate", "next"], alice, "next tdd@u1 (after refresh)");
  check("alice proceeds after the upstream refresh", recovered.status === 0, recovered.stdout + recovered.stderr);

  // 场景 6/9(部分):其他单元的活动实例不可被本 session 刷新。
  const crossUnit = run(project, ["evidence", "run", "--stage", "tdd", "--module", MODULE, "--unit", "u1", "--refresh"], bob);
  check("refreshing another unit's active instance is refused", crossUnit.status !== 0, crossUnit.stdout);
}

function projectKey(unitId: string): string {
  return `${MODULE}:${unitId}`;
}

// ---------------------------------------------------------------------------
// 场景 4/9(精确失效)由场景 5 的对照覆盖:私有源码改动(场景 2)不失效,
// 规划输入改动(场景 5)失效——只有真实输入变化使证据失效。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 旧标签受控兼容:升级前记录的宽 scope 证据,严格按旧语义校验,失效时给出
// 迁移指引;`--refresh` 由下游 session 重签为 baseline scope。
// ---------------------------------------------------------------------------
{
  const { project, alice, bob } = openParallelProject("legacy-scope", true);

  // 模拟升级前的记录:scope 标签与 digest 都按旧宽语义重签。
  const path = evidenceFile(project, "test-case-derivation");
  const record = JSON.parse(readFileSync(path, "utf8"));
  const legacyScope = legacyEvidenceScopeForInstance(project, `test-case-derivation@module:${MODULE}`);
  record.source_revision.scope = legacyScope.label;
  record.source_revision.scope_digest = readSourceRevision(project, legacyScope).scope_digest;
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n", "utf8");

  const before = run(project, ["orchestrate", "next"], alice);
  check("legacy-label evidence still validates while its wide scope is unchanged", before.status === 0, before.stdout + before.stderr);

  put(project, "src/users/profile.ts", "export const profile = 'users-v3';\n");
  const blocked = run(project, ["orchestrate", "next"], alice);
  check("a downstream edit invalidates the legacy wide scope strictly", blocked.status === 2, blocked.stdout + blocked.stderr);
  check(
    "the failure explains the refresh migration instead of a bare mismatch",
    /no longer matches the inputs-v2:module:project scope/.test(blocked.stdout) && /--refresh/.test(blocked.stdout),
    blocked.stdout,
  );

  // 输入指纹未变,但 scope 标签已旧:刷新必须重签,不得复用旧记录。
  const refresh = run(project, ["evidence", "run", "--stage", "test-case-derivation", "--module", MODULE, "--refresh"], bob, "evidence run I13 --refresh (legacy migration)");
  check("refresh regenerates instead of reusing the legacy-label record", refresh.status === 0, refresh.stdout + refresh.stderr);
  const refreshed = JSON.parse(readFileSync(path, "utf8"));
  check("the migrated record carries the baseline scope", refreshed.source_revision.scope === `inputs-v2:module:${MODULE}:baseline`);
  const after = run(project, ["orchestrate", "next"], alice, "next tdd@u1 (after legacy migration)");
  check("the session proceeds on the migrated baseline", after.status === 0, after.stdout + after.stderr);
}

// ---------------------------------------------------------------------------
// 场景 6/9 + 受控补齐:未声明归属的 manifest 得到结构化诊断;`unit inputs`
// 只允许本单元 session 首次声明,非法归属(越权/重叠)被拒绝并回滚。
// ---------------------------------------------------------------------------
{
  const { project, alice, bob } = openParallelProject("ownership-repair", false);

  const crossUnit = run(project, ["orchestrate", "unit", "inputs", "--module", MODULE, "--unit", "u1", "--paths", "src/orders"], bob);
  check("a u2-bound session cannot declare u1's ownership", crossUnit.status !== 0 && /unit u2/.test(crossUnit.stdout + crossUnit.stderr), crossUnit.stdout + crossUnit.stderr);

  const declare = run(project, ["orchestrate", "unit", "inputs", "--module", MODULE, "--unit", "u2", "--paths", "src/users", "--shared-paths", "src/shared"], bob, "unit inputs (first declaration)");
  check("the owning session declares its unit's inputs", declare.status === 0, declare.stdout + declare.stderr);
  const manifest = JSON.parse(readFileSync(join(project, `docs/aidlc/modules/${MODULE}/inception/unit-manifest.json`), "utf8"));
  check("the declaration lands in the manifest", manifest.units.find((unit: { unit_id: string }) => unit.unit_id === "u2")?.evidence_inputs?.paths?.[0] === "src/users");

  const declareU1 = run(project, ["orchestrate", "unit", "inputs", "--module", MODULE, "--unit", "u1", "--paths", "src/orders"], alice);
  check("u1's session declares u1's inputs", declareU1.status === 0, declareU1.stdout + declareU1.stderr);

  const redeclare = run(project, ["orchestrate", "unit", "inputs", "--module", MODULE, "--unit", "u2", "--paths", "src/other"], bob);
  check("re-declaring ownership is refused (regeneration path only)", redeclare.status !== 0, redeclare.stdout);

  // 越权写入:未绑定模块的 session 无法声明。
  const unbound = spawnSync(process.execPath, [tsx, cli, "orchestrate", "unit", "inputs", "--module", "other-module", "--unit", "u1", "--paths", "src"], { cwd: project, encoding: "utf8", env: { ...process.env, AIDLC_SESSION_BINDING: "" } });
  check("a session without the module binding cannot declare ownership", unbound.status !== 0, unbound.stdout + String(unbound.stderr));

  // 重叠归属:声明 u3(先建)覆盖 u2 已声明路径 → 拒绝并回滚。
  const manifestPath = join(project, `docs/aidlc/modules/${MODULE}/inception/unit-manifest.json`);
  const withU3 = JSON.parse(readFileSync(manifestPath, "utf8"));
  withU3.units.push({ unit_id: "u3", name: "Overlap", service_id: "svc" });
  writeFileSync(manifestPath, JSON.stringify(withU3, null, 2) + "\n", "utf8");
  const carol = bind(project, unitInstance("tdd", "u3"), "carol", "carol-session");
  const overlapping = run(project, ["orchestrate", "unit", "inputs", "--module", MODULE, "--unit", "u3", "--paths", "src/users/api"], carol);
  check("overlapping ownership is rejected", overlapping.status !== 0 && /overlapping/.test(overlapping.stdout + overlapping.stderr), overlapping.stdout + overlapping.stderr);
  const rolledBack = JSON.parse(readFileSync(manifestPath, "utf8"));
  check("the manifest is rolled back on rejection", rolledBack.units.find((unit: { unit_id: string }) => unit.unit_id === "u3")?.evidence_inputs === undefined);
}

// ---------------------------------------------------------------------------
// 场景 7/9:同输入重复执行复用有效计算;作用域外的直接调用不缓存。
// ---------------------------------------------------------------------------
{
  const project = makeProject("memoization");
  put(project, "src/a.ts", "export const a = 1;\n");
  git(project, ["add", "."]);
  git(project, ["commit", "-qm", "memo"]);

  const scope = evidenceScopeForInstance(project, `tdd@module:${MODULE}@unit:u1`);
  revisionCacheStats();
  const before = revisionCacheStats();
  withRevisionMemoization(() => {
    readSourceRevision(project, scope);
    readSourceRevision(project, scope);
    readSourceRevision(project, scope);
  });
  const scoped = revisionCacheStats();
  check("repeated reads within a gate pass compute the revision once", scoped.computations - before.computations === 1 && scoped.calls - before.calls === 3, JSON.stringify({ before, scoped }));

  const digestBefore = readSourceRevision(project, scope).scope_digest;
  put(project, "src/a.ts", "export const a = 2;\n");
  const digestAfter = readSourceRevision(project, scope).scope_digest;
  check("outside a memoization scope every read observes file changes", digestBefore !== digestAfter);
}

// ---------------------------------------------------------------------------
// 场景 8/9:并发状态提交冲突 → 有限恢复,双方结果不丢失。
// ---------------------------------------------------------------------------
{
  const { project, alice, bob } = openParallelProject("concurrent", true);
  const [aliceNext, bobNext] = await Promise.all([
    runParallel(project, ["orchestrate", "next"], alice, "next tdd@u1 (concurrent)"),
    runParallel(project, ["orchestrate", "next"], bob, "next tdd@u2 (concurrent)"),
  ]);
  check("the concurrent alice next terminates successfully", aliceNext.status === 0, aliceNext.stdout + aliceNext.stderr);
  check("the concurrent bob next terminates successfully", bobNext.status === 0, bobNext.stdout + bobNext.stderr);
  const state = loadWorkflowState(project)!;
  const positions = new Set([
    state.current_stage_instance,
    ...Object.values(state.unit_contexts || {}).map((context) => context.stage_instance),
  ]);
  check("both units' chain positions survive the concurrent writes", positions.has(unitInstance("tdd", "u1")) && positions.has(unitInstance("tdd", "u2")), JSON.stringify([...positions]));
}

rmSync(scratch, { recursive: true, force: true });

console.log(`MARS-277 parallel units passed: ${checks} checks`);
for (const timing of timings) console.log(`  [timing] ${timing.label}: ${timing.ms}ms`);
