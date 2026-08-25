---
name: aidlc-systematic-debugging
description: "基于可复现失败和原始证据执行系统化根因分析并给出最小修复与验证结果；不负责故障路由和阶段决策。"
---

# 系统化调试能力

开始时宣布："使用 aidlc-systematic-debugging 执行系统化调试"。

## 输入

输入项和证据不足时的处理以发布包中的 `knowledge/standards/common-systematic-debugging.md` 的"输入要求"为准，本文件不复制该清单。无法稳定复现或缺少必要证据时返回 `NEEDS_CONTEXT`，不猜测根因。

## 加载

加载发布包中的 `knowledge/standards/common-systematic-debugging.md`；实施修复时按该规则加载 `stages/construction/construction-tdd.md`。

## 输出

返回状态（`DONE`、`NEEDS_CONTEXT` 或 `BLOCKED`）、假设—验证记录、根因证据或明确未决结论、最小修复建议、修复后的验证结果，或继续处理所需上下文。

## 禁止事项

不得：

- 绕过三次失败停止条件；
- 决定是否回退 Inception 或进入 CR；
- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 宣布阶段完成；
- 伪造 evidence。
