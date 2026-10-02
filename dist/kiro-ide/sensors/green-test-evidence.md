---
id: green-test-evidence
name: Controlled GREEN Test Evidence
description: Verifies that code generation consumes RED evidence and the target tests pass with complete UC-D traceability.
evidence_path: .aidlc/evidence/<stage-slug>/green-test-evidence.json
---

# green-test-evidence Sensor

适用于 `code-generation` GREEN 门禁。可执行业务行为必须由受控命令产生：

```json
{
  "phase": "GREEN",
  "status": "passed",
  "compile_status": "passed",
  "environment_status": "passed",
  "tests_total": 1,
  "tests_failed": 0,
  "traceability_complete": true,
  "uc_mapping": [{"use_case": "UC-D-001", "test_methods": ["Test#behavior"]}]
}
```

GREEN 命令必须退出码为 0，且测试计数为非零/零失败。代码审查和构建测试继续消费该证据并重新验证 UC-D 覆盖。无业务行为时只能消费 I13 的 `not_applicable` 证据和其中声明的确定性替代验证。

GREEN 观察改动后的全部行为：I13 为 `required` 时，`uc_mapping` 必须恰好覆盖 I13 的全部 UC-D——`tdd_mode: new`（RED→GREEN）与 `characterization`（BASELINE→GREEN）都要包含，漏写、多写或重复都会被拒。

受控证据中 `checker` 为内置检查（`id: builtin:green-test-evidence`，`exit_code: 0`），被观察的测试命令记录在 `observed_command`（`exit_code: 0`）；缺少 `observed_command` 或其退出码不为 0 时门禁拒绝。

与 RED 相同，门禁把 `observed_command.argv_digest` / `id` 绑定到 `code-generation` 命令清单（`.aidlc/commands/code-generation.json` → `.aidlc/evidence-commands.json`，stage 锁定）中唯一一条 `role: green` 命令，并要求 `checker.argv_digest` 等于 `SHA-256(JSON.stringify(["GREEN-observation", observed_command.argv_digest]))`；命令清单缺失、无法解析、stage 不匹配或不是恰好一条 green 命令时拒绝。producer 会拒绝指向其他清单的 `--config`（与默认查找结果不是同一文件时直接报错，不执行命令、不写证据）。

`code-generation` 完成时复验 RED 与 BASELINE 证据（只容忍工作区漂移，见 `red-test-evidence.md`），读取的是 `tdd` 阶段的命令清单。多阶段共用 `.aidlc/evidence-commands.json` 时，改写为 `code-generation` 后 RED 复验会因 stage 不匹配被拒，请改用 `.aidlc/commands/tdd.json` 与 `.aidlc/commands/code-generation.json`。
