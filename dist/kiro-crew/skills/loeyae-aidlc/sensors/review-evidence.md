---
id: review-evidence
name: Code Review Evidence
description: >
  Verifies that a dual-axis code review (spec conformance + coding standards)
  was performed and all findings were resolved before completion.
evidence_path: .aidlc/evidence/<stage-slug>/review-evidence.json
---

# review-evidence Sensor

## Purpose

Proves that code review actually happened with both axes evaluated, all issues
were addressed, and the review reached a "passed" conclusion. Prevents
rubber-stamping.

## Evidence Schema

```jsonc
{
  "evidence_version": "1",
  "timestamp": "2026-08-22T11:00:00.000Z",
  "status": "passed",
  "spec_axis": "passed",       // Design conformance axis
  "standards_axis": "passed",  // Coding standards axis
  "reviewer": "aidlc-quality-agent",  // Who/what performed the review
  "reviewer_agent": "aidlc-quality-agent",
  "execution_context": "isolated",
  "review_only": true,
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
| `reviewer_agent` | Must match the stage reviewer persona in review mode |
| `execution_context` | Must be `"isolated"` in review mode |
| `review_only` | Must be `true` in review mode |
| `files_reviewed` | Non-empty string array |
| `issues_found` | Non-negative integer |
| `issues_resolved` | Non-negative integer, >= `issues_found` |
| `issues_open` | Must be 0 |
| `timestamp` | Valid ISO, < 24h old |

## Producer Responsibility

The review agent MUST:
1. Evaluate code against the functional design spec (spec_axis)
2. Evaluate code against project coding standards (standards_axis)
3. Record every finding and its resolution
4. Only produce evidence when ALL issues are resolved
5. Identify itself in the `reviewer` field
