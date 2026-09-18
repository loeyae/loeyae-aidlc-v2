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

当 directive 包含 `agent_execution` 时，加载 `agents/<primary.id>.md` 与 `skills/aidlc-agent-execution/SKILL.md`。对 `delegate`、`pipeline`、`mob` 和 `review` 使用宿主原生 subagent 能力；若不可用，明确回退 inline。只有 conductor 可以 `orchestrate report`、更新 state/audit、批准或 merge。
