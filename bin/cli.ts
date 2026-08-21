#!/usr/bin/env node
/**
 * loeyae-aidlc CLI — Global entry point.
 *
 * Subcommands:
 *   orchestrate <next|report|park> [flags]  — Run the workflow engine
 *   install --harness <name>                — Deploy skill to target platform
 *   build --harness <name> | --all          — Compile dist output
 *   graph <compile|validate>                — Stage graph operations
 *   version                                 — Print version
 *   help                                    — Show usage
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { readFileSync, existsSync, cpSync, mkdirSync, rmSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKG = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));

/**
 * Global install paths per harness.
 * All paths that can be resolved without a --target are "global installs".
 * Paths that are empty require --target (project-level deploy).
 */
const HOME = process.env.HOME || process.env.USERPROFILE || "~";
const HARNESS_INSTALL_PATHS: Record<string, string> = {
  // Kiro Crew Dashboard — global skill
  "kiro-crew": resolve(HOME, ".kiro/crew/skills/loeyae-aidlc"),
  // Kiro IDE — global Power (user's .kiro/powers/ or project-level)
  "kiro-ide": resolve(HOME, ".kiro/powers/loeyae-aidlc"),
  // Kiro CLI — global agent skill (same structure as Kiro IDE)
  "kiro-cli": resolve(HOME, ".kiro/skills/loeyae-aidlc"),
  // Claude Code — global plugin
  "claude": resolve(HOME, ".claude/plugins/loeyae-aidlc"),
  // OpenCode — global plugin
  "opencode": resolve(HOME, ".config/opencode/plugins/loeyae-aidlc"),
  // Codex — global agent instructions
  "codex": resolve(HOME, ".codex/agents/loeyae-aidlc"),
};

const HARNESS_DESCRIPTIONS: Record<string, string> = {
  "kiro-crew": "Kiro Crew Dashboard (global skill)",
  "kiro-ide": "Kiro IDE (global Power)",
  "kiro-cli": "Kiro CLI (global agent skill)",
  "claude": "Claude Code (global plugin)",
  "opencode": "OpenCode (global plugin)",
  "codex": "Codex (global agent)",
};

function run(script: string, args: string[]) {
  const cmd = `npx tsx ${resolve(ROOT, script)} ${args.join(" ")}`;
  try {
    const result = execSync(cmd, { stdio: "pipe", cwd: process.cwd(), encoding: "utf-8" });
    process.stdout.write(result);
  } catch (e: any) {
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
    process.exit(e.status || 1);
  }
}

function install(args: string[]) {
  const harnessIdx = args.indexOf("--harness");
  const harness = harnessIdx >= 0 ? args[harnessIdx + 1] : "";
  const targetIdx = args.indexOf("--target");
  const customTarget = targetIdx >= 0 ? args[targetIdx + 1] : "";
  const installAll = args.includes("--all");
  const listMode = args.includes("--list");

  // List available harnesses
  if (listMode) {
    console.log("Available harnesses:\n");
    for (const [name, desc] of Object.entries(HARNESS_DESCRIPTIONS)) {
      const path = HARNESS_INSTALL_PATHS[name];
      console.log(`  ${name.padEnd(12)} ${desc}`);
      console.log(`  ${"".padEnd(12)} → ${path}`);
    }
    return;
  }

  // Install all harnesses
  if (installAll) {
    console.log("🔧 Installing to ALL platforms...\n");
    for (const name of Object.keys(HARNESS_INSTALL_PATHS)) {
      try {
        installOne(name, "");
      } catch (e: any) {
        console.error(`  ❌ ${name}: ${e.message}\n`);
      }
    }
    console.log("\n⚠️  Restart affected platforms to activate.");
    return;
  }

  // Single harness install (default: kiro-crew)
  const targetHarness = harness || "kiro-crew";
  installOne(targetHarness, customTarget);
}

function installOne(harness: string, customTarget: string) {
  const target = customTarget || HARNESS_INSTALL_PATHS[harness];
  if (!target) {
    console.error(`Unknown harness "${harness}". Available: ${Object.keys(HARNESS_INSTALL_PATHS).join(", ")}`);
    process.exit(1);
  }

  // Map harness name to build harness (kiro-cli uses kiro-ide build)
  const buildHarness = getBuildHarness(harness);

  console.log(`🔧 Building harness: ${buildHarness} (for ${HARNESS_DESCRIPTIONS[harness] || harness})...`);
  run("scripts/build.ts", ["--harness", buildHarness]);

  // Find the dist output
  const distSkillDir = resolve(ROOT, "dist", buildHarness, "skills/loeyae-aidlc");
  const distRoot = resolve(ROOT, "dist", buildHarness);
  const srcDir = existsSync(distSkillDir) ? distSkillDir : distRoot;

  if (!existsSync(srcDir)) {
    throw new Error(`Build output not found at ${srcDir}`);
  }

  console.log(`📦 Installing to: ${target}`);
  if (existsSync(target)) {
    rmSync(target, { recursive: true });
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(srcDir, target, { recursive: true });

  console.log(`✅ Installed loeyae-aidlc v${PKG.version} (${harness}) → ${target}\n`);
}

/**
 * Map logical harness names to build harness names.
 * Multiple platforms may share a build output (e.g. kiro-cli uses kiro-ide).
 */
function getBuildHarness(harness: string): string {
  const mapping: Record<string, string> = {
    "kiro-crew": "kiro-crew",
    "kiro-ide": "kiro-ide",
    "kiro-cli": "kiro-ide",  // Kiro CLI uses same structure as Kiro IDE
    "claude": "claude",
    "opencode": "opencode",
    "codex": "claude",       // Codex uses similar structure to Claude
  };
  return mapping[harness] || harness;
}

function help() {
  console.log(`
loeyae-aidlc v${PKG.version} — AI-DLC Engine CLI

Usage:
  loeyae-aidlc <command> [options]

Commands:
  orchestrate <next|report|park> [flags]   Run the workflow engine
  install [options]                         Deploy skill to platform(s)
  build --harness <name> | --all           Compile dist output
  graph <compile|validate>                 Stage graph operations
  version                                  Print version
  help                                     Show this message

Install options:
  --harness <name>   Target platform (default: kiro-crew)
  --target <path>    Custom install path (overrides default)
  --all              Install to ALL platforms at once
  --list             Show available platforms and paths

Supported platforms:
  kiro-crew    Kiro Crew Dashboard    → ~/.kiro/crew/skills/loeyae-aidlc/
  kiro-ide     Kiro IDE (Power)       → ~/.kiro/powers/loeyae-aidlc/
  kiro-cli     Kiro CLI               → ~/.kiro/skills/loeyae-aidlc/
  claude       Claude Code            → ~/.claude/plugins/loeyae-aidlc/
  opencode     OpenCode               → ~/.config/opencode/plugins/loeyae-aidlc/
  codex        Codex                  → ~/.codex/agents/loeyae-aidlc/

Install examples:
  loeyae-aidlc install                          # Kiro Crew (default)
  loeyae-aidlc install --harness claude         # Claude Code global
  loeyae-aidlc install --harness kiro-cli       # Kiro CLI global
  loeyae-aidlc install --all                    # All platforms
  loeyae-aidlc install --harness claude --target ./my-project  # Project-level

Orchestrate examples:
  loeyae-aidlc orchestrate next --scope feature
  loeyae-aidlc orchestrate report --stage requirements-analysis --result completed
  loeyae-aidlc orchestrate next --status
`);
}

// --- Main ---
const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case "orchestrate":
    run("core/tools/aidlc-orchestrate.ts", rest);
    break;
  case "install":
    install(rest);
    break;
  case "build":
    run("scripts/build.ts", rest);
    break;
  case "graph":
    run("core/tools/aidlc-graph.ts", rest);
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(`loeyae-aidlc v${PKG.version}`);
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    help();
    break;
  default:
    console.error(`Unknown command: ${cmd}. Run 'loeyae-aidlc help' for usage.`);
    process.exit(1);
}
