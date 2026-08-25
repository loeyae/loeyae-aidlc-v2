---
id: nfr-coverage
name: NFR Coverage
description: >
  Verifies that all non-functional requirements have acceptance criteria,
  measurement methods, and verified status — no NFR left unaddressed.
evidence_path: .aidlc/evidence/<stage-slug>/nfr-coverage.json
---

# nfr-coverage Sensor

## Purpose

Proves that every non-functional requirement (performance, security,
reliability, scalability, etc.) has been formally addressed with a concrete
acceptance criterion and verified as achievable.

## Evidence Schema

```jsonc
{
  "evidence_version": "1",
  "timestamp": "2026-08-22T10:00:00.000Z",
  "status": "passed",
  "requirements_covered": 6,
  "unresolved": 0,
  "nfr_items": [
    {
      "id": "NFR-001",
      "category": "performance",
      "description": "API response time < 200ms P95",
      "acceptance_criterion": "P95 latency < 200ms under 1000 concurrent users",
      "verified": true
    },
    {
      "id": "NFR-002",
      "category": "security",
      "description": "All endpoints require authentication",
      "acceptance_criterion": "401 returned for unauthenticated requests",
      "verified": true
    }
  ]
}
```

## Validation Rules (fail-closed)

| Field | Rule |
|-------|------|
| `status` | Must be `"passed"` |
| `requirements_covered` | >= 1 |
| `unresolved` | Must be 0 |
| `nfr_items` | Non-empty array; each entry needs: |
| `nfr_items[].id` | Non-empty string |
| `nfr_items[].category` | Non-empty string (performance/security/reliability/...) |
| `nfr_items[].acceptance_criterion` | Non-empty string |
| `nfr_items[].verified` | Must be `true` |
| `timestamp` | Valid ISO, < 24h old |

## Producer Responsibility

The agent MUST:
1. Extract all NFRs from requirements/design docs
2. For each NFR, define a measurable acceptance criterion
3. Verify or design-validate each criterion is achievable
4. Mark `verified: true` only when the criterion can be met by the design
5. Never mark unresolved NFRs as verified
