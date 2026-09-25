import { existsSync, readFileSync, realpathSync } from "fs";
import { resolve } from "path";
import { loadWorkflowState } from "./aidlc-light-state";
import { checkSensors, expandStageInstances, loadGraph, type StageInstance } from "./aidlc-orchestrate";

interface HookInput {
  cwd?: string;
  stop_hook_active?: boolean;
}

const projectRoot = process.cwd();
const format = readFlag("format") || "plain";

function readFlag(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function readInput(): HookInput {
  try {
    const raw = readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) as HookInput : {};
  } catch {
    return {};
  }
}

function allow(): never {
  process.exit(0);
}

function block(reason: string): never {
  if (["claude", "codex", "codebuddy", "zcode"].includes(format)) {
    process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
    process.exit(0);
  }
  if (format === "opencode" || format === "qoder-cli") {
    process.stderr.write(`${reason}\n`);
    process.exit(2);
  }
  process.stderr.write(`${reason}\n`);
  process.exit(1);
}

async function main(): Promise<never> {
  const input = readInput();
  if (format === "qoder-cli" && input.stop_hook_active === true) allow();
  const requestedRoot = typeof input.cwd === "string" && input.cwd.trim() ? resolve(input.cwd) : projectRoot;
  if (!existsSync(requestedRoot)) block(`AI-DLC project root does not exist: ${requestedRoot}`);
  const root = realpathSync(requestedRoot);

  try {
    const state = loadWorkflowState(root);
    if (!state || state.status === "done" || state.status === "parked") allow();
    if (state.status !== "running") block(`AWS-style lightweight workflow has unsupported status: ${state.status}`);

    // 准出门禁强制 (Phase A):当前阶段的 sensor(准出门禁)未过时,阻止 agent 结束回合。
    // 这把语义门禁从"仅在 agent 主动 report 时触发"提升为"每次 Stop 都强制复验",
    // 让有 host Stop-hook 的 harness(claude/codex/codebuddy/zcode/qoder/kiro-cli/kiro-ide)获得硬拦截。
    // 纯时间性证据过期(>24h resume)不是回归,不阻断续作;一切实质失败(覆盖缺失、映射断裂、产物被改坏)阻断。
    const currentInstanceId = state.current_stage_instance;
    if (currentInstanceId) {
      try {
        const graph = loadGraph();
        const instances = expandStageInstances(graph, state);
        const current: StageInstance | undefined = instances.find((instance) => instance.instance_id === currentInstanceId);
        if (current) {
          const failures = await checkSensors(current, state);
          const substantive = failures.filter((failure) => !/evidence is stale \(\d+h old/i.test(failure.message));
          if (substantive.length > 0) {
            block(
              `🚫 当前阶段 "${currentInstanceId}" 的准出门禁未通过,必须先修复再结束:\n` +
              substantive.map((failure) => `  ❌ [${failure.sensor}] ${failure.message}`).join("\n") +
              `\n\n修复产物/证据使门禁转绿后再继续;不要跳过门禁直接结束或写下游产物。`,
            );
          }
        }
      } catch (gateError) {
        // 门禁自检本身出错(graph/state 解析失败等)不应静默放行:作为阻断信号暴露给 agent。
        block(`AI-DLC 准出门禁自检失败: ${gateError instanceof Error ? gateError.message : String(gateError)}`);
      }
    }

    const current = state.current_stage_instance || state.current_stage || "workflow planning";
    block(`AWS-style lightweight workflow is still running for: ${state.work_description || "current work"}. Continue ${current}, or explicitly park the workflow. Team members may select a unit with 'loeyae-aidlc unit select'.`);
  } catch (error) {
    block(`AWS-style lightweight workflow state is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

void main();
