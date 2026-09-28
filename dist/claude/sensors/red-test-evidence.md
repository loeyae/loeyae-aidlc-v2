---
id: red-test-evidence
name: Controlled RED Test Evidence
description: Verifies that tests exist before GREEN and fail because the target behavior is not implemented.
evidence_path: .aidlc/evidence/<stage-slug>/red-test-evidence.json
---

# red-test-evidence Sensor

适用于 `tdd` RED 门禁。可执行业务行为必须由受控命令产生：

```json
{
  "phase": "RED",
  "status": "failed",
  "failure_class": "behavior",
  "failure_signature": "assertion failure summary",
  "compile_status": "passed",
  "environment_status": "passed",
  "tests_total": 1,
  "tests_failed": 1,
  "traceability_complete": true,
  "uc_mapping": [{"use_case": "UC-D-001", "test_methods": ["Test#behavior"]}]
}
```

命令必须退出码为 1，并输出上述 JSON 观察对象。命令找不到、编译失败、环境失败、测试通过、失败分类不是 `behavior` 或缺少 UC-D 映射都会阻断。无业务行为时只能消费 I13 的 `not_applicable` 证据，不得手写 RED 豁免。
