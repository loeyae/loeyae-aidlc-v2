---
id: test-quality
name: Test Quality & UC-D Traceability
description: >
  Verifies TDD discipline (red-green-refactor observed) and Use Case to Design
  traceability — every use case maps to at least one test method.
evidence_path: .aidlc/evidence/<stage-slug>/test-quality.json
---

# test-quality Sensor

## Purpose

Proves that:
1. TDD cycle was followed (RED phase seen before GREEN)
2. All tests pass (GREEN)
3. Every use case from the design has at least one test covering it (UC-D mapping)

This is the semantic layer above raw test-pass — it validates *process quality*
not just exit codes.

## Evidence Schema

```jsonc
{
  "evidence_version": "1",
  "timestamp": "2026-08-22T12:00:00.000Z",
  "status": "passed",
  "red_seen": true,          // RED phase observed (test failed first)
  "green_seen": true,        // GREEN phase observed (tests pass now)
  "tests_total": 48,
  "tests_failed": 0,
  "traceability_complete": true,
  "uc_mapping": [
    {
      "use_case": "UC-001: User Registration",
      "test_methods": [
        "UserRegistrationTest#testSuccessfulRegistration",
        "UserRegistrationTest#testDuplicateEmailRejected"
      ]
    },
    {
      "use_case": "UC-002: User Login",
      "test_methods": [
        "AuthenticationTest#testValidLogin",
        "AuthenticationTest#testInvalidPassword"
      ]
    }
  ],
  "red_exemption": null  // or string explaining why RED was not observed
}
```

## Validation Rules (fail-closed)

| Field | Rule |
|-------|------|
| `status` | Must be `"passed"` |
| `green_seen` | Must be `true` |
| `tests_total` | >= 1 |
| `tests_failed` | Must be 0 |
| `red_seen` | Must be `true` OR `red_exemption` must be a non-empty string |
| `traceability_complete` | Must be `true` |
| `uc_mapping` | Non-empty array; each entry needs `use_case` (non-empty) and `test_methods` (non-empty string array) |
| `timestamp` | Valid ISO, < 24h old |

## Producer Responsibility

The agent MUST:
1. Write a failing test first (RED), observe the failure, then implement until GREEN
2. Record `red_seen: true` only if a test failure was actually observed
3. Map EVERY use case from `docs/aidlc/inception/user-stories.md` or equivalent to test methods
4. If RED cannot be demonstrated (e.g., pure refactor), document `red_exemption`
5. Never fabricate the UC mapping — it must reflect actual test class/method names
