---
id: ui-artifact-consistency
stage: ui-page-planning | ui-mock-generation | ui-figma-generation
type: semantic
evidence_path: .aidlc/evidence/<stage>/{module-id}/ui-artifact-consistency.json
---
# ui-artifact-consistency

仅当签名 I9 choice 选择 `html-mock`、`figma-create` 或 `figma-existing` 时适用。按当前模块隔离验证：

- `ui-page-planning`：需求、用户故事与 `page-plan.md` 的页面和来源引用一致；
- `ui-mock-generation`：page-plan、page-specs、HTML/mock-box 及 `ui-mock-manifest.json` 页面集合一致，skeleton/content 两段均为 `validated`；并校验 **US→UI 正向全覆盖**（见下）；
- `ui-figma-generation`：page-plan 与 `figma-manifest.json` 的 Page/Frame/nodeId/截图和来源模式一致；外部稿必须只读；并校验 **US→UI 正向全覆盖**（见下）。

## US→UI 正向全覆盖（MARS-118）

本 sensor 原有的 mock→US 校验是**反向存在性**（manifest 每个 page 的 `stories[]` / `requirements[]` 必须在 `user-stories.md` / `requirements.md` 真实存在，不悬空）。在 `ui-mock-generation` / `ui-figma-generation` 两个生成阶段，额外增量校验 **US→UI 正向全覆盖**：

- 聚合 `ui-mock-manifest.json` / `figma-manifest.json` 全部 page 的 `stories[]` 并集，得到「被 UI 覆盖的 US 集合」；
- 从 `user-stories.md` 解析全部 US（复用本 sensor 既有的 US id 口径 `US-...`），减去「显式豁免的 US」，得到「要求有界面表现的 US 集合」；
- 若存在要求有界面却未被任何 page 覆盖的 US，fail 并列出悬空 id（`US-xxx: UNCOVERED@ui-mock`）。

**显式豁免口径（默认不豁免）**：无标记的 US 一律要求被 UI 覆盖。只有在 `user-stories.md` 中声明该 US 的那一行用显式标记声明无界面表现时才豁免：行内 `[ui: n/a]`、`[ui: 无界面]` 或 `[无界面]`（大小写与全/半角冒号不敏感）。豁免是行内局部的——标记只豁免同一行上出现的 US id。证据输出 `stories_required` / `stories_covered` / `stories_exempt` / `uncovered_stories`。

该正向校验**仅在模块实际选了 UI route（html-mock / figma）时触发**：未选择 UI 或选择 `skip` 的模块本 sensor 不实例化，不新增负担。

未选择 UI 或选择 `skip` 时相关 Stage 不实例化，不生成或要求本 Evidence。checker 必须由受控 Producer 运行，不接受 handoff.md 作为机器选择或 canonical 设计清单。
