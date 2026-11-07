---
id: traceability-matrix
name: Traceability Matrix (full-coverage)
description: End-to-end classified traceability matrix — every REQ must reach every downstream layer its track declares, verified stage by stage.
type: semantic
evidence_path: .aidlc/evidence/<stage-slug>/traceability-matrix.json
---
# traceability-matrix

## 目的
全覆盖对账的治本门禁。以每个 `REQ-xxx` 为行,按其 `track` 标签(backend/frontend/data/infra/nfr/doc-only)**条件化**校验它是否到达每个下游层。阶段感知:只强制"截至当前阶段应完成的层",未到的层不算断点。

任一需求在中途层丢失(如活到故事层却在设计层断)→ `coverage_status = BROKEN@design` → 门禁在该阶段当场阻断,drift 无法进入下一步。这是"每一步都不许有差距、避免最终代码与需求大相径庭"的机器保证。

## 层与阶段映射(track 条件化)
| 层 | 阶段 | 适用 track |
|----|------|-----------|
| stories / acceptance | user-stories | backend, frontend |
| design_components | application-design | backend, data |
| pages | application-design | frontend |
| test_cases | functional-design | backend, frontend, data |
| code_refs (@ReqId) | code-generation | 全部 |
| tests (@TestCaseId) | RED/GREEN | backend, frontend, data |

## 为什么不误报
覆盖只要求 REQ 到达**它自己 track 声明的层** —— UI-only 不查后端代码,backend-only 不查页面。这消除了"正向全覆盖"在混合前后端场景的误报,同时把覆盖率拉满到 100%。

## 门禁语义
由确定性 producer `traceabilityMatrix()` 生成 evidence(provenance 受控,Agent 不可伪造);sensor 校验 `broken_rows` 为空。经 Phase A 的 `next` 前置门禁 + Stop hook 强制。

## 按单元收敛(4.8.0)
module 的 I13 有 `ucd_units`(UC-D 声明了 `unit_refs`)且处于 unit 上下文时,tests 层只检查本单元的 UC-D 用例文件引用的 REQ,UC-D 派生诊断也只看本单元子集;证据额外输出 `unit_scope: { unit_id, ucd_ids, tests_layer_reqs }`。模块全集由 build-and-test 的 `test-quality` 对账保证。没有 `ucd_units` 时行为不变。

## code_refs 层按单元收敛(4.11.0)
- 扫描范围:code_refs 层只读本模块的源码根(module-manifest `paths` → `.aidlc/source-roots.json`(含嵌套仓库)),其他模块目录里的 `REQ` 标记不算覆盖;两者都没有声明时没有归属信息,保持全项目扫描。
- unit 上下文的检查范围:unit-manifest 中该 unit 的 `req_refs: ["REQ-001", ...]`(非空、不重复、必须是 requirements.md 中存在的 REQ,否则 `UNKNOWN_REQ_REF@unit-manifest`)→ 本单元 UC-D 子集用例文件引用的 REQ → 模块全集。
- 声明了 `ucd_exemption` 且 I13 `ucd_units` 中没有该 unit 时,code_refs 层与 tests 层为 `not_applicable`,证据输出 `unit_scope.code_refs_layer = "not_applicable(ucd_exemption)"` 与 `exemption.reason_code`;其他层不变。
- `unit_scope` 增加 `code_refs_layer_reqs`(排序)与 `code_refs_source`(`req_refs` / `ucd_subset` / `module` / `ucd_exemption`)。
- build-and-test(无 unit 上下文)继续按模块全集对账:每条 REQ 至少被本模块某处代码引用,否则 `BROKEN@code_refs`。不声明 `req_refs`、没有 `ucd_units` 时证据结构不变。

## 遗留兼容
requirements.md 无 REQ-xxx 或需求缺 `track` 标签(未迁移旧项目)→ `migration_status: MIGRATION_REQUIRED`,降级放行 + 输出 `missing_track` 缺失清单,不硬阻断。

## 确定性边界
矩阵保证**结构覆盖**(每层都有对应条目、无需求悄悄消失)。下游内容是否"忠实"上游意图仍需 review/测试;矩阵负责堵住占 drift 绝大多数的结构性丢失。
