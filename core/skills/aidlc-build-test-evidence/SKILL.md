---
name: aidlc-build-test-evidence
description: "执行真实构建和测试命令并生成结构化证据；不负责 C8 路由和完成判定。"
---

# 构建测试证据能力

开始时宣布："使用 aidlc-build-test-evidence 执行构建与测试"。

## 输入

调用方必须提供：

- 执行矩阵（组件/服务、构建命令、测试命令、预期退出码）；
- 审查证据确认（双轴审查和可选全局审查已通过）；
- 测试分层策略取值（L3 或 L4）；
- 工作目录。

缺少必要输入时返回 `NEEDS_CONTEXT`。命令不明确时返回 `BLOCKED`，不臆造构建命令。

## 加载

加载发布包中的 `stages/construction/construction-build-and-test.md`。

## 输出

返回构建报告路径、测试结果摘要、结构化 evidence（`build-test-evidence.json`）和失败项。

## 禁止事项

不得：

- 臆造构建或测试命令；
- 编造命令执行结果；
- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 宣布 C8 或 Construction 完成；
- 手动写入 evidence 文件绕过实际执行。
