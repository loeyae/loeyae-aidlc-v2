export type McpServerConfig = Record<string, unknown>;

export interface McpMergeResult {
  config: Record<string, unknown>;
  added: string[];
  preserved: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const preserved: string[] = [];

  for (const [name, config] of Object.entries(defaults)) {
    if (Object.prototype.hasOwnProperty.call(servers, name)) {
      preserved.push(name);
    } else {
      servers[name] = config;
      added.push(name);
    }
  }

  return {
    config: { ...current, mcpServers: servers },
    added,
    preserved,
  };
}
