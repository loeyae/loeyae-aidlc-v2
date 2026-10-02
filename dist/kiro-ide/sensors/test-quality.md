---
id: test-quality
name: Test Quality & UC-D Traceability
description: >
  Verifies the RED-before-GREEN gate and Use Case to Design traceability — every applicable UC-D maps to real tests and the target GREEN command passes.
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
  "red_seen": true,
  "baseline_seen": false,
  "green_seen": true,
  "tests_total": 48,
  "tests_failed": 0,
  "traceability_complete": true,
  "uc_mapping": [
    {
      "use_case": "UC-D-001",
      "test_methods": ["UserRegistrationTest#testSuccessfulRegistration"]
    }
  ]
}
```

For a unit with no executable business behavior, the controlled evidence may instead be:

```json
{
  "status": "not_applicable",
  "not_applicable_reason": "I13 approved pure declaration",
  "alternative_validation": "compile and schema validation",
  "traceability_complete": true,
  "uc_mapping": []
}
```

## Validation Rules (fail-closed)

| Field | Rule |
|-------|------|
| `status` | `"passed"` for executable behavior, or `"not_applicable"` only with I13-derived reason and alternative validation |
| `green_seen` | Must be `true` for executable behavior |
| `tests_total` | >= 1 for executable behavior |
| `tests_failed` | Must be 0 for executable behavior |
| `red_seen` | Must be `true` when I13 declares a `tdd_mode: new` UC-D (pre-4.6 I13 without `ucd_modes`: every UC-D is new; no readable required I13: always); no free-form exemption replaces I13 |
| `baseline_seen` | Must be `true` when I13 declares a `tdd_mode: characterization` UC-D |
| `traceability_complete` | Must be `true` |
| `uc_mapping` | Non-empty for executable behavior; empty only for `not_applicable` |
| `timestamp` | Valid ISO, < 24h old |

## Producer Responsibility

The agent MUST:
1. Consume the I13 evidence before evaluating tests
2. For executable behavior, judge each module by its I13 `ucd_modes`: `new` UC-Ds require the controlled RED evidence (`status: failed`, behavior failure) before GREEN; `characterization` UC-Ds require the controlled BASELINE evidence (`status: passed`, `tests_failed: 0`); a phase whose mode has no UC-D must be `not_required`
3. Verify the GREEN evidence and actual test source mapping for every UC-D
4. For `not_applicable`, verify the I13 reason and deterministic alternative validation
5. Never fabricate the UC mapping or accept a text-only TDD claim
