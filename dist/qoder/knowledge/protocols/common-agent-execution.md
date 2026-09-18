# Agent 执行协议

`orchestrate next` 的 `run-stage` directive 可包含 `agent_execution`。该对象是阶段的唯一 agent 执行计划。

## 权限边界

- 只有 conductor 可以调用 `orchestrate report`、更新 Markdown state/audit、记录审批结果或执行 merge/push。
- Agent 只能生成业务产物、review 结论或结构化结果。
- Agent 不得派发嵌套 agent；`nested_delegation` 必须为 `forbidden`。
- 任何 agent 输出必须通过：

```bash
loeyae-aidlc agent validate-result <result.json>
```

结果必须包含 `agent`、`stage`、`status`、`summary`、`artifacts` 和 `risks`，不得包含 state、audit、approval、merge、push 或 delegations 字段。

## 执行方式

1. 加载 `agents/<agent-id>.md`，获取 persona、知识焦点、允许模式与权限边界。
2. `inline`：conductor 在当前会话加载 persona 后执行对应 Skill。
3. `delegate`：若宿主有原生 subagent 能力，派发一个新鲜上下文的实现 agent；否则 conductor 加载同一 persona inline 执行，并在结果中说明 fallback。
4. `pipeline`：按照 `dispatch_steps` 顺序派发；后续 agent 只接收前一步结构化结果和必需产物，不接收完整私有会话历史。
5. `mob`：每个 `dispatch_steps` agent 独立贡献；conductor 或 lead 整合最终产物。
6. `review`：派发 reviewer 到隔离上下文。reviewer 只读审查对象和证据，不编辑被审查业务产物，也不读取实现者私有推理。

## 交付回路

agent 返回结果 → conductor 验证结构 → review/build/test/sensor → 用户审批（如适用）→ conductor `report` → 更新 Markdown state/audit。

agent 失败、缺少能力或返回 `NEEDS_CONTEXT` / `BLOCKED` 时，conductor 不得标记阶段完成。