# Loeyae AI-DLC v2 for ZCode

`dist/zcode` 是可由 **Settings → Plugins → Create → Add marketplace** 导入的本地 marketplace。由于 ZCode 当前没有公开的 CLI 插件注册命令，`loeyae-aidlc install --harness zcode` 默认采用可自动管理的用户集成：

- Skill 安装到用户级 ZCode Skill 目录；
- Stop Hook 精确合并到用户配置；
- 缺失的 MCP 服务合并到用户配置，已有同名配置保持不变。

修改后请新开 ZCode 会话；Hook 配置在会话启动时快照。完整插件模式需要在 ZCode UI 中导入 `dist/zcode`、安装并启用插件。
