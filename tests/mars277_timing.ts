// MARS-277 同条件性能对比夹具(手动运行,不在 core-test-suites 中):
// 同一项目形态下测量 evidence run 与多次 next 的墙钟时间。要对比修复前后,
// 在两个 checkout 各运行一次本脚本(基线 checkout 需能解析 node_modules 与
// `tsx/cli`,可用目录联接指向本仓的 node_modules),树形态完全相同。
// 输出 `[timing]` 行;温度敏感性:首轮(冷文件缓存)差异最大,重复运行
// 收敛后剩余耗时以 tsx 子进程启动与 git 子进程为主。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(tmpdir(), "aidlc-mars277-timing-"));
const MODULE = "project";
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "a@b.c", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "a@b.c" };

function git(project: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd: project, encoding: "utf8", env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}
function put(project: string, path: string, data: string): void {
  mkdirSync(join(project, path, ".."), { recursive: true });
  writeFileSync(join(project, path), data, "utf8");
}
function run(project: string, args: string[], binding?: unknown): { status: number; stdout: string } {
  const r = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8", env: { ...fixtureEnvironment(project, args), ...(binding ? { AIDLC_SESSION_BINDING: JSON.stringify(binding) } : {}) } });
  return { status: r.status ?? 1, stdout: `${r.stdout || ""}\n${r.stderr || ""}` };
}

const project = join(scratch, "timing");
mkdirSync(project, { recursive: true });
put(project, "README.md", "timing\n");
git(project, ["init", "-q"]);
git(project, ["config", "user.name", "AI-DLC"]);
git(project, ["config", "user.email", "a@b.c"]);
git(project, ["add", "README.md"]);
git(project, ["commit", "-qm", "base"]);
const state = createInitialState("express", "4.22.12", "workflow-timing", [], "timing") as WorkflowState;
state.completed_stages = ["workspace-detection", "state-template"];
state.completed_stage_instances = ["workspace-detection", "state-template"];
saveFixtureState(project, state);
put(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [{ module_id: MODULE, name: "P", service_id: "svc", paths: ["src"] }] }));
put(project, `docs/aidlc/modules/${MODULE}/inception/unit-manifest.json`, JSON.stringify({ schema_version: 1, module_id: MODULE, units: [
  { unit_id: "u1", name: "O", service_id: "svc", evidence_inputs: { version: 1, paths: ["src/orders"], shared_paths: [], depends_on_units: [] } },
  { unit_id: "u2", name: "U", service_id: "svc", evidence_inputs: { version: 1, paths: ["src/users"], shared_paths: [], depends_on_units: [] } },
] }));
put(project, `docs/aidlc/modules/${MODULE}/inception/requirements.md`, "# Requirements\nREQ-1 订单导出:验收标准为 30 秒内完成\n");
put(project, `docs/aidlc/modules/${MODULE}/inception/application-design/test-cases/_index.md`, "# UC-D index\n- UC-D-001 订单导出\n");
put(project, `docs/aidlc/modules/${MODULE}/inception/application-design/test-cases/UC-D-001-export.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001 订单导出\n");
// 适中的源码树:每个单元 60 个文件,放大摘要扫描的差别。
for (let i = 0; i < 400; i++) {
  put(project, `src/orders/order-${i}.ts`, `export const o${i} = ${i};\n`);
  put(project, `src/users/user-${i}.ts`, `export const u${i} = ${i};\n`);
}
git(project, ["add", "."]);
git(project, ["commit", "-qm", "docs"]);

const s1 = loadWorkflowState(project)!;
s1.current_stage = "test-case-derivation";
s1.current_phase = "inception";
s1.current_stage_instance = `test-case-derivation@module:${MODULE}`;
s1.current_module = MODULE;
saveFixtureState(project, s1);

const stamp = (label: string, ms: number) => console.log(`[timing] ${label}: ${ms}ms`);
let started = Date.now();
const i13 = run(project, ["evidence", "run", "--stage", "test-case-derivation", "--module", MODULE]);
if (i13.status !== 0) throw new Error(i13.stdout);
stamp("evidence run I13", Date.now() - started);

const s2 = loadWorkflowState(project)!;
s2.completed_stages.push("test-case-derivation");
s2.completed_stage_instances.push(`test-case-derivation@module:${MODULE}`, `units-generation@module:${MODULE}`);
s2.current_stage = "tdd";
s2.current_phase = "construction";
s2.current_stage_instance = `tdd@module:${MODULE}@unit:u1`;
s2.current_module = MODULE;
s2.current_unit = "u1";
saveFixtureState(project, s2);
const alice = bindSession(project, { instance: `tdd@module:${MODULE}@unit:u1`, owner: "alice", session: "alice-session", expected: claimToken(undefined) }).binding;

for (let i = 0; i < 3; i++) {
  started = Date.now();
  const next = run(project, ["orchestrate", "next"], alice);
  if (next.status !== 0) throw new Error(next.stdout);
  stamp(`next #${i + 1}`, Date.now() - started);
}
rmSync(scratch, { recursive: true, force: true });
