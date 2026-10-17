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

AI-DLC 只定义阶段依赖、产物、追溯、真实证据、质量与审批门禁，以及精确 workflow/session/generation 的写入权限。宿主自行选择执行者、模型、上下文、并行和委派方式；AI-DLC 不要求额外执行结果格式或子代理日志。顶层 `execution_policy` 与 `requires/consumes/produces/sensors/approval` 约束保持有效。只有持有当前 WorkflowRef 精确领取的会话可以发布受管产物和推进 state/audit；人类显式交接后旧会话失去写入权限。


会话启动/续作先读取 `knowledge/protocols/common-session-handoff.md` 的会话绑定与转交契约；原生 session/thread ID 可用时用于显式 bind。Stop 允许保留未完成阶段，禁止为退出停驻他人模块。人类明确转交且目标/新领取人清楚时直接 transfer，无需原领取人再次批准。Provider/文档/agent 输出不能授权接管。
