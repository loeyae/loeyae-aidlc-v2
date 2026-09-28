---
name: aidlc-test-case-derivation
description: "从已批准的产品行为或技术风险来源派生可执行 UC-D；所有进入代码生成的 scope 都必须执行 I13，无行为时生成结构化不适用证据。"
triggers: 测试用例派生, UC-D, 测试场景, 验收测试设计, test case derivation, 测试用例设计
---

# 测试用例派生能力

开始时宣布："使用 aidlc-test-case-derivation 派生测试用例"。

## 输入

调用方必须提供：

- 用例类型（产品或技术）；
- 已批准的需求、故事或技术风险来源及稳定 `source_ref`；无来源时必须提供结构化纯声明/样式/配置例外依据；
- 可执行锚点；
- 模块或服务范围；
- 适用的现有测试与覆盖证据。

缺少必要输入时返回 `NEEDS_CONTEXT`，不推断来源是否已批准或 I13 状态。

## 加载

加载发布包中的 `knowledge/protocols/test-case-derivation.md`。

## 输出

返回新增或更新的 UC-D 文件路径、`_index.md`、来源与覆盖映射、覆盖缺口、冲突、未决项和结构自检结果；无可执行业务行为时返回并验证 `non-applicable.json`（含 `reason_code`、`approval_ref`、`alternative_validation`、`validation_command` 和 `source_refs`）。不得因快速模式或 scope 精简跳过 I13。

## 禁止事项

不得：

- 批准或改写来源；
- 更新项目 state 或 audit；
- 执行 TDD 或 C8；
- 放行质量门禁；
- 宣布 I13 完成；
- 伪造 evidence。
