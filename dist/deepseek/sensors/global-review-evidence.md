---
id: global-review-evidence
name: Global Review Evidence
description: Enforces conditional FINAL_GLOBAL review before C8 and at completion.
---

# 全局审查证据

多单元、complex profile 或已记录跨边界风险时触发。简单单元任务的运行时 directive 移除该 sensor 和对应 produce。

审查前运行只读 `loeyae-aidlc orchestrate state review-inputs`，获取全部 `covered_instances` 和按路径排序的 `inputs`（path、sha256）。该投影不进行审查、不产证、不批准。

完成实际全局审查后，在 `docs/aidlc/construction/global-code-review.md` 写 `aidlc-global-review` JSON fenced block：`mode: FINAL_GLOBAL`、`status: passed`、`spec_axis: passed`、`standards_axis: passed`、真实 `reviewer`、问题计数、全部 covered_instances 和所审阅输入的摘要。沿用 review 的严重度计数规则；关键或重要开放问题阻断。

逐项填写投影的 `checklist_items`：`checklist.<id> = {"status":"passed","evidence":["投影 inputs 中的文件路径#可选章节"]}`。不适用项须使用 `status: not_applicable`、非空 `reason` 和实际来源；安全、未裁决 blocked，以及有选定 UC-D 时的设计/测试对账不能记为不适用。缺项、失败、未验证和未知项均拒绝。投影只给项目与来源，不替审查者填写结论。

报告的 `ucd_coverage` 必须与投影中的当前机器统计一致。引擎按模块和单元核验受控 I13、当前 ready 用例、实际实现设计/代码生成计划与受控 GREEN 测试映射；逐单元缺覆盖、失败、不可信来源和统计篡改阻断。相关上游证据及设计/用例文件均进入输入摘要，变动后重新审查。

已有显式 `mapping_deferred` 的范围继续按 I13 的分级映射规则处理，在 `units[].deferred_ucd_ids` 中列出；不能算为已覆盖，也不能用暂缓掩盖未裁决 blocked 用例。

inspect/bind 精确的 `build-and-test` 实例后，用 `evidence run --stage build-and-test --sensor global-review-evidence` 生成受控证据，再执行 next 进入 C8。缺失、失败、单元遗漏、来源变化均阻断准入和完成。输入变化后先复审受影响范围，再刷新真实审查记录和证据；禁止只替换摘要冒充复审。
