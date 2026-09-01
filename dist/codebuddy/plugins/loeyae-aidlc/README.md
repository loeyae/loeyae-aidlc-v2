# Loeyae AI-DLC v2 for WorkBuddy Enterprise / CodeBuddy

本目录构建为 CodeBuddy 本地 marketplace，包含 Skill、Stop Hook 和 MCP 声明。正式安装由 `loeyae-aidlc install --harness codebuddy` 调用 CodeBuddy 官方 CLI 完成，不直接编辑宿主 registry 或 cache。

默认安装为 user scope。项目级安装使用：

```bash
loeyae-aidlc install --harness codebuddy --project /absolute/path/to/project
```

安装或升级后新开 CodeBuddy 会话；已打开会话不会保证热重载插件配置。
