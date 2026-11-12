# 默认：宿主直接实施

使用宿主原生工具按用户已明确的设计和验收标准实施、测试、审查及返修。可选 `loeyae-aidlc work` 只读获取 Git/所选输入；无需 H5、claim、专用 worker 或逐阶段 report。真实验收失败继续修复，不得宣称完成；流程记录缺失不阻止独立工作。

## 兼容参考

以下旧 orchestrate、会话及专用 runtime 说明仅在用户明确选择维护旧受管流程时适用，不是默认实施前置条件。

# Loeyae AI-DLC for Kiro

使用 Markdown workflow 管理开发：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

默认不安装 Stop Hook；显式保留的旧兼容 Hook 只读取当前状态：仅诊断本会话显式 binding，结束回合可保留 running 阶段。Hook 不推进阶段、不生成 Evidence，也不替代 review、构建或测试。

从明确工作描述开始：

```bash
loeyae-aidlc orchestrate next --scope feature --work "修复订单导出超时"
```
