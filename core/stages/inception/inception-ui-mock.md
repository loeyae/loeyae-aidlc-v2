---
slug: ui-mock
number: "2.5"
name: UI Mock 设计
phase: inception
execution: CONDITIONAL
lead_agent: aidlc-design-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces: [docs/aidlc/inception/ui-mock/]
sensors: []
requires: [user-stories]
approval: confirm
---
# UI 设计模式路由（I9）

## 目的

在需求、故事和 I8 审查完成后，由用户选择 HTML Mock、创建 Figma、使用已有 Figma 或跳过，并协调页面计划确认、能力调用、用户审核和状态更新。

本文件只负责 I9 编排。页面语义规划由 `inception-ui-page-planning.md` 定义；HTML 生成由 `aidlc-ui-mock-design` 加载 `inception-ui-mock-generation.md` 执行；Figma 路径由 `inception-ui-figma.md` 编排并调用 `aidlc-figma-design`；I10 放行只由 `inception-cross-validation.md` 决定。

## 前置条件

- 需求文档已完成；
- 用户故事已完成；
- I8 已通过；
- 工作区检测已识别涉及端和现有代码位置。

## 模式选择

向 Boss 提供以下选项，并等待明确选择：

- **创建 Figma 设计**：适合团队协作、高保真交付和 Dev Mode；
- **使用已有 Figma 设计稿**：验证外部文件并登记为正式设计基准；
- **HTML Mock 模式**：生成可离线浏览的结构化 HTML 原型；
- **跳过 UI 设计**：仅适用于无界面需求或用户明确不需要设计基准。

路由：

| 选择 | 路由 |
|------|------|
| 创建 Figma | 加载 `inception-ui-figma.md`，来源为 `流程创建` |
| 已有 Figma | 加载 `inception-ui-figma.md`，来源为 `外部提供` |
| HTML Mock | 执行本文件的 HTML Mock 编排 |
| 跳过 | 记录原因并进入 I11 |

## 跳过处理

用户明确跳过时，在 state.md 的 `UI 设计（I9 条件）` 中记录：

- `UI 设计方式：跳过`；
- `Figma 来源：不适用`；
- `页面计划：不适用`；
- `页面计划状态：不适用`；
- `设计状态：skipped`；
- 下一操作和跳过原因。

已有外部 Figma 文件不属于跳过。

## HTML Mock 编排

### 1. 建立页面计划

加载 `inception-ui-page-planning.md`，生成跨模式唯一页面计划。将路径和 `draft` 状态写入 state.md，提交用户确认；确认后把 `页面计划状态` 更新为 `approved`。未确认前不得调用生成 Skill。

### 2. 确定视觉来源

- 存量项目读取实际 UI 框架和现有页面风格，不另选品牌风格；
- 新项目由用户选择默认样式或可选设计风格；
- 选择设计风格时可通过 `awesome-design` 获取 tokens；不可用时使用默认样式，不改变页面语义。

### 3. 生成并审核骨架

调用 `aidlc-ui-mock-design`，传入已批准页面计划和 `stage=skeleton`。具体生成规则由 `inception-ui-mock-generation.md` 及其引用文件定义。

生成后按 `inception-ui-mock-workflow.md` 提交用户审核页面数量、改造基础和操作闭环。发现页面语义错误时回到页面计划就地修正并重新确认。

### 4. 填充并审核内容

骨架确认后再次调用 `aidlc-ui-mock-design`，传入 `stage=content`。提交用户审核字段、状态、权限和交互；反馈只修改受影响页面，涉及产品语义时按 `common-workflow-changes.md` 协调。

### 5. I9 状态交接

HTML Mock 用户审核完成后，在 state.md 中记录：

- `UI 设计方式：html-mock`；
- `Figma 来源：不适用`；
- 页面计划路径和 `approved`；
- `产物位置`；
- `设计状态：review_pending`；
- 涉及端、页面数、设计风格和风格来源；
- `下一操作：执行 I10 UI 设计交叉验证`。

执行 `common-step-completion-protocol.md`，然后进入 I10。不得在 I10 前写入 `approved`。

## I10 边界

I10 加载 `inception-cross-validation.md`（e），对需求、故事、页面计划和选定模式产物进行交叉验证。只有未决冲突为零且检查通过后，编排层才能把 `设计状态` 更新为 `approved`。
