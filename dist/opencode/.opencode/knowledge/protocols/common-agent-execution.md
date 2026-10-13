# Agent 执行协议

`orchestrate next` 的 `run-stage` directive 可包含 `agent_execution`。该对象是阶段的唯一 agent 执行计划。

## 统一执行策略

`run-stage` directive 同时包含由当前 workflow state 和 stage graph 确定性生成的 `execution_policy`。同一个对象也位于 `agent_execution.execution_policy`，使只传递 execution plan 的宿主不会丢失约束。它不是第二套配置，也不替代 `requires`、`consumes`、`produces`、sensor、Provider、review、build、test 或审批门禁；它把这些已有约束转成所有 persona 都遵守的执行边界。

执行 agent 和 reviewer 必须以此字段及 `handoff_prompt` 为准：

- `task_level` 区分 `question`、`local-change`、`multi-file-feature` 与 `cross-module-infrastructure`；多个文件不会自动升级为全仓审查。
- `required` 是当前阶段已有的 requires、产物、sensor、approval 和 completion contract；由 Engine / producer 确定性完成的检查仍由对应机制执行，Agent 不得重复或替代它们。
- 只复用 provenance、revision、digest 和新鲜度仍有效的受控 Evidence；工具、Agent 或阶段描述变化不是重跑等价检查的理由。
- `allowed_exploration`、`prohibited_actions`、`stop_conditions` 与 `expansion_triggers` 约束探索和收尾。只有门禁失败、直接依赖/共享契约证据、无法界定影响、安全/数据完整性风险或用户明确 exhaustive 要求允许扩大范围；修复后只重跑受影响、失效或尚未满足的声明检查。非阻断且无法执行的检查须在结构化 `risks` 中记为未验证及原因；同一检查连续失败两次后改用不同诊断路径或返回 `NEEDS_CONTEXT` / `BLOCKED`，不得无限等价重试。
- 成功条件满足后立即交回 owning conductor；不得为提高信心追加无关探索、重构、测试或同范围二次委托。
- 规则优先级固定为：用户明确要求及安全约束 > 当前 AIDLC directive 与强制门禁 > 当前任务的执行范围、必需检查和停止条件 > Agent 一般行为准则。

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
3. `delegate`：若宿主有原生 subagent 能力，派发一个新鲜上下文的实现 agent，并原样传递 `agent_execution.execution_policy` 与其 `required` 约束；不得以宿主自定义提示取代它。无能力时 conductor 加载同一 persona inline 执行，并在结果中说明 fallback。
4. `pipeline`：按照 `dispatch_steps` 顺序派发；每一步接收同一个 `agent_execution.execution_policy`、前一步结构化结果和必需产物，不接收完整私有会话历史。
5. `mob`：每个 `dispatch_steps` agent 独立贡献时都接收同一个 `agent_execution.execution_policy`；lead/conductor 统一整合最终产物。
6. `review`：派发 reviewer 到隔离上下文，并原样传递策略中声明的审查范围。reviewer 只读审查对象和证据，不编辑被审查业务产物，也不读取实现者私有推理。

## 交付回路

execution agent 返回结果 → **拥有当前 WorkflowRef 的 conductor** 验证结构 → review/build/test/sensor → 用户审批（如适用）→ owning conductor `report` → 只更新该 workflow 的 Markdown state/audit。

split 布局中，各模块按自身 state 独立推进；全局进度由引擎读取所有模块 state 后动态聚合，模块完成不需要顶层父议题重复裁决或代报。execution agent 失败、缺少能力或返回 `NEEDS_CONTEXT` / `BLOCKED` 时，owning conductor 不得标记阶段完成。