# Loeyae AI-DLC v2 for Qoder Desktop / CLI

本目录是 Qoder 原生本地插件，包含 Skill、Stop Hook 和 MCP 声明。Qoder 官方说明 Skills 在 Qoder IDE 与 CLI 中行为一致；经真实 Windows 验证，user scope 插件可由 Qoder Desktop 加载并触发。

正式安装由 `loeyae-aidlc install --harness qoder` 调用官方 `qoder plugins` 命令完成，插件 ID 为 `loeyae-aidlc@local`。Loeyae 只管理项目外的插件源和 ownership manifest，不直接编辑 Qoder 的 `settings.json` 或插件 cache。自动安装要求 PATH 中存在 `qoder`，也可通过 `QODER_CLI` 指定；仅检测到 Qoder Desktop 安装目录不足以证明官方注册命令可调用。

默认安装为 user scope。项目级安装使用：

```bash
loeyae-aidlc install --harness qoder --project /absolute/path/to/project
```

安装或升级后，重启 Qoder Desktop；Qoder CLI 可依次执行 `/plugins reload` 和 `/mcp reload`，再用 `/plugins`、`/hooks`、`/mcp` 核对组件。插件 manifest 显式声明整个 `skills/` 目录、`hooks/hooks.json` 和 `.mcp.json`，避免只加载 Skill 而漏掉 Stop Hook 或 MCP。

桌面版应同时满足：

- **Settings → Plugins → User → Custom** 中 `loeyae-aidlc@local` 已启用；
- **Settings → MCP**（新版界面为 **Extensions → Connectors**）中可见 `loeyae-skills`、`awesome-design`、`figma`、`ssot`，并标记为来自 `loeyae-aidlc` 插件；
- 新会话中可触发 `loeyae-aidlc` Skill，已 enrollment 且仍为 running 的业务项目会执行 Stop Hook。

本地 `@local` 插件不一定显示在 Marketplace 的 Installed 过滤结果中。本 harness 不声称自动注册 Qoder JetBrains 插件。MCP 出现在列表中只表示插件声明已加载；Figma OAuth、SSOT 认证和各服务网络连通性仍须分别验收。
