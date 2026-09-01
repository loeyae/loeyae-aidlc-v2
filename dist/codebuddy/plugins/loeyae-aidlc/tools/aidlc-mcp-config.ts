import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "fs";
import { dirname } from "path";

interface McpServerConfig {
  command?: string;
  args?: string[];
  [key: string]: unknown;
}

export interface McpMergeResult {
  config: Record<string, unknown>;
  added: string[];
  upgraded: string[];
  preserved: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CHROME_DEVTOOLS_PACKAGE = "chrome-devtools-mcp";
const MIGRATABLE_LEGACY_SPECS = new Set(["chrome-devtools-mcp@1.6.0"]);

function isChromeDevtoolsPackage(value: unknown, packageName = CHROME_DEVTOOLS_PACKAGE): boolean {
  if (!isRecord(value) || value.command !== "npx" || !Array.isArray(value.args)) return false;
  return value.args.length === 2 && value.args[0] === "-y" && value.args[1] === packageName;
}

function isMigratableLegacyChromeDevtools(value: unknown): boolean {
  if (!isRecord(value) || value.command !== "npx" || !Array.isArray(value.args) || value.args.length !== 2 || value.args[0] !== "-y") return false;
  if (!MIGRATABLE_LEGACY_SPECS.has(String(value.args[1]))) return false;
  if (value.disabled !== undefined && value.disabled !== false) return false;
  if (value.autoApprove !== undefined && (!Array.isArray(value.autoApprove) || value.autoApprove.length !== 0)) return false;
  return Object.keys(value).every((key) => ["command", "args", "disabled", "autoApprove"].includes(key));
}

export function mergeMcpServers(current: unknown, defaults: Record<string, McpServerConfig>): McpMergeResult {
  if (!isRecord(current)) throw new Error("MCP config must be a JSON object");
  const currentServers = current.mcpServers;
  if (currentServers !== undefined && !isRecord(currentServers)) throw new Error("MCP config mcpServers must be a JSON object");
  const servers: Record<string, unknown> = isRecord(currentServers) ? { ...currentServers } : {};
  const added: string[] = [];
  const upgraded: string[] = [];
  const preserved: string[] = [];
  for (const [name, config] of Object.entries(defaults)) {
    if (!Object.prototype.hasOwnProperty.call(servers, name)) {
      servers[name] = config;
      added.push(name);
    } else if (name === "chrome-devtools" && isChromeDevtoolsPackage(config) && isMigratableLegacyChromeDevtools(servers[name])) {
      servers[name] = config;
      upgraded.push(name);
    } else {
      preserved.push(name);
    }
  }
  return { config: { ...current, mcpServers: servers }, added, upgraded, preserved };
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireLock(path: string): number {
  const started = Date.now();
  while (true) {
    try {
      return openSync(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > 30000) {
          unlinkSync(path);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started > 3000) throw new Error(`timed out waiting for MCP config lock: ${path}`);
      sleep(20);
    }
  }
}

export function updateMcpConfig(path: string, defaults: Record<string, McpServerConfig>): McpMergeResult {
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const lockFd = acquireLock(lockPath);
  let temporary = "";
  try {
    const current = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    const result = mergeMcpServers(current, defaults);
    if (result.added.length === 0 && result.upgraded.length === 0) return result;
    temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeSync(fd, `${JSON.stringify(result.config, null, 2)}\n`, undefined, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    temporary = "";
    return result;
  } finally {
    closeSync(lockFd);
    if (temporary && existsSync(temporary)) unlinkSync(temporary);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}
