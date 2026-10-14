## Phase 6 验收：回归、迁移与发布度量

Phase 6 提供只读的 `ExecutionProfileReleaseMeasurements`，并新增
`orchestrate state measurements [--module <id>]` 观察面。它量化当前 profile 的选择结果、相对历史
selector 的省略集合、mandatory rule 保留情况，以及 WorkflowState 是否拥有持久化 profile。

迁移度量明确输出 `legacy_read_without_migration` 与 `state_write_performed: false`：缺少
`execution_profile` 的旧状态按 conservative standard 解释，但不回写、不升级，也不改变 state。
standard 与 complex 必须与历史 selector 一致；lightweight 的省略项由实际 selector 导出，而非硬编码的
发布豁免。所有结果均标记为 `advisory: true` / `release_authority: not_a_gate`，不能替代 report、sensor、
evidence、approval 或 release gate。

## 与 Phase 5 的衔接

Phase 5 提供 instance-bound evidence reuse/verify/revalidate 建议；Phase 6 不消费它来授权任何结果，
而是在相同 profile-aware selector 基础上观测 selector parity、兼容迁移和必须规则保留。故 Phase 5 的
证据 provenance、强制 revalidate 和 gate 权威保持不变。

## 验收

- `npm run typecheck`
- `npm run test:mars161-phase5`
- `npm run test:mars161-phase6`

Phase 6 测试覆盖 legacy 无写回、standard/complex 历史选择器回归、lightweight 安全省略、mandatory
规则保留、CLI 只读性及不可作为 release/gate 授权。
