---
id: recovery-evidence
phase: construction
---

# recovery-evidence Sensor

读取 `.aidlc/evidence/compact-recovery/recovery-evidence.json`。

通过条件：`status` 为 `passed`、`state_restored` 为 true、`handoff_recorded` 为 true，并带最近 24 小时内的 ISO `timestamp`。
