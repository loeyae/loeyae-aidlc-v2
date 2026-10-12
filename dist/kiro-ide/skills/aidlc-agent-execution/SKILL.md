---
name: aidlc-agent-execution
description: Execute an AI-DLC agent_execution plan with portable persona, isolated review, structured return, and per-WorkflowRef conductor-only state authority.
---

# Agent Execution

当 directive 含有 `agent_execution` 时，先读取：

```text
agents/<primary.id>.md
knowledge/protocols/common-agent-execution.md
```

按 `agent_execution.mode` 执行：

- `inline`：当前 conductor 加载 persona 后执行。
- `delegate`：使用宿主原生 subagent 能力启动一个新鲜上下文的 agent；无能力时明确回退 inline。
- `pipeline`：按 `dispatch_steps` 顺序执行，前一步仅传递结构化结果与必需产物。
- `mob`：每个参与 persona 独立贡献，lead/conductor 统一整合。
- `review`：使用隔离 reviewer；reviewer 只读审查，不编辑业务产物。

Agent 返回 JSON 结果：

```json
{
  "agent": "aidlc-developer-agent",
  "stage": "code-generation",
  "status": "DONE",
  "summary": "…",
  "artifacts": ["…"],
  "risks": []
}
```

拥有当前 WorkflowRef 的 conductor 运行：

```bash
loeyae-aidlc agent validate-result result.json
```

验证后才可继续质量门禁和 `orchestrate report`。split 后，模块负责人可作为本模块 workflow conductor 使用带 `--module` 的 `next` / `report` / `park`，不需要回到 global/父议题协调者；被派发的 execution agent 仍不得更新 state、audit、代用户 approval、merge、push 或派发嵌套 agent。