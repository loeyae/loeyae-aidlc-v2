# Loeyae AI-DLC for WorkBuddy Enterprise / CodeBuddy

本目录构建为 CodeBuddy 本地 marketplace，包含 Skill 和 Stop Hook。正式安装由 `loeyae-aidlc install --harness codebuddy` 调用 CodeBuddy 官方 CLI 完成，不直接编辑宿主 registry 或 cache。Core 不声明领域 MCP；`--project` 仅选择部署范围，不授权连接。历史宿主 MCP 保留，卸载不释放受管连接。

默认安装为 user scope。项目级安装使用：

```bash
loeyae-aidlc install --harness codebuddy --project /absolute/path/to/project
```

安装或升级后新开 CodeBuddy 会话；已打开会话不会保证热重载插件配置。
