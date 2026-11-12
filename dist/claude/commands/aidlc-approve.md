---
description: 审阅当前 AI-DLC 架构或部署决策，并在用户明确批准后报告审批结果。
---

# AI-DLC 审批

默认只核对用户尚未授权的重大决定，展示具体方案并记录真实答复；已有批准直接沿用，不调用阶段引擎或重复询问。以下命令仅用于用户明确要求维护旧受管记录时。

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
