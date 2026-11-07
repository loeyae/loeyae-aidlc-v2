---
name: aidlc-approval
description: Approve an AWS-style lightweight AI-DLC architecture or deployment decision.
---

# Lightweight Approval

应用设计和部署阶段需要人工决策。

完成当前产物和适用 sensor 后，向用户展示：

- 当前工作描述；
- 当前阶段和关键决策；
- 产物、review、构建/测试状态；
- 影响与风险。

用户明确批准时报告：

```bash
loeyae-aidlc orchestrate report \
  --stage <slug> \
  --result approved \
  --user-input Approve
```

用户要求修改时，保留当前阶段并按反馈修订后重新报告。普通阶段按产物、review、构建和测试门禁推进。