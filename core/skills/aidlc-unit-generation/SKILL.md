---
name: aidlc-unit-generation
description: "将系统分解为可独立实现的工作单元并建立依赖矩阵和故事映射；不负责单元认领和阶段完成判定。"
---

# 工作单元生成能力

开始时宣布："使用 aidlc-unit-generation 生成工作单元"。

## 输入

调用方必须提供：

- 已批准的应用设计产物路径（组件、方法、服务、依赖）；
- 用户故事路径；
- 项目类型和分布式/单体标识；
- 设计意图标记（如有）。

缺少必要输入时返回 `NEEDS_CONTEXT`。

## 加载

加载发布包中的 `stages/inception/inception-units-generation.md`。

## 输出

返回单元列表（`units.md`）、单元详情（`unit-of-work.md`）、依赖矩阵和故事映射路径。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 跨越服务所有权边界合并单元；
- 宣布阶段完成；
- 伪造 design-intent-coverage evidence。
