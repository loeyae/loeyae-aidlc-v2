---
id: template-completeness
phase: construction
---

# template-completeness Sensor

读取 `.aidlc/evidence/build-and-test-templates/template-completeness.json`。

通过条件：`status` 为 `passed`、`templates` 非空、`unresolved` 为 0，并带合法、非未来的 ISO `timestamp`；来源、命令、范围及世代仍匹配时不因纯时间失效。
