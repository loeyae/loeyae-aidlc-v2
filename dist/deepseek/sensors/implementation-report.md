---
id: implementation-report
name: Implementation Report
description: >
  Verifies applicable delivery evidence and gates, and records a controlled
  summary linking workflow scope to outcomes. No Markdown report is required.
evidence_path: .aidlc/evidence/<stage-slug>/implementation-report.json
---

# implementation-report Sensor

## Purpose

The capstone gate for Construction. The controlled producer verifies the
applicable evidence chain and records the delivery result in JSON. It does
not require a unit summary or a final Markdown report. A read-only
`orchestrate state summary` view is for display and cannot satisfy this gate.

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
    ".aidlc/evidence/code-review/orders/u1/review-evidence.json",
    ".aidlc/evidence/code-generation/orders/u1/test-quality.json"
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
| `timestamp` | Valid ISO; content/command/provenance bound, no time-only expiry |

## Producer Responsibility

The controlled producer derives scope, completion counts and applicable
evidence references from the workflow. It validates provenance and required
gates before publishing the result; existing files or an agent-written
summary cannot prove success. Module, PRD, UI, deletion and Provider checks
retain their existing applicability rules.

The agent resolves concrete diagnostics and submits the stage through
`orchestrate report`; it must not handwrite evidence or duplicate machine
counts in Markdown. Human reports are only required by an explicit delivery
request or a specific risk explanation. An explicitly requested summary
export may be saved under `.aidlc/views/` as a rebuildable display artifact.
