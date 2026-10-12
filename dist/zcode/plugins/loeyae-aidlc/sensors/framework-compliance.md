---
id: framework-compliance
phase: construction
---

# framework-compliance Sensor

读取 `.aidlc/evidence/loeyae-compliance/<module-id>/<unit-id>/framework-compliance.json`。

通过条件：`status` 为 `passed`、`skills_loaded` 为 true、`checks_total` 至少为 1、`checks_failed` 为 0，并带最近 24 小时内的 ISO `timestamp`。

迁移期行为：

- `legacy` / `shadow`：由原 controlled semantic producer 生成；
- `enforce`：若不存在旧 Evidence，Core 只能从当前、签名有效且 Gate 通过的 `implementation-validation` Provider Evidence 生成兼容投影；已有旧记录不得覆盖；
- Provider Evidence、GateDecision 与 `.aidlc/provider-reconciliation/loeyae-compliance/**` 不替代本文件的 provenance 校验。
