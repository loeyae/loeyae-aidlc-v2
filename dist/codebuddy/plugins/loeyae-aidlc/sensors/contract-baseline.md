---
id: contract-baseline
name: Shared Contract Baseline
description: >
  Verifies that shared contracts (API schemas, event definitions, protobuf)
  are baselined with owner, consumers acknowledged, and schema hash recorded
  for integrity tracking.
evidence_path: .aidlc/evidence/<stage-slug>/contract-baseline.json
---

# contract-baseline Sensor

## Purpose

Proves that shared contracts between modules/services have been formally
baselined: the schema is locked, consumers are enumerated and acknowledge
compatibility, and a hash allows detecting unauthorized changes.

## Evidence Schema

```jsonc
{
  "evidence_version": "1",
  "timestamp": "2026-08-22T13:00:00.000Z",
  "status": "verified",
  "contract_id": "user-service-api-v2",
  "contract_type": "api",  // api | event | schema | proto
  "owner": "user-domain-team",
  "consumers": ["order-service", "notification-service"],
  "schema_hash": "sha256:a1b2c3d4e5f6...",
  "validation_status": "passed"
}
```

## Validation Rules (fail-closed)

| Field | Rule |
|-------|------|
| `status` | Must be `"verified"` |
| `contract_id` | Non-empty string |
| `contract_type` | Non-empty string (api/event/schema/proto) |
| `owner` | Non-empty string |
| `consumers` | Non-empty string array (at least one consumer) |
| `schema_hash` | Non-empty string (integrity fingerprint) |
| `validation_status` | Must be `"passed"` |
| `timestamp` | Valid ISO, < 24h old |

## Producer Responsibility

The agent MUST:
1. Identify the shared contract file(s) in the project
2. Compute a stable hash of the contract schema
3. Enumerate all known consumers of the contract
4. Validate schema against consumers' expected format
5. Record owner accountability
6. Only produce evidence when validation passes
