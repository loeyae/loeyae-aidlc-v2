---
slug: ui-figma
number: "2.5.2"
name: Figma UI 设计
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
requires: [ui-page-planning]
condition: ui_mode_figma
---

## 目的

在 I9 已选择 Figma 后，确认来源和运行时能力，协调页面计划、设计资源、代表页定标、全量连续生成、自动技术读回和最终集中验收。Figma 画布生成与外部文件登记由 `aidlc-figma-design` 加载 `inception-ui-figma-generation.md` 执行。

## 前置条件

使用本文件前，`inception-ui-mock.md` 已完成模式选择，来源必须是：

- `流程创建`：创建并写入唯一主 Figma 文件；
- `外部提供`：只读验证和登记用户提供的文件。

## 1. 初始化状态

签名 I9 choice 写入 history 后，立即在 handoff.md 派生展示：

- `UI 设计方式：figma`；
- `Figma 来源`；
- `设计状态：selected`；
- 当前批次和下一操作；
- 外部提供的文件 URL 或流程创建的“待创建”。

## 2. 身份与能力门禁

调用 `whoami` 确认认证和 seat。配置存在或认证成功均不能替代运行时能力验证：

- `流程创建`：`create_new_file` 创建的验证目标必须直接作为唯一主文件；在该文件内用 `use_figma` 完成最小写入验证，后续设计必须复用同一文件，不得另建正式文件。工具返回的 URL 必须进入本次 `figma-manifest.json`，handoff.md 只能镜像展示；
- `外部提供`：必须用 `get_metadata` 验证目标文件可读取，且后续不得调用写入工具；URL 必须以 `source=external`、`external_read_only=true` 写入 manifest。

客户端、seat、权限或工具不满足时标记 blocked，向用户提供“修复 Figma 能力后重试”与“切换 HTML Mock”选项。未经用户选择不得自动切换模式。

## 3. 建立页面计划

加载 `inception-ui-page-planning.md` 生成跨模式唯一 `page-plan.md`，通过该 Stage 的 `ui-artifact-consistency` 后再提交用户确认。handoff.md 可派生展示路径和审核进度，但不得替代页面计划或 Evidence；未确认前不得调用 Figma 设计 Skill。

外部提供模式还必须将计划项与现有 Page/Frame 对照。缺失页面、无法定位或语义冲突时阻断并请用户或设计方修正，不得静默写入外部文件。

## 4. 确定设计资源与代表页定标

`流程创建`由用户选择：

- 使用团队设计系统；
- 从零创建 Variables/Components；
- 提供参考 Figma 文件。

`外部提供`以目标文件为正式设计基准，不重新选择视觉来源或写入设计资源。

按 `knowledge/design/common-ui-generation-flow.md` 阶段 1、2：先执行 `loeyae-aidlc ui lock --module {module-id} --route <figma-create|figma-existing>`，受控记录 PRD/故事/page-plan 的真实 SHA-256、Git blob、ID digest、HEAD 与 upstream commit；再选代表页完成一次定标（已批准参考或稳定设计系统时自动定标，并在 canonical manifest/报告记录参考节点）。定标后后续页面不得逐页暂停确认。

## 5. 调用 Figma 设计能力

调用 `aidlc-figma-design`，传入：

- 已批准页面计划；
- 规范化来源：签名 choice `figma-create` 映射为 `source=created`，`figma-existing` 映射为 `source=external`；
- 已验证的读写能力结果；
- 已登记的唯一主文件 URL；
- 设计资源和当前批次。

具体 Page/Frame 组织、Variables/Components、画布写入、截图验证和只读登记规则由 `inception-ui-figma-generation.md` 定义。

## 6. 全量连续生成与每批轻量技术读回

按 `knowledge/design/common-ui-generation-flow.md` 阶段 3、4执行。

`流程创建`按页面依赖顺序**连续生成全部页面**：

- 不设逐页人工确认门禁，不设每批“独立审查→修正→复验”repeat loop；
- 可按批次写入，但批次**只用于控制写入规模和错误恢复**，一个 Figma 文件同时只有一个写者；
- 每批写入后由当前写者**自动执行技术读回**（节点真实生成、顶层 Frame 唯一、`nodeId` 稳定、未误改只读来源或旧版本、无 API 回滚残留、无碰撞/越界/缺字/截断、Variables/Components/Auto Layout 真实引用、截图与登记生成），**不启动独立 reviewer，不等待用户确认**；
- Figma 写入失败时按阶段 4 的恢复顺序（改参数→拆更小批次→先 Auto Layout 父级再 FILL→自动重试→连续两次失败切换实现），不无限重试；
- 每次汇报或状态更新后生成继续运行，不因进度回复停顿。每批进度和读回结果写入 canonical manifest 或报告。

`外部提供`连续读取并登记已有 Page/Frame，生成截图证据，不写入源文件。涉及页面语义变化时回到页面计划并按 `common-workflow-changes.md` 处理，旧设计证据失效。

## 7. I9 状态交接

全部计划页面完成全量连续生成与每批技术读回后，先核对当前模块 canonical `figma-manifest.json`：

- `file_url` 与签名 source 一致；
- manifest 的 `page_plan` 指向已验证页面计划；
- 每个 PAGE 都有唯一 Page/Frame/nodeId 和截图引用；
- Variables、Components、Auto Layout、screenshots 以及外部只读状态均通过；
- `unresolved` 为空。

随后运行受控 `ui-artifact-consistency` Producer。只有 manifest 与 Evidence 均通过后，才能把上述状态派生展示到 handoff.md，并将下一操作写为“执行 I10 UI 设计交叉验证”。

执行 `common-step-completion-protocol.md`，然后进入 I10。不得在 I10 前写入 `approved`。

## I10 与 Construction 边界

I10 只由 `inception-cross-validation.md`（e）执行并决定 `approved/blocked`。Construction 从 Figma 读取并还原代码时加载 `common-figma-design-standards.md`，不得反向修改已批准设计语义。
