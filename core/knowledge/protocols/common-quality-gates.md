# 质量门禁

**目的**：用与当前步骤、技术栈和已确认需求匹配的证据阻止缺陷流入下一阶段。门禁不适用项必须记录依据，不能伪造通过。

## 通用执行规则

1. 只加载当前阶段和已触发风险的检查项。
2. 每项记录 `通过 / 失败 / 不适用 / 未验证` 及证据位置。
3. 任一必需项失败或未验证时阻断；修复后重跑受影响检查。
4. 不得擅自引入工具、改变需求、关闭检查或删除失败测试。
5. 技术栈专属项仅在检测到可靠证据时加载；项目现有规范优先。
6. state.md 保存结论和证据索引，详细结果留在阶段报告或外部平台。
7. Hook 只可作为可选提醒，不能证明语义一致性、替代本文件检查或作为任何门禁通过证据；未安装或未触发不得降低门禁要求。
8. 上游产品语义变化后，依赖旧语义的审查、设计、测试用例、代码和验证证据立即失效；完成受影响重审前不得继续使用旧通过结论。

## Inception 门禁

### 工作区与基线

- [ ] state.md 已创建或恢复，项目、协作、架构、审批模式和复杂度已记录
- [ ] 现有代码、技术栈、真实构建/测试入口和 AI-DLC 产物状态已识别
- [ ] 分布式能力已按证据记录；适用时系统基线路径、代码版本和新鲜度有效
- [ ] 服务、运行时消费者、外部系统和数据 Owner 的未知项未被假设填补

### 需求、故事与设计

- [ ] 需求范围、约束和验收标准明确且可验证
- [ ] 需求审查通过；存量项目与逆向产物及系统基线一致
- [ ] 产品故事覆盖需求；技术风险有批准的 NFR/CR/设计来源
- [ ] 应用设计定义适用的边界、契约、配置、数据和一致性行为
- [ ] UI 设计（如执行）与需求、故事一致
- [ ] UI、需求与故事之间无未决语义冲突；存在差异时已有用户明确选择基准、完整影响记录和受影响重审证据
- [ ] I10 未使用 Hook 输出替代交叉验证报告或用户冲突决策
- [ ] html-mock 模式的 `{端}-page-specs.md` 与 mock-box 页面名称、类型、关联 US 一一对应
- [ ] figma 模式已按 `inception-cross-validation.md` 产出逐 Frame 的 F1-F4 可复现证据表
- [ ] UI 审查结论基于可定位的产物和工具证据，未使用百分比估算或"看起来一致"等主观判断

### 场景与 PRD 门禁

| 门禁 | 触发时机 | 阻断条件 |
|------|----------|----------|
| 业务流程图完整性 | I5 完成 | `business-flows.md` 缺失，或 FR 未映射到流程节点、分支或经批准的文字/表格步骤；图表适用时缺少 SVG 源语义检查、事实映射、连通性或拆分决策 |
| SVG 源设计契约 | 生成或调整 SVG 源 | 缺少 Blueprinter 设计约束、稳定 ID/端口、方向/连通性检查、图例/分组/图型决策或 Provider Request |
| Provider SVG 验收 | 明确要求预览、渲染或导出 | 缺少源—目标产物追溯、Provider 能力证据或适用结构/几何/语义/视觉验收记录 |
| 状态流转判定 | I5 完成 | 命中触发信号但无状态图，或无显式判定记录 |
| 角色权限矩阵完整性 | I7 完成 | 矩阵缺失，或 `无权表现` 列存在空值，或角色无矩阵条目，或权限不适用 FR 缺少确认记录 |
| PRD 自审清单 | I15 完成 | `product-prd-generation.md` 自审清单任一项未通过，或 `prd-completeness` evidence 缺失/失败 |
| `prd-completeness` | prd-generation | PRD 章节、功能验收、非目标、待确认项、来源索引或一致性证据不完整 |
| `diagram-contract` | requirements-methods, application-design | SVG 源 ID/端口/方向/图例/分组/viewBox/FR 映射不完整 |
| `design-intent-coverage` | units-generation | 设计意图未被工作单元承接，或存在未覆盖意图 |

### 契约、配置与工作单元（条件）

- [ ] 跨边界契约有权威来源、兼容性结论和逐消费者状态
- [ ] 共享/远程配置有作用域、生效方式、消费者反向索引和回滚组合
- [ ] 跨数据所有权流程有业务不变量、幂等、补偿、对账和故障场景
- [ ] UC-D 覆盖产品 Gherkin 及已批准高风险技术场景
- [ ] 每个工作单元有服务归属、允许修改范围、依赖和验证检查点
- [ ] 设计意图覆盖检查通过：I12 产物中所有 `[意图:*]` 标记条目均被至少一个工作单元的完成证据或允许修改范围覆盖；无标记时已记录跳过
- [ ] Construction 入场条件已满足或有经审批的跳过记录

## Construction 门禁

### Evidence 协议

Construction 各 sensor 验证的证据必须来自机器执行（CI 脚本、构建工具、自动化测试），而非手写或 agent 直接编辑。引擎从 `.aidlc/evidence/<stage-slug>/<sensor>.json` 读取结构化证据文件，执行以下约束：

| 约束 | 规则 |
|------|------|
| 格式 | 合法 JSON object，必须含 `evidence_version: "1"` |
| 大小 | ≤ 512 KB |
| 时效 | `timestamp` 字段为合法 ISO 日期，≤ 24 小时；超期拒绝，未来时间戳拒绝 |
| 来源 | 由受控 evidence producer（CI 脚本、构建工具、测试 runner）写入；禁止 Agent 直接编辑通过证据 |
| 完整性 | 每个字段按 sensor schema 严格校验；缺失、类型不匹配或值异常均阻断 |

证据文件路径约定：`.aidlc/evidence/<stage-slug>/<sensor-name>.json`

`build-test-evidence` 的标准 Producer 入口为 `loeyae-aidlc evidence run --stage build-and-test`。它只读取业务项目 `.aidlc/evidence-commands.json` 中的 argv allowlist，使用 `shell: false` 执行 `build`、`test` 和 `check` 命令，采集真实退出码、耗时和测试输出，记录源 revision 与配置 artifact 的 SHA-256，并通过同目录临时文件加 rename 原子写入。任一命令失败、测试统计无法解析、artifact 缺失或配置越界时 fail-closed，既不生成通过证据，也不更新 state/audit。

其他语义 sensor 使用同一入口并显式传入 `--sensor <sensor>`，allowlist 中必须存在唯一的 `role: "semantic"` 命令。该 checker 必须以退出码 0 在 stdout 返回一个 JSON object，只提供 sensor-specific 字段；`evidence_version`、`timestamp`、`producer`、`source_revision` 和 `checker` 由 Producer 注入，禁止 checker 伪造。引擎随后仍执行对应 sensor 的完整 schema 校验；checker 失败、输出非 JSON、输出包含受控字段或缺少 status 时不写 evidence。

### Construction Sensors 一览

| Sensor | 适用 Stage | 触发条件 | 阻断语义 |
|--------|-----------|----------|----------|
| `functional-design-completeness` | functional-design | 始终 | 数据源验证未通过、存在未解决歧义、用例未覆盖、接口未指定、错误处理未定义 |
| `nfr-coverage` | nfr-requirements, nfr-design | condition: has_nfr_needs | NFR 未全部覆盖、缺少验收标准或度量方法、任何 nfr_item.verified≠true |
| `infrastructure-completeness` | infrastructure-design | condition: has_infra_needs | 缺少 deployment/resources/migration/rollback/runtime_dependencies 任一小节、资源未枚举或未 provisioned |
| `contract-baseline` | shared-contract-baseline | condition: has_contract_dependencies | 契约未 verified、缺少 owner/consumers/schema_hash、validation 未通过 |
| `doc-cascade` | code-generation, functional-design, build-and-test, nfr-design, implementation-report | 始终 | 设计文档未引用上游产物、代码阶段缺少 functional-design、测试未对应源文件 |
| `test-quality` | tdd | 始终 | tests_failed≠0、未观测 green、TDD red-green 循环无证据且无豁免、UC-D 追踪不完整 |
| `review-evidence` | code-review | 始终 | 审查未通过(spec_axis/standards_axis)、存在未关闭 issue、缺少 reviewer 身份、files_reviewed 为空 |
| `reviewer-required` | code-review | 始终 | produces 中不含审查记录文件 |
| `build-test-evidence` | build-and-test | 始终 | 构建命令 exit_code≠0、测试 failed>0 或 total<1、静态检查 checks.status≠passed |
| `implementation-report` | implementation-report | 始终 | 证据引用指向不存在的文件、all_gates_passed≠true、scope/stages_completed 缺失 |
| `frontend-platform-spec` | ui-implementation-bridge | 适用跨端项目 | layout_primitives、component_mapping 或 css_constraints 不完整 |
| `framework-compliance` | loeyae-compliance | condition: is_loeyae_boot | skills 未加载、检查失败或无有效检查 |
| `subagent-evidence` | subagent-execution | condition: has_subagent_support | agent/task evidence 缺失或存在失败 |
| `template-completeness` | build-and-test-templates | 始终 | 模板清单为空或存在未解决项 |
| `recovery-evidence` | compact-recovery | condition: context_compacted | state 未恢复或交接未记录 |
| `ui-design-alignment` | code-review | 始终 | HTML Mock/Figma 页面或组件未映射、存在多余 UI、样式/可见性/平台约束不一致 |
| `no-todo` | 含 produces 声明的 stage | 始终 | produces 文件中发现 TODO/FIXME/HACK 关键词 |
| `traceability` | 含 produces 声明的 stage | 始终 | produces 文件中无需求 ID（REQ-xxx 或 R-xxx） |

### 审批原则

- **仅 2 个 stage 保留 `approval: block`**：`application-design`（架构决策）和 `operations`（部署决策）
- 其余 44 个 stage 门禁通过即自动推进（`notify` 级别仅做通知，不阻断流程）
- 门禁（requires + produces + sensors）负责质量保证，取代了人工审批的质量验证职责

### 单元实现

- [ ] 每项实现可追溯到需求、故事、技术用例或已批准 CR
- [ ] TDD 存在实际 RED 和 GREEN 证据（`test-quality` sensor 验证 `red_seen` + `green_seen`）
- [ ] 无未批准功能、需求简化、TODO、FIXME 或空实现（`no-todo` sensor 自动扫描 produces 文件）
- [ ] 规格审查先于质量审查，失败项已修复并重审（`review-evidence` sensor 验证双轴通过）
- [ ] 修改未越过工作单元服务归属和允许范围
- [ ] 当前单元的构建依赖与运行时影响域测试实际通过（`build-test-evidence` sensor 验证退出码和测试计数）
- [ ] 无受上游语义变化影响但仍标记为完成的单元；所有 `rework_required` 单元已完成受影响步骤和重新验证
- [ ] 代码中外部数据源字段引用与 C1 字段映射表或实际源码/契约定义一致（`functional-design-completeness` sensor 验证 `data_source_validation`）
- [ ] UC-D 用例到测试方法的映射完整（`test-quality` sensor 验证 `uc_mapping` + `traceability_complete`）

### 跨边界与安全（条件）

- [ ] 契约兼容检查与每个受影响消费者验证通过（`contract-baseline` sensor 验证 consumers + validation_status）
- [ ] 配置绑定、缺失/非法值、刷新/重启、版本组合和回滚已验证
- [ ] 幂等、重复、乱序、部分失败、补偿、恢复和对账按风险执行
- [ ] 外部系统超时、不可用和恢复行为有证据
- [ ] 输入、权限、敏感数据、错误处理与日志满足项目规范
- [ ] 数据迁移、部署顺序和版本并存与计划一致

具体安全、前端、测试、数据库及框架检查按适用 steering 加载，不对其他技术栈套用。

### 实际构建和测试

- [ ] 所有必要组件实际构建成功，记录命令、工作目录和退出码（`build-test-evidence` sensor 校验 `commands[].exit_code == 0`）
- [ ] 适用 lint、类型、静态和安全检查实际通过（`build-test-evidence` sensor 校验 `checks.status == "passed"`）
- [ ] 测试范围同时覆盖构建依赖和运行时依赖闭包（`build-test-evidence` sensor 校验 `tests.total >= 1` + `tests.failed == 0`）
- [ ] 条件契约、集成、E2E、故障、配置、性能或迁移测试已执行，或记录不适用依据
- [ ] UC-D→执行范围→C8 证据映射完整，所有 ready 用例已进入执行矩阵
- [ ] 外部证据包含稳定运行标识、不可变代码提交、适用的制品标识/摘要、范围、结果、位置和时间，且与当前验证目标一致
- [ ] `build-and-test-summary.md` 与实施报告包含真实、脱敏、可复现证据

环境阻塞或只有口头结论时标记"未验证"，Construction 不得完全通过。

### 不适用条件的记录

当 stage 的 `condition` 评估为 false 时（如 `has_nfr_needs`、`has_infra_needs`、`has_contract_dependencies`）：
- 引擎自动将该 stage 标记为 `skipped`，下游 `requires` 视其为满足
- 无需手动记录跳过原因——引擎 condition 评估结果即为充分依据
- 下游 stage 的 `doc-cascade` sensor 感知跳过状态，不检查被跳过 stage 的产物
- `implementation-report` sensor 的 `stages_completed` 只计实际执行的 stage，不含 skipped

当检查项本身不适用时（如项目无 NFR 需求），在门禁结果中记录为「不适用」并附依据——但不得伪造通过。

## Operations 门禁（部署准备）

- [ ] 只生成用户确认目标所需配置，无多余平台文件
- [ ] 无硬编码密钥、私有绝对路径或未经确认的生产自动发布
- [ ] 健康检查、资源、迁移、smoke test、版本顺序和回滚与计划匹配
- [ ] 适用配置已执行语法、渲染、dry-run 或静态验证
- [ ] `deployment-guide.md` 可从 Construction 已验证制品和证据开始执行

工具不可用时标记"未验证"并给出项目真实命令，不得宣称完全通过。

## 结果格式

```markdown
## 质量门禁结果
| 检查项 | 状态 | 证据/依据 |
|--------|------|-----------|
| {检查项} | 通过/失败/不适用/未验证 | {命令、文件、运行标识或理由} |

结论：通过 / 阻断
```

state.md 至少记录阶段、时间、结论、证据索引和阻断原因。失败后只重跑受影响门禁及其依赖检查。
