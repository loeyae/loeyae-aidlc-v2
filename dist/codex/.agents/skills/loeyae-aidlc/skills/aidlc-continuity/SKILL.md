---
name: aidlc-continuity
description: Continue an AWS-style lightweight AI-DLC workflow from Markdown state and audit.
---

# Lightweight Workflow Continuity

当前 workflow 只读取：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

继续工作：

```bash
loeyae-aidlc orchestrate next
```

若没有 active workflow，要求用户明确新的工作描述并启动：

```bash
loeyae-aidlc orchestrate next --scope <scope> --work "<工作描述>"
```

必须展示 directive 的 `handoff_prompt`。团队成员进入 Construction 时先查看或声明 unit：

```bash
loeyae-aidlc unit list
loeyae-aidlc unit select --module <id> --unit <id> --member <name> --branch <branch>
```

review、构建、测试和 merge plan 是交付依据。