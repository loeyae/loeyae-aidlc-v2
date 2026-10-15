# Loeyae AI-DLC for ZCode

`dist/zcode` 是可由 **Settings → Plugins → Create → Add marketplace** 导入的本地 marketplace。由于 ZCode 当前没有公开的 CLI 插件注册命令，`loeyae-aidlc install --harness zcode` 默认采用可自动管理的用户集成：

- Skill 安装到用户级 ZCode Skill 目录；
- Stop Hook 精确合并到用户配置；
- 不部署领域 MCP；历史 MCP 配置保持原样。安装范围不代表项目连接授权。

修改后请新开 ZCode 会话；Hook 配置在会话启动时快照。完整插件模式需要在 ZCode UI 中导入 `dist/zcode`、安装并启用插件。

需要 MCP 时先确认启用 Provider 的锁定需求。现有 `provider mcp-preview/plan/apply/cleanup` 仅支持 JSON `mcpServers`，不能直接写 ZCode 的 `mcp.servers`；该格式尚需受管适配器。
