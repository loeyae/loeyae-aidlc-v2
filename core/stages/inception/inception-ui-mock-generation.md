---
slug: ui-mock-generation
number: "2.5.4"
name: Mock 生成
phase: inception
execution: CONDITIONAL
lead_agent: aidlc-design-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces: []
sensors: []
completion_contract: instruction_only
requires: [ui-mock]
condition: has_ui_requirements
---

## 职责

根据已批准的 `page-plan.md` 生成 HTML Mock 骨架或完整内容。本文件不定义模式选择、用户审批、state/audit 或 I10 放行。

## 输入

- 页面计划路径；
- `stage=skeleton` 或 `stage=content`；
- 存量页面代码和组件证据；
- 默认样式、现有项目样式或已选择的 design tokens。

页面计划必须不存在未决项。生成内容不得改变页面 ID、名称、类型、来源、权限、状态差异或操作闭环。

## 加载规则

- 两阶段文件组织和 page-specs 投影：`inception-ui-mock-workflow.md`；
- HTML 内容和交互规范：`inception-ui-mock-design-spec.md`；
- 内容推导与自检：`inception-ui-mock-reasoning-principles.md`；
- CSS 模板：`inception-ui-mock-styles.md`。

## 骨架阶段

1. 从页面计划按端生成 `{端}-page-specs.md`，保留页面 ID、名称、类型、来源和改造基础，并附操作闭环。
2. 标准模式每端不超过 10 个页面时生成一个 HTML；超过 10 个时按功能域拆分并生成 `index.html`。
3. 局部改动先读取并还原现有页面相关结构；新增页面只生成标题、入口、操作及目标占位。
4. 每个 mock-box 与页面计划一一对应，不填充未批准字段或功能。

## 内容阶段

1. 仅在已存在且对账通过的骨架上填充。
2. 逐项投影页面计划的“页面内容契约”、权限、状态差异和操作闭环；示例数据只能用于展示已批准字段，不得补充计划外字段。
3. 局部改动保留现有结构，只标记本次增量。
4. 多状态页面使用条件表，不复制结构相同的完整页面。
5. 页面只展示用户可见内容；开发规则放入自包含的业务说明。

## 视觉来源

- 存量项目使用现有 UI 框架和实际页面风格；
- 新项目可使用默认样式或调用方提供的 design tokens；
- `awesome-design` 仅提供 tokens，字段缺失时使用默认值，不得影响页面语义。

## 输出

单模块输出到 `docs/aidlc/inception/ui-mock/`；多模块输出到对应模块的 `inception/ui-mock/`。输出包括 page-specs、骨架或完整 HTML，以及大型模式导航页。

## 自检

- page-plan、page-specs 与 mock-box 的 ID、名称、类型和来源一致；
- 所有操作入口都有计划内目标或反馈；
- 权限和状态差异完整表达；
- 局部改动未删减或重新设计未批准内容；
- 无需求外功能、TODO、FIXME 或空实现。
