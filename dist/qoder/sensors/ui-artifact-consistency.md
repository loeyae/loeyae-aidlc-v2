---
id: ui-artifact-consistency
stage: ui-page-planning | ui-mock-generation | ui-figma-generation
type: semantic
evidence_path: .aidlc/evidence/<stage>/{module-id}/ui-artifact-consistency.json
---
# ui-artifact-consistency

仅当签名 I9 choice 选择 `html-mock`、`figma-create` 或 `figma-existing` 时适用。按当前模块隔离验证：

- `ui-page-planning`：需求、用户故事与 `page-plan.md` 的页面和来源引用一致；
- `ui-mock-generation`：page-plan、page-specs、HTML/mock-box 及 `ui-mock-manifest.json` 页面集合一致，skeleton/content 两段均为 `validated`；
- `ui-figma-generation`：page-plan 与 `figma-manifest.json` 的 Page/Frame/nodeId/截图和来源模式一致；外部稿必须只读。

未选择 UI 或选择 `skip` 时相关 Stage 不实例化，不生成或要求本 Evidence。checker 必须由受控 Producer 运行，不接受 handoff.md 作为机器选择或 canonical 设计清单。
