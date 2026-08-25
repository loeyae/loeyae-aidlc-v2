# Loeyae AI-DLC v2 — Kiro CLI

安装：

```bash
loeyae-aidlc install --harness kiro-cli
```

Skill 安装到 `~/.kiro/skills/loeyae-aidlc/`，入口文件为 `SKILL.md`。在 Kiro CLI 新会话中输入 `使用 AI-DLC` 启动 v2 引擎流程。阶段状态保存在业务项目的 `docs/aidlc/aidlc-state.json`。

在支持独立 Hook 配置的 Kiro CLI 版本中，可为业务项目安装同一套 Stop Hook：

```bash
loeyae-aidlc install --harness kiro-cli --project /absolute/path/to/project
```

Hook 只触发 `orchestrate report`，不复制门禁逻辑，也不直接写状态或 Evidence；最终结果仍以引擎返回为准。
