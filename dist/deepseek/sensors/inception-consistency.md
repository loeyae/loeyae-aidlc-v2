---
id: inception-consistency
stage: cross-validation
type: semantic
evidence_path: .aidlc/evidence/cross-validation/{module-id}/inception-consistency.json
---
# inception-consistency

对当前模块执行最终 Inception 一致性复核：

- 始终验证需求 ID、用户故事覆盖及交叉验证报告；
- 仅当签名 `selected_optional_stages` 包含 `prd-generation` 时读取 PRD，并验证模块映射；
- 仅当当前模块签名 I9 choice 选择 HTML Mock/Figma 时读取 page-plan、canonical manifest、`ui-generation-lock.json` 和 `ui-generation-acceptance.json`；
- 对 UI 路由重新解析本地 `origin/main`（或锁中显式 upstream ref）、当前 worktree 文件、机器 ID 分段摘要与 STORY/AC→页面影响矩阵；upstream 在验收登记后再推进也会使 Evidence 失效；
- UI 全量验收必须在 `cross-validation-report.md` 中恰好出现一个 `UI full acceptance` 机器段，验收 schema 只允许一个 `full_acceptance` 对象；发现问题后只能用定向复验段覆盖问题页；
- 任一正文变化无法归类、任一变化 ID 无页面映射、同步页面超出/遗漏影响矩阵、第二次全量验收或验收后 revision 漂移都 fail-closed；
- `skip`、condition false 或未选择的分支不读取、不要求产物或 Evidence；
- 单模块和多模块都只能使用当前 `{module-id}` 的 Inception 产物，禁止跨模块借用。

交叉验证报告必须包含机器摘要、全部受审 ID 和零未决冲突。受控 Producer 输出的 Evidence 记录实际选择、受审数量、`ui_freshness_verified=true`、锁/验收 SHA-256、baseline/current upstream commit、变化路径、受影响页面、`ui_impact_unmapped=0`、`ui_full_acceptance_runs=1` 与 canonical 产物列表。未选择 UI 时这些 UI 门禁明确为不适用，不要求治理文件。
