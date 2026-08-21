#!/usr/bin/env bun
/**
 * aidlc-orchestrate.ts — The deterministic workflow engine.
 *
 * Subcommands:
 *   next [args...]    — Read state + stage graph, return ONE typed directive (JSON)
 *   continue <token>  — Internal steering transport (load-steering chain)
 *   report [flags]    — Record stage outcome, advance state machine
 *   park              — Park workflow at current inter-stage boundary
 *
 * State file: <project>/docs/aidlc/aidlc-state.json
 * Stage graph: <engine>/data/stage-graph.json
 *
 * This tool is DETERMINISTIC: same state → same directive.
 * `next` NEVER mutates state — only `report` and `park` write.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = resolve(__dirname, "..");
const GRAPH_PATH = join(__dirname, "data", "stage-graph.json");

// State file lives in the user's project (CWD-relative)
const PROJECT_ROOT = process.cwd();
const STATE_DIR = join(PROJECT_ROOT, "docs", "aidlc");
const STATE_PATH = join(STATE_DIR, "aidlc-state.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StageNode {
  slug: string;
  number: string;
  name: string;
  phase: string;
  execution: "ALWAYS" | "CONDITIONAL";
  lead_agent: string;
  support_agents: string[];
  mode: string;
  scopes: string[];
  requires: string[];
  consumes: string[];
  produces: string[];
  sensors: string[];
  approval: "block" | "confirm" | "notify";
  file: string;
}

interface StageGraph {
  version: string;
  compiled_at: string;
  stages: StageNode[];
  stage_count: number;
}

interface WorkflowState {
  version: string;
  scope: string;
  depth: string;
  current_phase: string;
  current_stage: string;
  status: "running" | "parked" | "done";
  completed_stages: string[];
  skipped_stages: string[];
  history: HistoryEntry[];
  created_at: string;
  updated_at: string;
}

interface HistoryEntry {
  stage: string;
  result: string;
  timestamp: string;
  user_input?: string;
}

interface Directive {
  kind: "load-steering" | "run-stage" | "ask" | "print" | "error" | "done" | "parked";
  stage?: string;
  stage_file?: string;
  name?: string;
  number?: string;
  phase?: string;
  lead_agent?: string;
  support_agents?: string[];
  mode?: string;
  gate?: boolean;
  consumes?: string[];
  produces?: string[];
  sensors?: string[];
  message?: string;
  rules_content?: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

const SUBCOMMANDS = ["next", "continue", "report", "park"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const VALID_RESULTS = ["completed", "approved", "rejected", "revised", "skipped", "awaiting-approval"] as const;
type StageResult = (typeof VALID_RESULTS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadGraph(): StageGraph {
  if (!existsSync(GRAPH_PATH)) {
    throw new Error(`Stage graph not found at ${GRAPH_PATH}. Run 'aidlc-graph.ts compile' first.`);
  }
  return JSON.parse(readFileSync(GRAPH_PATH, "utf-8"));
}

function loadState(): WorkflowState | null {
  if (!existsSync(STATE_PATH)) return null;
  return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
}

function saveState(state: WorkflowState): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
  state.updated_at = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function createInitialState(scope: string): WorkflowState {
  return {
    version: "2.0.0",
    scope,
    depth: "standard",
    current_phase: "ideation",
    current_stage: "",
    status: "running",
    completed_stages: [],
    skipped_stages: [],
    history: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Filter stages by scope: a stage executes if its scopes array includes
 * the workflow's active scope, OR if its execution is ALWAYS.
 */
function getExecutableStages(graph: StageGraph, scope: string): StageNode[] {
  return graph.stages.filter(
    (s) => s.execution === "ALWAYS" || s.scopes.includes(scope)
  );
}

/**
 * Check if a stage's requires dependencies are all satisfied.
 * Only checks dependencies that are in the executable stages list —
 * a requires pointing to a stage that's not in scope is auto-satisfied
 * (the scope intentionally skips that prerequisite).
 */
function checkRequires(
  stage: StageNode,
  completedSlugs: string[],
  skippedSlugs: string[],
  executableSlugs: Set<string>
): string[] {
  if (!stage.requires || stage.requires.length === 0) return [];
  const done = new Set([...completedSlugs, ...skippedSlugs]);
  return stage.requires.filter((dep) => executableSlugs.has(dep) && !done.has(dep));
}

/**
 * Check if produces files exist (glob patterns resolved against PROJECT_ROOT).
 * Returns list of missing produces.
 */
function checkProduces(stage: StageNode): string[] {
  if (!stage.produces || stage.produces.length === 0) return [];
  const missing: string[] = [];
  for (const pattern of stage.produces) {
    // Simple check: if it's a specific file path, check existence
    // If it contains *, treat as "at least one file should exist" (simplified)
    if (pattern.includes("*")) {
      // For glob patterns, we do a basic directory existence check
      const dir = join(PROJECT_ROOT, pattern.split("*")[0]);
      if (!existsSync(dir)) {
        missing.push(pattern);
      }
    } else {
      const filePath = join(PROJECT_ROOT, pattern);
      if (!existsSync(filePath)) {
        missing.push(pattern);
      }
    }
  }
  return missing;
}

/**
 * Find the next stage to execute: first executable stage whose
 * dependencies are all satisfied and not yet completed or skipped.
 */
function findNextStage(
  executableStages: StageNode[],
  completedSlugs: string[],
  skippedSlugs: string[]
): { stage: StageNode | null; blocked?: { stage: StageNode; unsatisfied: string[] } } {
  const done = new Set([...completedSlugs, ...skippedSlugs]);
  const executableSlugs = new Set(executableStages.map((s) => s.slug));

  for (const s of executableStages) {
    if (done.has(s.slug)) continue;

    // Check requires dependencies (only those in scope)
    const unsatisfied = checkRequires(s, completedSlugs, skippedSlugs, executableSlugs);
    if (unsatisfied.length > 0) {
      return { stage: null, blocked: { stage: s, unsatisfied } };
    }

    return { stage: s };
  }

  return { stage: null };
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      flags[key] = val;
    } else {
      // Positional args become "text"
      flags.text = (flags.text ? flags.text + " " : "") + args[i];
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// next — compute the next directive without mutating state
// ---------------------------------------------------------------------------

async function handleNext(args: string[]): Promise<Directive> {
  const graph = loadGraph();
  const flags = parseFlags(args);

  // Check for --resume flag
  const isResume = "resume" in flags;

  // Check for --scope flag (initializes a new workflow)
  const scopeFlag = flags.scope;

  // Check for --status flag
  if ("status" in flags) {
    const state = loadState();
    if (!state) {
      return { kind: "print", message: "No active workflow. Start with: aidlc-orchestrate next --scope <scope> \"<description>\"" };
    }
    const exec = getExecutableStages(graph, state.scope);
    const remaining = exec.filter((s) => !state.completed_stages.includes(s.slug) && !state.skipped_stages.includes(s.slug));
    return {
      kind: "print",
      message: `📊 Workflow Status\n` +
        `  Scope: ${state.scope} | Phase: ${state.current_phase} | Status: ${state.status}\n` +
        `  Current stage: ${state.current_stage || "(none)"}\n` +
        `  Completed: ${state.completed_stages.length}/${exec.length} stages\n` +
        `  Skipped: ${state.skipped_stages.length}\n` +
        `  Remaining: ${remaining.length} (${remaining.map((s) => s.slug).join(", ")})`,
    };
  }

  // Load or create state
  let state = loadState();

  if (!state) {
    // No workflow exists — need scope to initialize
    if (!scopeFlag) {
      return {
        kind: "ask",
        question: "No active workflow found. Which scope should this workflow use?",
        options: ["feature", "enterprise", "mvp", "classic", "express", "bugfix", "refactor", "poc"],
        ask_type: "scope-selection",
      } as unknown as Directive;
    }
    // Initialize new workflow
    state = createInitialState(scopeFlag);
    saveState(state);
    return {
      kind: "print",
      message: `✅ Workflow initialized with scope: ${scopeFlag}\n` +
        `  Executable stages: ${getExecutableStages(graph, scopeFlag).length}/${graph.stage_count}\n` +
        `  Run 'next' again to get the first stage directive.`,
    };
  }

  // Parked workflow — resume or report parked
  if (state.status === "parked") {
    if (!isResume) {
      return {
        kind: "parked",
        stage: state.current_stage,
        message: `Workflow is parked at stage "${state.current_stage}". Pass --resume to continue.`,
      };
    }
    // Resume: clear parked status
    state.status = "running";
    saveState(state);
  }

  // Done workflow
  if (state.status === "done") {
    return { kind: "done", message: "Workflow is already complete." };
  }

  // Find next executable stage
  const executableStages = getExecutableStages(graph, state.scope);
  const { stage: nextStage, blocked } = findNextStage(executableStages, state.completed_stages, state.skipped_stages);

  if (blocked) {
    // Stage exists but dependencies not met — report blocker
    return {
      kind: "error",
      message: `🚫 Stage "${blocked.stage.slug}" (${blocked.stage.name}) is blocked.\n` +
        `  Unsatisfied requires: ${blocked.unsatisfied.join(", ")}\n` +
        `  These stages must be completed first.`,
    };
  }

  if (!nextStage) {
    // All stages done
    state.status = "done";
    state.current_stage = "";
    saveState(state);
    return {
      kind: "done",
      message: `🎉 All ${state.completed_stages.length} stages complete. Workflow finished.`,
    };
  }

  // Update current stage pointer (next is read-mostly but updates the cursor for resume)
  state.current_stage = nextStage.slug;
  state.current_phase = nextStage.phase;
  saveState(state);

  // Determine gate: ALWAYS stages with number starting with "0." or phase "initialization" get no gate
  const isBootstrap = nextStage.number.startsWith("0.") || nextStage.phase === "initialization";
  const gate = !isBootstrap;

  // Build the run-stage directive
  return {
    kind: "run-stage",
    stage: nextStage.slug,
    stage_file: join("core", nextStage.file),
    name: nextStage.name,
    number: nextStage.number,
    phase: nextStage.phase,
    lead_agent: nextStage.lead_agent,
    support_agents: nextStage.support_agents,
    mode: nextStage.mode,
    gate,
    consumes: nextStage.consumes,
    produces: nextStage.produces,
    sensors: nextStage.sensors,
  };
}

// ---------------------------------------------------------------------------
// report — validate and record a stage outcome
// ---------------------------------------------------------------------------

async function handleReport(args: string[]): Promise<Directive> {
  const flags = parseFlags(args);
  const stageSlug = flags.stage;
  const result = flags.result as StageResult;
  const userInput = flags["user-input"];
  const reason = flags.reason;

  // Validate required fields
  if (!stageSlug) {
    return { kind: "error", message: "report requires --stage <slug>" };
  }
  if (!result) {
    return { kind: "error", message: "report requires --result <outcome>. Valid: " + VALID_RESULTS.join(", ") };
  }
  if (!VALID_RESULTS.includes(result)) {
    return { kind: "error", message: `Invalid result "${result}". Valid: ${VALID_RESULTS.join(", ")}` };
  }

  // Load state
  const state = loadState();
  if (!state) {
    return { kind: "error", message: "No active workflow. Cannot report." };
  }
  if (state.status !== "running") {
    return { kind: "error", message: `Workflow is ${state.status}, not running. Cannot report.` };
  }

  // Validate stage matches current
  if (state.current_stage !== stageSlug) {
    return {
      kind: "error",
      message: `Stage mismatch: current is "${state.current_stage}", but report is for "${stageSlug}". ` +
        `Cannot report on a stage that is not the active one.`,
    };
  }

  // Record history entry
  const entry: HistoryEntry = {
    stage: stageSlug,
    result,
    timestamp: new Date().toISOString(),
  };
  if (userInput) entry.user_input = userInput;

  // --- P0 Gate: Validate produces before allowing completion ---
  if (result === "completed" || result === "approved") {
    const graph = loadGraph();
    const stageNode = graph.stages.find((s) => s.slug === stageSlug);
    if (stageNode) {
      const missingProduces = checkProduces(stageNode);
      if (missingProduces.length > 0) {
        return {
          kind: "error",
          message: `🚫 Cannot complete stage "${stageSlug}" — required produces not found:\n` +
            missingProduces.map((p) => `  ❌ ${p}`).join("\n") +
            `\n\nGenerate these artifacts first, then report again.`,
        };
      }
    }
  }

  state.history.push(entry);

  // Process result
  switch (result) {
    case "completed":
    case "approved":
      state.completed_stages.push(stageSlug);
      state.current_stage = ""; // cleared — next `next` will find the successor
      break;

    case "skipped":
      if (!reason) {
        return { kind: "error", message: "Skipping a stage requires --reason <explanation>" };
      }
      state.skipped_stages.push(stageSlug);
      state.current_stage = "";
      break;

    case "rejected":
      // Stage stays current — agent must revise and re-report
      break;

    case "revised":
      // After revision, stays current for re-approval
      break;

    case "awaiting-approval":
      // Stage stays current — waiting for user gate decision
      break;
  }

  saveState(state);

  // Return confirmation
  switch (result) {
    case "completed":
    case "approved":
      return {
        kind: "print",
        message: `✅ Stage "${stageSlug}" ${result}. Run 'next' for the next stage.`,
      };
    case "skipped":
      return {
        kind: "print",
        message: `⏭️ Stage "${stageSlug}" skipped: ${reason}. Run 'next' for the next stage.`,
      };
    case "rejected":
      return {
        kind: "print",
        message: `🔄 Stage "${stageSlug}" rejected. Revise and report --result revised, then re-present gate.`,
      };
    case "revised":
      return {
        kind: "print",
        message: `📝 Stage "${stageSlug}" revised. Re-present the approval gate.`,
      };
    case "awaiting-approval":
      return {
        kind: "print",
        message: `⏳ Stage "${stageSlug}" awaiting approval. Present the gate to the user.`,
      };
  }
}

// ---------------------------------------------------------------------------
// park — save workflow for later resume
// ---------------------------------------------------------------------------

async function handlePark(): Promise<Directive> {
  const state = loadState();
  if (!state) {
    return { kind: "error", message: "No active workflow to park." };
  }
  if (state.status !== "running") {
    return { kind: "error", message: `Workflow is ${state.status}, not running. Cannot park.` };
  }

  state.status = "parked";
  saveState(state);

  return {
    kind: "parked",
    stage: state.current_stage,
    message: `Workflow parked at stage "${state.current_stage}". Resume with 'next --resume'.`,
  };
}

// ---------------------------------------------------------------------------
// continue — steering chain transport (placeholder for rule loading)
// ---------------------------------------------------------------------------

async function handleContinue(token: string): Promise<Directive> {
  // In v2, load-steering chains are simplified:
  // The agent loads stage files directly. This is a passthrough.
  return {
    kind: "print",
    message: `[Engine] Continue token "${token}" acknowledged. Agent should load the stage file directly.`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseSubcommand(args: string[]): { cmd: Subcommand; rest: string[] } {
  const cmd = args[0] as Subcommand;
  if (!SUBCOMMANDS.includes(cmd)) {
    console.error(
      JSON.stringify({
        kind: "error",
        message: `Unknown subcommand: ${args[0]}. Use: ${SUBCOMMANDS.join(", ")}`,
      })
    );
    process.exit(1);
  }
  return { cmd, rest: args.slice(1) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      JSON.stringify({
        kind: "error",
        message: "Usage: aidlc-orchestrate.ts <next|continue|report|park> [args...]",
      })
    );
    process.exit(1);
  }

  const { cmd, rest } = parseSubcommand(args);

  let directive: Directive;
  switch (cmd) {
    case "next":
      directive = await handleNext(rest);
      break;
    case "report":
      directive = await handleReport(rest);
      break;
    case "park":
      directive = await handlePark();
      break;
    case "continue":
      directive = await handleContinue(rest[0] || "");
      break;
  }

  console.log(JSON.stringify(directive, null, 2));
}

main();
