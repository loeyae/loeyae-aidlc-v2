---
name: loeyae-aidlc
description: AWS-style lightweight AI-DLC workflow for explicit work, Markdown state/audit, unit selection, review, build, test, and merge planning.
---

# Loeyae AI-DLC

```bash
loeyae-aidlc orchestrate next --scope <scope> --work "<工作描述>"
```

控制面为 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md`。展示 `handoff_prompt` 后执行当前阶段的产物、review、构建、测试和报告。成员使用 `unit select` 公开记录分工；审批使用 `--user-input Approve`。

存在 `aidlc/active/registry.md` 时为按模块拆分的工作流：用 `orchestrate next --module <id>` 推进单个模块，按 `handoff_prompt` 给出的带 `--module` 的 report 命令结算；已完成阶段的证据失配时，先 `evidence run --stage <slug> --module <id> --refresh`，再用同一 `report` 命令复验（re-attest）。

## Agent execution

当 directive 包含 `agent_execution` 时，加载 `agents/<primary.id>.md` 与 `skills/aidlc-agent-execution/SKILL.md`。对 `delegate`、`pipeline`、`mob` 和 `review` 使用宿主原生 subagent 能力；若不可用，明确回退 inline。只有 conductor 可以 `orchestrate report`、更新 state/audit、批准或 merge。
