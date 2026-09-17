# Loeyae AI-DLC for Kiro

使用 Markdown workflow 管理开发：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

Stop Hook 只读取当前状态：workflow 正在运行时提示继续或明确暂停；已完成或暂停时放行。Hook 不推进阶段、不生成 Evidence，也不替代 review、构建或测试。

从明确工作描述开始：

```bash
loeyae-aidlc orchestrate next --scope feature --work "修复订单导出超时"
```
