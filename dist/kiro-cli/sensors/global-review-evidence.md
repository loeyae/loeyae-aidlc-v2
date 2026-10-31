---
id: global-review-evidence
name: Global Review Evidence
description: Enforces conditional FINAL_GLOBAL review before C8 and at completion.
---

# 全局审查证据

多单元、complex profile 或已记录跨边界风险时触发。简单单元任务的运行时 directive 移除该 sensor 和对应 produce。

审查前运行只读 `loeyae-aidlc orchestrate state review-inputs`，获取全部 `covered_instances` 和按路径排序的 `inputs`（path、sha256）。该投影不进行审查、不产证、不批准。

完成实际全局审查后，在 `docs/aidlc/construction/global-code-review.md` 写 `aidlc-global-review` JSON fenced block：`mode: FINAL_GLOBAL`、`status: passed`、`spec_axis: passed`、`standards_axis: passed`、真实 `reviewer`、问题计数、全部 covered_instances 和所审阅输入的摘要。沿用 review 的严重度计数规则；关键或重要开放问题阻断。

inspect/bind 精确的 `build-and-test` 实例后，用 `evidence run --stage build-and-test --sensor global-review-evidence` 生成受控证据，再执行 next 进入 C8。缺失、失败、单元遗漏、来源变化均阻断准入和完成。输入变化后先复审受影响范围，再刷新真实审查记录和证据；禁止只替换摘要冒充复审。
