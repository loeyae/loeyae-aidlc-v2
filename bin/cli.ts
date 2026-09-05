#!/usr/bin/env node
/** Loeyae AI-DLC command line entry point. */

import { createHash } from "crypto";
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
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { updateMcpConfig } from "../core/tools/aidlc-mcp-config";
import {
  hasManagedInstallation,
  installManagedAssets,
  migrateManagedOwnership,
  type LegacyInstallBackup,
  type ManagedAsset,
  uninstallManagedAssets,
  updateSharedJson,
} from "../core/tools/aidlc-installer";
import {
  codeBuddyConfigDirForCli,
  codeBuddyKnownCliPaths,
  hostCliInvocation,
  type WindowsDesktopHarness,
  windowsDesktopHostPaths,
} from "./host-detection";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const PKG = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const HOME = process.env.HOME || process.env.USERPROFILE || "~";
const APPLICATION_ROOTS = process.platform === "darwin"
  ? [...new Set([
      process.env.AIDLC_APPLICATIONS_ROOT ? resolve(process.env.AIDLC_APPLICATIONS_ROOT) : "/Applications",
      resolve(HOME, "Applications"),
    ])]
  : [];
const CLAUDE_MARKETPLACE_NAME = "loeyae-aidlc";
const CLAUDE_GLOBAL_MARKETPLACE_ROOT = resolve(HOME, ".claude/plugins/loeyae-aidlc-marketplace");
const CLAUDE_GLOBAL_PLUGIN_ROOT = resolve(CLAUDE_GLOBAL_MARKETPLACE_ROOT, "plugins/loeyae-aidlc");
const OPENCODE_GLOBAL_CONFIG_ROOT = resolve(HOME, ".config/opencode");
const OPENCODE_GLOBAL_PLUGIN_PATH = resolve(OPENCODE_GLOBAL_CONFIG_ROOT, "plugins/loeyae-aidlc.js");
const OPENCODE_GLOBAL_ASSET_ROOT = resolve(OPENCODE_GLOBAL_CONFIG_ROOT, "loeyae-aidlc");
const CODEX_GLOBAL_HOOKS_PATH = resolve(HOME, ".codex/hooks.json");
const CODEX_HOOK_ID = "loeyae-aidlc-stop-gate-v1";
const PLUGIN_NAME = "loeyae-aidlc";
const PLUGIN_MARKETPLACE_NAME = "loeyae-aidlc";
const HOST_ASSET_ROOT = resolve(HOME, ".config/loeyae-aidlc/host-assets");
const CODEBUDDY_USER_MARKETPLACE_ROOT = resolve(HOST_ASSET_ROOT, "codebuddy/user");
const QODER_USER_PLUGIN_ROOT = resolve(HOST_ASSET_ROOT, "qoder/user/loeyae-aidlc");
const ZCODE_GLOBAL_SKILL_ROOT = resolve(HOME, ".zcode/skills/loeyae-aidlc");
const ZCODE_GLOBAL_CONFIG_PATH = resolve(HOME, ".zcode/cli/config.json");
const KIRO_GLOBAL_SKILL_ROOT = resolve(HOME, ".kiro/skills/loeyae-aidlc");
const KIRO_GLOBAL_SKILL_OWNER = "loeyae-aidlc:kiro-global-skill";
const KIRO_LEGACY_CLI_SKILL_OWNER = "loeyae-aidlc:kiro-cli";
const KIRO_LEGACY_IDE_POWER_ROOT = resolve(HOME, ".kiro/powers/loeyae-aidlc");
const KIRO_LEGACY_IDE_POWER_OWNER = "loeyae-aidlc:kiro-ide";

const HARNESS_INSTALL_PATHS: Record<string, string> = {
  "kiro-crew": resolve(HOME, ".kiro/crew/skills/loeyae-aidlc"),
  "kiro-ide": KIRO_GLOBAL_SKILL_ROOT,
  "kiro-cli": KIRO_GLOBAL_SKILL_ROOT,
  claude: CLAUDE_GLOBAL_PLUGIN_ROOT,
  opencode: OPENCODE_GLOBAL_PLUGIN_PATH,
  codex: resolve(HOME, ".agents/skills/loeyae-aidlc"),
  codebuddy: CODEBUDDY_USER_MARKETPLACE_ROOT,
  qoder: QODER_USER_PLUGIN_ROOT,
  zcode: ZCODE_GLOBAL_SKILL_ROOT,
};

const HARNESS_DESCRIPTIONS: Record<string, string> = {
  "kiro-crew": "Kiro Crew Dashboard (global skill)",
  "kiro-ide": "Kiro IDE (shared global Agent Skill)",
  "kiro-cli": "Kiro CLI (shared global Agent Skill)",
  claude: "Claude Code (official user/project plugin)",
  opencode: "OpenCode (global plugin)",
  codex: "Codex (global skill)",
  codebuddy: "WorkBuddy Enterprise / CodeBuddy (official plugin)",
  qoder: "Qoder Desktop / CLI (official plugin; registered via qoder CLI)",
  zcode: "ZCode (user skill + user Hook/MCP; plugin marketplace also built)",
};

interface DeployOptions {
  harness: string;
  target: string;
  project: string;
  all: boolean;
  list: boolean;
  migrateLegacy: boolean;
}

interface ClaudeDeployment {
  marketplaceRoot: string;
  pluginRoot: string;
  catalogPath: string;
  scope: "user" | "project";
  cwd: string;
}

interface CodeBuddyDeployment {
  marketplaceRoot: string;
  marketplaceName: string;
  pluginRoot: string;
  pluginRef: string;
  scope: "user" | "project";
  cwd: string;
}

interface QoderDeployment {
  pluginRoot: string;
  scope: "user" | "project";
  cwd: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function run(script: string, args: string[], input?: string): never | void {
  const tsx = require.resolve("tsx/cli");
  const result = spawnSync(process.execPath, [tsx, resolve(ROOT, script), ...args], {
    stdio: "pipe",
    cwd: process.cwd(),
    encoding: "utf8",
    input,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runExternal(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): number {
  const invocation = hostCliInvocation(command);
  const result = spawnSync(invocation.command, [...invocation.argsPrefix, ...args], { stdio: "inherit", cwd, env });
  if (result.error) {
    console.error(`❌ Failed to run ${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function commandOnPath(command: string): string | undefined {
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const directory of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = resolve(directory, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function firstExistingPath(candidates: string[]): string | undefined {
  return candidates.find((candidate) => existsSync(candidate));
}

function applicationPaths(...relativePaths: string[]): string[] {
  return APPLICATION_ROOTS.flatMap((root) => relativePaths.map((relativePath) => resolve(root, relativePath)));
}

function windowsDesktopEvidence(harness: WindowsDesktopHarness): string | undefined {
  return firstExistingPath(windowsDesktopHostPaths(harness));
}

function kiroCrewKnownPaths(): string[] {
  const dataHome = process.env.KIROCREW_HOME?.trim() || resolve(HOME, ".kiro/crew");
  const venvRoot = process.env.KIROCREW_VENV?.trim() || resolve(HOME, ".kiro/crew-venv");
  const localAppData = process.env.LOCALAPPDATA?.trim();
  const programFilesRoots = [
    process.env.ProgramW6432?.trim(),
    process.env.ProgramFiles?.trim(),
    process.env["ProgramFiles(x86)"]?.trim(),
  ].filter((root): root is string => Boolean(root));
  return [
    ...programFilesRoots.map((root) => resolve(root, "KiroCrew/KiroCrew.exe")),
    ...(localAppData ? [resolve(localAppData, "Programs/KiroCrew/KiroCrew.exe")] : []),
    resolve(dataHome, "channel"),
    resolve(venvRoot, "Scripts/kirocrew.exe"),
    resolve(venvRoot, "Scripts/kirocrew"),
    resolve(venvRoot, "bin/kirocrew"),
  ];
}

function discoverHostCli(environmentVariable: string, command: string, knownPaths: string[] = []): string | undefined {
  const configured = process.env[environmentVariable]?.trim();
  if (configured) {
    if (existsSync(configured)) return resolve(configured);
    return commandOnPath(configured);
  }
  return commandOnPath(command) || firstExistingPath(knownPaths);
}

function hostEvidence(harness: string): string | undefined {
  switch (harness) {
    case "kiro-crew":
      return commandOnPath("kirocrew")
        || firstExistingPath(kiroCrewKnownPaths())
        || windowsDesktopEvidence("kiro-crew")
        || firstExistingPath(applicationPaths("KiroCrew.app"));
    case "kiro-ide":
      return commandOnPath("kiro")
        || windowsDesktopEvidence("kiro-ide")
        || firstExistingPath(applicationPaths("Kiro.app"));
    case "kiro-cli":
      return commandOnPath("kiro-cli");
    case "claude":
      return commandOnPath("claude");
    case "opencode":
      return commandOnPath("opencode")
        || windowsDesktopEvidence("opencode")
        || firstExistingPath(applicationPaths("OpenCode.app"));
    case "codex":
      return commandOnPath("codex")
        || windowsDesktopEvidence("codex")
        || firstExistingPath(applicationPaths("Codex.app"));
    case "codebuddy":
      return discoverHostCli("CODEBUDDY_CLI", "codebuddy", codeBuddyKnownCliPaths());
    case "qoder":
      return discoverHostCli("QODER_CLI", "qoder");
    case "zcode":
      return commandOnPath("zcode")
        || windowsDesktopEvidence("zcode")
        || firstExistingPath(applicationPaths("ZCode.app", "Zcode.app"));
    default:
      return undefined;
  }
}

function detectAvailableHarnesses(): string[] {
  const available: Array<{ harness: string; evidence: string }> = [];
  const unavailable: string[] = [];
  for (const harness of Object.keys(HARNESS_INSTALL_PATHS)) {
    const evidence = hostEvidence(harness);
    if (evidence) available.push({ harness, evidence });
    else unavailable.push(harness);
  }
  console.log(`🔎 Detected supported hosts: ${available.length ? available.map(({ harness, evidence }) => `${harness} (${evidence})`).join(", ") : "none"}`);
  if (unavailable.length) console.log(`⏭️  Skipping unavailable hosts: ${unavailable.join(", ")}`);
  return available.map(({ harness }) => harness);
}

function deduplicateSharedKiroHarnesses(harnesses: string[], operation: "install" | "uninstall"): string[] {
  if (!harnesses.includes("kiro-ide") || !harnesses.includes("kiro-cli")) return harnesses;
  console.log(`♻️  Kiro IDE and Kiro CLI share one global Agent Skill; ${operation}ing it once via kiro-ide.`);
  return harnesses.filter((harness) => harness !== "kiro-cli");
}

function resolveHostCli(environmentVariable: string, command: string, knownPaths: string[] = []): string {
  const configured = process.env[environmentVariable]?.trim();
  if (configured) return configured;
  const discovered = commandOnPath(command);
  if (discovered) return discovered;
  const known = knownPaths.find((candidate) => existsSync(candidate));
  if (known) return known;
  throw new Error(`${command} CLI not found; install the host CLI or set ${environmentVariable} to its executable path`);
}

function runExternalJson(
  command: string,
  args: string[],
  cwd: string,
  description: string,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  const invocation = hostCliInvocation(command);
  const result = spawnSync(invocation.command, [...invocation.argsPrefix, ...args], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new Error(`${description} failed: ${result.error.message}`);
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${description} failed with code ${result.status ?? 1}: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  const output = (result.stdout || "").trim();
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${description} returned invalid JSON: ${output}`);
  }
}

function jsonHasNamedEntry(value: unknown, name: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => jsonHasNamedEntry(entry, name));
  if (!isRecord(value)) return false;
  if (value.name === name || value.id === name) return true;
  return Object.values(value).some((entry) => typeof entry === "object" && entry !== null && jsonHasNamedEntry(entry, name));
}

function jsonHasPlugin(value: unknown, name: string, source: string): boolean {
  const reference = `${name}@${source}`;
  if (typeof value === "string") return value === name || value === reference;
  if (Array.isArray(value)) return value.some((entry) => jsonHasPlugin(entry, name, source));
  if (!isRecord(value)) return false;
  if (value.id === reference || value.pluginId === reference || value.name === name) return true;
  return Object.values(value).some((entry) => jsonHasPlugin(entry, name, source));
}

function parseDeployOptions(args: string[], allowList: boolean): DeployOptions {
  const options: DeployOptions = { harness: "", target: "", project: "", all: false, list: false, migrateLegacy: false };
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
    } else if (["--all", "--list", "--migrate-legacy"].includes(argument)) {
      if (seen.has(argument)) throw new Error(`duplicate option: ${argument}`);
      seen.add(argument);
      if (argument === "--all") options.all = true;
      if (argument === "--list") options.list = true;
      if (argument === "--migrate-legacy") options.migrateLegacy = true;
    } else {
      throw new Error(`unknown deploy option: ${argument}`);
    }
  }
  if (options.list && !allowList) throw new Error("--list is only valid with install");
  if (options.migrateLegacy && !allowList) throw new Error("--migrate-legacy is only valid with install");
  if (options.list && (options.harness || options.target || options.project || options.all || options.migrateLegacy)) throw new Error("--list cannot be combined with other install options");
  if (options.all && (options.harness || options.target || options.project)) throw new Error("--all cannot be combined with --harness, --target, or --project");
  if (options.target && options.project) throw new Error("--target and --project cannot be used together");
  if (options.harness && !HARNESS_INSTALL_PATHS[options.harness]) {
    throw new Error(`unknown harness "${options.harness}"; available: ${Object.keys(HARNESS_INSTALL_PATHS).join(", ")}`);
  }
  if (options.project && !["kiro-ide", "kiro-cli", "codebuddy", "qoder"].includes(options.harness)) {
    throw new Error("--project requires --harness kiro-ide, kiro-cli, codebuddy, or qoder");
  }
  return options;
}

function getBuildHarness(harness: string): string {
  return harness;
}

interface DistStatus {
  harness: string;
  distRoot: string;
  missing: boolean;
  stale: boolean;
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

function inspectDist(harness: string): DistStatus {
  const buildHarness = getBuildHarness(harness);
  const distRoot = resolve(ROOT, "dist", buildHarness);
  const sourcePaths = [resolve(ROOT, "core"), resolve(ROOT, "harness", buildHarness), resolve(ROOT, "scripts/build.ts")];
  const sourceCheckout = sourcePaths.every((entry) => existsSync(entry));
  const missing = !existsSync(distRoot);
  const stale = !missing && sourceCheckout && newestMtime(distRoot) + 1 < Math.max(...sourcePaths.map(newestMtime));
  return { harness: buildHarness, distRoot, missing, stale };
}

function ensureDist(harness: string): string {
  const status = inspectDist(harness);
  if (status.missing || status.stale) {
    console.log(`${status.stale ? "♻️  Prebuilt harness is stale; rebuilding" : "🔨 Building harness"}: ${status.harness}`);
    run("scripts/build.ts", ["--harness", status.harness]);
  } else {
    console.log(`📦 Using current prebuilt harness: ${status.distRoot}`);
  }
  if (!existsSync(status.distRoot)) throw new Error(`build output not found: ${status.distRoot}`);
  return status.distRoot;
}

function ensureAllDist(harnesses: string[] = Object.keys(HARNESS_INSTALL_PATHS)): Map<string, string> {
  const statuses = harnesses.map(inspectDist);
  if (statuses.length === 0) return new Map();
  const missing = statuses.filter((status) => status.missing).map((status) => status.harness);
  const stale = statuses.filter((status) => status.stale).map((status) => status.harness);
  if (missing.length || stale.length) {
    const reasons = [
      ...(missing.length ? [`missing: ${missing.join(", ")}`] : []),
      ...(stale.length ? [`stale: ${stale.join(", ")}`] : []),
    ];
    console.log(`♻️  Harness set requires rebuild; building all once (${reasons.join("; ")})`);
    run("scripts/build.ts", ["--all"]);
  } else {
    console.log(`📦 Using current prebuilt harness set (${statuses.length} selected platform${statuses.length === 1 ? "" : "s"}).`);
  }
  for (const status of statuses) {
    if (!existsSync(status.distRoot)) throw new Error(`build output not found: ${status.distRoot}`);
  }
  return new Map(statuses.map((status) => [status.harness, status.distRoot]));
}

function findInstallSource(harness: string, distRoot: string): string {
  const skill = resolve(distRoot, "skills/loeyae-aidlc");
  const agentSkill = resolve(distRoot, ".agents/skills/loeyae-aidlc");
  const pluginRoot = resolve(distRoot, "plugins/loeyae-aidlc");
  const source = harness === "claude" || harness === "qoder" || harness === "codebuddy"
    ? distRoot
    : harness === "zcode"
      ? pluginRoot
      : existsSync(skill)
        ? skill
        : existsSync(agentSkill)
          ? agentSkill
          : distRoot;
  if (!existsSync(source)) throw new Error(`build output not found: ${source}`);
  return source;
}

function readLegacyJson(file: string): Record<string, unknown> | undefined {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return undefined;
    const value = JSON.parse(readFileSync(file, "utf8"));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isLegacyRuntimeDirectory(target: string): boolean {
  const graph = readLegacyJson(resolve(target, "tools/data/stage-graph.json"));
  if (!graph || typeof graph.version !== "string" || !/^2\.\d+\.\d+(?:[-+].*)?$/.test(graph.version)) return false;
  return Array.isArray(graph.stages) && graph.stages.some((stage) => isRecord(stage) && stage.slug === "workspace-detection");
}

function isLegacyClaudeCatalog(target: string): boolean {
  const catalog = readLegacyJson(target);
  if (!catalog || catalog.name !== CLAUDE_MARKETPLACE_NAME || !Array.isArray(catalog.plugins)) return false;
  return catalog.plugins.some((plugin) => isRecord(plugin)
    && plugin.name === "loeyae-aidlc"
    && plugin.source === "./plugins/loeyae-aidlc"
    && typeof plugin.version === "string"
    && /^2\.\d+\.\d+(?:[-+].*)?$/.test(plugin.version));
}

function isLegacyKiroHook(target: string): boolean {
  const hookConfig = readLegacyJson(target);
  if (!hookConfig || hookConfig.version !== "v1" || !Array.isArray(hookConfig.hooks)) return false;
  return hookConfig.hooks.some((hook) => isRecord(hook)
    && isRecord(hook.action)
    && hook.action.command === "loeyae-aidlc hook --format kiro");
}

function isLegacyOpenCodePlugin(target: string): boolean {
  try {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return false;
    const source = readFileSync(target, "utf8");
    return source.includes("Loeyae AI-DLC v2")
      && source.includes("aidlc-orchestrate.ts")
      && source.includes("loeyae-aidlc");
  } catch {
    return false;
  }
}

function assertRecognizedLegacyTarget(asset: ManagedAsset): void {
  const name = path.basename(asset.target);
  const recognized = asset.kind === "directory"
    ? isLegacyRuntimeDirectory(asset.target)
    : name === "marketplace.json"
      ? isLegacyClaudeCatalog(asset.target)
      : name === "loeyae-aidlc.json"
        ? isLegacyKiroHook(asset.target)
        : name === "loeyae-aidlc.js" && isLegacyOpenCodePlugin(asset.target);
  if (!recognized) {
    throw new Error(`unowned target is not a recognized Loeyae AI-DLC v2 legacy install; refusing migration: ${asset.target}`);
  }
}

function reportLegacyBackup(backup: LegacyInstallBackup): void {
  console.log(`🛟 Preserved legacy install backup: ${backup.target} → ${backup.backup}`);
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
  const updateStatus = runExternal("claude", ["plugin", "update", pluginRef, "--scope", deployment.scope], deployment.cwd);
  if (updateStatus !== 0) throw new Error(`Claude Code plugin install/update failed: ${pluginRef}`);
  console.log(installStatus === 0
    ? `🔌 Claude Code plugin registered and refreshed (${deployment.scope} scope): ${pluginRef}`
    : `🔌 Claude Code existing plugin refreshed (${deployment.scope} scope): ${pluginRef}`);
}

function unregisterClaudePlugin(deployment: ClaudeDeployment): void {
  const pluginRef = `loeyae-aidlc@${CLAUDE_MARKETPLACE_NAME}`;
  const uninstallStatus = runExternal("claude", ["plugin", "uninstall", pluginRef, "--scope", deployment.scope], deployment.cwd);
  if (uninstallStatus !== 0) throw new Error(`Claude Code plugin unregister failed: ${pluginRef}`);
  const removeStatus = runExternal("claude", ["plugin", "marketplace", "remove", CLAUDE_MARKETPLACE_NAME, "--scope", deployment.scope], deployment.cwd);
  if (removeStatus !== 0) throw new Error(`Claude Code marketplace unregister failed: ${CLAUDE_MARKETPLACE_NAME}`);
}

function requireProjectDirectory(projectTarget: string): string {
  const project = resolve(projectTarget);
  if (!existsSync(project) || !lstatSync(project).isDirectory() || lstatSync(project).isSymbolicLink()) {
    throw new Error(`--project must be an existing, non-symlink directory: ${project}`);
  }
  return project;
}

function projectDeploymentKey(project: string): string {
  return createHash("sha256").update(project).digest("hex").slice(0, 12);
}

function getCodeBuddyDeployment(projectTarget: string): CodeBuddyDeployment {
  const project = projectTarget ? requireProjectDirectory(projectTarget) : "";
  const key = project ? `project-${projectDeploymentKey(project)}` : "user";
  const marketplaceName = project ? `${PLUGIN_MARKETPLACE_NAME}-${projectDeploymentKey(project)}` : PLUGIN_MARKETPLACE_NAME;
  const marketplaceRoot = project ? resolve(HOST_ASSET_ROOT, `codebuddy/${key}`) : CODEBUDDY_USER_MARKETPLACE_ROOT;
  return {
    marketplaceRoot,
    marketplaceName,
    pluginRoot: resolve(marketplaceRoot, "plugins/loeyae-aidlc"),
    pluginRef: `${PLUGIN_NAME}@${marketplaceName}`,
    scope: project ? "project" : "user",
    cwd: project || process.cwd(),
  };
}

function createCodeBuddyMarketplaceSource(distRoot: string, marketplaceName: string): { temporaryRoot: string; source: string } {
  const temporaryRoot = mkdtempSync(resolve(process.env.TMPDIR || tmpdir(), "loeyae-aidlc-codebuddy-"));
  const source = resolve(temporaryRoot, "marketplace");
  cpSync(distRoot, source, { recursive: true });
  const catalogPath = resolve(source, ".codebuddy-plugin/marketplace.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  catalog.name = marketplaceName;
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 });
  return { temporaryRoot, source };
}

function codeBuddyCli(): { command: string; env: NodeJS.ProcessEnv } {
  const command = resolveHostCli("CODEBUDDY_CLI", "codebuddy", codeBuddyKnownCliPaths());
  const candidate = existsSync(command) ? resolve(command) : commandOnPath(command);
  let executableIdentity = candidate || command;
  if (candidate) {
    try {
      executableIdentity = realpathSync(candidate);
    } catch {
      // Keep the resolved path for environment detection if canonicalization fails.
    }
  }
  const configDir = codeBuddyConfigDirForCli(executableIdentity)
    || codeBuddyConfigDirForCli(command);
  return {
    command,
    env: configDir ? { ...process.env, CODEBUDDY_CONFIG_DIR: configDir } : process.env,
  };
}

function registerCodeBuddyPlugin(deployment: CodeBuddyDeployment): void {
  const { command: cli, env } = codeBuddyCli();
  if (runExternal(cli, ["plugin", "validate", deployment.pluginRoot], deployment.cwd, env) !== 0) {
    throw new Error(`CodeBuddy plugin validation failed: ${deployment.pluginRoot}`);
  }
  const marketplaces = runExternalJson(cli, ["plugin", "marketplace", "list"], deployment.cwd, "CodeBuddy marketplace list", env);
  const alreadyRegistered = jsonHasNamedEntry(marketplaces, deployment.marketplaceName);
  if (alreadyRegistered) {
    if (runExternal(cli, ["plugin", "marketplace", "update", deployment.marketplaceName], deployment.cwd, env) !== 0) {
      throw new Error(`CodeBuddy marketplace update failed: ${deployment.marketplaceName}`);
    }
  } else if (runExternal(cli, ["plugin", "marketplace", "add", deployment.marketplaceRoot, "--name", deployment.marketplaceName], deployment.cwd, env) !== 0) {
    throw new Error(`CodeBuddy marketplace registration failed: ${deployment.marketplaceRoot}`);
  }

  const installStatus = runExternal(cli, ["plugin", "install", deployment.pluginRef, "--scope", deployment.scope], deployment.cwd, env);
  const updateStatus = runExternal(cli, ["plugin", "update", deployment.pluginRef, "--scope", deployment.scope], deployment.cwd, env);
  if (updateStatus !== 0) {
    if (installStatus === 0) runExternal(cli, ["plugin", "uninstall", deployment.pluginRef, "--scope", deployment.scope], deployment.cwd, env);
    if (!alreadyRegistered) runExternal(cli, ["plugin", "marketplace", "remove", deployment.marketplaceName], deployment.cwd, env);
    throw new Error(`CodeBuddy plugin install/update failed: ${deployment.pluginRef}`);
  }
  if (runExternal(cli, ["plugin", "enable", deployment.pluginRef, "--scope", deployment.scope], deployment.cwd, env) !== 0) {
    if (installStatus === 0) runExternal(cli, ["plugin", "uninstall", deployment.pluginRef, "--scope", deployment.scope], deployment.cwd, env);
    if (!alreadyRegistered) runExternal(cli, ["plugin", "marketplace", "remove", deployment.marketplaceName], deployment.cwd, env);
    throw new Error(`CodeBuddy plugin enable failed: ${deployment.pluginRef}`);
  }
  console.log(`🔌 CodeBuddy plugin registered and refreshed (${deployment.scope} scope): ${deployment.pluginRef}`);
}

function unregisterCodeBuddyPlugin(deployment: CodeBuddyDeployment): void {
  const { command: cli, env } = codeBuddyCli();
  const plugins = runExternalJson(cli, ["plugin", "list", "--json"], deployment.cwd, "CodeBuddy plugin list", env);
  if (jsonHasPlugin(plugins, PLUGIN_NAME, deployment.marketplaceName)) {
    const status = runExternal(cli, ["plugin", "uninstall", deployment.pluginRef, "--scope", deployment.scope], deployment.cwd, env);
    if (status !== 0) throw new Error(`CodeBuddy plugin unregister failed: ${deployment.pluginRef}`);
  }
  const marketplaces = runExternalJson(cli, ["plugin", "marketplace", "list"], deployment.cwd, "CodeBuddy marketplace list", env);
  if (jsonHasNamedEntry(marketplaces, deployment.marketplaceName)) {
    const status = runExternal(cli, ["plugin", "marketplace", "remove", deployment.marketplaceName], deployment.cwd, env);
    if (status !== 0) throw new Error(`CodeBuddy marketplace unregister failed: ${deployment.marketplaceName}`);
  }
}

function getQoderDeployment(projectTarget: string): QoderDeployment {
  const project = projectTarget ? requireProjectDirectory(projectTarget) : "";
  const key = project ? `project-${projectDeploymentKey(project)}` : "user";
  return {
    pluginRoot: project ? resolve(HOST_ASSET_ROOT, `qoder/${key}/loeyae-aidlc`) : QODER_USER_PLUGIN_ROOT,
    scope: project ? "project" : "user",
    cwd: project || process.cwd(),
  };
}

function qoderCli(): string {
  return resolveHostCli("QODER_CLI", "qoder");
}

function registerQoderPlugin(deployment: QoderDeployment): void {
  const cli = qoderCli();
  if (runExternal(cli, ["plugins", "validate", deployment.pluginRoot], deployment.cwd) !== 0) {
    throw new Error(`Qoder CLI plugin validation failed: ${deployment.pluginRoot}`);
  }
  const pluginsBefore = runExternalJson(cli, ["plugins", "list", "--json"], deployment.cwd, "Qoder CLI plugin list");
  const alreadyInstalled = jsonHasPlugin(pluginsBefore, PLUGIN_NAME, "local");
  if (runExternal(cli, ["plugins", "install", deployment.pluginRoot, "--scope", deployment.scope], deployment.cwd) !== 0) {
    throw new Error(`Qoder CLI plugin install failed: ${deployment.pluginRoot}`);
  }
  if (runExternal(cli, ["plugins", "enable", PLUGIN_NAME, "--scope", deployment.scope], deployment.cwd) !== 0) {
    if (!alreadyInstalled) runExternal(cli, ["plugins", "uninstall", PLUGIN_NAME, "--scope", deployment.scope], deployment.cwd);
    throw new Error(`Qoder CLI plugin enable failed: ${PLUGIN_NAME}`);
  }
  console.log(`🔌 Qoder plugin installed and enabled for Desktop / CLI (${deployment.scope} scope): ${PLUGIN_NAME}@local`);
}

function unregisterQoderPlugin(deployment: QoderDeployment): void {
  const cli = qoderCli();
  const plugins = runExternalJson(cli, ["plugins", "list", "--json"], deployment.cwd, "Qoder CLI plugin list");
  if (!jsonHasPlugin(plugins, PLUGIN_NAME, "local")) return;
  const status = runExternal(cli, ["plugins", "uninstall", PLUGIN_NAME, "--scope", deployment.scope], deployment.cwd);
  if (status !== 0) throw new Error(`Qoder CLI plugin unregister failed: ${PLUGIN_NAME}`);
}

function isZcodeHookGroup(group: unknown): boolean {
  if (!isRecord(group) || !Array.isArray(group.hooks)) return false;
  return group.hooks.some((hook) => isRecord(hook)
    && hook.command === "loeyae-aidlc"
    && Array.isArray(hook.args)
    && JSON.stringify(hook.args) === JSON.stringify(["hook", "--format", "zcode"]));
}

function registerZcodeConfig(pluginRoot: string): void {
  const hookDefaults = JSON.parse(readFileSync(resolve(pluginRoot, "hooks/hooks.json"), "utf8"));
  const mcpDefaults = JSON.parse(readFileSync(resolve(pluginRoot, ".mcp.json"), "utf8"));
  const desiredGroups = Array.isArray(hookDefaults?.hooks?.Stop) ? hookDefaults.hooks.Stop : [];
  const desiredServers = isRecord(mcpDefaults.mcpServers) ? mcpDefaults.mcpServers : {};
  const result = updateSharedJson(ZCODE_GLOBAL_CONFIG_PATH, (current) => {
    if (current.hooks !== undefined && !isRecord(current.hooks)) throw new Error(`ZCode hooks config must be an object: ${ZCODE_GLOBAL_CONFIG_PATH}`);
    const hooks = isRecord(current.hooks) ? { ...current.hooks } : {};
    if (hooks.events !== undefined && !isRecord(hooks.events)) throw new Error(`ZCode hook events must be an object: ${ZCODE_GLOBAL_CONFIG_PATH}`);
    const events = isRecord(hooks.events) ? { ...hooks.events } : {};
    const existingStop = Array.isArray(events.Stop) ? events.Stop : [];
    const retainedStop = existingStop.filter((group) => !isZcodeHookGroup(group));
    const nextStop = [...retainedStop, ...desiredGroups];
    events.Stop = nextStop;

    if (current.mcp !== undefined && !isRecord(current.mcp)) throw new Error(`ZCode MCP config must be an object: ${ZCODE_GLOBAL_CONFIG_PATH}`);
    const mcp = isRecord(current.mcp) ? { ...current.mcp } : {};
    if (mcp.servers !== undefined && !isRecord(mcp.servers)) throw new Error(`ZCode MCP servers must be an object: ${ZCODE_GLOBAL_CONFIG_PATH}`);
    const servers = isRecord(mcp.servers) ? { ...mcp.servers } : {};
    const added: string[] = [];
    const preserved: string[] = [];
    for (const [name, server] of Object.entries(desiredServers)) {
      if (servers[name] === undefined) {
        servers[name] = server;
        added.push(name);
      } else {
        preserved.push(name);
      }
    }
    return {
      value: { ...current, hooks: { ...hooks, enabled: true, events }, mcp: { ...mcp, servers } },
      result: { hookChanged: JSON.stringify(existingStop) !== JSON.stringify(nextStop) || hooks.enabled !== true, added, preserved },
    };
  });
  console.log(result.hookChanged ? "🔒 Registered ZCode user Stop Hook." : "🔒 ZCode user Stop Hook already current.");
  console.log(result.added.length
    ? `🔌 Added ZCode MCP services: ${result.added.join(", ")}`
    : `🔌 ZCode MCP services already present; preserved: ${result.preserved.join(", ") || "none"}`);
}

function unregisterZcodeConfig(): void {
  if (!existsSync(ZCODE_GLOBAL_CONFIG_PATH)) return;
  const removed = updateSharedJson(ZCODE_GLOBAL_CONFIG_PATH, (current) => {
    if (!isRecord(current.hooks)) return { value: current, result: 0 };
    const hooks = { ...current.hooks };
    if (!isRecord(hooks.events)) return { value: current, result: 0 };
    const events = { ...hooks.events };
    const existingStop = Array.isArray(events.Stop) ? events.Stop : [];
    const retainedStop = existingStop.filter((group) => !isZcodeHookGroup(group));
    const count = existingStop.length - retainedStop.length;
    if (retainedStop.length) events.Stop = retainedStop;
    else delete events.Stop;
    if (Object.keys(events).length) hooks.events = events;
    else delete hooks.events;
    return { value: { ...current, hooks }, result: count };
  });
  if (removed) console.log("🔓 Removed ZCode user Stop Hook; shared MCP services were preserved.");
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

function installProjectHook(harness: string, projectRoot: string, distRoot: string, migrateLegacy: boolean): void {
  const asset = projectHookAsset(harness, projectRoot, distRoot);
  if (!asset) return;
  installManagedAssets("loeyae-aidlc:kiro-project-hook", [asset], undefined, {
    migrateLegacy,
    validateLegacyTarget: assertRecognizedLegacyTarget,
    onLegacyBackup: reportLegacyBackup,
  });
  console.log(`🔒 Installed ${harness} project Stop Hook → ${asset.target}`);
}

function uninstallProjectHook(harness: string, projectRoot: string): void {
  if (!["kiro-ide", "kiro-cli"].includes(harness)) return;
  const target = resolve(projectRoot, ".kiro/hooks/loeyae-aidlc.json");
  const removed = uninstallManagedAssets("loeyae-aidlc:kiro-project-hook", [target]);
  console.log(removed ? `🔓 Removed project Stop Hook → ${target}` : `ℹ️  Project Stop Hook is not owned by this installer; preserved: ${target}`);
}

function isSharedKiroGlobalSkill(harness: string, customTarget: string): boolean {
  return !customTarget && (harness === "kiro-ide" || harness === "kiro-cli");
}

function installationOwner(harness: string, customTarget: string): string {
  return isSharedKiroGlobalSkill(harness, customTarget) ? KIRO_GLOBAL_SKILL_OWNER : `loeyae-aidlc:${harness}`;
}

function migrateKiroGlobalSkillOwnership(): boolean {
  return migrateManagedOwnership(KIRO_LEGACY_CLI_SKILL_OWNER, KIRO_GLOBAL_SKILL_OWNER, [KIRO_GLOBAL_SKILL_ROOT]);
}

function removeManagedLegacyKiroIdePower(): boolean {
  if (!hasManagedInstallation(KIRO_LEGACY_IDE_POWER_OWNER, [KIRO_LEGACY_IDE_POWER_ROOT])) return false;
  return uninstallManagedAssets(KIRO_LEGACY_IDE_POWER_OWNER, [KIRO_LEGACY_IDE_POWER_ROOT]);
}

function installOne(harness: string, customTarget: string, projectTarget: string, migrateLegacy: boolean, preparedDistRoot = ""): void {
  const distRoot = preparedDistRoot || ensureDist(harness);
  if (!existsSync(distRoot)) throw new Error(`build output not found: ${distRoot}`);
  const source = findInstallSource(harness, distRoot);
  const owner = installationOwner(harness, customTarget);
  const migrationOptions = {
    migrateLegacy,
    validateLegacyTarget: assertRecognizedLegacyTarget,
    onLegacyBackup: reportLegacyBackup,
  };

  if (harness === "codebuddy" && !customTarget) {
    const deployment = getCodeBuddyDeployment(projectTarget);
    const marketplace = createCodeBuddyMarketplaceSource(distRoot, deployment.marketplaceName);
    try {
      installManagedAssets(owner, [
        { source: marketplace.source, target: deployment.marketplaceRoot, kind: "directory" },
      ], () => registerCodeBuddyPlugin(deployment), migrationOptions);
    } finally {
      rmSync(marketplace.temporaryRoot, { recursive: true, force: true });
    }
    console.log(`✅ Installed loeyae-aidlc v${PKG.version} (${harness}, ${deployment.scope}) → ${deployment.marketplaceRoot}`);
    return;
  }

  if (harness === "qoder" && !customTarget) {
    const deployment = getQoderDeployment(projectTarget);
    installManagedAssets(owner, [
      { source, target: deployment.pluginRoot, kind: "directory" },
    ], () => registerQoderPlugin(deployment), migrationOptions);
    console.log(`✅ Installed loeyae-aidlc v${PKG.version} (${harness}, ${deployment.scope}) → ${deployment.pluginRoot}`);
    return;
  }

  if (harness === "zcode" && !customTarget) {
    installManagedAssets(owner, [
      { source, target: ZCODE_GLOBAL_SKILL_ROOT, kind: "directory" },
    ], () => registerZcodeConfig(ZCODE_GLOBAL_SKILL_ROOT), migrationOptions);
    console.log(`✅ Installed loeyae-aidlc v${PKG.version} (${harness}) → ${ZCODE_GLOBAL_SKILL_ROOT}`);
    return;
  }

  if (harness === "opencode" && !customTarget) {
    const sourceRoot = resolve(distRoot, ".opencode");
    const pluginSource = resolve(sourceRoot, "plugins/loeyae-aidlc.js");
    if (!existsSync(pluginSource)) throw new Error(`OpenCode plugin entry not found: ${pluginSource}`);
    installManagedAssets(owner, [
      { source: sourceRoot, target: OPENCODE_GLOBAL_ASSET_ROOT, kind: "directory" },
      { source: pluginSource, target: OPENCODE_GLOBAL_PLUGIN_PATH, kind: "file" },
    ], undefined, migrationOptions);
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
      ], () => registerClaudePlugin(deployment), migrationOptions);
    } finally {
      rmSync(catalog.root, { recursive: true, force: true });
    }
    console.log(`✅ Installed loeyae-aidlc v${PKG.version} (${harness}) → ${deployment.pluginRoot}`);
    return;
  }

  const target = customTarget ? resolve(customTarget) : HARNESS_INSTALL_PATHS[harness];
  if (isSharedKiroGlobalSkill(harness, customTarget) && migrateKiroGlobalSkillOwnership()) {
    console.log(`♻️  Adopted legacy Kiro CLI ownership for the shared global Agent Skill → ${target}`);
  }
  const activate = (): void => {
    if ((harness === "kiro-crew" || harness === "kiro-ide" || harness === "kiro-cli") && !customTarget) registerKiroMcp();
    if (harness === "codex" && !customTarget) registerCodexHooks(resolve(source, "hooks/hooks.json"));
  };
  installManagedAssets(owner, [{ source, target, kind: "directory" }], activate, migrationOptions);
  if (projectTarget) installProjectHook(harness, projectTarget, distRoot, migrateLegacy);
  if (harness === "kiro-ide" && !customTarget) {
    try {
      if (removeManagedLegacyKiroIdePower()) {
        console.log(`🧹 Removed installer-owned legacy Kiro IDE Power → ${KIRO_LEGACY_IDE_POWER_ROOT}`);
      } else if (existsSync(KIRO_LEGACY_IDE_POWER_ROOT)) {
        console.warn(`⚠️  Preserved legacy Kiro IDE Power without a matching ownership manifest: ${KIRO_LEGACY_IDE_POWER_ROOT}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  Shared Agent Skill installed, but the legacy Kiro IDE Power was preserved: ${message}`);
    }
  }
  console.log(`✅ Installed loeyae-aidlc v${PKG.version} (${harness}) → ${target}`);
}

function managedTargetsFor(harness: string, customTarget: string, projectTarget: string): string[] {
  if (harness === "codebuddy" && !customTarget) return [getCodeBuddyDeployment(projectTarget).marketplaceRoot];
  if (harness === "qoder" && !customTarget) return [getQoderDeployment(projectTarget).pluginRoot];
  if (harness === "zcode" && !customTarget) return [ZCODE_GLOBAL_SKILL_ROOT];
  if (harness === "opencode" && !customTarget) return [OPENCODE_GLOBAL_ASSET_ROOT, OPENCODE_GLOBAL_PLUGIN_PATH];
  if (harness === "claude") {
    const deployment = getClaudeDeployment(customTarget);
    return [deployment.pluginRoot, deployment.catalogPath];
  }
  return [customTarget ? resolve(customTarget) : HARNESS_INSTALL_PATHS[harness]];
}

function hasManagedHarnessInstallation(harness: string): boolean {
  const targets = managedTargetsFor(harness, "", "");
  if (harness === "kiro-ide" || harness === "kiro-cli") {
    if (hasManagedInstallation(KIRO_GLOBAL_SKILL_OWNER, targets)) return true;
    if (hasManagedInstallation(KIRO_LEGACY_CLI_SKILL_OWNER, targets)) return true;
    return harness === "kiro-ide"
      && hasManagedInstallation(KIRO_LEGACY_IDE_POWER_OWNER, [KIRO_LEGACY_IDE_POWER_ROOT]);
  }
  return hasManagedInstallation(installationOwner(harness, ""), targets);
}

function uninstallOne(harness: string, customTarget: string, projectTarget: string): void {
  const owner = installationOwner(harness, customTarget);
  const targets = managedTargetsFor(harness, customTarget, projectTarget);
  if (harness === "codebuddy" && !customTarget) {
    const deployment = getCodeBuddyDeployment(projectTarget);
    const removed = uninstallManagedAssets(owner, targets, () => unregisterCodeBuddyPlugin(deployment));
    console.log(removed ? `✅ Uninstalled ${harness} (${deployment.scope})` : `ℹ️  ${harness} is not owned by this installer; preserved existing files.`);
    return;
  }
  if (harness === "qoder" && !customTarget) {
    const deployment = getQoderDeployment(projectTarget);
    const removed = uninstallManagedAssets(owner, targets, () => unregisterQoderPlugin(deployment));
    console.log(removed ? `✅ Uninstalled ${harness} (${deployment.scope})` : `ℹ️  ${harness} is not owned by this installer; preserved existing files.`);
    return;
  }
  if (harness === "zcode" && !customTarget) {
    const removed = uninstallManagedAssets(owner, targets, unregisterZcodeConfig);
    console.log(removed ? `✅ Uninstalled ${harness}` : `ℹ️  ${harness} is not owned by this installer; preserved existing files.`);
    return;
  }
  if (harness === "opencode" && !customTarget) {
    const removed = uninstallManagedAssets(owner, targets);
    console.log(removed ? `✅ Uninstalled ${harness}` : `ℹ️  ${harness} is not owned by this installer; preserved existing files.`);
    return;
  }
  if (harness === "claude") {
    const deployment = getClaudeDeployment(customTarget);
    const removed = uninstallManagedAssets(owner, targets, () => unregisterClaudePlugin(deployment));
    console.log(removed ? `✅ Uninstalled ${harness}` : `ℹ️  ${harness} is not owned by this installer; preserved existing files.`);
    return;
  }
  if (isSharedKiroGlobalSkill(harness, customTarget)) {
    if (migrateKiroGlobalSkillOwnership()) {
      console.log(`♻️  Adopted legacy Kiro CLI ownership before uninstalling the shared global Agent Skill.`);
    }
    const target = targets[0];
    const removed = uninstallManagedAssets(owner, targets);
    let removedLegacyPower = false;
    if (harness === "kiro-ide") removedLegacyPower = removeManagedLegacyKiroIdePower();
    if (projectTarget) uninstallProjectHook(harness, projectTarget);
    console.log("ℹ️  Shared Kiro MCP entries were preserved; they may be used by other installations.");
    console.log(removed || removedLegacyPower
      ? `✅ Uninstalled shared Kiro Agent Skill${removedLegacyPower ? " and legacy IDE Power" : ""} → ${target}`
      : `ℹ️  Shared Kiro Agent Skill is not owned by this installer; preserved: ${target}`);
    return;
  }
  const target = targets[0];
  const removed = uninstallManagedAssets(
    owner,
    targets,
    harness === "codex" && !customTarget ? unregisterCodexHooks : undefined,
  );
  if (projectTarget) uninstallProjectHook(harness, projectTarget);
  if ((harness === "kiro-crew" || harness === "kiro-ide" || harness === "kiro-cli") && !customTarget) {
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
    const allHarnesses = Object.keys(HARNESS_INSTALL_PATHS);
    const failures: string[] = [];
    let harnesses: string[];
    let preparedDist: Map<string, string> | undefined;

    if (operation === "install") {
      harnesses = deduplicateSharedKiroHarnesses(detectAvailableHarnesses(), operation);
      if (harnesses.length === 0) {
        console.log("ℹ️  No supported host tools were detected; nothing to install. Use --harness to install a platform explicitly.");
        return;
      }
      preparedDist = ensureAllDist(harnesses);
    } else {
      harnesses = [];
      const detectionFailures = new Set<string>();
      const ownershipCandidates = deduplicateSharedKiroHarnesses(allHarnesses, operation);
      for (const harness of ownershipCandidates) {
        try {
          if (hasManagedHarnessInstallation(harness)) harnesses.push(harness);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          detectionFailures.add(harness);
          failures.push(`${harness}: ${message}`);
          console.error(`❌ ${harness}: ${message}`);
        }
      }
      console.log(`🔎 Installer-owned global installations: ${harnesses.join(", ") || "none"}`);
      const skipped = ownershipCandidates.filter((harness) => !harnesses.includes(harness) && !detectionFailures.has(harness));
      if (skipped.length) console.log(`⏭️  Skipping platforms without ownership manifests: ${skipped.join(", ")}`);
      if (harnesses.length === 0 && failures.length === 0) {
        console.log("ℹ️  No installer-owned global platform installations were found.");
        return;
      }
    }

    for (const harness of harnesses) {
      try {
        if (operation === "install") installOne(harness, "", "", options.migrateLegacy, preparedDist?.get(harness));
        else uninstallOne(harness, "", "");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${harness}: ${message}`);
        console.error(`❌ ${harness}: ${message}`);
      }
    }
    if (failures.length) throw new Error(`${operation} --all failed for ${failures.length} platform(s): ${failures.join("; ")}`);
    console.log(operation === "install"
      ? "⚠️  Restart affected platforms to activate."
      : `✅ Uninstalled ${harnesses.length} installer-owned global platform installation${harnesses.length === 1 ? "" : "s"}.`);
    return;
  }
  const harness = options.harness || "kiro-crew";
  if (operation === "install") installOne(harness, options.target, options.project, options.migrateLegacy);
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
  export <md|svg> <file> --to <format>    Export Markdown to DOCX/PDF or SVG to PNG
  docx <inspect|beautify|validate> [args]  Inspect or conservatively restyle DOCX files
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
  --target <path>   Dedicated bundle directory; Claude interprets it as project root
  --project <path>  Kiro project Hook root, or CodeBuddy/Qoder project plugin scope
  --all             Install detected hosts, or uninstall installer-owned global/user installs
  --list            Show available platforms (install only)
  --migrate-legacy  Preserve and replace recognized pre-manifest installs (install only)

Examples:
  loeyae-aidlc install
  loeyae-aidlc install --harness kiro-ide --project /absolute/path/to/project
  loeyae-aidlc install --harness codebuddy --project /absolute/path/to/project
  loeyae-aidlc install --harness qoder --project /absolute/path/to/project
  loeyae-aidlc uninstall --harness kiro-ide --project /absolute/path/to/project
  loeyae-aidlc install --all
  loeyae-aidlc install --all --migrate-legacy
  loeyae-aidlc uninstall --all
  loeyae-aidlc approve --stage application-design
  loeyae-aidlc orchestrate report --stage application-design --result approved --approval-token <token>
  loeyae-aidlc export md /absolute/path/document.md --to docx --toc
  loeyae-aidlc export md /absolute/path/document.md --to pdf
  loeyae-aidlc export svg /absolute/path/diagram.svg --to png --scale 2
  loeyae-aidlc docx inspect /absolute/path/document.docx --json
  loeyae-aidlc docx beautify /absolute/path/document.docx --dry-run --json
  loeyae-aidlc docx validate /absolute/path/polished.docx --against /absolute/path/document.docx --json
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
    case "export": run("core/tools/aidlc-export.ts", rest); break;
    case "docx": run("core/tools/aidlc-docx.ts", rest); break;
    case "hook": run("core/tools/aidlc-platform-hook.ts", rest, readFileSync(0, "utf8")); break;
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
