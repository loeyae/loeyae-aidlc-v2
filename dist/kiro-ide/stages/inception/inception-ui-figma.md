---
slug: ui-figma
number: "2.5.1"
name: Figma UI 设计
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

## 目的

在 I9 已选择 Figma 后，确认来源和运行时能力，协调页面计划、设计资源、能力调用、分批用户审核和状态恢复。Figma 画布生成与外部文件登记由 `aidlc-figma-design` 加载 `inception-ui-figma-generation.md` 执行。

## 前置条件

使用本文件前，`inception-ui-mock.md` 已完成模式选择，来源必须是：

- `流程创建`：创建并写入唯一主 Figma 文件；
- `外部提供`：只读验证和登记用户提供的文件。

## 1. 初始化状态

立即在 handoff.md 记录：

- `UI 设计方式：figma`；
- `Figma 来源`；
- `设计状态：selected`；
- 当前批次和下一操作；
- 外部提供的文件 URL 或流程创建的“待创建”。

## 2. 身份与能力门禁

调用 `whoami` 确认认证和 seat。配置存在或认证成功均不能替代运行时能力验证：

- `流程创建`：`create_new_file` 创建的验证目标必须直接作为唯一主文件，立即把 URL 写入 handoff.md；在该文件内用 `use_figma` 完成最小写入验证，后续设计必须复用同一文件，不得另建正式文件；
- `外部提供`：必须用 `get_metadata` 验证目标文件可读取，且后续不得调用写入工具。

客户端、seat、权限或工具不满足时标记 blocked，向用户提供“修复 Figma 能力后重试”与“切换 HTML Mock”选项。未经用户选择不得自动切换模式。

## 3. 建立页面计划

加载 `inception-ui-page-planning.md` 生成跨模式唯一页面计划，将路径和 `draft` 状态写入 handoff.md，并提交用户确认。确认后把 `页面计划状态` 更新为 `approved`；未确认前不得调用 Figma 设计 Skill。

外部提供模式还必须将计划项与现有 Page/Frame 对照。缺失页面、无法定位或语义冲突时阻断并请用户或设计方修正，不得静默写入外部文件。

## 4. 确定设计资源

`流程创建`由用户选择：

- 使用团队设计系统；
- 从零创建 Variables/Components；
- 提供参考 Figma 文件。

`外部提供`以目标文件为正式设计基准，不重新选择视觉来源或写入设计资源。

## 5. 调用 Figma 设计能力

调用 `aidlc-figma-design`，传入：

- 已批准页面计划；
- 规范化来源：handoff.md `流程创建` 映射为 `source=created`，`外部提供` 映射为 `source=external`；
- 已验证的读写能力结果；
- 已登记的唯一主文件 URL；
- 设计资源和当前批次。

具体 Page/Frame 组织、Variables/Components、画布写入、截图验证和只读登记规则由 `inception-ui-figma-generation.md` 定义。

## 6. 分批用户审核

`流程创建`每完成 3–5 个核心页面提交一批审核；提交前把 `设计状态` 更新为 `review_pending`。用户选择继续时恢复 `designing` 并处理下一批；要求调整时只修改受影响页面。

`外部提供`提交已登记页面和截图证据。用户要求调整时由用户或设计方更新源文件，随后重新读取验证；流程不得写入。

涉及页面语义变化时回到页面计划并按 `common-workflow-changes.md` 处理，旧设计证据失效。

## 7. I9 状态交接

全部计划页面完成并经用户审核后，核对 handoff.md：

- 唯一主文件 URL；
- 页面计划路径和 `approved`；
- `Figma 页面进度` 中每个页面的唯一 nodeId、完成状态和截图证据；
- `设计状态：review_pending`；
- `下一操作：执行 I10 UI 设计交叉验证`。

执行 `common-step-completion-protocol.md`，然后进入 I10。不得在 I10 前写入 `approved`。

## I10 与 Construction 边界

I10 只由 `inception-cross-validation.md`（e）执行并决定 `approved/blocked`。Construction 从 Figma 读取并还原代码时加载 `common-figma-design-standards.md`，不得反向修改已批准设计语义。
