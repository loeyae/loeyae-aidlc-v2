# AI-DLC 主工作流路由

> 本文件只定义阶段路由、执行条件、审批级别和按需加载入口。步骤详情由对应 steering 文件定义。

## 强制规则

1. 使用简体中文交互，并称呼用户为 Boss。
2. 不确定时先提一个关键问题，不得用假设代替澄清。
3. 禁止 TODO、FIXME、空实现和未经验证的完成声明。
4. 每步先由 `orchestrate report` 更新签名机器状态 `docs/aidlc/aidlc-state.json`，再按 `common-step-completion-protocol.md` 派生更新 `docs/aidlc/handoff.md`。
5. 下一步说明必须附可直接复制的执行提示词。

## 审批模式

| 模式 | 等待规则 | 适用场景 |
|------|----------|----------|
| 严格 | 🔴、🟡均等待 | 团队协作、高风险项目 |
| 标准（默认） | 仅🔴等待 | 单人开发、中等复杂度 |
| 自主 | 仅需求确认、架构与安全决策等待 | 低风险迭代 |

团队协作自动使用严格模式；新项目首次 Inception 不得低于标准模式。🟢步骤仅通知，任何模式下均不得跳过其验证。

## 按需加载

| 时机 | 加载文件 |
|------|----------|
| 启动 | 本文件；首次启动再加载 `common-welcome-message.md` |
| 配置了 SSOT 连接时 | `common-ssot-integration.md` |
| I3 场景分析与模块映射 | `product-scenario-module-mapping.md` |
| 用户选择产出 PRD 或独立生成 PRD | `product-prd-generation.md` |
| I9 选择 Figma 模式 | `inception-ui-figma.md` |
| handoff.md `UI 设计方式` 为 `figma` | `common-figma-design-standards.md` |
| 工作区检测后 | `common-complexity-assessment.md` |
| 恢复会话 | `common-session-continuity.md` |
| 变更请求 | `common-workflow-changes.md` + `change-request-process.md` |
| 进入步骤 | 路由表指定文件 |
| 创建文件 | `common-content-validation.md` |
| 执行门禁 | `common-quality-gates.md` |
| 生成澄清问题或分析用户回答 | `common-overconfidence-prevention.md` |
| 声明完成、验证结果，或出现跳步与合理化倾向 | `common-persuasion-defense.md` |
| 多模块项目执行审计、自检、交叉验证或批量修复 | `common-module-scope-guard.md` |
| TDD、构建测试 | `common-test-execution-strategy.md` |
| 存量分布式系统 | 按需加载 `common-runtime-dependency-analysis.md`、`common-contract-governance.md`、`common-configuration-governance.md`、`common-distributed-consistency.md` |
| 创建或优化文档且需要新图表时 | `common-diagram-design-standards.md`；默认 Mermaid 时再加载 `common-mermaid-diagram-standards.md` + `common-mermaid-syntax-rules.md` |
| 用户明确要求 SVG、目标文档已有有效 SVG 引用，或阶段契约明确要求 SVG 时 | `common-diagram-design-standards.md` + `common-svg-diagram-standards.md` |
| 执行 SVG 源级、几何或目标环境验证时 | `common-diagram-validation-standards.md` + `common-svg-diagram-standards.md` |
| 检测到技术栈证据 | 按 handoff.md 加载对应的 `common-tech-*` 条件适配 |

禁止启动时预加载全部规则。目录、审计、协作、提问和交接分别按 `common-directory-structure.md`、`common-audit-logging.md`、`common-team-collaboration.md`、`common-question-format-guide.md`、`common-session-handoff.md` 按需加载。

规则中出现的 `aidlc-*` 能力调用只是平台入口。当前宿主未独立发现随附的 capability Skill 时，直接加载本分发中的 `skills/<capability>/SKILL.md` 及其引用规则执行，输入要求、输出内容和质量门禁均不变。能力入口缺失不构成跳过步骤的理由。

## 文档图表格式决策（强制）

创建或优化 Markdown 及其他文档产物时，必须先读取目标文档并在生成图表前按以下优先级确定格式：

1. 用户明确指定 Mermaid 或 SVG 时，使用用户指定格式；
2. 用户未指定且目标文档已经通过有效 Markdown/HTML 引用使用 SVG 时，延续 SVG；同目录存在未引用的 `.svg` 文件不构成依据；
3. 阶段的 `produces`、sensor 或目标产物契约明确要求 SVG 时，将其视为显式 SVG 要求；
4. 其余文档创建或优化场景默认选择 `mermaid`，以目标 Markdown 内的 fenced block 交付。

格式一经确定不得因生成、解析或 Provider 失败而静默切换。需要变更格式时，必须重新满足上述优先级或取得用户明确指示。Mermaid 模式不得额外生成 `.svg`、`.diagram.json`、expected contract 或 Provider Request；SVG 模式不得用 Mermaid 代码块冒充 SVG 门禁产物。

## Diagram Invocation Protocol

1. Phase 先判断是否需要图——复杂结构、多组件依赖、分支/循环、多方时序、状态迁移、层级关系、图明显优于文字/表格或用户明确要求时才生成；简单字段列表、两实体简单关系、纯线性步骤或事实不足时使用文字/表格。
2. 按“文档图表格式决策”确定 `output_format`。
3. `output_format: mermaid` 时：
   - 加载 `common-mermaid-diagram-standards.md` 与 `common-mermaid-syntax-rules.md`；
   - 直接在目标 Markdown 中生成或优化 `mermaid` fenced block，保持相邻正文为业务事实来源；
   - 使用项目已具备的 Mermaid parser/CLI 执行真实语法解析；能力不可用时明确记录“未执行真实语法解析”，不得伪造通过或静默安装工具；
   - 不调用仅处理 SVG 的 `aidlc-diagram-design` Capability。
4. `output_format: svg` 时，Phase 准备 Diagram Request 并调用 `aidlc-diagram-design`：
   - `source/context`：当前 Phase 已确认的语义上下文；
   - `diagram intent`：这张图帮助读者理解什么（一句话）；
   - `approved facts`：已确认的组件、实体、关系和规则；
   - `target artifact`：图所服务的目标 Markdown 路径；
   - `diagram_type`：默认 `auto`；
   - `output_format`：固定为 `svg`；
   - `target_operations`：用户或目标产物实际要求的 `source-only`、`preview`、`render`、`export`；
   - `target_reading_environment` 与 `constraints`：仅在有明确事实时传入。
5. SVG Result 包含 SVG 源路径、可选 `.diagram.json`、Provider Request、Design Notes、Validation 和 Delivery Status。只有外部 Provider 实际返回目标产物并提供证据时，才能声明预览、渲染或导出完成；无 Provider 时将目标几何/视觉标为 `UNVERIFIED`，明确要求目标操作但能力缺失时返回 `NEEDS_CAPABILITY`。

每张具有不同语义目的的图独立处理。Phase 不得重复定义图型语义，也不得把一种格式的检查结果当作另一种格式的验收证据。

## 意图路由

工作区检测后读取 `handoff.md` 并按下表路由；无法唯一判断时询问用户。

| 意图 | 判定 | 路由 |
|------|------|------|
| 继续开发 | 继续、恢复、接着做 | `common-session-continuity.md` |
| 缺陷修复 | 修复已批准需求/故事/契约中的错误实现，不改变产品语义 | 受影响 Construction 步骤（不进入 CR） |
| 无行为重构 | 不改变外部行为，仅改善内部结构 | 受影响 Construction 步骤 + 影响域验证（不进入 CR） |
| 在途产品协调 | 需求、故事、UI 或设计存在差异，且受影响范围尚无代码基线 | `common-workflow-changes.md`（用户裁决、就地协调、受影响步骤重审） |
| 业务方 PRD 评审意见回流 | PRD 已发出且业务方提出内容变更 | 无代码基线按 `common-workflow-changes.md` 协调后通过 `product-prd-generation.md` Patch 模式更新 PRD；有代码基线按 CR1-CR5 |
| 需求/契约变更 | 改变已有代码基线的行为、验收标准、接口契约或数据语义 | CR1-CR5（PR 模型） |
| 合并历史 CR | 合并历史CR文档、清理遗留CR文件 | `change-request-process.md` §历史CR文档批量合并 |
| 压缩 state | 压缩state、精简state | `inception-state-template.md` §handoff.md 压缩规则 |
| 新增功能 | 新功能且现有产物中不存在 | Inception 追加模式 |
| 生成 PRD | 生成PRD、写PRD、产品需求文档 | `product-prd-generation.md` |
| 新项目 | 无 handoff.md | Inception |

## Inception 路由

> 目标：确认开发什么、为什么开发以及如何验收。具体方法、产物和回退规则均在加载文件中定义。

| # | 步骤 | 条件 | 审批 | 加载文件 |
|---|------|------|------|----------|
| I1 | 工作区检测 | 始终 | 🟢 | `inception-workspace-detection.md` + `common-complexity-assessment.md` |
| I2 | 产品级 Inception | 多模块且尚未完成 | 🔴 | `product-inception.md` + `product-module-division.md` + `product-contracts.md` |
| I3 | 场景分析与模块映射 | 始终 | 🔴 | `product-inception.md` + `product-scenario-module-mapping.md` |
| I4 | 逆向工程 | 存量项目且无有效逆向产物 | 🟡 | `inception-reverse-engineering.md` |
| I5 | 需求分析 | 标准/完整流程 | 🔴 | `inception-requirements-analysis.md` |
| I6 | 需求审查 | I5 完成 | 🔴 | `inception-cross-validation.md`（a/b） |
| I7 | 用户故事 | 已生成需求文档 | 🔴 | `inception-user-stories.md` |
| I8 | 用户故事审查 | I7 完成 | 🔴 | `inception-cross-validation.md`（c/d） |
| I9 | UI 设计 | 用户选择且存在界面需求 | 🔴 | `inception-ui-mock.md`（路由入口）→ Figma 模式加载 `inception-ui-figma.md` |
| I10 | UI 设计审查 | I9 已执行 | 🔴 | `inception-cross-validation.md`（e） |
| I15 | PRD 生成 | 用户选择产出 PRD | 🔴 | `product-prd-generation.md` |
| I16 | PRD 审查 | I15 已执行且用户要求审查 | 🔴 | `inception-cross-validation.md`（g） |
| I11 | 工作流规划 | 标准/完整流程，且（未选择产出 PRD 或 I16 已通过） | 🔴 | `inception-workflow-planning.md` |
| I12 | 应用设计 | 新接口、跨模块/服务、多端、复杂业务规则，或契约/共享配置/迁移/一致性/外部故障行为变化 | 🟡 | `inception-application-design.md` |
| I13 | 测试用例派生 | 产品用例具备 I7+I12；或技术用例具备已批准风险来源与可执行锚点 | 🟡 | `test-case-derivation.md` |
| I14 | 单元生成 | 需拆分多个工作单元 | 🟡 | `inception-units-generation.md` |

业务产物门禁完成后，无论此前是否提及 PRD，都必须先询问用户是否产出 PRD，并将“需要 / 不需要”写入 handoff.md。该决策检查点位于 I15 之外：选择“需要”才执行 I15/I16；选择“不需要”则记录跳过依据并直接继续 I11，不创建 PRD 文件或占位目录。

I15 采用独立生成流程（`product-prd-generation.md`），支持 SSOT 优先检索和已有 Inception 产物增强，无硬性前置步骤依赖。I16 为可选审查步骤：用户要求审查时执行。

I15/I16 的执行时机为业务产物门禁完成后、I11 之前，不按编号顺序执行。业务产物门禁完成 = I8 已通过，且执行了 I9 时 I10 也已通过；I9 不适用时记录不适用依据。

PRD 也可独立于 Inception 流程执行：用户直接要求"生成 PRD"时，通过意图路由进入 `product-prd-generation.md`，无需前置 I5-I10。

快速通道的最小需求确认和跳过条件以 `common-complexity-assessment.md` 为准。多模块的模块级产物路径以 `common-directory-structure.md` 为准。

## Construction 入场门禁

若存在新接口、跨模块/服务调用、多端改动、复杂业务规则，或契约、共享配置、数据迁移、一致性、外部故障行为变化，I12 必须完成；若工作量超出单次执行范围、需多个工作单元或跨服务协调，I14 必须完成。缺失时阻断并返回对应 Inception 步骤。

## Construction 路由

> 目标：按单元完成设计、TDD 实现、审查和可复现验证。所有条件阈值由 `common-complexity-assessment.md` 定义。

| # | 步骤 | 条件 | 审批 | 加载文件 |
|---|------|------|------|----------|
| C1 | 功能设计 | 新数据模型或业务规则达到阈值 | 🟡 | `construction-functional-design.md` |
| C2 | NFR 需求 | 明确性能指标或新增安全机制 | 🟡 | `construction-nfr-requirements.md` |
| C3 | NFR 设计 | C2 识别出特殊模式 | 🟡 | `construction-nfr-design.md` |
| C4 | 基础设施设计 | 新基础设施组件或部署架构变更 | 🟡 | `construction-infrastructure-design.md` |
| C5 | TDD 代码生成与自适应审查 | 始终 | 🔴 | `construction-shared-contract-baseline.md`（条件） + `construction-code-generation.md` + `construction-tdd.md` + `construction-code-review.md` + `construction-subagent-execution.md` |
| C6 | 系统化调试 | 出现技术失败 | — | `common-systematic-debugging.md` |
| C7 | 最终全局审查 | 多单元、复杂/高风险，或跨组件/服务、契约、共享配置、数据所有权、安全边界 | 🟢 | `construction-code-review.md` |
| C8 | 实际构建和测试 | 始终；C5 审查通过 + C7 审查通过（触发时） | 🔴 | `construction-build-and-test.md` + `construction-implementation-report.md` |

每个单元必须完成“设计（条件）→ TDD → Spec/Standards 双轴检查 → 影响域验证”；快速通道可在一次集成审查中完成双轴检查，其他路径独立执行两轴审查。C8 未取得实际命令证据时，Construction 不得标记完成。

**C8 硬性前置依赖**：C8 开始前，编排方必须确认每单元审计文件中双轴审查记录存在且通过；C7 触发时还须确认最终全局审查记录通过。缺失审查证据时 C8 不得启动，返回 C5/C7 补齐。详见 `construction-build-and-test.md`“审查证据阻断”章节。

C5 条件前置：存在 `contract` 类型跨单元依赖时，先加载并完成 `construction-shared-contract-baseline.md`；相关基线未 `verified` 时阻断消费者代码生成。单单元或无 `contract` 依赖时记录跳过原因后继续 C5。

## Operations 路由（部署准备，条件）

> 目标：为需要部署的项目生成与已确认目标环境匹配的交付配置和可执行部署说明；不覆盖部署后的生产运营。

| # | 步骤 | 条件 | 审批 | 加载文件 |
|---|------|------|------|----------|
| O1 | 部署需求与目标确认 | 独立服务、需部署或用户明确要求 | 🔴 | `operations-operations.md` |
| O2 | 交付配置生成 | O1 完成 | 🟡 | `operations-operations.md` + `operations-templates.md`（按需） |
| O3 | 配置验证与部署文档 | O2 完成 | 🔴 | `operations-operations.md` + `common-quality-gates.md` |

纯库、纯本地工具或用户明确不需要部署时跳过 Operations，并在 `handoff.md` 记录原因。

## Change Request 路由

> CR 是暂态差异，不是永久档案。正式基线就地更新，Git 历史为唯一长期档案。CR 完成 = 基线已更新 + 暂态文件已删除。变更分流详见 `change-request-process.md`。

| # | 步骤 | 条件 | 审批 | 加载文件 |
|---|------|------|------|----------|
| CR1 | 变更范围定位 | 始终 | 🟢 | `change-request-process.md` |
| CR2 | 影响评估 | 始终 | 🔴 | `change-request-process.md` |
| CR3 | 变更计划 | CR2 已确认 | 🔴 | `change-request-process.md` |
| CR4 | 执行变更与就地基线更新 | CR3 已确认 | 按受影响步骤 | 对应阶段 steering |
| CR5 | 合并门禁与完成 | CR4 完成 | 🟢 | `change-request-process.md` + `inception-cross-validation.md` |

新增功能采用追加模式，从 I5 开始，仅追加受影响产物并对新增/受影响单元执行 Construction。已有代码基线的产品语义或接口契约变化进入 CR；尚无代码基线时就地协调并重审。代码基线与混合成熟度判定见 `change-request-process.md`，在途协调见 `common-workflow-changes.md`。

## 完成标准

| 范围 | 完成条件 |
|------|----------|
| Inception | 必需产物经用户确认，交叉审查通过，执行/跳过决定写入 handoff.md；选择产出 PRD 时 I16 已通过且 PRD 状态不低于 `consistency-checked` |
| Construction | TDD、适用审查、实际构建和测试均有证据且通过；触发 C7 时全局审查通过 |
| Operations | 仅生成选定部署目标需要的文件，配置语法/静态验证通过，部署说明可执行 |
| 会话连续性 | handoff.md、审计与下一步交接一致，可在三平台恢复 |
