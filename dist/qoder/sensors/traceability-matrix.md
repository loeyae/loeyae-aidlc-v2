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
| tests (@TestCaseId) | tdd | backend, frontend, data |

## 为什么不误报
覆盖只要求 REQ 到达**它自己 track 声明的层** —— UI-only 不查后端代码,backend-only 不查页面。这消除了"正向全覆盖"在混合前后端场景的误报,同时把覆盖率拉满到 100%。

## 门禁语义
由确定性 producer `traceabilityMatrix()` 生成 evidence(provenance 受控,Agent 不可伪造);sensor 校验 `broken_rows` 为空。经 Phase A 的 `next` 前置门禁 + Stop hook 强制。

## 遗留兼容
requirements.md 无 REQ-xxx 或需求缺 `track` 标签(未迁移旧项目)→ `migration_status: MIGRATION_REQUIRED`,降级放行 + 输出 `missing_track` 缺失清单,不硬阻断。

## 确定性边界
矩阵保证**结构覆盖**(每层都有对应条目、无需求悄悄消失)。下游内容是否"忠实"上游意图仍需 review/测试;矩阵负责堵住占 drift 绝大多数的结构性丢失。
