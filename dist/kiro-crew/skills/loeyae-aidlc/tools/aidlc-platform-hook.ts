import { existsSync, readFileSync, realpathSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { loadWorkflowState, statePath } from "./aidlc-state";
import { readEnrollment } from "./aidlc-trust";

interface HookInput {
  cwd?: string;
  hook_event_name?: string;
  event?: string;
}

interface Directive {
  kind?: string;
  message?: string;
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = resolve(packageRoot, "bin", "cli.js");
const projectRoot = process.cwd();
const format = readFlag("format") || "plain";

function readFlag(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function readInput(): HookInput {
  try {
    const raw = readFileSync(0, "utf-8").trim();
    return raw ? JSON.parse(raw) as HookInput : {};
  } catch {
    return {};
  }
}

function output(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(reason: string): never {
  if (format === "claude" || format === "codex") {
    output({ decision: "block", reason });
    process.exit(0);
  }
  if (format === "opencode") {
    process.stderr.write(`${reason}\n`);
    process.exit(2);
  }
  process.stderr.write(`${reason}\n`);
  process.exit(1);
}

function allow(): never {
  process.exit(0);
}

function parseDirective(stdout: string, stderr: string): Directive | null {
  for (const candidate of [stdout, stderr]) {
    const value = candidate.trim();
    if (!value) continue;
    try {
      return JSON.parse(value) as Directive;
    } catch {
      continue;
    }
  }
  return null;
}

function runReport(root: string, stage: string): string | null {
  const result = spawnSync(process.execPath, [cliPath, "orchestrate", "report", "--stage", stage, "--result", "completed"], {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  if (result.error) return `Unable to execute AI-DLC gate engine: ${result.error.message}`;
  const directive = parseDirective(result.stdout || "", result.stderr || "");
  if (directive?.kind === "error") return directive.message || "AI-DLC gate rejected stage completion.";
  if (result.status !== 0) {
    return `AI-DLC gate engine exited with code ${result.status}: ${(result.stderr || result.stdout || "unknown error").trim()}`;
  }
  if (!directive) return `AI-DLC gate engine returned invalid JSON: ${(result.stdout || result.stderr || "").trim()}`;
  return null;
}

const input = readInput();
const requestedRoot = typeof input.cwd === "string" && input.cwd.length > 0 ? resolve(input.cwd) : projectRoot;
if (!existsSync(requestedRoot)) fail(`AI-DLC project root does not exist: ${requestedRoot}`);
const root = realpathSync(requestedRoot);

let enrollment;
try {
  enrollment = readEnrollment(root);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const path = statePath(root);
if (!existsSync(path)) {
  if (enrollment) fail(`AI-DLC enrolled project is missing its signed state: ${path}`);
  allow();
}

let state;
try {
  state = loadWorkflowState(root);
} catch (error) {
  fail(`AI-DLC gate state is invalid: ${error instanceof Error ? error.message : String(error)}`);
}
if (!state) fail(`AI-DLC state disappeared while evaluating the lifecycle gate: ${path}`);
if (enrollment && enrollment.workflow_id !== state.workflow_id) fail("AI-DLC state workflow_id does not match project enrollment");
if (state.status === "done" || state.status === "parked") allow();
if (state.status !== "running" || !state.current_stage) fail("AI-DLC running state has no active current_stage");

const failure = runReport(root, state.current_stage);
if (failure) fail(`AI-DLC stage "${state.current_stage}" cannot finish: ${failure}`);
allow();
