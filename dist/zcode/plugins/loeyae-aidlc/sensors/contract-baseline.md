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

## Collection scope (4.8.1)

- 没有模块上下文（单一工作流）时与 4.8.0 相同：收集全项目中路径匹配 `contracts?|openapi|swagger|schema|.proto|.avsc` 的文件。
- 有模块上下文（`--module` / `AIDLC_ACTIVE_MODULE`）时只收集：
  - `docs/aidlc/modules/<module>/inception/`；
  - 有单元时 `docs/aidlc/modules/<module>/construction/<unit>/`，无单元时本模块整个 `construction/`；
  - module-manifest 中本模块的 `paths`（以上三类按文件名规则过滤）；
  - module-manifest 中本模块的 `contract_paths`（声明的文件与目录下全部文件，不按文件名过滤；不存在、符号链接/junction、越出项目根时报错）。
  项目根下的其他文件不再隐式参与。范围内没有文件时仍报 `no contract schema file found`。
- `owner`、`consumers`、版本信息和 `schema_hash` 只来自范围内的来源。
- 项目级契约表（文件名 `product-contracts.md`，通过 `contract_paths` 纳入）在模块上下文中按本模块的角色取行：本模块在“提供方 / provider”列出现的契约，取该契约在文档各张含“契约 ID”列的表中的全部行，全部做未决标记检查；本模块只在“消费者 / 消费方 / consumers”列出现的契约，只检查消费者单元格包含本模块的行，该契约的提供方行作为引用行（确定 owner、计入 hash，不检查未决标记），其他消费方的行不纳入。`owner` 优先取普通契约文档中的 `owner:`，没有时取这些行的提供方（本模块提供的契约优先）；`consumers` 取被校验行的消费者列（消费的契约只报告本模块自身）；`schema_hash` 覆盖被校验行、引用行及其表头。表中没有本模块的行时，该文件不作为本模块的契约来源，也不报错。列识别与模块匹配规则与 orchestrate 的 shared contract projection 共用（`core/tools/aidlc-contract-table.ts`）。
