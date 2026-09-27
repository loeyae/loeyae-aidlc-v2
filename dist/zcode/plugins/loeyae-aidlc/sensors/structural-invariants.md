---
id: structural-invariants
name: Structural Invariants (shape consistency)
description: Fail-closed check that generated persistence artifacts (DDL, entities, schema, mapper SQL, design entity markers) honour the machine-readable structural invariants declared in application design.
type: semantic
evidence_path: .aidlc/evidence/<stage-slug>/<module-id>[/<unit-id>]/structural-invariants.json
---
# structural-invariants

## 目的
形态方向的门禁，与覆盖方向的 `traceability-matrix` 互补。读取应用设计声明的 `structural-invariants.json`（模块级 + 产品级），对本 module 的生成产物做确定性比对，阻断：

- 新建实体/表影子化一个已声明为唯一真源的对象（`shadow-entity`、`duplicate-canonical`）；
- 非授权 module 写入唯一真源（`foreign-write`）；
- 已声明收敛、废弃、迁出的对象仍被新建或写入（`converge-*`、`deprecated-*`、`migrate-out-*`）；
- `persistence.mode: strict` 下新建的持久化实体没有被任何设计声明授权（`unauthorized-entity`）。

清单 schema、检测面、名称归一与豁免规则见 `common-structural-invariants.md`。

## 挂载阶段
| 阶段 | 作用 |
| --- | --- |
| application-design | 校验清单合法性，记录 `manifest_digest`（`manifest_binding: authoring`），并对既有产物做首次比对 |
| units-generation | 比对单元产物中的 `[实体:X]` 与 SQL 块 |
| functional-design | 比对 `domain-entities.md` 等数据模型设计 |
| code-generation | 比对迁移 DDL、实体类、Prisma model、Mapper SQL |

后三个阶段要求清单摘要与应用设计证据一致（`manifest_binding: bound`），否则阻断。

## Evidence

```json
{
  "evidence_version": "1",
  "status": "passed",
  "module_id": "order",
  "stage": "code-generation",
  "manifests": ["docs/aidlc/ideation/structural-invariants.json", "docs/aidlc/modules/order/inception/application-design/structural-invariants.json"],
  "manifest_digest": "<sha256>",
  "manifest_binding": "bound",
  "invariants_declared": 2,
  "invariant_ids": ["INV-CUSTOMER-SSOT", "INV-LEGACY-ADDR"],
  "persistence_mode": "strict",
  "persistence_entities_checked": 3,
  "baseline_ref": "origin/main",
  "files_scanned": 42,
  "operations_detected": 7,
  "exemptions_applied": [],
  "violations": [],
  "producer": { "name": "loeyae-aidlc-evidence", "mode": "controlled", "execution_id": "<uuid>" },
  "checker": { "id": "builtin:structural-invariants", "sensor": "structural-invariants", "argv_digest": "<sha256>", "exit_code": 0, "status": "passed" },
  "source_revision": { "commit": "<sha>", "dirty": false, "worktree_digest": "<sha256>" }
}
```

无清单：`{"status": "not_applicable", "invariants_declared": 0, "violations": [], "skip_reason": "no structural-invariants manifest declared (module or product level)"}`。

## 门禁语义（fail-closed）
| 字段 | 规则 |
| --- | --- |
| `status` | `passed` 或 `not_applicable` |
| `violations` | 必须是空数组 |
| `skip_reason` | `not_applicable` 时必填 |
| `module_id` | 等于当前 stage instance 的 module |
| `invariants_declared` | `>= 1`，或 `persistence_mode` 为 `strict` |
| `manifests` | 非空 |
| `manifest_digest` | SHA-256 |
| `manifest_binding` | application-design 为 `authoring`，其余阶段为 `bound` |
| provenance | 受控 producer、`builtin:structural-invariants` checker、当前 source revision |

违例时 checker 以非零退出，producer 不写证据；结构化违例写到 `.aidlc/reports/<stage>/<module>[/<unit>]/structural-invariants.blocked.json`，每条含 `invariant`、`kind`、`rule`、`name`、`file`、`line`、`via`、`requirements`、`message`。

## 豁免
只能在清单中按不变式（`exemptions`）或 strict 模式（`persistence.exemptions`）声明路径前缀与理由，随应用设计审批生效。没有运行时 skip。

## 确定性边界
检查的是结构形态（名称、DDL、注解、DML 目标），不判断实现语义。清单没覆盖到的影子命名需要 `patterns` 或 strict 模式兜住。
