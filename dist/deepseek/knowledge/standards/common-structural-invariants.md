# 结构不变式（Structural Invariants）声明规范

## 为什么需要

追溯矩阵（`traceability-matrix`）保证每个 REQ 到达它声明的下游层，属于**覆盖方向**。它防不住需求以错误的**结构形态**落地：例如本应并入既有真源 `t_customer` 的对象，被实现成一张并行的 `t_order_customer` 表。这种情况下映射完整、没有断点，覆盖门禁照样通过。

散文里写“不得创建并行真源”没有 sensor 读取，只能靠人工评审事后发现。结构不变式把这类架构级硬约束写成机器可读清单，由 `structural-invariants` sensor 在生成当场比对产物，命中即 fail-closed。

## 归属与作者责任

| 项 | 规则 |
| --- | --- |
| 模块级清单 | `docs/aidlc/modules/{module-id}/inception/application-design/structural-invariants.json` |
| 产品级清单（跨 module 真源） | `docs/aidlc/ideation/structural-invariants.json`，与模块级合并，`id` 全局唯一 |
| 归属阶段 | 应用设计（I12），随该阶段一起进入人工审批 |
| 作者 | `aidlc-architect-agent`；审批人对清单内容负责 |
| 变更 | 后续阶段的清单摘要必须与应用设计阶段受控证据中的 `manifest_digest` 一致；改清单等于回到应用设计重新审批 |
| 无清单 | sensor 输出 `not_applicable`，不做任何检查（向后兼容） |

## Schema（`schema_version: "1"`）

```jsonc
{
  "schema_version": "1",
  "baseline_ref": "origin/main",          // 可选。存量项目必填：只检查相对该 git ref 新增/修改的文件与未跟踪文件
  "strip_prefixes": ["t_", "tb_", "tbl_"], // 可选。名称归一时去掉的表前缀（小写）
  "invariants": [ /* 见下 */ ],
  "persistence": {                         // 可选，仅模块级。开启“新实体必须授权”
    "mode": "strict",
    "authorized": [ { "names": ["t_order"], "refs": ["REQ-ORDER-001"] } ],
    "exemptions": [ { "path": "src/test/resources/", "reason": "测试夹具建表" } ]
  }
}
```

每条不变式的公共字段：`id`（`INV-XXX`）、`kind`、`subject`（逻辑对象名）、可选 `requirements`（REQ-xxx，模块级清单会校验存在性）、可选 `patterns`（正则，大小写不敏感，匹配原名或归一名）、可选 `exemptions`（`{path, reason}`，路径前缀，理由至少 8 个字符）。

| kind | 必填字段 | 违例规则 |
| --- | --- | --- |
| `single-source-of-truth` | `owner.module`；`owner.tables` 或 `owner.entities`；`aliases` 或 `patterns` | `shadow-entity`：新建的实体/表命中 `subject`/`aliases`/`patterns` 但不是真源本身；`duplicate-canonical`：非 owner module 再建同名真源；`foreign-write`：`writers`（默认仅 owner）以外的 module 写入真源 |
| `converge` | `from`；`to.tables` 或 `to.entities` | `converge-recreated` / `converge-written`：新建或写入 `from` 中的对象 |
| `deprecated` | `targets` | `deprecated-recreated` / `deprecated-written` |
| `migrate-out` | `targets`；`to_module` | `migrate-out-recreated` / `migrate-out-written`：`to_module` 以外的 module 新建或写入 |
| `persistence.mode: strict` | `authorized[].names` + `refs`（REQ-xxx 或已声明的 INV-xxx） | `unauthorized-entity`：本 module 新建的持久化实体不在授权表中，也不是本 module 拥有的真源或收敛目标 |

`owner.paths` 可选，用于把文件归属到 owner module；未提供时依次使用 `module-manifest.json` 的 `paths`、`docs/aidlc/modules/<id>/` 目录，单 module 项目默认归当前 module。无法归属的文件不参与 `duplicate-canonical`、`foreign-write`、`migrate-out` 判定，但仍参与 `shadow-entity`、收敛、废弃判定。

## 检测面（确定性，不做语义猜测）

| 产物 | 识别为“新建” | 识别为“写入” |
| --- | --- | --- |
| `*.sql`、`*.xml`（Mapper） | `CREATE TABLE`（不含临时表）、`ALTER TABLE ... RENAME TO` | `INSERT INTO`、`REPLACE INTO`、`MERGE INTO`、`UPDATE ... SET` |
| `*.java` `*.kt` `*.ts` `*.js` | `@TableName("x")`、`@Table(name="x")`、`@Entity`（取注解名与紧随的类名） | 字符串中的上述 DML |
| `*.prisma` | `model X {` | — |
| 本 module 设计文档 `*.md` | `[实体:X]` / `[实体:X table=t_x]` 标记；`` ```sql `` 块中的 DDL | `` ```sql `` 块中的 DML |

名称归一：去引号与 schema 前缀，驼峰转蛇形，去 `strip_prefixes`，去 `_entity/_do/_po/_model/_table/_tbl` 后缀，只保留 `[a-z0-9]`。例如 `CustomerEntity`、`t_customer`、`` `crm`.`t_customer` `` 都归一为 `customer`。

检测是**结构级**的：它保证已声明的形态约束不被违反，不判断代码语义是否忠实。未预料的影子命名依靠 `patterns` 或 `persistence.mode: strict` 兜住——strict 模式下任何未授权的新实体都会被拦。

## 追溯归属断言

在 `requirements.md` 的 REQ 段内声明该需求在数据层归属的不变式：

```markdown
### REQ-ORDER-003 下单时记录客户信息
- track: [backend, data]
- data_ownership: [INV-CUSTOMER-SSOT]
```

从应用设计阶段起，`traceability-matrix` 校验被引用的 INV 必须已在清单中声明，否则该行记为 `BROKEN@ownership`。未声明 `data_ownership` 的 REQ 不受影响。

## 示例

```json
{
  "schema_version": "1",
  "baseline_ref": "origin/main",
  "invariants": [
    {
      "id": "INV-CUSTOMER-SSOT",
      "kind": "single-source-of-truth",
      "subject": "Customer",
      "owner": { "module": "customer", "tables": ["t_customer"], "entities": ["CustomerEntity"] },
      "aliases": ["client", "buyer"],
      "patterns": ["customer_(?:copy|snapshot|mirror|info)$"],
      "requirements": ["REQ-ORDER-003"]
    },
    {
      "id": "INV-LEGACY-ADDR",
      "kind": "converge",
      "subject": "OrderAddress",
      "from": ["t_order_address"],
      "to": { "module": "customer", "tables": ["t_customer_address"] },
      "exemptions": [{ "path": "db/migration/V1__init.sql", "reason": "历史基线建表，保留只读" }]
    }
  ],
  "persistence": {
    "mode": "strict",
    "authorized": [{ "names": ["t_order", "t_order_item"], "refs": ["REQ-ORDER-001"] }]
  }
}
```

## 豁免与不可绕过

- 豁免只能写在清单中，带路径与理由，随应用设计审批；运行时没有 skip 开关。
- 清单非法（字段缺失、ID 重复、正则非法、引用不存在的 REQ/INV、`baseline_ref` 无法解析）一律 fail-closed。
- 违例时 producer 不写证据，并把结构化违例清单写到 `.aidlc/reports/<stage>/<module>[/<unit>]/structural-invariants.blocked.json`（诊断用，不是门禁证据）。
