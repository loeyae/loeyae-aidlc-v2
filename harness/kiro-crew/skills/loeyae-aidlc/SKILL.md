---
name: loeyae-aidlc
description: AWS-style lightweight AI-DLC workflow for explicit work, Markdown state/audit, unit selection, review, build, test, and merge planning.
triggers: aidlc, AI-DLC, 使用 AI-DLC, 开始新工作, 继续当前工作, 选择开发单元, 功能设计, 用户故事, 代码审查, 部署准备
---

# Loeyae AI-DLC

从明确工作描述启动：

```bash
loeyae-aidlc orchestrate next --scope <scope> --work "<工作描述>"
```

控制面为 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md`。每次 `orchestrate next` 后原样展示 `handoff_prompt`，按当前阶段完成产物、review、构建、测试和报告。

成员使用 `unit list` 与 `unit select` 记录分工。应用设计和部署决策在用户明确批准后通过 `--user-input Approve` 报告。merge plan 只提供人工合并建议。

## Agent execution

当 directive 包含 `agent_execution` 时，加载 `agents/<primary.id>.md` 与 `skills/aidlc-agent-execution/SKILL.md`。对 `delegate`、`pipeline`、`mob` 和 `review` 使用宿主原生 subagent 能力；若不可用，明确回退 inline。只有 conductor 可以 `orchestrate report`、更新 state/audit、批准或 merge。
