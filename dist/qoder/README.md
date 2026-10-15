# Loeyae AI-DLC for Qoder

Core 安装提供原生 Skill、官方插件注册及 Stop Hook，不默认部署领域 MCP 或 CN bridge。user scope 把 Skill 受管安装到 ~/.qoder-cn/skills/loeyae-aidlc/；检测到 qoder CLI 时继续通过官方 qoder plugins 验证、注册并启用插件。desktop-only 模式仅安装原生 Skill。

loeyae-aidlc install --harness qoder
loeyae-aidlc install --harness qoder --project /absolute/path/to/project

项目级安装要求 qoder CLI，可用 QODER_CLI 指定。--project 只选择部署范围，不代表 MCP 授权。Core 不携带 .mcp.json 或 mcp-cn.json，不创建/改写 Desktop/CLI settings.json 或 CN mcp.json。QODER_CN_MCP_CONFIG 仍可用于宿主探测，不授权连接写入。

项目需要 MCP 时，由启用 Provider 的锁定 aidlc.mcp 元数据提供需求，再显式执行 provider mcp-preview、mcp-plan、逐配置批准的 mcp-apply。没有 Provider、禁用实例或缺元数据时安装不补服务。现有受管适配器仅支持 JSON mcpServers；CN bridge 配方需由 Provider 提供并显式批准，安装器不自动生成或运行 bridge。完整命令与格式限制见 core/knowledge/protocols/provider-mcp-apply.md。

历史宿主连接（包括旧 CN bridge）保持原样，不按名称认领或删除。卸载仅删除受管 Skill/staging 并按原路径注销插件，不释放 MCP 引用；清理需显式审阅 provider mcp-cleanup-plan，再执行 provider mcp-cleanup。共享 Skill 可见不能作为 Qoder harness、Hook 或认证成功的证据。

手工复制或旧版同名 Skill 默认不覆盖；首次接管使用 --migrate-legacy，安装器保留 *.pre-managed-backup-*。安装后新开宿主会话；CLI 可使用 /plugins reload，并检查 /plugins、/hooks。本变更不代表任何 MCP 服务已完成真实认证。
