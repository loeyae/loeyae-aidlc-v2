# AI-DLC 关键词指南

| 场景 | 常见表达 | 执行动作 |
| --- | --- | --- |
| 开始新工作 | `使用 AI-DLC`、`开始新工作`、明确说明要实现或修复的内容 | 以 `orchestrate next --scope <scope> --work "<描述>"` 启动 Markdown workflow |
| 继续工作 | `继续上次工作`、`继续当前项目` | 调用 `orchestrate next`，展示 `handoff_prompt` |
| 选择单元 | `选择开发单元`、`我负责这个模块` | 使用 `unit list` 或 `unit select` 记录成员与分支 |
| 人工审批 | `确认架构方案`、`批准部署方案` | 展示影响与质量证据；用户明确批准后以 `--user-input Approve` 报告 |
| 代码审查 | `代码审查`、`review` | 生成 review evidence，覆盖实际变更路径 |
| 构建测试 | `构建`、`测试`、`验证` | 运行真实命令并以 controlled Evidence 记录结果 |
| 合并准备 | `准备合并`、`merge plan` | 创建 worktree merge plan，由人执行实际 merge |

每个 workflow 的状态和审计位于 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md`。