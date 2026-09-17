# Loeyae AI-DLC for OpenCode

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