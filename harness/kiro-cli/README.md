# Loeyae AI-DLC v2 — Kiro CLI

安装：

```bash
loeyae-aidlc install --harness kiro-cli
```

Skill 安装到 `~/.kiro/skills/loeyae-aidlc/`，入口文件为 `SKILL.md`。在 Kiro CLI 新会话中输入 `使用 AI-DLC` 启动 v2 引擎流程。`docs/aidlc/aidlc-state.json` 是 HMAC、workflow ID、revision/CAS 保护的唯一机器状态，外部 enrollment 绑定项目；`docs/aidlc/handoff.md` 仅为派生人类视图。

在支持独立 Hook 配置的 Kiro CLI 版本中，可为业务项目安装同一套 Stop Hook：

```bash
loeyae-aidlc install --harness kiro-cli --project /absolute/path/to/project
```

Hook 只触发 `orchestrate report`，不复制门禁逻辑，不直接写 state/handoff，不生成或修改 Evidence，也不签发审批 token。`instruction_only` stage 必须由执行主体显式 `--instruction-ack`，因此 Hook 不会自动推进；最终结果仍以引擎返回为准。
