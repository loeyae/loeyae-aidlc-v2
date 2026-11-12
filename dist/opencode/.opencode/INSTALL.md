# 默认：宿主直接实施

使用宿主原生工具按用户已明确的设计和验收标准实施、测试、审查及返修。可选 `loeyae-aidlc work` 只读获取 Git/所选输入；无需 H5、claim、专用 worker 或逐阶段 report。真实验收失败继续修复，不得宣称完成；流程记录缺失不阻止独立工作。

## 兼容参考

以下旧 orchestrate、会话及专用 runtime 说明仅在用户明确选择维护旧受管流程时适用，不是默认实施前置条件。

# Loeyae AI-DLC for OpenCode

续作先运行 `loeyae-aidlc orchestrate state context [--module <id>] [--unit <id>]`，再获取最新 `next --preview`。不默认整读 state/audit、历史快照、验证目录或全部模块。按 directive 的规则与业务读取计划加载精确输入，切片同时包含 private 与 inherited。大过程文档使用 `orchestrate state artifact --path <文件>` 分页/摘要，原始证据继续由工具完整校验；不额外维护 handoff/progress 状态副本。

安装后，使用 AWS-style 轻量流程管理开发工作。

```bash
loeyae-aidlc orchestrate next --scope feature --work "实现新的订单导出重试"
loeyae-aidlc orchestrate next
```

工作流控制面是：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

团队成员通过 `unit list` 和 `unit select` 公开记录分工。每个阶段仍要求满足 directive 的产物、review、构建、测试和 sensor；应用设计与部署决策在用户明确批准后使用 `--user-input Approve` 报告。

生成 merge plan 后由团队人工完成 merge；工具不会自动 push 或 merge。