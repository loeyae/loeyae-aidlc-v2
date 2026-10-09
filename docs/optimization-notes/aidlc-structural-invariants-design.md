# AI-DLC 形态一致性门禁（structural-invariants）设计说明

## 落地自检

> 若某需求以并行/影子实体的错误形态落地、但追溯完整，本次增强能否在生成阶段当场阻断？

**能。** 前提是这条约束已经写成机器声明。两种写法，任选其一：
- 在 `structural-invariants.json` 里声明 `single-source-of-truth`，并用 `aliases` 或 `patterns` 描述影子形态；
- 开启 `persistence.mode: strict`。这样即使影子名称事先没有预料到，只要是未授权的新实体就会被拦。

在 `functional-design`（`[实体:X]` 与 SQL 块）和 `code-generation`（DDL、实体注解、Mapper SQL）阶段，`structural-invariants` sensor 发现违例就以非零码退出，producer 不写证据，`next` 因缺少证据被阻断。这时 `traceability-matrix` 照常 PASS。回归用例 `test_self_check_shadow_entity_blocked_while_traceability_complete` 同时断言了这两点。

如果这条约束只写在散文里、清单里没有，仍然拦不住。本方案的前提就是“无声明 = 不检查”，所以作者责任被放在应用设计阶段，并随该阶段的人工审批落实。

## 问题定性（认可）

- 覆盖型门禁（`traceability-matrix`）回答“每个需求都到达了吗”，不回答“以什么形态到达”。
- 意图型门禁（`design-intent-coverage`）只检查 `[意图:*]` 标记是否被工作单元承接，不比对生成产物。
- 散文硬约束没有任何 sensor 读取，唯一兜底是人工评审，属于晚检测。

## 交付映射

| 条目 | 实现 |
| --- | --- |
| A 硬约束可编码化 | `structural-invariants.json`（模块级 + 产品级），`schema_version: "1"`，包含 4 种 kind 和 strict 持久化授权；归属应用设计阶段，作者为 architect agent，随审批生效。规范见 `core/knowledge/standards/common-structural-invariants.md` |
| B 形态一致性 sensor | `structural-invariants`（`core/sensors/structural-invariants.md`）：确定性提取 DDL/DML、`@TableName`/`@Table`/`@Entity`、Prisma model、`[实体:X]` 标记，按不变式判定 7 类违例。发现违例时 fail-closed，结构化违例写入 `.aidlc/reports/<stage>/<module>[/<unit>]/structural-invariants.blocked.json` |
| C 门禁挂载前移 | `application-design`（校验清单、记录摘要）、`units-generation`、`functional-design`、`code-generation` 的 `sensors` 和 `produces` |
| D 追溯归属断言 | REQ 段 `data_ownership: [INV-xxx]`；`traceability-matrix` 从应用设计阶段起校验引用的 INV 已声明，否则记为 `BROKEN@ownership`，并在矩阵行里输出 `ownership_status` |

## 关键决策

- **防削弱**：后续阶段要求清单摘要与应用设计阶段受控证据里的 `manifest_digest` 一致（`manifest_binding: bound`）。在生成阶段为了过门禁而加豁免或删不变式，会被直接阻断，只能回到应用设计重新审批。
- **豁免**：只能写在清单里，带路径和理由，随审批生效；运行时没有 skip 开关。
- **存量项目**：`baseline_ref` 只扫描相对该基线新增或修改的文件，以及未跟踪文件。ref 无法解析时 fail-closed。
- **诊断与证据分离**：blocked 报告写在 `.aidlc/reports/`，不在 `.aidlc/evidence/`，也不进入工作区摘要，永远不会被当作门禁证据。

## 向后兼容

- 模块级和产品级都没有清单时，输出 `not_applicable`，不检查、不阻断。
- 未声明 `data_ownership` 的 REQ，矩阵行为不变。
- 新 sensor 挂到了 4 个阶段，处在这些阶段的项目需要在 `.aidlc/evidence-commands.json` 中声明 `structural-invariants` 的 semantic 命令（引擎报错会给出提示），这与此前新增 `traceability-matrix` 时的处理方式相同。

## 确定性边界

- 检查的是结构形态（名称、DDL、注解、DML 目标），不判断实现语义。
- ORM 方法级写入（例如 `mapper.insert(entity)`）不做识别，写入判定只覆盖 SQL 文本（Mapper XML、注解 SQL、迁移脚本）。
- 代码文件里的 DML 按字符串文本匹配，注释中若出现形如 `insert into t_x (...)` 的内容也会被识别；如属误报，用清单豁免处理。
- 摘要绑定是防篡改检测，不是防篡改保证：应用设计证据和其他证据一样依赖受控 producer 链路，人工审批记录仍是最终锚点。

## 验证

`tests/test_structural_invariants.py` 共 11 个用例（已加入 `npm test`），覆盖：无清单 NA、自检场景（追溯完整但影子实体被拦）、正例复用真源、重复真源与越权写入、废弃对象被 Mapper 写入以及豁免生效、strict 未授权实体、审批后清单被改、非法清单、归属断言悬空、`baseline_ref`，以及 producer 写 blocked 报告且不写证据。
