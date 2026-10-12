---
slug: ui-mock
number: "2.5"
name: UI Mock 设计
phase: inception
axis: module
execution: CONDITIONAL
lead_agent: aidlc-design-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces: []
sensors: []
completion_contract: instruction_only
choices: [html-mock, figma-create, figma-existing, skip]
requires: [user-stories]
condition: has_ui_requirements
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

向引擎报告本 Stage 时必须把选择写入 Markdown history，取值固定为：

| 用户选择 | `--user-input` |
|----------|----------------|
| HTML Mock | `html-mock` |
| 创建 Figma | `figma-create` |
| 使用已有 Figma | `figma-existing` |
| 跳过 UI 设计 | `skip` |

示例：`orchestrate report --stage ui-mock --result completed --instruction-ack ui-mock --user-input <html-mock|figma-create|figma-existing|skip>`，取值必须来自用户回答，不得自行选择。不得只修改 handoff.md 或用聊天文本改变后续分支。

路由：

| 选择 | 路由 |
|------|------|
| 创建 Figma | 加载 `inception-ui-figma.md`，来源为 `流程创建` |
| 已有 Figma | 加载 `inception-ui-figma.md`，来源为 `外部提供` |
| HTML Mock | 执行本文件的 HTML Mock 编排 |
| 跳过 | 记录原因并进入 I11 |

## 跳过处理

用户明确跳过时，在 handoff.md 的 `UI 设计（I9 条件）` 中记录：

- `UI 设计方式：跳过`；
- `Figma 来源：不适用`；
- `页面计划：不适用`；
- `页面计划状态：不适用`；
- `设计状态：skipped`；
- 下一操作和跳过原因。

已有外部 Figma 文件不属于跳过。

## HTML Mock 编排

本编排遵循 `knowledge/design/common-ui-generation-flow.md`（流程单一真相源）的七阶段：版本锁定 → 代表页定标 → 全量连续生成 → 每批轻量技术读回 → 需求新鲜度检查 → 一次集中验收 → 定向修正。不设逐页人工确认门禁，不设每批独立审查循环；代表页定标是唯一页面级人工确认点（满足自动化条件时可自动定标）。

### 1. 建立页面计划与版本锁定

加载 `inception-ui-page-planning.md`，生成跨模式唯一页面计划。将路径和 `draft` 状态写入 handoff.md，提交用户确认页面计划（这是对**页面范围**的一次确认，不是对每张 Mock 的确认）；确认后把 `页面计划状态` 更新为 `approved`。未确认前不得调用生成 Skill。

按 `common-ui-generation-flow.md` 阶段 1，执行 `loeyae-aidlc ui lock --module {module-id} --route html-mock`，由工具记录 PRD/故事/page-plan 的真实 SHA-256、Git blob、ID digest、HEAD 与 upstream commit。`ui-page-planning` 未通过该锁的受控校验前不得生成。

### 2. 确定视觉来源与代表页定标

- 存量项目读取实际 UI 框架和现有页面风格，不另选品牌风格；
- 新项目由用户选择默认样式或可选设计风格；
- 选择设计风格时可通过 `awesome-design` 获取 tokens；不可用时使用默认样式，不改变页面语义。

按 `common-ui-generation-flow.md` 阶段 2 选择信息量最丰富的代表页，调用 `aidlc-ui-mock-design`（`stage=skeleton`+`stage=content` 仅针对代表页）完成其视觉、密度、状态条件表和交互清单，执行**一次定标确认**。已批准参考设计或已有稳定样式来源时自动定标，并在 canonical manifest 或交叉验证报告记录所用来源。定标后后续页面不得逐页暂停确认。

### 3. 全量连续生成

调用 `aidlc-ui-mock-design`，传入已批准页面计划，按页面依赖顺序**连续生成全部页面**（`stage=skeleton` 后 `stage=content`）。具体生成规则由 `inception-ui-mock-generation.md` 及其附录定义。

不设逐页人工确认门禁，不设每批“独立审查→修正→复验”repeat loop；批次只用于控制写入规模和错误恢复。不影响其他页面的需求缺口在“开发说明·不渲染”标记后继续生成其余页面，禁止臆造。仅 `common-ui-generation-flow.md` 阶段 3 列出的高风险情形允许暂停。

### 4. 每批轻量技术读回

按 `common-ui-generation-flow.md` 阶段 4，每批写入后由当前写者自动执行技术读回（节点真实生成、编号/mock-box 唯一、未误改只读来源、无碰撞/截断、Variables/Components 真实引用、临时产物生成），不启动独立 reviewer，不等待用户确认。发现页面语义错误时回到页面计划就地修正并同步 canonical manifest。

### 5. I9 状态交接

全量连续生成与每批技术读回完成后，在 handoff.md 中记录：

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
