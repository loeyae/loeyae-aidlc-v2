---
name: loeyae-aidlc
description: Use the AWS-style lightweight Loeyae AI-DLC workflow for explicit work, Markdown state/audit, unit selection, review, build, test, and merge planning.
---

# Loeyae AI-DLC

启动：

```bash
loeyae-aidlc orchestrate next --scope <scope> --work "<工作描述>"
```

读取 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md`，展示 directive 的 `handoff_prompt`，并按阶段完成产物、review、构建、测试和报告。

成员使用 `unit select` 声明分工。应用设计和部署决策仅在用户明确批准后以 `--user-input Approve` 报告。