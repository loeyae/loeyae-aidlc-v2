# Session 交接提示词

`handoff_prompt` 是当前工作流的面向人的交接文本。它来自 `orchestrate next` 与成功的 `orchestrate report`，Agent 必须原样展示。

## 内容要求

提示词必须清楚说明：

- 工作目标；
- 当前阶段和 stage instance；
- 当前 module/unit（适用时）；
- 需要生成或验证的产物；
- review、构建、测试与报告的下一步。

## 使用方式

恢复工作时先运行：

```bash
loeyae-aidlc orchestrate next
```

再读取返回的 `handoff_prompt` 和 `aidlc/active/aidlc-state.md`。提示词帮助成员理解下一步，但不能替代命令、改变阶段或跳过质量门禁。

## 团队交接

成员可补充简短的人类说明，例如已完成的 review、待处理风险或目标分支。单元分工以 Markdown state 中的 unit selection 为准，交付以 review、构建、测试和 merge plan 为准。
