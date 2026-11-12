# 默认：宿主直接实施

使用宿主原生工具按用户已明确的设计和验收标准实施、测试、审查及返修。可选 `loeyae-aidlc work` 只读获取 Git/所选输入；无需 H5、claim、专用 worker 或逐阶段 report。真实验收失败继续修复，不得宣称完成；流程记录缺失不阻止独立工作。

## 兼容参考

以下旧 orchestrate、会话及专用 runtime 说明仅在用户明确选择维护旧受管流程时适用，不是默认实施前置条件。

# Loeyae AI-DLC for ZCode

`dist/zcode` 是可由 **Settings → Plugins → Create → Add marketplace** 导入的本地 marketplace。由于 ZCode 当前没有公开的 CLI 插件注册命令，`loeyae-aidlc install --harness zcode` 默认采用可自动管理的用户集成：

- Skill 安装到用户级 ZCode Skill 目录；
- 升级时移除精确识别的旧 AI-DLC Stop 命令，保留用户钩子和其他配置；
- 不部署领域 MCP；历史 MCP 配置保持原样。安装范围不代表项目连接授权。

修改后请新开 ZCode 会话以重新加载 Skill。完整插件模式需要在 ZCode UI 中导入 `dist/zcode`、安装并启用插件。

需要 MCP 时先确认启用 Provider 的锁定需求。现有 `provider mcp-preview/plan/apply/cleanup` 仅支持 JSON `mcpServers`，不能直接写 ZCode 的 `mcp.servers`；该格式尚需受管适配器。
