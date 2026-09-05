# Loeyae AI-DLC v2 for Qoder CN IDE / Desktop / CLI

本目录是 Qoder 原生本地插件，包含全部 Skills、Stop Hook 和两套 MCP 声明。Qoder CN IDE、Qoder Desktop 与 CLI 的插件加载入口可以共用，但 MCP 配置存储和传输能力不同。

正式安装由 `loeyae-aidlc install --harness qoder` 调用官方 `qoder plugins` 命令注册并启用 `loeyae-aidlc@local`，同时以“只补缺失、保留同名用户配置”的方式更新：

- Qoder Desktop/CLI：`~/.qoder/settings.json`，直接使用 Streamable HTTP；
- Qoder CN IDE：Windows `%APPDATA%\Qoder\SharedClientCache\mcp.json`、macOS `~/Library/Application Support/Qoder/SharedClientCache/mcp.json`、Linux `~/.config/Qoder/SharedClientCache/mcp.json`。

Qoder CN IDE 官方仅声明支持 STDIO/SSE，因此 CN 配置使用固定版本 `mcp-remote@0.8.3`，把 `loeyae-skills`、`awesome-design`、`figma`、`ssot` 的 Streamable HTTP 服务转换为本地 STDIO。可用 `QODER_CN_MCP_CONFIG` 指定非标准 CN 配置文件；`QODER_CONFIG_DIR` 继续覆盖 Desktop/CLI 配置目录。卸载插件时共享 MCP 条目会保留，避免删除用户或其他安装仍在使用的服务。

自动安装要求 PATH 中存在 `qoder`，也可通过 `QODER_CLI` 指定。默认安装为 user scope；项目级安装使用：

```bash
loeyae-aidlc install --harness qoder --project /absolute/path/to/project
```

安装或升级后必须完全退出并重启 Qoder CN IDE。CN IDE 2.5.0 或更高版本中，进入头像菜单 **Your Settings → MCP tools**，确认 4 个服务可见并逐项展开工具。CN IDE 仅在 Agent 模式配合 Qwen3 使用 MCP，且最多同时连接 10 个服务。

Qoder Desktop 应在 **Settings → Plugins → User → Custom** 核对插件，并在 **Settings → MCP**（新版为 **Extensions → Connectors**）核对服务。Qoder CLI 可依次执行 `/plugins reload`、`/mcp reload`，再用 `/plugins`、`/hooks`、`/mcp` 检查。

MCP 可见不等于认证成功：Figma 首次连接需要 OAuth；SSOT 要求在启动 Qoder CN IDE 前向宿主进程提供 `SSOT_API_KEY`；所有服务还需分别验证网络连通性。
