# Loeyae AI-DLC v2 for Qoder Desktop / CLI

本目录是 Qoder 原生本地插件，包含 Skill、Stop Hook 和 MCP 声明。Qoder 官方说明 Skills 在 Qoder IDE 与 CLI 中行为一致；经真实 Windows 验证，user scope 插件可由 Qoder Desktop 加载并触发。

正式安装由 `loeyae-aidlc install --harness qoder` 调用官方 `qoder plugins` 命令完成，插件 ID 为 `loeyae-aidlc@local`。Loeyae 只管理项目外的插件源和 ownership manifest，不直接编辑 Qoder 的 `settings.json` 或插件 cache。自动安装要求 PATH 中存在 `qoder`，也可通过 `QODER_CLI` 指定；仅检测到 Qoder Desktop 安装目录不足以证明官方注册命令可调用。

默认安装为 user scope。项目级安装使用：

```bash
loeyae-aidlc install --harness qoder --project /absolute/path/to/project
```

安装或升级后，重启 Qoder Desktop；Qoder CLI 可执行 `/plugins reload` 或重新启动。本地 `@local` 插件应在桌面版 **Settings → Plugins → User → Custom** 中核对，不一定显示在 Marketplace 的 Installed 过滤结果中。本 harness 不声称自动注册 Qoder JetBrains 插件。
