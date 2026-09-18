---
name: loeyae-aidlc
description: Use the AWS-style lightweight Loeyae AI-DLC workflow for explicit work, Markdown state/audit, unit selection, review, build, test, and merge planning.
---

# Loeyae AI-DLC

启动：

```bash
loeyae-aidlc orchestrate next --scope <scope> --work "<工作描述>"
```

读取 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md`，展示 directive 的 `handoff_prompt`，并按阶段完成产物、review、构建、测试和报告。

成员使用 `unit select` 声明分工。应用设计和部署决策仅在用户明确批准后以 `--user-input Approve` 报告。

## Agent execution

当 directive 包含 `agent_execution` 时，加载 `agents/<primary.id>.md` 与 `skills/aidlc-agent-execution/SKILL.md`。对 `delegate`、`pipeline`、`mob` 和 `review` 使用宿主原生 subagent 能力；若不可用，明确回退 inline。只有 conductor 可以 `orchestrate report`、更新 state/audit、批准或 merge。
