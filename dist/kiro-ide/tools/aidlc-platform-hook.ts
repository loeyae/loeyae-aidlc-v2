#!/usr/bin/env node
/**
 * Platform lifecycle adapter for AI-DLC.
 *
 * A platform invokes this adapter before allowing an agent turn to finish.
 * The adapter never edits workflow state directly; it asks the deterministic
 * orchestrator to report the active stage and relays the result in the
 * platform's native blocking format.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

interface HookInput {
  cwd?: string;
  hook_event_name?: string;
  event?: string;
}

interface WorkflowState {
  status?: string;
  current_stage?: string;
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

function loadState(root: string): WorkflowState | null {
  const path = resolve(root, "docs/aidlc/aidlc-state.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as WorkflowState;
  } catch {
    fail(`AI-DLC gate state is invalid: ${path}`);
  }
}

function runReport(root: string, stage: string): string | null {
  const result = spawnSync(process.execPath, [cliPath, "orchestrate", "report", "--stage", stage, "--result", "completed"], {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) return `Unable to execute AI-DLC gate engine: ${result.error.message}`;
  if (result.status !== 0) {
    return `AI-DLC gate engine exited with code ${result.status}: ${(result.stderr || result.stdout || "unknown error").trim()}`;
  }

  try {
    const directive = JSON.parse((result.stdout || "").trim()) as Directive;
    if (directive.kind === "error") return directive.message || "AI-DLC gate rejected stage completion.";
    return null;
  } catch {
    return `AI-DLC gate engine returned invalid JSON: ${(result.stdout || result.stderr || "").trim()}`;
  }
}

const input = readInput();
const root = typeof input.cwd === "string" && input.cwd.length > 0 ? resolve(input.cwd) : projectRoot;
const state = loadState(root);

if (!state || state.status === "done" || state.status === "parked" || !state.current_stage) allow();

const failure = runReport(root, state.current_stage as string);
if (failure) fail(`AI-DLC stage "${state.current_stage}" cannot finish: ${failure}`);
allow();
