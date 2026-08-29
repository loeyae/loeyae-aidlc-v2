export type McpServerConfig = Record<string, unknown>;

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

function isChromeDevtoolsPackage(value: unknown, packageName = CHROME_DEVTOOLS_PACKAGE): boolean {
  if (!isRecord(value) || value.command !== "npx" || !Array.isArray(value.args)) return false;
  return value.args.length === 2 && value.args[0] === "-y" && value.args[1] === packageName;
}

function isMigratableLegacyChromeDevtools(value: unknown): boolean {
  if (!isRecord(value) || value.command !== "npx" || !Array.isArray(value.args) || value.args.length !== 2 || value.args[0] !== "-y") return false;
  const packageSpec = value.args[1];
  if (typeof packageSpec !== "string" || !packageSpec.startsWith(`${CHROME_DEVTOOLS_PACKAGE}@`)) return false;
  if (value.disabled !== undefined && value.disabled !== false) return false;
  if (value.autoApprove !== undefined && (!Array.isArray(value.autoApprove) || value.autoApprove.length !== 0)) return false;
  return Object.keys(value).every((key) => ["command", "args", "disabled", "autoApprove"].includes(key));
}

export function mergeMcpServers(
  current: unknown,
  defaults: Record<string, McpServerConfig>,
): McpMergeResult {
  if (!isRecord(current)) {
    throw new Error("MCP config must be a JSON object");
  }

  const currentServers = current.mcpServers;
  if (currentServers !== undefined && !isRecord(currentServers)) {
    throw new Error("MCP config mcpServers must be a JSON object");
  }

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

  return {
    config: { ...current, mcpServers: servers },
    added,
    upgraded,
    preserved,
  };
}
