# 长任务分段执行

**职责**：定义 Construction 多单元任务的分批、上下文传递和进度更新。恢复规则见 `common-session-continuity.md`，唯一状态源是 `docs/aidlc/handoff.md`。

## 分段策略

| 待执行单元 | 模式 | 默认批次大小 |
|------------|------|--------------|
| < 5 | continuous | 全部 |
| 5-9 | segmented | 3 |
| >= 10 | segmented | 2 |

多模块任务按模块分组，不跨模块混合。单元预计改动超过 15 个文件时，应在 Inception 调整单元边界；若执行期才发现，暂停并走变更评估，不按技术层机械拆分业务单元。

## handoff.md 字段

进入 Construction 时在 handoff.md 维护：

```markdown
## 执行策略
| 执行模式 | 批次大小 | 总批次 | 当前批次 |
|----------|----------|--------|----------|
| segmented | 3 | 3 | 1 |

## 单元与批次进度
| 模块 | 批次 | 单元 | 状态 | 完成时间 | 验证证据 | 执行者 |
|------|------|------|------|----------|----------|--------|
| default | 1 | U01 | pending | - | - | - |
```

状态仅使用 `pending`、`in_progress`、`rework_required`、`complete`、`blocked`。`rework_required` 表示上游语义变化已使该单元计划或证据失效，禁止调度；完成产品产物协调、更新单元定义并清除旧证据后转为 `pending`，再按正常流程重做。每个单元开始、完成、返工或阻塞后立即更新对应行；批次状态由单元行汇总，不维护第二份账本。

## 带类型依赖就绪判断（条件）

生成批次和选择下一个单元时，读取 `unit-of-work-dependency.md`、`handoff.md` 及适用的共享契约基线记录；不得以接口文件存在、设计文档或推测代替实际状态。

| 依赖类型 | 满足条件 | 调度处理 |
|----------|----------|----------|
| `contract` | 每个关联基线均为 `verified`，且验证证据完整 | 可调度消费者；`contract_ready` 仅为派生判断，不单独写入 handoff.md |
| `implementation` | 提供方单元为 `complete`，且验证证据完整 | 提供方完成前保持消费者 `blocked` |
| `runtime` | 真实服务、数据或环境已就绪 | 仅在就绪后执行相应集成验证；未就绪不得把该验证标记完成 |
| `none` | 无前置依赖 | 可调度 |

`contract` 依赖的状态和重新验证要求以 `construction-shared-contract-baseline.md` 为准；缺少契约 ID、基线记录、Owner 或证据时标记相关单元 `blocked` 并返回 I14 或 CR 补齐事实。

<!-- 实现副本：.claude/workflows/aidlc-construction-batch.js#deriveReadiness —— 修改上表判定规则时必须同步 -->

## 执行流程

1. 按依赖关系排序单元并生成批次，写入 handoff.md。
2. `rework_required` 单元先返回 `common-workflow-changes.md` 完成上游协调和单元定义更新，转为 `pending` 后才可调度。
3. 每次只执行一个满足依赖条件的 `pending` 单元；平台支持时派发独立子 Agent。
4. 子 Agent 只接收当前单元的需求、故事、设计、共享接口和规范的文件路径。
5. 单元完成前必须执行 TDD、`construction-code-review.md` 选定的审查模式和影响域验证，并将证据回写 handoff.md。
6. 单元失败时标记 blocked、记录根因并停止依赖它的后续单元。
7. 批次完成后更新当前批次和交接提示，再进入下一批次。

## 平台适配

| 平台 | 执行方式 |
|------|----------|
| Kiro | `invoke_sub_agent`，每单元一个子 Agent |
| Claude Code | Agent/Workflow，每单元独立上下文 |
| OpenCode | 支持代理时逐单元派发；否则当前上下文串行执行并逐单元更新 handoff.md |

平台能力不可假设。无法派发子 Agent 时只改变执行方式，不降低 TDD、审查和验证标准。

## 上下文纪律

- 调度提示只传文件路径，不粘贴完整产物。
- 主 Agent 只保留 handoff.md 路径、当前模块/单元和调度状态。
- 不累积前序单元的长摘要；需要事实时读取 handoff.md 或对应单元产物。
- 恢复时先读 handoff.md，跳过其中已标记 complete 且证据完整的单元。
- 文件存在不等于单元完成；状态与证据不一致时标记 blocked 并询问用户。

## 完成标准

所有计划单元均为 complete、依赖关系满足、验证证据存在，且 handoff.md 的当前批次、阶段进度、质量门禁和下一步交接一致。
