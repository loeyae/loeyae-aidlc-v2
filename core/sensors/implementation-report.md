---
id: implementation-report
name: Implementation Report
description: >
  Verifies the final implementation report references all prior evidence,
  confirms all gates passed, and provides a complete summary linking scope
  to outcomes.
evidence_path: .aidlc/evidence/<stage-slug>/implementation-report.json
---

# implementation-report Sensor

## Purpose

The capstone gate for Construction phase. Proves that the implementation
report is backed by real evidence from prior stages, all gates are confirmed
green, and the summary is complete.

## Evidence Schema

```jsonc
{
  "evidence_version": "1",
  "timestamp": "2026-08-22T16:00:00.000Z",
  "status": "passed",
  "summary_complete": true,
  "all_gates_passed": true,
  "scope": "feature",
  "stages_completed": 12,
  "evidence_references": [
    ".aidlc/evidence/build-and-test/build-test-evidence.json",
    ".aidlc/evidence/code-review/review-evidence.json",
    ".aidlc/evidence/tdd/test-quality.json"
  ]
}
```

## Validation Rules (fail-closed)

| Field | Rule |
|-------|------|
| `status` | Must be `"passed"` |
| `summary_complete` | Must be `true` |
| `all_gates_passed` | Must be `true` |
| `scope` | Non-empty string (the workflow scope) |
| `stages_completed` | >= 1 |
| `evidence_references` | Non-empty string array; each path must exist on disk |
| `timestamp` | Valid ISO, < 24h old |

## Producer Responsibility

The agent MUST:
1. Collect all `.aidlc/evidence/` files produced during Construction
2. Verify each referenced file exists (engine validates this independently)
3. Confirm that the workflow state shows all gates passed (no sensor failures)
4. Record the scope and completion count from the workflow state
5. Write a human-readable summary in the implementation report document
6. Only produce this evidence when the full chain is green
