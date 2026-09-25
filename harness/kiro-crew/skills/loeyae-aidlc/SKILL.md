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

## 门禁强制契约（kiro-crew 无 host 自动 hook，必须靠本契约兜底）

KiroCrew Dashboard 不提供 Stop 事件的自动 hook，门禁的强制执行**依赖你严格遵守以下契约**，不得绕过：

1. **推进必经 `orchestrate next`**：进入任何下一阶段前必须调用 `loeyae-aidlc orchestrate next`。不得凭记忆或直觉跳到下一阶段、也不得在未取得下一 directive 时直接编写下游产物。
2. **`next` 返回 error/🚫 即"不可推进"**：`next` 现内置前置门禁——若上游阶段的准出门禁（sensor）未过，它会返回 `🚫 无法推进...` 的 error directive。**这是硬信号：停下，按清单修复上游产物/证据，重新 `orchestrate report` 使门禁转绿，再 `next`。** 不得忽略该 error 继续工作。
3. **每阶段结束必须 `orchestrate report`**：完成一个阶段的产物后，必须 `report` 让引擎跑该阶段的 sensor。`report` 返回 `🚫 Cannot complete stage ... sensor checks failed` 时，阶段**未完成**，必须先修复，不得标记完成或推进。
4. **禁止伪造证据放行**：不得手写/篡改 `.aidlc/evidence/**` 使门禁"看起来"通过。确定性 checker（如 diagram-contract、ui-artifact 对账）由引擎生成证据，你的职责是让**真实产物**满足门禁，而非让证据字段满足门禁。
5. **人工审批门（application-design/部署）**：只有用户明确批准后才 `--user-input Approve`；不得代替用户点批。

违反以上任一条＝绕过门禁，会直接导致你观察到的"用户故事偏离 PRD、前端偏离设计稿"类漂移。在 kiro-crew 下，你就是门禁的最后一道执行者。
