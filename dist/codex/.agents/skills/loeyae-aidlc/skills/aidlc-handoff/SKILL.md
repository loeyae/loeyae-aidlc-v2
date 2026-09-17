---
name: aidlc-handoff
description: 根据当前 Markdown workflow 生成清晰的 AI-DLC 交接提示词。
triggers: 暂停并交接, 交接当前工作, 生成交接, handoff, aidlc handoff
---

# AI-DLC 交接

读取当前 workflow：

```bash
loeyae-aidlc orchestrate next
```

将返回的 `handoff_prompt` 原样展示为可复制文本。提示词必须包含工作目标、当前阶段/实例、module/unit、产物、review/build/test 与下一步。

用户仅希望换会话或换成员时，不要暂停流程；下一位成员运行 `orchestrate next` 后从 Markdown state 和 prompt 继续。

用户明确要求暂停时执行：

```bash
loeyae-aidlc orchestrate park
```

恢复时执行：

```bash
loeyae-aidlc orchestrate next --resume
```

交接说明不能改变阶段、单元选择或质量门禁。