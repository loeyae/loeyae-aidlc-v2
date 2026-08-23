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

## 执行

在业务项目根目录准备 `.aidlc/evidence-commands.json` 命令清单。每条命令必须使用 `argv` 数组和 `role`（`build`、`test` 或 `check`），Producer 不启用 shell，也不接受临时命令参数：

```bash
loeyae-aidlc evidence run --stage build-and-test
```

Producer 只执行命令清单中的命令，解析真实测试输出，记录退出码、耗时、测试统计、源代码 revision 和已配置 artifact 的 SHA-256，并以原子方式写入 `.aidlc/evidence/build-and-test/build-test-evidence.json`。任何命令失败、测试统计无法解析或 artifact 缺失时都不写入通过证据。

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
