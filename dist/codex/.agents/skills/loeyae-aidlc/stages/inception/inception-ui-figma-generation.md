---
slug: ui-figma-generation
number: "2.5.3"
name: Figma 生成
phase: inception
axis: module
execution: CONDITIONAL
lead_agent: aidlc-design-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes:
  - docs/aidlc/modules/{module-id}/inception/ui-design/page-plan.md
  - docs/aidlc/modules/{module-id}/inception/ui-design/ui-generation-lock.json
produces:
  - docs/aidlc/modules/{module-id}/inception/ui-design/figma-manifest.json
  - .aidlc/evidence/ui-figma-generation/{module-id}/ui-artifact-consistency.json
  - .aidlc/evidence/ui-figma-generation/{module-id}/ui-behavior-consistency.json
sensors: [ui-artifact-consistency, ui-behavior-consistency]
requires: [ui-figma]
condition: ui_mode_figma
---

## 职责

根据已批准的 `page-plan.md` 创建 Figma 原生设计，或只读登记外部 Figma 文件。本文件不定义模式选择、认证审批、用户审核、state/audit 或 I10 放行。

## 输入

- 页面计划路径；
- `ui-generation-lock.json`（由 `ui-page-planning` 受控校验，禁止生成后覆盖）；
- `source=created` 或 `source=external`；
- 编排层已验证的读写能力结果；
- 目标文件或创建目标；
- 团队设计系统、参考文件、design tokens 或现有文件基准；
- 当前批次。

页面计划必须不存在未决项。生成或登记结果不得改变页面 ID、名称、类型、来源、权限、状态差异或操作闭环。

## 流程创建模式

具体连接与工具由外部创建 Provider 声明，Core 通过 `createUiDesign` 验证签名授权并先持久化认领操作 ID；外部包不接收凭据、不执行远端脚本。当前生产包明确缺少 OAuth 与已核实的有限写入/归属读回协议，联网前返回能力诊断。仅本地 fixture 支持结构化 Frame 和文本创建，不能宣称支持完整设计系统生成或真实账户写入。

操作日志区分 prepared/dispatched/unknown/failed/succeeded。超时、响应丢失或进程中断后只允许 `recoverUiDesign` 只读对账；无法唯一证明本操作归属就要求人工处理，不重试创建，不宣称 exactly-once。只有读回内容、节点归属、截图和当前锁全部核验后，由 Core 原子发布 canonical manifest；视觉与行为仍须独立验收。

1. 创建或复用调用方指定的唯一主 Figma 文件，一个 AI-DLC 项目不得按模块创建多个主文件。
2. 单模块按端创建 Page；多模块按 `{module}-{endpoint}` 创建 Page。
3. 每个页面计划项创建一个可唯一定位的顶层 Frame；PC、平板和移动端使用适合其端的标准宽度。
4. 优先复用团队设计系统；没有设计系统时建立必要的 Color、Spacing、Typography Variables 和可复用 Components。
5. 使用 Auto Layout，避免绝对定位；重复结构达到 3 次时使用 Component/Instance，或返回明确例外。
6. 逐项投影计划中的页面内容契约、权限、状态差异和操作闭环，设计字段、按钮、Variants、弹窗或并列 Frame；不得自行推断计划外字段。
7. 局部改动标注改动范围，不删除或重设计未批准的既有内容。
8. 每批完成后读取截图验证布局、命名、内容和对齐，返回每个 Frame 的 nodeId 与证据。

## 外部提供模式

由已 Git 锁定的外部只读适配包提供读取声明与未受信任 manifest 候选，调用 Core 通用 `consumeExternalUiDesign` 入口；契约与调用说明见 `knowledge/protocols/ui-readonly-adapter.md`。本分支不直接调用服务工具。

输入必须绑定签名选择、已批准 page-plan、当前 generation/resource/provider lock、显式目标文件和 PAGE→Page/Frame 节点，以及可信 currentContext 和精确操作策略。映射来源只能是用户提供的目标或锁定声明，不猜页面名称。Provider 声明和服务读取提示均不授予权限。

Core 验证读取快照、唯一映射、来源、新鲜度与真实资产后受控发布 canonical manifest。缺页、冲突、越界、资源不明或未决项返回 `UNVERIFIED`；不支持的认证/截图形式返回 `NEEDS_CAPABILITY`。失败不发布占位 manifest。未选择本分支、无 UI、skip 或 HTML 时零调用、无占位 Evidence。

metadata/variables 读取与截图资产核验不等于 Components、Auto Layout、产品行为或视觉验收通过。适配器不签发质量 Evidence，不修改 state/approval；继续由既有 artifact、behavior、freshness sensors 和集中视觉审核分别验证。

## 创建分支工具边界

外部包的 `aidlc.ui-create-source/v1` 声明协议和连接；operator 独立核对该契约，不依据服务提示或包声明授予写权限。Core 保留通用授权、签名操作日志、精确单次发送、读回恢复与受管发布；不开放任意代码执行。已有稿、HTML、skip 和未选择创建模式时零写入。

以下仅展示 manifest 字段，不能手工生成通过状态；实际 canonical `docs/aidlc/modules/{module-id}/inception/ui-design/figma-manifest.json` 必须由 Core 带受管 create_registration 发布，技术读回不签发视觉或行为通过：

```json
{
  "schema_version": "1",
  "design_mode": "figma",
  "source": "created",
  "file_url": "https://www.figma.com/design/...",
  "page_plan": "docs/aidlc/modules/{module-id}/inception/ui-design/page-plan.md",
  "pages": [{
    "page_id": "PAGE-001",
    "page": "module-web",
    "frame": "Rule List",
    "node_id": "1:234",
    "screenshot": "figma://screenshot/1:234",
    "requirements": ["REQ-UI-001"],
    "stories": ["US-001"]
  }],
  "validation": {
    "creation": "reconciled",
    "components": "unverified",
    "auto_layout": "unverified",
    "screenshots": "verified-assets",
    "external_read_only": false
  },
  "unresolved": []
}
```

上例只展示创建分支的输出形状，不作为已有稿的验证值模板。`figma-existing` 的 canonical 内容必须由通用 Core 入口发布，含 `read_registration` 与受控 PNG 路径/摘要，标记 `source=external`、`external_read_only=true`。Variables 是 `observed`，截图是 `verified-assets`，行为/Components/Auto Layout/视觉审核保持 `unverified`，不能抄上例的 passed。每个页面计划项恰有一个 Page/Frame/nodeId 和截图资产；页面集合及来源 ID 与计划完全一致。report 前分别运行现有 artifact 与 behavior 校验；handoff.md 不能替代 manifest 或 Evidence。

## 输出

返回并持久化：

- 唯一主文件 URL；
- 页面 ID、Page、Frame 和 nodeId 映射；
- Variables/Components 使用结果；
- 每个页面或批次的截图证据；
- 资产结果；
- 未映射、冲突或未验证项。

## 自检

- 每个页面计划项恰有一个 Frame/nodeId；
- 页面名称、类型、权限、状态差异和操作闭环与计划一致；
- 流程创建模式使用 Variables、Auto Layout 和适用 Components；
- 外部提供模式零写入；
- 截图证据可复现，不使用“看起来一致”或百分比估算代替。

**每批轻量技术读回**（`knowledge/design/common-ui-generation-flow.md` 阶段 4，全量连续生成中每批自动执行，不启动独立 reviewer、不等待用户）：节点真实生成、顶层 Frame 唯一、`nodeId` 稳定、未误改只读来源或旧版本、无 API 回滚残留、无碰撞/越界/缺字/截断、Variables/Components/Auto Layout 真实引用、截图与登记生成。写入失败按阶段 4 恢复顺序，连续两次失败切换实现，不无限重试。
