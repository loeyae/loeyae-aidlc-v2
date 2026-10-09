# 测试用例派生规范（I13）

## 目的

将产品行为和已批准的系统级技术风险翻译为可执行测试用例点 UC-D，建立“需求/设计/CR → 执行锚点 → Construction 证据”的追溯链。

## 前置条件

- 产品行为用例：I7 用户故事已完成，I12 已提供接口、页面或流程锚点。
- 技术风险用例：已有经批准的 NFR、CR、契约变更、配置变更、迁移设计或一致性场景。
- 两类来源都不存在时，也必须执行 I13 并生成结构化 `non-applicable.json`；只有传感器验证该记录包含批准依据、原因代码、替代验证和可执行命令后，才能将状态记为 `not_applicable`。

## 结构化不适用/豁免

无可执行业务行为时，在测试用例目录写入 `non-applicable.json`：

```json
{
  "schema_version": "1",
  "status": "not_applicable",
  "reason_code": "pure-declaration",
  "reason": "仅生成声明，不包含可执行业务行为",
  "approval_ref": "REQ-001 / approved design decision",
  "alternative_validation": "编译、Schema/序列化或配置加载验证",
  "validation_command": "<项目已有的确定性验证命令>",
  "source_refs": ["<稳定来源>"]
}
```

`reason_code`、`approval_ref`、`alternative_validation`、`validation_command` 和 `source_refs` 均为必填。该文件只能由 I13 传感器验证后产生 `not_applicable`，不得用 handoff、计划或自然语言代替。

## 来源基线规则

### 产品行为基线

I7 的 Gherkin 是产品语义唯一基线：
- 原样复制到“来源溯源”段，不得改写；
- 宽泛、矛盾或无法追溯需求时回退 I7 澄清；
- 技术不可行时标记 `blocked` 并提交回执，不得私自降低期望；
- 后续语义变化必须走 CR。

### 技术风险基线

技术用例可来源于已批准的 NFR、CR、应用设计或系统基线，必须使用稳定 `source_ref`。技术用例只验证风险和工程行为，不得引入新的产品语义；来源不明确时先询问，不得虚构预期。

## 产物路径与组织

路径：`docs/aidlc/modules/{module-id}/inception/application-design/test-cases/`。`{module-id}` 必须取当前 directive 的 `module_id`，不得读取或写入其他模块目录。

- 用例不超过 20 个时，推荐每个场景一个 `UC-D-{编号}-{名称}.md`。
- 用例较多或同源强耦合时，可按故事、契约、配置或一致性场景聚合，内部仍以独立 UC-D 分隔。
- 首次派生确定组织方式后保持一致。

## 用例格式

```markdown
---
id: UC-D-{编号}
title: {可验证行为}
source_ref: {US/NFR/CR/契约/配置/一致性场景的稳定引用}
story_ref: {产品用例必填；技术用例不适用}
scenario_ref: {产品 Gherkin 场景或技术场景标识}
type: {unit/api/e2e/contract/integration/resilience/configuration/migration}
priority: {P0/P1/P2}
status: {ready/blocked/deprecated}
service_ids: [{受影响服务；非分布式项目写不适用}]
tdd_mode: {new/characterization}        # 可选，默认 new
code_refs:                              # 仅 characterization 必填，new 不得填写
  - {项目相对路径}[::{符号}]
reason: {仅 characterization 必填：为什么给存量行为补回归保护}
approval_ref: {仅 characterization 必填：批准依据}
unit_refs: [{unit-id}, ...]              # 可选（4.8.0）：所属单元；同一模块要么全部声明，要么全部不声明
defect_ref: {bug ticket 或缺陷 REQ 标识}  # 可选（4.13.2/MARS-112）：仅 bugfix scope 的 new UC-D 需要，锚定复现缺陷的追溯身份
---

# UC-D-{编号} {标题}

## 来源溯源
{产品用例原样复制 Gherkin；技术用例引用批准产物并摘要不可变预期}

## 执行锚点
- endpoint/page/topic/config/migration: {实际锚点}
- environment: {所需环境}
- auth: {认证要求或不适用}
- preconditions: {前置数据、版本和依赖状态}

## 执行步骤与断言
| # | 步骤 | 断言 |
|---|------|------|

## 覆盖映射
- {来源条件/风险} → 步骤 {N} → 断言 {N}

## 证据要求
- {项目现有命令、CI 任务、契约平台或测试平台证据类型}

## 派生日志
- 来源、时间、派生者和 CR 变更记录
```

## 用例声明与计数

- 每个 UC-D 以**自己的用例文件**为准：用例文件 frontmatter（`---` 包围、含 `id: UC-D-xxx` 的块）中的 `status` 决定是否 ready；聚合文件可包含多个这样的块。没有 frontmatter 块的用例文件，按文件名中的 UC-D 编号认定，并读取正文中的 `status:` 行。
- `_index.md` 只是索引，其中的 `status: ready` 不参与计数；只在 `_index.md` 中出现、没有自己用例文件的 UC-D 视为未 ready。
- 同一 UC-D 在多个用例文件（或块）中声明会被拒绝。

## TDD 模式（`tdd_mode`）

| 取值 | 含义 | 字段要求 |
|------|------|----------|
| `new`（默认） | 新行为，严格 RED→GREEN | 不得写 `code_refs`、`reason`、`approval_ref` |
| `characterization` | 为基线中已存在的行为补回归保护（BASELINE→GREEN） | 必须写非空 `code_refs`、`reason`、`approval_ref` |

```yaml
---
id: UC-D-003
status: ready
source_ref: REQ-002
tdd_mode: characterization
code_refs:
  - app/exporter.py::export_orders
reason: 补齐导出现有分页行为的回归保护，重构前锁定
approval_ref: REVIEW-2026-10-01-01
---
```

- `tdd_mode`、`code_refs`、`reason`、`approval_ref` 只能写在 frontmatter 中。
- `code_refs` 每项格式 `<项目相对路径>[::<符号>]`：`\` 与 `/` 均可；拒绝绝对路径、盘符、UNC、`.`/`..` 段、控制面目录与符号链接；路径必须落在源码根之内（module-manifest `paths` → `.aidlc/source-roots.json` → 默认 `src`）。
- I13 用工作流基线（`orchestrate baseline`；模块子工作流使用父工作流的基线）校验：文件在基线中存在且是普通文件；写了符号的，符号须作为完整标识符出现在基线版本的文件文本中（文本匹配，不做 AST 解析）。
- 使用 characterization 需要 git 仓库与已登记、仍可从 HEAD 到达的基线；存量工作流先执行 `orchestrate baseline --set`。
- I13 始终绑定基线链的第 0 代（4.7.0）：多单元依次改动共享 code ref 时，用 `orchestrate baseline --advance <上一单元 GREEN 的 commit>` 追加一代，后续单元的 BASELINE 在新一代上观察；I13 不需要因推进而刷新。
- `bugfix` 至少要有 1 条 `new`（复现 bug）；`refactor` 至少要有 1 条 `characterization`（锚定存量行为的基线），可以全部为 characterization。

## 轻量 scope 的追溯锚点（`defect_ref`，4.13.2 / MARS-112）

`bugfix` / `refactor` 走 8 阶段路径、不经 `requirements-analysis`，没有 `requirements.md` 作 REQ 追溯根。`traceability-matrix` 门禁不再对它们盲判 `not_applicable`，而是改验各自的轻量来源锚点：

- `bugfix`：至少一个 `tdd_mode: new` 的 UC-D 要在 frontmatter 声明 `defect_ref`（bug ticket 或缺陷 REQ 标识，如 `BUG-123`、`REQ-DEFECT-7`，单个清洁 token：字母数字与 `. _ - /`），把复现缺陷的 UC-D 锚定到可追溯的缺陷身份。到 `code-generation` 阶段起，交付源码必须至少引用一个该锚点（否则记 `ANCHOR_UNREFERENCED@code_refs`）；缺锚点记 `ANCHOR_MISSING@defect_ref`。`defect_ref` 只能写在 frontmatter，I13 证据以 `defect_refs` 记录。
- `refactor`：至少一个 `tdd_mode: characterization` 的 UC-D 要声明非空 `code_refs`（上面已要求的 baseline 锚点），追溯锚定到存量代码基线；缺则记 `ANCHOR_MISSING@code_refs`。
- 其他 scope 在没有 `requirements.md` 时仍为 `not_applicable`，行为不变。

```yaml
---
id: UC-D-001
status: ready
source_ref: BUG-123
tdd_mode: new
defect_ref: BUG-123          # bugfix：锚定复现缺陷的追溯身份，交付源码须引用它
---
```

## 所属单元（`unit_refs`，4.8.0）

一个模块拆成多个 unit 时，用 `unit_refs` 声明每个 UC-D 属于哪些 unit。声明后，各 unit 的 tdd / code-generation 只覆盖本单元的 UC-D：RED、BASELINE、GREEN 的 `uc_mapping`、BASELINE 的 `code_ref_digests`、test-quality、追溯矩阵 tests 层和功能设计都只看本单元子集。

```yaml
---
id: UC-D-003
status: ready
source_ref: REQ-002
tdd_mode: new
unit_refs: [u1, u2]          # 跨单元：u1 和 u2 的 GREEN 都必须覆盖它
---
```

- 可选字段，和 `tdd_mode` 一样只能写在 frontmatter；写在正文会被拒绝。
- 取值必须是非空列表，不得重复，每个 unit-id 都必须是本模块 `unit-manifest.json` 中已有的 unit。
- 同一模块内只要有一个 UC-D 写了 `unit_refs`，**全部** UC-D 都必须写，否则拒绝并列出缺失的 UC-D。
- I13 证据在有声明时输出 `ucd_units: { "<UC-D>": ["<unit-id>", ...] }`；全部不写时不输出该字段，行为与 4.7.1 相同（每个 unit 都覆盖模块全集）。
- 模块收口时对账：build-and-test 的 test-quality 和 split 布局的集成屏障（`ucd-coverage:<module>`）要求每个 UC-D 都出现在其 `unit_refs` 中**每个** unit 的 GREEN `uc_mapping` 里，缺一项即失败。

### 不含 UC-D 的单元（`ucd_exemption`）

契约类等不含业务行为的 unit 不被任何 `unit_refs` 指向时，必须在 `unit-manifest.json` 的该 unit 下声明结构化豁免：

```json
{
  "unit_id": "u3",
  "name": "订单契约",
  "service_id": "trade-service",
  "ucd_exemption": {
    "reason_code": "pure-declaration",
    "reason": "只声明跨单元契约，不含业务行为",
    "approval_ref": "REVIEW-2026-10-05-02",
    "alternative_validation": "契约结构校验",
    "validation_command": ["node", "tests/validate_contract.cjs"]
  }
}
```

`reason_code` 取值同 `non-applicable.json`；`validation_command` 是 argv 数组（不经 shell）。受控 producer 先执行该命令，退出码为 0 才写 RED / BASELINE / GREEN 的 `not_required`（`ucd_ids: []`），门禁复核豁免字段与命令摘要。子集为空却没有豁免时拒绝；子集非空时 GREEN 不得为 `not_required`。

## 用例类型

| type | 用途 | 典型消费位置 |
|------|------|--------------|
| `unit` | 单一逻辑规则 | 单元 TDD |
| `api` | 单接口行为 | TDD 或 C8 |
| `e2e` | 用户跨页面/端到端行为 | C8 |
| `contract` | 提供方与消费者兼容性 | C8 契约验证 |
| `integration` | 跨服务、消息或外部系统协作 | C8 集成验证 |
| `resilience` | 超时、重复、乱序、降级、恢复 | C8 故障验证 |
| `configuration` | 配置绑定、刷新、版本组合与回滚 | C8 配置验证 |
| `migration` | 数据或接口迁移、版本并存与回退 | C8 迁移验证 |

测试工具必须来自项目现有配置或经用户确认，不得因派生用例擅自引入框架。

## 技术用例触发矩阵

按实际风险加载通用规则并派生：

| 风险来源 | 至少覆盖 |
|----------|----------|
| 契约变化 | 提供方、每个受影响消费者、兼容与破坏性路径 |
| 共享/远程配置 | 绑定、缺失/非法值、刷新或重启、新旧版本组合、回滚 |
| 跨边界写入 | 幂等、重复、乱序、局部失败、补偿、恢复和对账 |
| 外部系统 | 超时、重复回调、不可用、恢复和责任边界 |
| 数据迁移 | 前向、回退、部分执行、版本并存和数据校验 |

不存在对应风险时不创建该类用例。

## 执行流程

1. 收集产品 Gherkin 与已批准技术风险来源，建立 `source_ref` 清单。
2. 对每个来源派生至少一个可执行用例；一个来源有多个独立失败模式时分别派生。
3. 填写实际执行锚点、受影响服务、前置版本与断言。
4. 自检覆盖性、锚点、来源一致性和技术可行性。
5. 无法执行的用例标记 `blocked`，记录约束、建议和需要的用户决策。
6. 生成 `_index.md`，列出用例、来源、类型、服务、状态和证据位置。
7. 将用例 ID 映射到 RED、GREEN、代码审查和构建测试证据；无可执行业务行为时，将结构化豁免映射到确定性替代验证并直接记录到 handoff.md 与构建测试矩阵。

## 强制字段

所有用例必须有 `id / source_ref / scenario_ref / type / status / service_ids / 覆盖映射`。产品用例额外强制 `story_ref` 和原样 Gherkin；缺任一必需字段即阻断。

## 派生自检

- [ ] 每个产品 Gherkin 场景至少有一个 UC-D
- [ ] 每个已批准高风险技术场景有对应 UC-D 或明确不适用依据
- [ ] 每个用例有真实执行锚点和可验证断言
- [ ] 产品语义未被技术用例覆盖或改写
- [ ] blocked 用例已进入 `_index.md` 待决策清单
- [ ] ready 用例已映射到单元与 Construction 证据要求

## 禁止行为

- 不改写产品 Gherkin 语义；
- 不用技术用例引入未经批准的业务行为；
- 不把文档审阅写成实际执行通过；
- 不隐藏 blocked、未验证或外部环境依赖；
- 不因工具缺失删除高风险用例。
