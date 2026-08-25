---
id: infrastructure-completeness
name: Infrastructure Completeness
description: >
  Verifies that infrastructure design covers deployment, resources, migration,
  rollback, and runtime dependencies — with each resource enumerated and
  provisioning confirmed.
evidence_path: .aidlc/evidence/<stage-slug>/infrastructure-completeness.json
---

# infrastructure-completeness Sensor

## Purpose

Proves that infrastructure planning is complete: all required sections are
addressed, every resource is named and provisioned, a rollback strategy exists,
and no unresolved infrastructure gaps remain.

## Evidence Schema

```jsonc
{
  "evidence_version": "1",
  "timestamp": "2026-08-22T14:00:00.000Z",
  "status": "passed",
  "sections": ["deployment", "resources", "migration", "rollback", "runtime_dependencies"],
  "unresolved": 0,
  "resources_enumerated": [
    {
      "name": "user-db",
      "type": "PostgreSQL",
      "provisioned": true
    },
    {
      "name": "redis-cache",
      "type": "Redis",
      "provisioned": true
    },
    {
      "name": "message-queue",
      "type": "RabbitMQ",
      "provisioned": true
    }
  ],
  "rollback_strategy": "Blue-green deployment with instant DNS failover to previous version"
}
```

## Validation Rules (fail-closed)

| Field | Rule |
|-------|------|
| `status` | Must be `"passed"` |
| `sections` | Must include all of: deployment, resources, migration, rollback, runtime_dependencies |
| `unresolved` | Must be 0 |
| `resources_enumerated` | Non-empty array; each entry needs `name`, `type` (non-empty), `provisioned` = `true` |
| `rollback_strategy` | Non-empty string |
| `timestamp` | Valid ISO, < 24h old |

## Producer Responsibility

The agent MUST:
1. Enumerate every infrastructure resource the application depends on
2. Confirm each is provisioned (or confirm it will be before deploy)
3. Document the deployment topology (how code reaches production)
4. Define migration steps (database schema, data, config)
5. Define a rollback strategy (how to revert if the deploy fails)
6. List all runtime dependencies (external services, SDKs, certificates)
