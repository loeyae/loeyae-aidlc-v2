---
name: aidlc-deployment-validation
description: "对生成的交付配置执行静态验证和可执行性检查；不负责实际部署和阶段完成判定。"
triggers: 部署配置验证, 交付配置校验, 发布配置检查, deployment validation, 部署可执行性检查
---

# 部署准备验证能力

开始时宣布："使用 aidlc-deployment-validation 验证部署配置"。

## 输入

调用方必须提供：

- 待验证的配置文件路径列表；
- 部署目标类型和环境；
- 验证范围（语法、引用完整性、安全基线）。

缺少必要输入时返回 `NEEDS_CONTEXT`。

## 加载

加载发布包中的 `stages/operation/operations.md`（步骤 4 验证部分）。

## 输出

返回每个配置文件的验证结果（语法、引用完整性、安全基线）和未解决问题。

## 禁止事项

不得：

- 执行实际部署；
- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 宣布 Operations 完成；
- 伪造 evidence。
