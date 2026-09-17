import { existsSync, readFileSync, realpathSync } from "fs";
import { resolve } from "path";
import { loadWorkflowState } from "./aidlc-light-state";

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

const input = readInput();
if (format === "qoder-cli" && input.stop_hook_active === true) allow();
const requestedRoot = typeof input.cwd === "string" && input.cwd.trim() ? resolve(input.cwd) : projectRoot;
if (!existsSync(requestedRoot)) block(`AI-DLC project root does not exist: ${requestedRoot}`);
const root = realpathSync(requestedRoot);

try {
  const state = loadWorkflowState(root);
  if (!state || state.status === "done" || state.status === "parked") allow();
  if (state.status !== "running") block(`AWS-style lightweight workflow has unsupported status: ${state.status}`);
  const current = state.current_stage_instance || state.current_stage || "workflow planning";
  block(`AWS-style lightweight workflow is still running for: ${state.work_description || "current work"}. Continue ${current}, or explicitly park the workflow. Team members may select a unit with 'loeyae-aidlc unit select'.`);
} catch (error) {
  block(`AWS-style lightweight workflow state is invalid: ${error instanceof Error ? error.message : String(error)}`);
}
