# AI-DLC 问题渲染

默认宿主执行时，仅询问缺失的重大业务决定或实际权限，已有明确答案直接沿用，不为逐阶段推进发问。以下阶段命令仅适用于显式旧受管流程。

当 `orchestrate next` 返回 `ask` 时，展示问题、选项和必要的输入说明。用户回答后在下一回合调用相应命令。

对应用设计和部署决策，先展示当前工作目标、影响、产物、review、构建和测试状态。用户明确批准后使用：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result approved --user-input Approve
```

用户要求修改或拒绝时，记录反馈并保持当前阶段，完成修订和验证后重新请求决策。
