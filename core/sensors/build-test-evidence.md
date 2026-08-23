---
id: build-test-evidence
name: Build & Test Evidence
description: >
  Verifies that build and test execution produced machine-readable proof:
  all commands exited 0, tests passed with count > 0, and static checks green.
evidence_path: .aidlc/evidence/<stage-slug>/build-test-evidence.json
---

# build-test-evidence Sensor

## Purpose

Proves that the build toolchain and test suite actually ran successfully — not
just that a marker file was touched. The agent must produce a structured JSON
evidence file recording every executed command, its exit code, test counts, and
static analysis results.

## Evidence Schema

```jsonc
{
  "evidence_version": "1",
  "timestamp": "2026-08-22T10:30:00.000Z",  // ISO-8601, must be < 24h old
  "status": "passed",
  "producer": {
    "name": "loeyae-aidlc-evidence",
    "mode": "controlled",
    "execution_id": "uuid-or-ci-run-id"
  },
  "commands": [
    {
      "cmd": "mvn clean verify -DskipITs",
      "exit_code": 0,
      "status": "passed",
      "duration_ms": 45200,
      "stdout_tail": "BUILD SUCCESS"  // optional, last 200 chars
    }
  ],
  "tests": {
    "total": 142,
    "passed": 142,
    "failed": 0,
    "skipped": 3  // optional
  },
  "checks": {
    "status": "passed",
    "lint": "passed",       // optional detail
    "typecheck": "passed",  // optional detail
    "security": "passed"   // optional detail
  }
}
```

## Validation Rules (fail-closed)

| Field | Rule |
|-------|------|
| `status` | Must be `"passed"` |
| `producer` | Object with non-empty `name`, `mode: "controlled"`, and non-empty `execution_id` |
| `commands` | Non-empty array; each entry needs `cmd` (non-empty), `exit_code` = 0, `status` = `"passed"`, `duration_ms` (number) |
| `tests.total` | >= 1 |
| `tests.passed` | >= 1 |
| `tests.failed` | Must be 0 |
| `checks` | Object present with `status` = `"passed"` |
| `timestamp` | Valid ISO, < 24h old, not in the future |

## Producer Responsibility

The executing agent MUST:
1. Run the actual build/test commands
2. Capture stdout/stderr exit codes programmatically
3. Parse test framework output for counts
4. Write the evidence JSON only if ALL commands passed
5. Never write evidence from cached or hypothetical results
