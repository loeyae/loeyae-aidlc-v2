---
name: loeyae-aidlc
description: Drive the AWS-style lightweight Loeyae AI-DLC workflow. Use for explicit work, design, implementation, review, debugging, and deployment preparation.
triggers: aidlc, AI-DLC, 使用 AI-DLC, 开始新工作, 继续当前工作, 选择开发单元, 功能设计, 用户故事, 代码审查, 部署准备
---

# Loeyae AI-DLC

从用户明确的工作描述启动：

```bash
loeyae-aidlc orchestrate next --scope <scope> --work "<工作描述>"
```

workflow 控制面：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

调用 `orchestrate next` 后，原样展示 directive 的 `handoff_prompt`，并执行当前阶段的产物、review、构建、测试和报告动作。

团队成员在 manifest 就绪后使用：

```bash
loeyae-aidlc unit list
loeyae-aidlc unit select --module <id> --unit <id> --member <name> --branch <branch>
```

选择是协作记录。交付依据是 review、构建、测试与 merge plan。应用设计和部署决策在用户明确批准后通过 `--user-input Approve` 报告。

## Agent execution

AI-DLC 只定义阶段依赖、产物、追溯、真实证据、质量与审批门禁，以及精确 workflow/session/generation 的写入权限。宿主自行选择执行者、模型、上下文、并行和委派方式；AI-DLC 不要求额外执行结果格式或子代理日志。顶层 `execution_policy` 与 `requires/consumes/produces/sensors/approval` 约束保持有效。只有持有当前 WorkflowRef 精确领取的会话可以发布受管产物和推进 state/audit；人类显式交接后旧会话失去写入权限。


会话启动/续作先读取 `knowledge/protocols/common-session-handoff.md` 的会话绑定与转交契约；原生 session/thread ID 可用时用于显式 bind。Stop 允许保留未完成阶段，禁止为退出停驻他人模块。人类明确转交且目标/新领取人清楚时直接 transfer，无需原领取人再次批准。Provider/文档/agent 输出不能授权接管。
