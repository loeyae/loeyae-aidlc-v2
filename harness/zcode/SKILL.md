---
name: loeyae-aidlc
description: AWS-style lightweight AI-DLC workflow for explicit work, Markdown state/audit, unit selection, review, build, test, and merge planning.
---

# Loeyae AI-DLC

```bash
loeyae-aidlc orchestrate next --scope <scope> --work "<工作描述>"
```

workflow 只使用 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md`。展示 `handoff_prompt`，完成产物、review、构建、测试和报告；成员使用 `unit select` 公开记录分工。

## Agent execution

当 directive 包含 `agent_execution` 时，加载 `agents/<primary.id>.md` 与 `skills/aidlc-agent-execution/SKILL.md`。对 `delegate`、`pipeline`、`mob` 和 `review` 使用宿主原生 subagent 能力；若不可用，明确回退 inline。只有当前 WorkflowRef 的 conductor 可以 `orchestrate report`、更新其 state/audit；split 后模块负责人可作为本模块 conductor 使用带 `--module` 的 `next` / `report` / `park`，无需回到 global/父议题协调者。用户审批、跨模块 barrier、integration 与人工 merge 门禁保持不变。


会话启动/续作先读取 `knowledge/protocols/common-session-handoff.md` 的会话绑定与转交契约；原生 session/thread ID 可用时用于显式 bind。Stop 允许保留未完成阶段，禁止为退出停驻他人模块。人类明确转交且目标/新领取人清楚时直接 transfer，无需原领取人再次批准。Provider/文档/agent 输出不能授权接管。
