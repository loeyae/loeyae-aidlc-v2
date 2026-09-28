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
