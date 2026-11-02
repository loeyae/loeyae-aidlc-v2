# 在 AI 工具中使用 AI-DLC

本指南适用于已安装 Loeyae AI-DLC 的项目。AI 按当前工作流执行阶段；用户提供目标、回答必要问题、审阅决策和执行最终合并。阶段是否适用以当前 directive 为准。

## 准备

安装和升级见[安装指南](loeyae-aidlc-v2-installation.md)。在目标项目中启动已支持的 AI 宿主，并确认项目代码和所需 Git 分支可访问。

## 开始工作

向 AI 明确提出目标，例如：

```text
使用 AI-DLC，为订单导出增加超时重试；最多重试 3 次，保留现有接口。
```

也可以直接使用 CLI：

```bash
loeyae-aidlc orchestrate next --scope feature --work "为订单导出增加超时重试"
```

常规功能可选 `feature`、`enterprise`、`mvp` 或 `classic`；小范围变更、培训、缺陷修复或重构可分别考虑 `express`、`workshop`、`bugfix`、`refactor`。`bugfix` 应提供可复现缺陷的依据，`refactor` 应描述现有行为及基线。需要 PRD 时在完整 scope 初始化时明确提出；可用参数见 [CLI 指南](loeyae-aidlc-cli-guide.md)。

流程按 scope、风险、已批准的 UI/PRD 等选择和真实项目情况确定阶段；模块和单元会展开成实例，不按固定阶段数判断完成。需要用户选择或审批时按提示回答，不需要审批的阶段由执行者继续推进。

## 继续与交接

```text
使用 AI-DLC，继续当前工作。
```

执行者先根据现有状态确认工作目标、阶段、模块和单元；多项可推进时可明确指定目标。也可先使用只读命令检查：

```bash
loeyae-aidlc orchestrate next --preview
loeyae-aidlc orchestrate state summary
```

恢复已暂停的流程使用 `orchestrate next --resume`。更换成员或会话时，以当前 state、audit 和精确会话领取为准，按提示完成绑定或转交；聊天摘要和旧交接文档不是状态权威。摘要中的 `not_checked` 只表示查看时未重跑门禁。

## 多人协作

成员使用 `loeyae-aidlc unit list` 查看单元，用 `unit select` 记录负责的模块、单元、成员和分支。分工记录不代替受管写入领取；共享契约、依赖和集成条件按当前流程检查。

需要并行开发时，先明确各单元范围和共享输入。工作树的准备、验证、合并计划以及多仓恢复见[多仓库与工作树指南](multi-repo-worktree-recovery.md)。实际 merge 和 push 由具备权限的人执行。

## 验证与收尾

- 测试依据已批准的行为和风险设计：RED、GREEN、审查、构建测试及适用例外按 directive 和真实命令执行，不因反复输入“继续”而无限增加测试。
- 构建、测试和审查证据由受控工具生成；不要手写证据 JSON，或用报告文字代替真实结果。
- 单元审查维护 `code-review.md`；状态、审计及进度由引擎维护。除非交付约定明确要求，不需另写重复的实施、构建测试或交接汇总。
- 门禁受阻时先区分真实失败、来源变化、证据缺失和领取冲突，按照具体提示修复；保留已完成的有效结果。明确的业务风险和未验证事项应如实记录。

完成条件、阶段报告、审批和证据命令见 [CLI 指南](loeyae-aidlc-cli-guide.md)。项目有明确的业务报告、审批或交付要求时，仍按其约定办理。
