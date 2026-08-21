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
 * This tool is DETERMINISTIC: same state → same directive.
 * It NEVER mutates state on `next` — only `report` and `park` write.
 *
 * Directive schema: { kind, stage?, message?, rules_content?, gate?, ... }
 */

import { resolve } from "path";

const SUBCOMMANDS = ["next", "continue", "report", "park"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

interface Directive {
  kind: "load-steering" | "run-stage" | "ask" | "print" | "error" | "done" | "parked";
  stage?: string;
  message?: string;
  rules_content?: string[];
  gate?: boolean | "unresolved";
  stage_file?: string;
  memory_path?: string;
  [key: string]: unknown;
}

function parseSubcommand(args: string[]): { cmd: Subcommand; rest: string[] } {
  const cmd = args[0] as Subcommand;
  if (!SUBCOMMANDS.includes(cmd)) {
    console.error(JSON.stringify({ kind: "error", message: `Unknown subcommand: ${args[0]}. Use: ${SUBCOMMANDS.join(", ")}` }));
    process.exit(1);
  }
  return { cmd, rest: args.slice(1) };
}

async function handleNext(args: string[]): Promise<Directive> {
  // TODO: Implement state reading + stage graph traversal
  // For now, return a placeholder that shows the engine is alive
  return {
    kind: "print",
    message: `[Engine] aidlc-orchestrate.ts next called with args: ${args.join(" ")}. Engine not yet implemented — stage graph and state reader pending.`,
  };
}

async function handleReport(args: string[]): Promise<Directive> {
  // TODO: Parse --stage, --result, --user-input; validate transition; write state
  return {
    kind: "print",
    message: `[Engine] report received: ${args.join(" ")}. State writer pending.`,
  };
}

async function handlePark(): Promise<Directive> {
  // TODO: Write park marker to state
  return {
    kind: "parked",
    message: "Workflow parked at current boundary. Resume with --resume.",
  };
}

async function handleContinue(token: string): Promise<Directive> {
  // TODO: Resolve continuation token from load-steering chain
  return {
    kind: "print",
    message: `[Engine] continue token: ${token}. Steering chain resolver pending.`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(JSON.stringify({ kind: "error", message: "Usage: bun aidlc-orchestrate.ts <next|continue|report|park> [args...]" }));
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
