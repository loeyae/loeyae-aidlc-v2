# Loeyae AI-DLC v2 — Kiro IDE / CLI

Kiro IDE 与 Kiro CLI 共用标准全局 Agent Skill：`~/.kiro/skills/loeyae-aidlc/SKILL.md`。安装后可在 **Agent Steering & Skills** 中查看，并通过 `/loeyae-aidlc` 显式激活；`SKILL.md` 的描述也覆盖 `AI-DLC`、`使用 AI-DLC`、`功能设计`、`用户故事`、`代码审查` 等自动激活关键词。

安装器会将共享 Kiro MCP 默认项合并到 `~/.kiro/settings/mcp.json`。其中 `chrome-devtools-mcp` 仅用于 SVG/目标预览的浏览器验收，不生成 SVG 或导出文件；不可用时按 `NEEDS_CAPABILITY` 处理。`docs/aidlc/aidlc-state.json` 是签名机器状态，`docs/aidlc/handoff.md` 仅为派生人类视图。

Kiro 的 Hook 配置必须位于业务项目的 `.kiro/hooks/`，全局 Skill 中随附的 Hook 源文件不会自动成为项目 Hook。根据当前宿主使用以下任一命令显式安装项目级 Stop Hook：

```bash
loeyae-aidlc install --harness kiro-ide --project /absolute/path/to/project
loeyae-aidlc install --harness kiro-cli --project /absolute/path/to/project
```

该 Hook 在 Agent 停止前调用 `loeyae-aidlc orchestrate report --stage <current> --result completed`；所有门禁仍由确定性引擎执行。Hook 不签发审批 token、不携带 `--instruction-ack`、不生成/修改 Evidence，因此不能自动推进 `approval:block` 或 `instruction_only` stage。具体 Kiro 版本若不支持阻断 Stop，仍不能绕过引擎门禁；需要继续处理时必须修复失败并重新报告。
