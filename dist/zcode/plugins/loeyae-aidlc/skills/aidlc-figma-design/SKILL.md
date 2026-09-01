---
name: aidlc-figma-design
description: "基于已批准 UI 页面计划创建 Figma 设计，或只读登记外部设计稿；不负责 I9 路由和审批。"
triggers: Figma, Figma 设计, UI 设计稿, 外部设计稿, Figma 页面
---

# Figma 设计能力

开始时宣布："使用 aidlc-figma-design 执行 Figma 设计"。

## 输入

调用方必须提供：

- 已批准页面计划路径；
- `source=created` 或 `source=external`；
- 编排层已验证的 Figma 能力结果；
- 目标文件或创建目标；
- 设计资源和当前批次。

缺少任一输入时返回 `NEEDS_CONTEXT`，不推断流程状态或来源模式。

## 加载

加载发布包中的 `stages/inception/inception-ui-figma-generation.md`。Construction 的 `knowledge/design/common-figma-design-standards.md` 不属于本能力。

## 输出

返回主文件 URL、页面与 nodeId、设计资源使用结果、截图证据和未解决问题。外部提供模式只读。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 切换 UI 模式；
- 等待或代替用户审批；
- 执行 I10（交叉验证）；
- 宣布 I9/I10 完成；
- 伪造 evidence。
