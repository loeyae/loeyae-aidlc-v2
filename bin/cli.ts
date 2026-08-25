#!/usr/bin/env node
/**
 * loeyae-aidlc CLI — Global entry point.
 *
 * Subcommands:
 *   orchestrate <next|report|park> [flags]  — Run the workflow engine
 *   evidence run [flags]                    — Produce controlled build/test evidence
 *   check --sensor <name>                  — Run a deterministic semantic checker
 *   diagram-provider run [flags]              — Run Chrome DevTools diagram validation
 *   install --harness <name>                — Deploy skill to target platform
 *   build --harness <name> | --all          — Compile dist output
 *   graph <compile|validate>                — Stage graph operations
 *   version                                 — Print version
 *   help                                    — Show usage
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, cpSync, mkdirSync, rmSync, renameSync } from "fs";
import { mergeMcpServers } from "../core/tools/aidlc-mcp-config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const PKG = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));

/**
 * Global install paths per harness.
 * All paths that can be resolved without a --target are "global installs".
 * Paths that are empty require --target (project-level deploy).
 */
const HOME = process.env.HOME || process.env.USERPROFILE || "~";
const CLAUDE_MARKETPLACE_NAME = "loeyae-aidlc";
const CLAUDE_GLOBAL_MARKETPLACE_ROOT = resolve(HOME, ".claude/plugins/loeyae-aidlc-marketplace");
const CLAUDE_GLOBAL_PLUGIN_ROOT = resolve(CLAUDE_GLOBAL_MARKETPLACE_ROOT, "plugins/loeyae-aidlc");
const OPENCODE_GLOBAL_CONFIG_ROOT = resolve(HOME, ".config/opencode");
const OPENCODE_GLOBAL_PLUGIN_PATH = resolve(OPENCODE_GLOBAL_CONFIG_ROOT, "plugins/loeyae-aidlc.js");
const OPENCODE_GLOBAL_ASSET_ROOT = resolve(OPENCODE_GLOBAL_CONFIG_ROOT, "loeyae-aidlc");
const CODEX_GLOBAL_HOOKS_PATH = resolve(HOME, ".codex/hooks.json");
const HARNESS_INSTALL_PATHS: Record<string, string> = {
  // Kiro Crew Dashboard — global skill
  "kiro-crew": resolve(HOME, ".kiro/crew/skills/loeyae-aidlc"),
  // Kiro IDE — global Power (user's .kiro/powers/ or project-level)
  "kiro-ide": resolve(HOME, ".kiro/powers/loeyae-aidlc"),
  // Kiro CLI — global Agent Skill
  "kiro-cli": resolve(HOME, ".kiro/skills/loeyae-aidlc"),
  // Claude Code — staged plugin source; Claude Code copies it to its official cache.
  "claude": CLAUDE_GLOBAL_PLUGIN_ROOT,
  // OpenCode — direct global plugin entry; assets are staged beside the config.
  "opencode": OPENCODE_GLOBAL_PLUGIN_PATH,
  // Codex — global skill (Codex's native skill discovery path)
  "codex": resolve(HOME, ".agents/skills/loeyae-aidlc"),
};

const HARNESS_DESCRIPTIONS: Record<string, string> = {
  "kiro-crew": "Kiro Crew Dashboard (global skill)",
  "kiro-ide": "Kiro IDE (global Power)",
  "kiro-cli": "Kiro CLI (global agent skill)",
  "claude": "Claude Code (official user/project plugin)",
  "opencode": "OpenCode (global plugin)",
  "codex": "Codex (global skill)",
};

function registerKiroMcp() {
  const sourcePath = resolve(ROOT, "harness/kiro-crew/mcp.json");
  const targetPath = resolve(HOME, ".kiro/settings/mcp.json");
  const defaults = JSON.parse(readFileSync(sourcePath, "utf-8"));
  const current = existsSync(targetPath)
    ? JSON.parse(readFileSync(targetPath, "utf-8"))
    : {};
  const merged = mergeMcpServers(current, defaults.mcpServers);

  if (merged.added.length === 0) {
    console.log(`🔌 Kiro MCP services already present; preserved: ${merged.preserved.join(", ") || "none"}`);
    return;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(merged.config, null, 2)}\n`);
  renameSync(temporaryPath, targetPath);
  console.log(`🔌 Added Kiro MCP services: ${merged.added.join(", ")}`);
}
function registerCodexHooks(sourcePath: string) {
  const defaults = JSON.parse(readFileSync(sourcePath, "utf-8"));
  const current = existsSync(CODEX_GLOBAL_HOOKS_PATH)
    ? JSON.parse(readFileSync(CODEX_GLOBAL_HOOKS_PATH, "utf-8"))
    : {};
  const merged = { ...current, hooks: { ...(current.hooks || {}) } };
  let added = 0;

  for (const [event, groups] of Object.entries(defaults.hooks || {})) {
    const currentGroups = Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [];
    const existing = new Set(currentGroups.map((group: unknown) => JSON.stringify(group)));
    for (const group of groups as unknown[]) {
      const serialized = JSON.stringify(group);
      if (!existing.has(serialized)) {
        currentGroups.push(group);
        existing.add(serialized);
        added++;
      }
    }
    merged.hooks[event] = currentGroups;
  }

  if (added === 0) {
    console.log("🔒 Codex AI-DLC lifecycle hooks already present; preserved existing hooks.");
    return;
  }

  mkdirSync(dirname(CODEX_GLOBAL_HOOKS_PATH), { recursive: true });
  const temporaryPath = `${CODEX_GLOBAL_HOOKS_PATH}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`);
  renameSync(temporaryPath, CODEX_GLOBAL_HOOKS_PATH);
  console.log(`🔒 Added Codex AI-DLC lifecycle hooks: ${CODEX_GLOBAL_HOOKS_PATH}`);
}


function run(script: string, args: string[]) {
  const tsx = require.resolve("tsx/cli");
  const result = spawnSync(process.execPath, [tsx, resolve(ROOT, script), ...args], {
    stdio: "pipe",
    cwd: process.cwd(),
    encoding: "utf-8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runExternal(command: string, args: string[], cwd: string): number {
  const result = spawnSync(command, args, { stdio: "inherit", cwd });
  if (result.error) {
    console.error(`❌ Failed to run ${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

interface ClaudeDeployment {
  marketplaceRoot: string;
  pluginRoot: string;
  scope: "user" | "project";
  cwd: string;
}

function getClaudeDeployment(customTarget: string): ClaudeDeployment {
  const projectRoot = customTarget ? resolve(customTarget) : "";
  const marketplaceRoot = customTarget
    ? resolve(projectRoot, ".claude/loeyae-aidlc-marketplace")
    : CLAUDE_GLOBAL_MARKETPLACE_ROOT;
  return {
    marketplaceRoot,
    pluginRoot: resolve(marketplaceRoot, "plugins/loeyae-aidlc"),
    scope: customTarget ? "project" : "user",
    cwd: customTarget ? projectRoot : process.cwd(),
  };
}

function registerClaudePlugin(deployment: ClaudeDeployment) {
  const marketplace = {
    name: CLAUDE_MARKETPLACE_NAME,
    owner: { name: "Loeyae Team", url: "https://github.com/loeyae" },
    description: "Loeyae AI-DLC v2 plugin marketplace",
    plugins: [{
      name: "loeyae-aidlc",
      source: "./plugins/loeyae-aidlc",
      description: "Loeyae AI-DLC v2 engine-driven lifecycle with enforced stage gates.",
      version: PKG.version,
    }],
  };
  const catalogDir = resolve(deployment.marketplaceRoot, ".claude-plugin");
  mkdirSync(catalogDir, { recursive: true });
  const catalogPath = resolve(catalogDir, "marketplace.json");
  const temporaryPath = `${catalogPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(marketplace, null, 2)}\n`);
  renameSync(temporaryPath, catalogPath);

  const addStatus = runExternal(
    "claude",
    ["plugin", "marketplace", "add", deployment.marketplaceRoot, "--scope", deployment.scope],
    deployment.cwd,
  );
  if (addStatus !== 0) {
    throw new Error(`Claude Code marketplace registration failed: ${deployment.marketplaceRoot}`);
  }

  const pluginRef = `loeyae-aidlc@${CLAUDE_MARKETPLACE_NAME}`;
  const installStatus = runExternal(
    "claude",
    ["plugin", "install", pluginRef, "--scope", deployment.scope],
    deployment.cwd,
  );
  if (installStatus === 0) {
    console.log(`🔌 Claude Code plugin registered and installed (${deployment.scope} scope): ${pluginRef}`);
    return;
  }

  const updateStatus = runExternal(
    "claude",
    ["plugin", "update", pluginRef, "--scope", deployment.scope],
    deployment.cwd,
  );
  if (updateStatus !== 0) {
    throw new Error(`Claude Code plugin install/update failed: ${pluginRef}`);
  }
  console.log(`🔌 Claude Code plugin marketplace refreshed (${deployment.scope} scope): ${pluginRef}`);
}

function installOpenCodeGlobal(sourceRoot: string) {
  const pluginSource = resolve(sourceRoot, "plugins/loeyae-aidlc.js");
  if (!existsSync(pluginSource)) {
    throw new Error(`OpenCode plugin entry not found at ${pluginSource}`);
  }

  if (existsSync(OPENCODE_GLOBAL_ASSET_ROOT)) {
    rmSync(OPENCODE_GLOBAL_ASSET_ROOT, { recursive: true });
  }
  mkdirSync(OPENCODE_GLOBAL_CONFIG_ROOT, { recursive: true });
  cpSync(sourceRoot, OPENCODE_GLOBAL_ASSET_ROOT, { recursive: true });
  rmSync(resolve(OPENCODE_GLOBAL_ASSET_ROOT, "plugins"), { recursive: true });
  mkdirSync(dirname(OPENCODE_GLOBAL_PLUGIN_PATH), { recursive: true });
  cpSync(pluginSource, OPENCODE_GLOBAL_PLUGIN_PATH);
}

function installKiroProjectHook(harness: string, projectRoot: string, distRoot: string) {
  if (harness !== "kiro-ide" && harness !== "kiro-cli") return;
  const sourcePath = resolve(distRoot, "hooks", "aidlc-gates.json");
  if (!existsSync(sourcePath)) throw new Error(`Kiro lifecycle hook config not found at ${sourcePath}`);
  const targetPath = resolve(projectRoot, ".kiro/hooks/loeyae-aidlc.json");
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath);
  console.log(`🔒 Installed ${harness} project Stop Hook → ${targetPath}`);
}

function install(args: string[]) {
  const harnessIdx = args.indexOf("--harness");
  const harness = harnessIdx >= 0 ? args[harnessIdx + 1] : "";
  const targetIdx = args.indexOf("--target");
  const customTarget = targetIdx >= 0 ? args[targetIdx + 1] : "";
  const projectIdx = args.indexOf("--project");
  const projectTarget = projectIdx >= 0 ? args[projectIdx + 1] : "";
  if (customTarget && projectTarget) {
    throw new Error("--target and --project cannot be used together");
  }
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
        installOne(name, "", "");
      } catch (e: any) {
        console.error(`  ❌ ${name}: ${e.message}\n`);
      }
    }
    console.log("\n⚠️  Restart affected platforms to activate.");
    return;
  }

  // Single harness install (default: kiro-crew)
  const targetHarness = harness || "kiro-crew";
  installOne(targetHarness, customTarget, projectTarget);
}

function installOne(harness: string, customTarget: string, projectTarget: string) {
  const claudeDeployment = harness === "claude" ? getClaudeDeployment(customTarget) : undefined;
  const opencodeGlobal = harness === "opencode" && !customTarget;
  const target = claudeDeployment?.pluginRoot
    || (opencodeGlobal ? OPENCODE_GLOBAL_PLUGIN_PATH : customTarget)
    || HARNESS_INSTALL_PATHS[harness];
  if (!target) {
    console.error(`Unknown harness "${harness}". Available: ${Object.keys(HARNESS_INSTALL_PATHS).join(", ")}`);
    process.exit(1);
  }

  // Map harness name to build harness (kiro-cli uses kiro-ide build)
  const buildHarness = getBuildHarness(harness);

  // Published packages already contain the complete dist output. Rebuild only
  // when running from a source checkout without a prebuilt harness directory.
  const distRoot = resolve(ROOT, "dist", buildHarness);
  if (existsSync(distRoot)) {
    console.log(`📦 Using prebuilt harness: ${distRoot}`);
  } else {
    console.log(`🔨 Building harness: ${buildHarness} (for ${HARNESS_DESCRIPTIONS[harness] || harness})...`);
    run("scripts/build.ts", ["--harness", buildHarness]);
  }

  // Find the dist output — try known content root patterns
  const distSkillDir = resolve(ROOT, "dist", buildHarness, "skills/loeyae-aidlc");
  const distAgentsSkillDir = resolve(ROOT, "dist", buildHarness, ".agents/skills/loeyae-aidlc");
  const srcDir = harness === "claude" ? distRoot
    : existsSync(distSkillDir) ? distSkillDir
    : existsSync(distAgentsSkillDir) ? distAgentsSkillDir
    : distRoot;

  if (!existsSync(srcDir)) {
    throw new Error(`Build output not found at ${srcDir}`);
  }

  if (opencodeGlobal) {
    installOpenCodeGlobal(resolve(distRoot, ".opencode"));
    console.log(`✅ Installed loeyae-aidlc v${PKG.version} (${harness}) → ${target}\n`);
    return;
  }

  console.log(`📦 Installing to: ${target}`);
  if (existsSync(target)) {
    rmSync(target, { recursive: true });
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(srcDir, target, { recursive: true });

  if ((harness === "kiro-crew" || harness === "kiro-cli") && !customTarget) {
    registerKiroMcp();
  }
  if (harness === "codex" && !customTarget) {
    registerCodexHooks(resolve(srcDir, "hooks/hooks.json"));
  }
  if (projectTarget) {
    installKiroProjectHook(harness, projectTarget, distRoot);
  }
  if (claudeDeployment) {
    registerClaudePlugin(claudeDeployment);
  }

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
    "kiro-cli": "kiro-cli",
    "claude": "claude",
    "opencode": "opencode",
    "codex": "codex",        // Codex has its own manifest (global skill layout)
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
  evidence run [flags]                   Produce controlled build/test evidence
  check --sensor <name>                  Run a deterministic semantic checker
  diagram-provider run [options]         Run Chrome DevTools diagram validation
  hook --format <platform>                Enforce the active AI-DLC stage gate
  install [options]                         Deploy skill to platform(s)
  build --harness <name> | --all           Compile dist output
  graph <compile|validate>                 Stage graph operations
  scope-table                              Show executable stage counts by scope
  version                                 Print version
  help                                     Show this message

Install options:
  --harness <name>   Target platform (default: kiro-crew)
  --target <path>    Custom install path (overrides default)
  --project <path>   Also install Kiro project lifecycle hooks under <path>/.kiro/hooks/
  --all              Install to ALL platforms at once
  --list             Show available platforms and paths

Supported platforms:
  kiro-crew    Kiro Crew Dashboard    → ~/.kiro/crew/skills/loeyae-aidlc/
  kiro-ide     Kiro IDE (Power)       → ~/.kiro/powers/loeyae-aidlc/
  kiro-cli     Kiro CLI               → ~/.kiro/skills/loeyae-aidlc/
  claude       Claude Code            → ~/.claude/plugins/loeyae-aidlc-marketplace/
  opencode     OpenCode               → ~/.config/opencode/plugins/loeyae-aidlc.js
  codex        Codex                  → ~/.agents/skills/loeyae-aidlc/

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
  case "evidence":
    run("core/tools/aidlc-evidence.ts", rest);
    break;
  case "check":
    run("core/tools/aidlc-semantic-checks.ts", rest);
    break;
  case "diagram-provider":
    run("core/tools/aidlc-diagram-provider.ts", rest);
    break;
  case "hook":
    run("core/tools/aidlc-platform-hook.ts", rest);
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
  case "scope-table":
    run("core/tools/aidlc-utility.ts", ["scope-table"]);
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
