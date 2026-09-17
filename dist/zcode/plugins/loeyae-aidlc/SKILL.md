---
name: loeyae-aidlc
description: AWS-style lightweight AI-DLC workflow for explicit work, Markdown state/audit, unit selection, review, build, test, and merge planning.
---

# Loeyae AI-DLC

```bash
loeyae-aidlc orchestrate next --scope <scope> --work "<工作描述>"
```

workflow 只使用 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md`。展示 `handoff_prompt`，完成产物、review、构建、测试和报告；成员使用 `unit select` 公开记录分工。