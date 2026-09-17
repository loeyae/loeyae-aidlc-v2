# Loeyae AI-DLC for Codex

使用明确工作描述启动当前 Markdown workflow：

```bash
loeyae-aidlc orchestrate next --scope feature --work "实现订单导出重试"
```

状态与审计位于 `aidlc/active/aidlc-state.md` 和 `aidlc/active/audit.md`。Agent 调用 `orchestrate next` 获取 directive 并展示 `handoff_prompt`；成员通过 `unit select` 记录分工。

阶段交付以产物、review、构建、测试和 merge plan 为准。应用设计和部署决策在用户明确批准后以 `--user-input Approve` 报告。