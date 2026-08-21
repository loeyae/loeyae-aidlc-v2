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

const HARNESS_INSTALL_PATHS: Record<string, string> = {
  "kiro-crew": resolve(process.env.HOME || "~", ".kiro/crew/skills/loeyae-aidlc"),
  "kiro-ide": "", // user specifies project path
  "claude": "",   // user specifies project path
  "opencode": "", // user specifies project path
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
  const harness = harnessIdx >= 0 ? args[harnessIdx + 1] : "kiro-crew";
  const targetIdx = args.indexOf("--target");
  const target = targetIdx >= 0 ? args[targetIdx + 1] : HARNESS_INSTALL_PATHS[harness];

  if (!target) {
    console.error(`No default install path for harness "${harness}". Use --target <path>.`);
    process.exit(1);
  }

  console.log(`🔧 Building harness: ${harness}...`);
  run("scripts/build.ts", ["--harness", harness]);

  const distDir = resolve(ROOT, "dist", harness, "skills/loeyae-aidlc");
  if (!existsSync(distDir)) {
    // Fallback: some harnesses put output differently
    const altDist = resolve(ROOT, "dist", harness);
    if (!existsSync(altDist)) {
      console.error(`❌ Build output not found at ${distDir}`);
      process.exit(1);
    }
  }

  console.log(`📦 Installing to: ${target}`);
  if (existsSync(target)) {
    rmSync(target, { recursive: true });
  }
  mkdirSync(dirname(target), { recursive: true });

  const srcDir = existsSync(distDir) ? distDir : resolve(ROOT, "dist", harness);
  cpSync(srcDir, target, { recursive: true });

  console.log(`✅ Installed loeyae-aidlc v${PKG.version} (${harness}) → ${target}`);
  console.log(`\n⚠️  Restart Kiro Crew gateway to activate: kirocrew restart`);
}

function help() {
  console.log(`
loeyae-aidlc v${PKG.version} — AI-DLC Engine CLI

Usage:
  loeyae-aidlc <command> [options]

Commands:
  orchestrate <next|report|park> [flags]   Run the workflow engine
  install [--harness <name>] [--target <path>]  Deploy skill to platform
  build --harness <name> | --all           Compile dist output
  graph <compile|validate>                 Stage graph operations
  version                                  Print version
  help                                     Show this message

Install examples:
  loeyae-aidlc install                     Install to Kiro Crew (default)
  loeyae-aidlc install --harness kiro-ide --target ./my-project

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
