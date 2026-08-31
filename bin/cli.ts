#!/usr/bin/env node
/** Loeyae AI-DLC command line entry point. */

import path, { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { spawnSync } from "child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { updateMcpConfig } from "../core/tools/aidlc-mcp-config";
import {
  installManagedAssets,
  ManagedAsset,
  uninstallManagedAssets,
  updateSharedJson,
} from "../core/tools/aidlc-installer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const PKG = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const HOME = process.env.HOME || process.env.USERPROFILE || "~";
const CLAUDE_MARKETPLACE_NAME = "loeyae-aidlc";
const CLAUDE_GLOBAL_MARKETPLACE_ROOT = resolve(HOME, ".claude/plugins/loeyae-aidlc-marketplace");
const CLAUDE_GLOBAL_PLUGIN_ROOT = resolve(CLAUDE_GLOBAL_MARKETPLACE_ROOT, "plugins/loeyae-aidlc");
const OPENCODE_GLOBAL_CONFIG_ROOT = resolve(HOME, ".config/opencode");
const OPENCODE_GLOBAL_PLUGIN_PATH = resolve(OPENCODE_GLOBAL_CONFIG_ROOT, "plugins/loeyae-aidlc.js");
const OPENCODE_GLOBAL_ASSET_ROOT = resolve(OPENCODE_GLOBAL_CONFIG_ROOT, "loeyae-aidlc");
const CODEX_GLOBAL_HOOKS_PATH = resolve(HOME, ".codex/hooks.json");
const CODEX_HOOK_ID = "loeyae-aidlc-stop-gate-v1";

const HARNESS_INSTALL_PATHS: Record<string, string> = {
  "kiro-crew": resolve(HOME, ".kiro/crew/skills/loeyae-aidlc"),
  "kiro-ide": resolve(HOME, ".kiro/powers/loeyae-aidlc"),
  "kiro-cli": resolve(HOME, ".kiro/skills/loeyae-aidlc"),
  claude: CLAUDE_GLOBAL_PLUGIN_ROOT,
  opencode: OPENCODE_GLOBAL_PLUGIN_PATH,
  codex: resolve(HOME, ".agents/skills/loeyae-aidlc"),
};

const HARNESS_DESCRIPTIONS: Record<string, string> = {
  "kiro-crew": "Kiro Crew Dashboard (global skill)",
  "kiro-ide": "Kiro IDE (global Power)",
  "kiro-cli": "Kiro CLI (global agent skill)",
  claude: "Claude Code (official user/project plugin)",
  opencode: "OpenCode (global plugin)",
  codex: "Codex (global skill)",
};

interface DeployOptions {
  harness: string;
  target: string;
  project: string;
  all: boolean;
  list: boolean;
}

interface ClaudeDeployment {
  marketplaceRoot: string;
  pluginRoot: string;
  catalogPath: string;
  scope: "user" | "project";
  cwd: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function run(script: string, args: string[]): never | void {
  const tsx = require.resolve("tsx/cli");
  const result = spawnSync(process.execPath, [tsx, resolve(ROOT, script), ...args], {
    stdio: "pipe",
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
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

function parseDeployOptions(args: string[], allowList: boolean): DeployOptions {
  const options: DeployOptions = { harness: "", target: "", project: "", all: false, list: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (["--harness", "--target", "--project"].includes(argument)) {
      if (seen.has(argument)) throw new Error(`duplicate option: ${argument}`);
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      seen.add(argument);
      if (argument === "--harness") options.harness = value;
      if (argument === "--target") options.target = value;
      if (argument === "--project") options.project = value;
    } else if (argument === "--all" || argument === "--list") {
      if (seen.has(argument)) throw new Error(`duplicate option: ${argument}`);
      seen.add(argument);
      if (argument === "--all") options.all = true;
      if (argument === "--list") options.list = true;
    } else {
      throw new Error(`unknown deploy option: ${argument}`);
    }
  }
  if (options.list && !allowList) throw new Error("--list is only valid with install");
  if (options.list && (options.harness || options.target || options.project || options.all)) throw new Error("--list cannot be combined with other install options");
  if (options.all && (options.harness || options.target || options.project)) throw new Error("--all cannot be combined with --harness, --target, or --project");
  if (options.target && options.project) throw new Error("--target and --project cannot be used together");
  if (options.harness && !HARNESS_INSTALL_PATHS[options.harness]) {
    throw new Error(`unknown harness "${options.harness}"; available: ${Object.keys(HARNESS_INSTALL_PATHS).join(", ")}`);
  }
  if (options.project && !["kiro-ide", "kiro-cli"].includes(options.harness)) {
    throw new Error("--project requires --harness kiro-ide or --harness kiro-cli");
  }
  return options;
}

function getBuildHarness(harness: string): string {
  return harness;
}

function newestMtime(target: string): number {
  if (!existsSync(target)) return 0;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) return stat.mtimeMs;
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const name of readdirSync(target)) newest = Math.max(newest, newestMtime(resolve(target, name)));
  return newest;
}

function ensureDist(harness: string): string {
  const buildHarness = getBuildHarness(harness);
  const distRoot = resolve(ROOT, "dist", buildHarness);
  const sourcePaths = [resolve(ROOT, "core"), resolve(ROOT, "harness", buildHarness), resolve(ROOT, "scripts/build.ts")];
  const sourceCheckout = sourcePaths.every((entry) => existsSync(entry));
  const stale = sourceCheckout && newestMtime(distRoot) + 1 < Math.max(...sourcePaths.map(newestMtime));
  if (!existsSync(distRoot) || stale) {
    console.log(`${stale ? "♻️  Prebuilt harness is stale; rebuilding" : "🔨 Building harness"}: ${buildHarness}`);
    run("scripts/build.ts", ["--harness", buildHarness]);
  } else {
    console.log(`📦 Using current prebuilt harness: ${distRoot}`);
  }
  if (!existsSync(distRoot)) throw new Error(`build output not found: ${distRoot}`);
  return distRoot;
}

function findInstallSource(harness: string, distRoot: string): string {
  const skill = resolve(distRoot, "skills/loeyae-aidlc");
  const agentSkill = resolve(distRoot, ".agents/skills/loeyae-aidlc");
  const source = harness === "claude" ? distRoot : existsSync(skill) ? skill : existsSync(agentSkill) ? agentSkill : distRoot;
  if (!existsSync(source)) throw new Error(`build output not found: ${source}`);
  return source;
}

function getClaudeDeployment(customTarget: string): ClaudeDeployment {
  const projectRoot = customTarget ? resolve(customTarget) : "";
  if (customTarget) {
    if (!existsSync(projectRoot) || !lstatSync(projectRoot).isDirectory() || lstatSync(projectRoot).isSymbolicLink()) {
      throw new Error(`Claude --target must be an existing, non-symlink project directory: ${projectRoot}`);
    }
  }
  const marketplaceRoot = customTarget ? resolve(projectRoot, ".claude/loeyae-aidlc-marketplace") : CLAUDE_GLOBAL_MARKETPLACE_ROOT;
  return {
    marketplaceRoot,
    pluginRoot: resolve(marketplaceRoot, "plugins/loeyae-aidlc"),
    catalogPath: resolve(marketplaceRoot, ".claude-plugin/marketplace.json"),
    scope: customTarget ? "project" : "user",
    cwd: customTarget ? projectRoot : process.cwd(),
  };
}

function createClaudeCatalogSource(): { root: string; file: string } {
  const root = mkdtempSync(resolve(process.env.TMPDIR || tmpdir(), "loeyae-aidlc-claude-"));
  const file = resolve(root, "marketplace.json");
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
  writeFileSync(file, `${JSON.stringify(marketplace, null, 2)}\n`, { mode: 0o600 });
  return { root, file };
}

function registerClaudePlugin(deployment: ClaudeDeployment): void {
  const addStatus = runExternal("claude", ["plugin", "marketplace", "add", deployment.marketplaceRoot, "--scope", deployment.scope], deployment.cwd);
  if (addStatus !== 0) throw new Error(`Claude Code marketplace registration failed: ${deployment.marketplaceRoot}`);
  const pluginRef = `loeyae-aidlc@${CLAUDE_MARKETPLACE_NAME}`;
  const installStatus = runExternal("claude", ["plugin", "install", pluginRef, "--scope", deployment.scope], deployment.cwd);
  if (installStatus === 0) {
    console.log(`🔌 Claude Code plugin registered and installed (${deployment.scope} scope): ${pluginRef}`);
    return;
  }
  const updateStatus = runExternal("claude", ["plugin", "update", pluginRef, "--scope", deployment.scope], deployment.cwd);
  if (updateStatus !== 0) throw new Error(`Claude Code plugin install/update failed: ${pluginRef}`);
  console.log(`🔌 Claude Code plugin marketplace refreshed (${deployment.scope} scope): ${pluginRef}`);
}

function unregisterClaudePlugin(deployment: ClaudeDeployment): void {
  const pluginRef = `loeyae-aidlc@${CLAUDE_MARKETPLACE_NAME}`;
  const uninstallStatus = runExternal("claude", ["plugin", "uninstall", pluginRef, "--scope", deployment.scope], deployment.cwd);
  if (uninstallStatus !== 0) throw new Error(`Claude Code plugin unregister failed: ${pluginRef}`);
  const removeStatus = runExternal("claude", ["plugin", "marketplace", "remove", CLAUDE_MARKETPLACE_NAME, "--scope", deployment.scope], deployment.cwd);
  if (removeStatus !== 0) throw new Error(`Claude Code marketplace unregister failed: ${CLAUDE_MARKETPLACE_NAME}`);
}

function registerKiroMcp(): void {
  const sourcePath = resolve(ROOT, "harness/kiro-crew/mcp.json");
  const targetPath = resolve(HOME, ".kiro/settings/mcp.json");
  const defaults = JSON.parse(readFileSync(sourcePath, "utf8"));
  const merged = updateMcpConfig(targetPath, defaults.mcpServers);
  if (merged.added.length === 0 && merged.upgraded.length === 0) {
    console.log(`🔌 Kiro MCP services already present; preserved: ${merged.preserved.join(", ") || "none"}`);
    return;
  }
  const changes = [
    ...(merged.added.length ? [`added: ${merged.added.join(", ")}`] : []),
    ...(merged.upgraded.length ? [`upgraded: ${merged.upgraded.join(", ")}`] : []),
  ];
  console.log(`🔌 Updated Kiro MCP services (${changes.join("; ")})`);
}

function hookCommand(group: unknown): string {
  if (!isRecord(group) || !Array.isArray(group.hooks)) return "";
  const command = group.hooks.find((hook) => isRecord(hook) && typeof hook.command === "string");
  return isRecord(command) ? String(command.command) : "";
}

function registerCodexHooks(sourcePath: string): void {
  const defaults = JSON.parse(readFileSync(sourcePath, "utf8"));
  const result = updateSharedJson(CODEX_GLOBAL_HOOKS_PATH, (current) => {
    const currentHooks = isRecord(current.hooks) ? { ...current.hooks } : {};
    let changed = false;
    for (const [event, rawGroups] of Object.entries(defaults.hooks || {})) {
      const desiredGroups = (Array.isArray(rawGroups) ? rawGroups : []).map((group) => ({ ...(group as Record<string, unknown>), id: CODEX_HOOK_ID }));
      const existingGroups = Array.isArray(currentHooks[event]) ? [...currentHooks[event] as unknown[]] : [];
      for (const desired of desiredGroups) {
        const indices = existingGroups.map((group, index) => isRecord(group) && (group.id === CODEX_HOOK_ID || hookCommand(group) === "loeyae-aidlc hook --format codex") ? index : -1).filter((index) => index >= 0);
        if (indices.length === 0) {
          existingGroups.push(desired);
          changed = true;
        } else {
          if (JSON.stringify(existingGroups[indices[0]]) !== JSON.stringify(desired)) changed = true;
          existingGroups[indices[0]] = desired;
          for (const duplicate of indices.slice(1).reverse()) {
            existingGroups.splice(duplicate, 1);
            changed = true;
          }
        }
      }
      currentHooks[event] = existingGroups;
    }
    return { value: { ...current, hooks: currentHooks }, result: changed };
  });
  console.log(result ? `🔒 Registered Codex lifecycle Hook: ${CODEX_HOOK_ID}` : "🔒 Codex lifecycle Hook already current; preserved existing hooks.");
}

function unregisterCodexHooks(): void {
  if (!existsSync(CODEX_GLOBAL_HOOKS_PATH)) return;
  const removed = updateSharedJson(CODEX_GLOBAL_HOOKS_PATH, (current) => {
    const hooks = isRecord(current.hooks) ? { ...current.hooks } : {};
    let count = 0;
    for (const [event, rawGroups] of Object.entries(hooks)) {
      if (!Array.isArray(rawGroups)) continue;
      const retained = rawGroups.filter((group) => {
        const owned = isRecord(group) && (group.id === CODEX_HOOK_ID || hookCommand(group) === "loeyae-aidlc hook --format codex");
        if (owned) count++;
        return !owned;
      });
      if (retained.length) hooks[event] = retained;
      else delete hooks[event];
    }
    return { value: { ...current, hooks }, result: count };
  });
  if (removed) console.log(`🔓 Removed Codex lifecycle Hook: ${CODEX_HOOK_ID}`);
}

function projectHookAsset(harness: string, projectRoot: string, distRoot: string): ManagedAsset | undefined {
  if (!["kiro-ide", "kiro-cli"].includes(harness)) return undefined;
  const project = resolve(projectRoot);
  if (!existsSync(project) || !lstatSync(project).isDirectory() || lstatSync(project).isSymbolicLink()) {
    throw new Error(`--project must be an existing, non-symlink directory: ${project}`);
  }
  const source = resolve(distRoot, "hooks/aidlc-gates.json");
  if (!existsSync(source)) throw new Error(`Kiro lifecycle Hook config not found: ${source}`);
  return { source, target: resolve(project, ".kiro/hooks/loeyae-aidlc.json"), kind: "file" };
}

function installProjectHook(harness: string, projectRoot: string, distRoot: string): void {
  const asset = projectHookAsset(harness, projectRoot, distRoot);
  if (!asset) return;
  installManagedAssets("loeyae-aidlc:kiro-project-hook", [asset]);
  console.log(`🔒 Installed ${harness} project Stop Hook → ${asset.target}`);
}

function uninstallProjectHook(harness: string, projectRoot: string): void {
  if (!["kiro-ide", "kiro-cli"].includes(harness)) return;
  const target = resolve(projectRoot, ".kiro/hooks/loeyae-aidlc.json");
  const removed = uninstallManagedAssets("loeyae-aidlc:kiro-project-hook", [target]);
  console.log(removed ? `🔓 Removed project Stop Hook → ${target}` : `ℹ️  Project Stop Hook is not owned by this installer; preserved: ${target}`);
}

function installOne(harness: string, customTarget: string, projectTarget: string): void {
  const distRoot = ensureDist(harness);
  const source = findInstallSource(harness, distRoot);
  const owner = `loeyae-aidlc:${harness}`;

  if (harness === "opencode" && !customTarget) {
    const sourceRoot = resolve(distRoot, ".opencode");
    const pluginSource = resolve(sourceRoot, "plugins/loeyae-aidlc.js");
    if (!existsSync(pluginSource)) throw new Error(`OpenCode plugin entry not found: ${pluginSource}`);
    installManagedAssets(owner, [
      { source: sourceRoot, target: OPENCODE_GLOBAL_ASSET_ROOT, kind: "directory" },
      { source: pluginSource, target: OPENCODE_GLOBAL_PLUGIN_PATH, kind: "file" },
    ]);
    console.log(`✅ Installed loeyae-aidlc v${PKG.version} (${harness}) → ${OPENCODE_GLOBAL_PLUGIN_PATH}`);
    return;
  }

  if (harness === "claude") {
    const deployment = getClaudeDeployment(customTarget);
    const catalog = createClaudeCatalogSource();
    try {
      installManagedAssets(owner, [
        { source, target: deployment.pluginRoot, kind: "directory" },
        { source: catalog.file, target: deployment.catalogPath, kind: "file" },
      ], () => registerClaudePlugin(deployment));
    } finally {
      rmSync(catalog.root, { recursive: true, force: true });
    }
    console.log(`✅ Installed loeyae-aidlc v${PKG.version} (${harness}) → ${deployment.pluginRoot}`);
    return;
  }

  const target = customTarget ? resolve(customTarget) : HARNESS_INSTALL_PATHS[harness];
  const activate = (): void => {
    if ((harness === "kiro-crew" || harness === "kiro-cli") && !customTarget) registerKiroMcp();
    if (harness === "codex" && !customTarget) registerCodexHooks(resolve(source, "hooks/hooks.json"));
  };
  installManagedAssets(owner, [{ source, target, kind: "directory" }], activate);
  if (projectTarget) installProjectHook(harness, projectTarget, distRoot);
  console.log(`✅ Installed loeyae-aidlc v${PKG.version} (${harness}) → ${target}`);
}

function uninstallOne(harness: string, customTarget: string, projectTarget: string): void {
  const owner = `loeyae-aidlc:${harness}`;
  if (harness === "opencode" && !customTarget) {
    const removed = uninstallManagedAssets(owner, [OPENCODE_GLOBAL_ASSET_ROOT, OPENCODE_GLOBAL_PLUGIN_PATH]);
    console.log(removed ? `✅ Uninstalled ${harness}` : `ℹ️  ${harness} is not owned by this installer; preserved existing files.`);
    return;
  }
  if (harness === "claude") {
    const deployment = getClaudeDeployment(customTarget);
    const targets = [deployment.pluginRoot, deployment.catalogPath];
    const removed = uninstallManagedAssets(owner, targets, () => unregisterClaudePlugin(deployment));
    console.log(removed ? `✅ Uninstalled ${harness}` : `ℹ️  ${harness} is not owned by this installer; preserved existing files.`);
    return;
  }
  const target = customTarget ? resolve(customTarget) : HARNESS_INSTALL_PATHS[harness];
  const removed = uninstallManagedAssets(
    owner,
    [target],
    harness === "codex" && !customTarget ? unregisterCodexHooks : undefined,
  );
  if (projectTarget) uninstallProjectHook(harness, projectTarget);
  if ((harness === "kiro-crew" || harness === "kiro-cli") && !customTarget) {
    console.log("ℹ️  Shared Kiro MCP entries were preserved; they may be used by other installations.");
  }
  console.log(removed ? `✅ Uninstalled ${harness} → ${target}` : `ℹ️  ${harness} target is not owned by this installer; preserved: ${target}`);
}

function listHarnesses(): void {
  console.log("Available harnesses:\n");
  for (const [name, description] of Object.entries(HARNESS_DESCRIPTIONS)) {
    console.log(`  ${name.padEnd(12)} ${description}`);
    console.log(`  ${"".padEnd(12)} → ${HARNESS_INSTALL_PATHS[name]}`);
  }
}

function deploy(args: string[], operation: "install" | "uninstall"): void {
  const options = parseDeployOptions(args, operation === "install");
  if (options.list) {
    listHarnesses();
    return;
  }
  if (options.all) {
    const failures: string[] = [];
    for (const harness of Object.keys(HARNESS_INSTALL_PATHS)) {
      try {
        if (operation === "install") installOne(harness, "", "");
        else uninstallOne(harness, "", "");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${harness}: ${message}`);
        console.error(`❌ ${harness}: ${message}`);
      }
    }
    if (failures.length) throw new Error(`${operation} --all failed for ${failures.length} platform(s): ${failures.join("; ")}`);
    console.log(operation === "install" ? "⚠️  Restart affected platforms to activate." : "✅ Uninstalled all installer-owned platform assets.");
    return;
  }
  const harness = options.harness || "kiro-crew";
  if (operation === "install") installOne(harness, options.target, options.project);
  else uninstallOne(harness, options.target, options.project);
}

function help(): void {
  console.log(`
loeyae-aidlc v${PKG.version} — AI-DLC Engine CLI

Usage:
  loeyae-aidlc <command> [options]

Commands:
  orchestrate <next|report|park> [flags]  Run the workflow engine
  approve --stage <slug>                  Issue a short-lived token in an interactive human terminal
  evidence run [flags]                    Produce controlled build/test evidence
  check --sensor <name>                   Run a deterministic semantic checker
  diagram-provider run [options]          Run Chrome DevTools diagram validation
  hook --format <platform>                Enforce the active AI-DLC stage gate
  install [options]                       Transactionally deploy installer-owned assets
  uninstall [options]                     Remove only verified installer-owned assets
  build --harness <name> | --all          Compile dist output
  graph <compile|validate>                Stage graph operations
  scope-table                             Show executable stage counts by scope
  version                                 Print version
  help                                    Show this message

Install/uninstall options:
  --harness <name>  Target platform (default: kiro-crew)
  --target <path>   Dedicated install directory; Claude interprets it as project root
  --project <path>  Kiro IDE/CLI project Hook root (requires an explicit Kiro harness)
  --all             Process every platform and return nonzero if any platform fails
  --list            Show available platforms (install only)

Examples:
  loeyae-aidlc install
  loeyae-aidlc install --harness kiro-ide --project /absolute/path/to/project
  loeyae-aidlc uninstall --harness kiro-ide --project /absolute/path/to/project
  loeyae-aidlc install --all
  loeyae-aidlc approve --stage application-design
  loeyae-aidlc orchestrate report --stage application-design --result approved --approval-token <token>
`);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "orchestrate": run("core/tools/aidlc-orchestrate.ts", rest); break;
    case "approve": run("core/tools/aidlc-approve.ts", rest); break;
    case "evidence": run("core/tools/aidlc-evidence.ts", rest); break;
    case "check": run("core/tools/aidlc-semantic-checks.ts", rest); break;
    case "diagram-provider": run("core/tools/aidlc-diagram-provider.ts", rest); break;
    case "hook": run("core/tools/aidlc-platform-hook.ts", rest); break;
    case "install": deploy(rest, "install"); break;
    case "uninstall": deploy(rest, "uninstall"); break;
    case "build": run("scripts/build.ts", rest); break;
    case "graph": run("core/tools/aidlc-graph.ts", rest); break;
    case "scope-table": run("core/tools/aidlc-utility.ts", ["scope-table"]); break;
    case "version":
    case "--version":
    case "-v": console.log(`loeyae-aidlc v${PKG.version}`); break;
    case "help":
    case "--help":
    case "-h":
    case undefined: help(); break;
    default: throw new Error(`unknown command: ${command}; run 'loeyae-aidlc help' for usage`);
  }
}

try {
  main();
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
