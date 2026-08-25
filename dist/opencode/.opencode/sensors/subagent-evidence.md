---
id: subagent-evidence
phase: construction
---

# subagent-evidence Sensor

读取 `.aidlc/evidence/subagent-execution/subagent-evidence.json`。

通过条件：`status` 为 `passed`、`agents` 非空、`tasks_completed` 至少为 1、`failures` 为 0，并带最近 24 小时内的 ISO `timestamp`。
