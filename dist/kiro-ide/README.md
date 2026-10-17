# Loeyae AI-DLC for Kiro

使用 Markdown workflow 管理开发：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

Stop Hook 只读取当前状态：仅诊断本会话显式 binding，结束回合可保留 running 阶段。Hook 不推进阶段、不生成 Evidence，也不替代 review、构建或测试。

从明确工作描述开始：

```bash
loeyae-aidlc orchestrate next --scope feature --work "修复订单导出超时"
```
