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

## Collection scope and block rules (4.8.1)

- 收集范围与 `contract-baseline` 的模块规则相同（见 `contract-baseline.md` 的 Collection scope），文件名规则为 `nfr|non-functional|非功能` 且扩展名 `.md`；`contract_paths` 中的文件同样按该规则过滤。没有模块上下文时与 4.8.0 相同，扫描全项目。注意 `infrastructure` 一词也匹配 `nfr`。
- 每个 NFR 编号的块从该编号的完整出现处开始（`NFR-1` 不会命中 `NFR-10` 或 `NFR-1-x`），到其后的下一个 `NFR-\d+` 为止（偏移从编号末尾起算，4.8.0 少算了编号长度）。
- 验收关键词：`验收|acceptance|阈值|threshold|p95|p99|measurement|度量|指标`（不区分大小写）；`acceptance_criterion` 取块内第一行匹配 `验收|acceptance|阈值|threshold|p95|p99|指标` 的行。
- 未决标记检查不把 `不阻断`、`非阻断`、`无阻断` 视为命中；`阻断`、`存在阻断`、`阻断项` 及 `TODO`、`待确认` 等仍然命中。
