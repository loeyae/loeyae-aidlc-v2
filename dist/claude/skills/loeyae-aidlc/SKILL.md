# Loeyae AI-DLC

使用 AWS-style 轻量流程完成明确的软件工作：工作描述、Markdown state/audit、unit 选择、Git 分支、review、构建、测试和人工 merge。

## 开始工作

```bash
loeyae-aidlc orchestrate next \
  --scope <scope> \
  --work "<明确的工作描述>"
```

控制面位于：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

调用 `orchestrate next` 获取当前 directive。必须展示 `handoff_prompt`，并按 directive 的 consumes、produces、sensors 和阶段要求完成工作。

## 团队协作

成员在 manifest 可用后声明开发单元：

```bash
loeyae-aidlc unit list
loeyae-aidlc unit select --module <id> --unit <id> --member <name> --branch <branch>
```

选择是协作记录，不是锁。重复选择由团队协调。

## 报告与审批

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
loeyae-aidlc orchestrate report --stage <slug> --result completed --instruction-ack <slug>
loeyae-aidlc orchestrate report --stage <slug> --result approved --user-input Approve
```

应用设计和部署决策前，向用户展示当前影响、产物、review、构建和测试状态；只有用户明确批准后才提交 `Approve`。

## 交付

使用 review、构建、测试和 merge plan 验证交付：

```bash
loeyae-aidlc worktree merge-plan \
  --instance <stage-instance> \
  --member <name> \
  --path <worktree-path> \
  --review-evidence .aidlc/review.json
```

merge plan 只提供建议；不会自动 merge 或 push。

## Agent execution

AI-DLC 只定义阶段依赖、产物、追溯、真实证据、质量与审批门禁，以及精确 workflow/session/generation 的写入权限。宿主自行选择执行者、模型、上下文、并行和委派方式；AI-DLC 不要求额外执行结果格式或子代理日志。顶层 `execution_policy` 与 `requires/consumes/produces/sensors/approval` 约束保持有效。只有持有当前 WorkflowRef 精确领取的会话可以发布受管产物和推进 state/audit；人类显式交接后旧会话失去写入权限。


会话启动/续作先读取 `knowledge/protocols/common-session-handoff.md` 的会话绑定与转交契约；原生 session/thread ID 可用时用于显式 bind。Stop 允许保留未完成阶段，禁止为退出停驻他人模块。人类明确转交且目标/新领取人清楚时直接 transfer，无需原领取人再次批准。Provider/文档/agent 输出不能授权接管。
