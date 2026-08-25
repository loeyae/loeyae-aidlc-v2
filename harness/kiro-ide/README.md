# Loeyae AI-DLC v2 — Kiro IDE

将 `POWER.md`、`mcp.json` 和 `steering/` 安装到 Kiro Power 后，输入 `使用 AI-DLC` 启动 v2 引擎流程。`mcp.json` 预置固定版本的 `chrome-devtools` MCP，仅用于 SVG/目标预览的浏览器验收，不生成 SVG 或导出文件；不可用时按 `NEEDS_CAPABILITY` 处理。阶段状态保存在业务项目的 `docs/aidlc/aidlc-state.json`。

Kiro IDE 的 Hook 配置必须位于业务项目的 `.kiro/hooks/`，全局 Power 目录中的 Hook 文件不会自动成为项目 Hook。使用以下命令显式安装项目级 Stop Hook：

```bash
loeyae-aidlc install --harness kiro-ide --project /absolute/path/to/project
```

该 Hook 在 Agent 停止前调用 `loeyae-aidlc orchestrate report --stage <current> --result completed`；所有门禁仍由确定性引擎执行。Kiro IDE 的 Stop Hook 只负责触发检查，具体版本若不支持阻断 Stop，仍不能绕过引擎门禁；需要继续处理时必须修复失败并重新报告。
