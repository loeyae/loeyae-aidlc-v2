## Phase 5 验收：evidence reuse 与验证调度

Phase 5 已实现为只读、建议性的 `EvidenceReusePlan`。`run-stage` directive 提供
`evidence_reuse_plan`，`orchestrate state evidence [--module <id>]` 提供同一观察面；二者均不写
workflow state 或 evidence，也不参与 `report`、sensor 或 approval gate 的通过判定。

对当前交接的 stage instance，计划仅检查该 instance 的规范 evidence 路径。可复用候选必须同时
匹配受控 producer、严格有效的 ISO 日历时间、stage instance/module/unit 身份、source revision
（含 scope 与摘要）和 checker provenance。路径或祖先为 symlink、缺失或任何 provenance 不一致时
均 fail closed 至 `revalidate`。`approval: block` 和 gated evidence 保持 `verify`，TDD/baseline/
build 等强制刷新项保持 `revalidate`；没有任何分支能把证据计划当作 gate pass。

## 与 Phase 4 的衔接

Phase 5 以 Phase 4 的 `RuleLoadPlan.selected` 作为唯一规则选择来源，因此 lightweight slice 只会
为 Phase 4 已选的安全集合生成建议。风险升级恢复 `state-template` 后，它会重新出现在 RuleLoadPlan
和 EvidenceReusePlan 的选中集合中；不会因 profile 或缓存证据绕过既有依赖、审批或 evidence 要求。

## 验收

- `npm run typecheck` 通过。
- `npm run test:mars161-phase4` 通过。
- `tests/test_mars161_execution_profile_phase5.ts` 通过；覆盖 canonical instance 路径、严格日期、
  revision/checker/symlink 防御、错误或缺失 instance/module/unit 元数据，以及 mandatory gate。
- 独立安全复核确认计划不进入 report/gate 授权路径。
