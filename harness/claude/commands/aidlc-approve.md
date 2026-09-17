---
description: 审阅当前 AI-DLC 架构或部署决策，并在用户明确批准后报告审批结果。
---

# AI-DLC 审批

1. 调用 `loeyae-aidlc orchestrate next` 确认当前阶段是审批门禁。
2. 展示工作目标、决策影响、产物、review、构建和测试状态。
3. 询问用户是否批准。
4. 仅在用户明确批准后执行：

```bash
loeyae-aidlc orchestrate report \
  --stage <slug> \
  --result approved \
  --user-input Approve
```

用户要求修改或驳回时，保留当前阶段，完成修订和相关验证后再请求批准。