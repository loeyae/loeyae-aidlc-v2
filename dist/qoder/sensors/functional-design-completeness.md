---
id: functional-design-completeness
name: Functional Design Completeness
description: >
  Verifies that the functional design covers all use cases, resolves
  ambiguities, specifies interfaces, and defines error handling — no gaps
  that would force implementation-time guessing.
evidence_path: .aidlc/evidence/<stage-slug>/functional-design-completeness.json
---

# functional-design-completeness Sensor

## Purpose

Proves that the functional design document is complete enough to drive
implementation without requiring the implementer to make design decisions.
Catches missing interface specs, unresolved ambiguities, and gaps in error
handling before code is written.

## Evidence Schema

```jsonc
{
  "evidence_version": "1",
  "timestamp": "2026-08-22T09:30:00.000Z",
  "status": "passed",
  "data_source_validation": "passed",
  "ambiguities_resolved": true,
  "unresolved_blockers": 0,
  "use_cases_covered": [
    "UC-001: User Registration",
    "UC-002: User Login",
    "UC-003: Password Reset"
  ],
  "interfaces_specified": 5,
  "error_handling_defined": true
}
```

## Validation Rules (fail-closed)

| Field | Rule |
|-------|------|
| `status` | Must be `"passed"` |
| `data_source_validation` | Must be `"passed"` |
| `ambiguities_resolved` | Must be `true` |
| `unresolved_blockers` | Must be 0 |
| `use_cases_covered` | Non-empty string array |
| `interfaces_specified` | >= 1 |
| `error_handling_defined` | Must be `true` |
| `timestamp` | Valid ISO, < 24h old |

## Producer Responsibility

The design agent MUST:
1. Cross-reference every use case from requirements against the design
2. Verify no ambiguous language remains ("TBD", "TODO", "to be decided")
3. Count and list all public interfaces (API endpoints, event handlers, etc.)
4. Confirm error/exception handling is specified for each interface
5. Validate data sources are identified and accessible
