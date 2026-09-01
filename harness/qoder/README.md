# Loeyae AI-DLC v2 for Qoder CLI

本目录是 Qoder CLI 原生插件，包含 Skill、Stop Hook 和 MCP 声明。正式安装由 `loeyae-aidlc install --harness qoder` 调用 `qoder plugins` 完成，不直接编辑 Qoder 的 `settings.json` 或插件 cache。

默认安装为 user scope。项目级安装使用：

```bash
loeyae-aidlc install --harness qoder --project /absolute/path/to/project
```

安装或升级后执行 `/plugins reload`，或重启 Qoder CLI。本 harness 不声称自动注册 Qoder IDE/JetBrains 插件。
