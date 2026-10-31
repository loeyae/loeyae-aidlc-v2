---
id: review-evidence
name: Code Review Evidence
description: >
  Verifies that a dual-axis code review (spec conformance + coding standards)
  was performed, covers the delivered changes and has no blocking findings.
evidence_path: .aidlc/evidence/code-review/<module-id>/<unit-id>/review-evidence.json
---

# review-evidence Sensor

## Purpose

Requires a review record with an explicit passing conclusion for each axis and
coverage of delivered files. The checker verifies the record and its bindings;
the host remains responsible for performing the substantive review.

## Evidence Schema

```jsonc
{
  "evidence_version": "1",
  "timestamp": "2026-08-22T11:00:00.000Z",
  "status": "passed",
  "spec_axis": "passed",       // Design conformance axis
  "standards_axis": "passed",  // Coding standards axis
  "reviewer": "current-session",  // Who/what performed the review
  "files_reviewed": [
    "src/main/java/com/example/UserService.java",
    "src/main/java/com/example/UserController.java"
  ],
  "issues_found": 3,
  "issues_resolved": 3,
  "issues_open": 0
}
```

## Validation Rules (fail-closed)

| Field | Rule |
|-------|------|
| `status` | Must be `"passed"` |
| `spec_axis` | Must be `"passed"` |
| `standards_axis` | Must be `"passed"` |
| `reviewer` | Non-empty string identifying the reviewer |
| `files_reviewed` | Project-relative real files or verified deletions; covers delivered files in the unit's declared `evidence_inputs`, or conservatively the module delivery when ownership is undeclared |
| `issues_found` | Non-negative integer |
| `issues_resolved` | Non-negative integer; legacy records require >= `issues_found` |
| `issues_open` | Legacy records require 0; severity-partitioned records follow `reviewIssueErrors` and cannot leave critical or important issues open |
| `timestamp` | Valid ISO; content/command/provenance bound, no time-only expiry |

## Producer Responsibility

The built-in checker derives the real review result from the record. Historical
executor metadata is diagnostic only; it does not select a persona, require an
additional reviewer, or prove completion. The host owns execution and context.
Explicit user requirements for independent review remain applicable.

The reviewer MUST:
1. Evaluate code against the functional design spec (spec_axis)
2. Evaluate code against project coding standards (standards_axis)
3. Record every finding and its resolution
4. Resolve blocking findings; record advisory findings with severity and disposition
5. Identify itself in the `reviewer` field

Use separate explicit lines, for example `Spec result: passed` and
`Standards result: passed`, including Markdown list items. Missing, failed, unknown
or conflicting conclusions block production. Merely mentioning both axis names
and an unrelated passing test is insufficient. Deleted and renamed files must be
covered using verified deletion ownership and the actual destination path.

The producer and completion sensor apply the same coverage rules. Run
`evidence run --stage code-review --all-sensors` explicitly before reporting;
`report` cannot fabricate missing observations. When FINAL_GLOBAL is required,
follow [global-review-evidence](global-review-evidence.md) before C8.
