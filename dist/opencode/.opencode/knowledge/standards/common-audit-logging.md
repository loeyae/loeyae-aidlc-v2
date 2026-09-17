# 审计记录

AI-DLC workflow 的控制面审计记录位于：

```text
aidlc/active/audit.md
```

每次状态保存都会追加时间、revision、工作目标、当前实例和状态。审计用于理解推进历史，不用于绕过阶段门禁。

阶段产物、review Evidence、构建测试日志和 merge plan 保持在各自声明的位置，并在 `handoff_prompt` 中作为下一步上下文引用。