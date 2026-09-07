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
- 仅当当前模块签名 I9 choice 选择 HTML Mock/Figma 时读取 page-plan 和对应 canonical manifest；
- `skip`、condition false 或未选择的分支不读取、不要求产物或 Evidence；
- 单模块和多模块都只能使用当前 `{module-id}` 的 Inception 产物，禁止跨模块借用。

交叉验证报告必须包含机器摘要、全部受审 ID 和零未决冲突。受控 Producer 输出的 Evidence 记录实际选择、受审数量与 canonical 产物列表。
