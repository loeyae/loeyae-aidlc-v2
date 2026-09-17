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