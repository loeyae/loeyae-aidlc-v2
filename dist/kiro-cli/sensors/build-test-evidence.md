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
just that a marker file was touched. The agent must invoke the controlled Producer;
only that Producer may execute the allowlisted commands and write signed evidence
containing exit codes, test counts, static-analysis results, and source provenance.

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
  "source_revision": {
    "commit": "git-commit",
    "dirty": false,
    "worktree_digest": "64-hex-sha256"
  },
  "commands": [
    {
      "argv_digest": "64-hex-sha256",
      "exit_code": 0,
      "status": "passed",
      "duration_ms": 45200,
      "stdout_tail": "BUILD SUCCESS"  // optional, last 200 redacted chars
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
  },
  "integrity": {
    "algorithm": "ed25519",
    "key_id": "device-key-id",
    "public_key": "base64-spki-public-key",
    "signature": "base64-ed25519-signature"
  }
}
```

## Validation Rules (fail-closed)

| Field | Rule |
|-------|------|
| `status` | Must be `"passed"` |
| `producer` | `name` 必须为 `loeyae-aidlc-evidence`，`mode` 必须为 `"controlled"`，`execution_id` 非空 |
| `source_revision` | `commit`、`dirty`、`worktree_digest` 必须与 report 时当前 Git 工作树完全一致 |
| `commands` | 非空数组；每项需要 64 位 `argv_digest`、`exit_code` = 0、`status` = `"passed"`、数值 `duration_ms`；不得持久化明文 argv |
| `tests.total` | >= 1 |
| `tests.passed` | >= 1 |
| `tests.failed` | Must be 0 |
| `checks` | Object present with `status` = `"passed"` |
| `integrity` | 与 workflow schema 一致：v3 为自动设备 Ed25519 envelope；v2 legacy 为当前 trust key 的 HMAC-SHA256 envelope |
| `timestamp` | Valid ISO, < 24h old, not in the future |

## Producer Responsibility

The executing agent MUST:
1. Read the signed workflow schema: for v3, let the engine use its automatic local Ed25519 device credential and never request, expose, or share `AIDLC_TRUST_SECRET`; only v2 legacy requires a stable secret of at least 32 bytes
2. Configure only the required `build`, `test`, and `check` argv entries in `.aidlc/evidence-commands.json`
3. Invoke `loeyae-aidlc evidence run --stage build-and-test`; when more than one matching instance is `in_progress`, also pass the exact `--instance <stage-instance>`; never execute a substitute writer
4. Treat command failure, unparseable test counts, instance ambiguity, symlink/root-boundary rejection, or lock conflict as blocking
5. Never create, edit, copy, cache, or reuse a passing evidence JSON manually; rerun the Producer after any source revision change
