---
name: aidlc-ui-implementation-bridge
description: "将 HTML Mock 或 Figma 设计翻译为目标平台代码的前端平台规范和组件映射；不负责 Construction 路由和代码审查。"
triggers: Figma 转代码, Mock 转代码, 前端平台规范, 组件映射, 设计还原, UI 实现规范
---

# UI 实现桥接能力

开始时宣布："使用 aidlc-ui-implementation-bridge 执行 UI 实现桥接"。

## 输入

调用方必须提供：

- UI 设计产物路径（HTML Mock 或 Figma 设计稿）；
- 目标平台及框架（Taro/RN/Flutter/UniApp 等）；
- 项目级 `frontend-platform-spec.md` 路径（存在时）；
- 当前工作单元范围。

缺少任一输入时返回 `NEEDS_CONTEXT`。纯 Web 项目（Vue3+ElementPlus 等纯浏览器方案）不需要本能力。

## 加载

加载发布包中的 `stages/construction/construction-ui-implementation-bridge.md`。

## 输出

返回生成或更新的 `docs/aidlc/frontend-platform-spec.md` 路径、布局原语映射表、组件映射表、CSS 约束禁止列表和未解决问题。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 执行代码审查或代码生成；
- 宣布 Construction 阶段完成；
- 伪造 frontend-platform-spec evidence。
