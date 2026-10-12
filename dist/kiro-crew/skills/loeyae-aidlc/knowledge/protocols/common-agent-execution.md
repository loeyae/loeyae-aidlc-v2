# Agent 执行协议

`orchestrate next` 的 `run-stage` directive 可包含 `agent_execution`。该对象是阶段的唯一 agent 执行计划。

## 权限边界

`conductor-only` 是**按 WorkflowRef 的单写者约束**，不是“顶层父议题协调者独占整个项目状态”：

- 单布局只有 global workflow，由当前 global conductor 串行调用 `orchestrate report`、更新其 Markdown state/audit。
- split 布局的 global、每个 module、integration 是相互独立的 workflow；每个 workflow 各有一个 conductor。模块负责人可作为本模块 workflow conductor，使用带 `--module <id>` 的 `next` / `report` / `park` 推进本模块，无需把状态动作回交顶层父议题。
- global/integration 阶段、跨模块 barrier、lineage 处置仍由对应 global/integration conductor 负责；需要用户批准的门禁仍必须取得真实用户输入，模块 conductor 不得代用户批准。
- 被 conductor 派发的 execution agent 只能生成业务产物、review 结论或结构化结果，不得直接写其所属 workflow 的 state/audit。
- execution agent 不得派发嵌套 agent；`nested_delegation` 必须为 `forbidden`。
- merge/push 保持人工控制，不因模块自主推进而自动执行。
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

execution agent 返回结果 → **拥有当前 WorkflowRef 的 conductor** 验证结构 → review/build/test/sensor → 用户审批（如适用）→ owning conductor `report` → 只更新该 workflow 的 Markdown state/audit。

split 布局中，各模块按自身 state 独立推进；全局进度由引擎读取所有模块 state 后动态聚合，模块完成不需要顶层父议题重复裁决或代报。execution agent 失败、缺少能力或返回 `NEEDS_CONTEXT` / `BLOCKED` 时，owning conductor 不得标记阶段完成。