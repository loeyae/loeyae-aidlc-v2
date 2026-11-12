# P1 自主实施工程记录

**当前状态（2026-11-11，第 40 节）：Native 有效续验进展与重复控制调用已完成定向修复，入口仍 HOLD。** 捕获的 orders-r12 尾段在原 32 步上限下，旧响应复现停止，新契约可继续，重复回执仍被停止；真实 Core→Gateway、候选提交后的 Native review 门禁以及同阶段合并调度通过。12 个局部测试文件、两个类型检查及构建/分发检查通过；没有新试点、真实模型、H5 或旧 attempt 恢复。完整当前来源 Native/批次汇合和真实交付效率仍未验证，不能据此宣称 P1 全部完成。见[本轮验收](evals/autonomy/p1-10/native-refresh-2026-11-11/acceptance.json)。以下为各轮历史结论。

**当前状态（2026-11-11，第 39 节）：从空实现开始的真实订单试跑失败，P1 收口重新打开，入口 HOLD。** orders-r12 完成 TDD、编码、审查和两次独立功能观察，最终 Native 续验中不同证据刷新成功却未计入语义进展，触发 `no-progress-step-limit`；未完成 C8/最终批次汇合。890.379s 为失败到清理耗时，不是成功交付效率。publish-r16 已从空实现完成准备，但因首项失败未签 H5、未启动。见[本次结果](evals/autonomy/p1-10/fresh-run-2026-11-11/result.json)与[根因证据](evals/autonomy/p1-10/fresh-run-2026-11-11/diagnosis.json)。以下工程通过与收口结论均保留其历史范围，不能替代此次真实失败。

**当前状态（2026-11-11，第 38 节）：剩余工程收口完成，真实试跑保持 HOLD。** 当前冻结来源在 3600s grant / 900s admission / 610s Native 窗口下通过完整 wire/main/worker/Core/Native/候选/委托汇合及两尺寸十组 UI；完整工程耗时 248.448s。复用上一轮 11 个局部测试，新做类型与分发一致性检查，未运行真实模型、新业务试点或 H5。工程预算通过，但没有观察到整链提速，真实模型成功效率仍未验证。见[本次验收](evals/autonomy/p1-10/engineering-close-2026-11-11/acceptance.json)与[分层关闭及停止条件](evals/autonomy/p1-10/engineering-close-2026-11-11/closure.json)。以下“最新状态”均为历史时点。

**最新状态（2026-11-11）：控制与验收成本收缩已整体实施，集中定向检查通过，真实试跑继续 HOLD。** 同一 grant/config 的能力证明配合当前轻量配置复核，时间老化不再重复完整模型探针；Go 以运行依赖判断失效，保留回归来源变化的未验证提示；宿主消除重复选协调阶段、紧随 run 的 inspect 和已验证依赖的重复观察。整组修改后集中执行 11 个测试文件及 5 项类型/构建/分发检查，各一次通过。详见第 37 节和[集中结果](evals/autonomy/p1-10/simplification-2026-11-11/results.json)。以下为各轮历史结论，不代表当前整体交付已通过。

**最新状态：跨层续验契约与验收方法已修正，41 条独立路径及 19 个受影响测试文件通过；当前版本完整发布验证仍开放，保持 HOLD。** Core 与宿主共用 continue/reprobe/stop 判定，能力复用消费实际动作剩余窗口，配置轻检、预检、发布锁、阶段恢复和最终权限准备均核对耗时。本轮只关闭有独立证据的生产子路径，撤回八个故障族可整体沿用为“当前已关闭”的判断；旧 IT-07 成功和 IT-08 失败原文保留。详见第 36 节、[本轮验收索引](evals/autonomy/p1-10/continuation-review-acceptance.json)及[逐族重评](evals/autonomy/p1-10/continuation-review-validation-1794324360185/closure-reassessment.json)。没有真实试跑、新业务工作流、H5 或 P2 恢复。以下“最新状态”为第 35 节的历史时点。

**最新状态：IT-08 已完成审查、两项新工作流准备及订单真实 H5，但首次真实订单运行未通过，已恢复 HOLD。** orders-r11 在 GREEN 前因复用的能力凭据只剩 525675ms、不能覆盖 Native 所需 610000ms 而停止；原 grant 仍余 3200122ms。已只读复现“未过期即可复用”与动作窗口不一致的生产缺口，资源/领取正常对账。publish-r15 未签 H5、未实施；没有重试、恢复或再建工作流。详见第 35 节和 IT-08 验收索引。

此前局部修复记录（当前整体结论以上述 HOLD 为准）：已修复并验证 P1-10 的决策引用/等价重试、长命令准入窗口、生命周期及异常退出对账，详见 [三项阻塞修复记录](evals/autonomy/p1-10/blocker-remediation-2026-11-10.md) 与 [契约第 19 节](aidlc-autonomous-contracts-v1.md#19-p1-10决策写入长命令与宿主失联)。40/40 回归及三个分发检查通过，新的 orders-r10 / publish-r14 已完成 H4 与 H5 前检查，详见第 23 节。历史 r9/r13 结论保留，P1-10 与完整 P1 均未通过；旧发布页失联的具体 OS 触发原因仍未确定，不恢复旧 attempt 或清除其未对账领取。

| 项目 | 内容 |
| --- | --- |
| 日期 | 2026-11-10（Asia/Shanghai）；第 1–22 节保留各阶段历史验证时点 |
| 授权 | 用户已授权修复 IT-07 剩余三个阻塞；本轮修改 Core/宿主交接窗口、工程夹具、测试与记录。不启动真实试跑、不创建新业务试点、不代签 H5、不修改根无关工作流、不恢复旧 attempt |
| 实现基线 | HEAD d2fd48b58c503ecd2e34342a4b7593987e3e625a；package 4.26.3；变更保留在工作区 |
| 当前结论 | P1-01～09 工程实现与验证逐节保留；P1-09 结果与退出见第 20/21 节和对应 verification.json；完整业务试点与 P1 尚未完成 |
| 依据 | [总体设计](aidlc-autonomous-implementation-design.md)、[契约 v1](aidlc-autonomous-contracts-v1.md)、[P0 记录](aidlc-autonomous-implementation-p0.md) |
| 审查 | 当前 [P1-10 阻塞修复 Spec / Standards 复核](evals/autonomy/p1-10/blocker-review-2026-11-10.md)，P1-09 复核保留在原目录；历史审查保留在对应阶段目录 |

第 1–5 节保留 P1-01 当时的实施与验证口径；第 6–7 节为 P1-02；P1-03 增量与当前退出结论见第 8–9 节，各阶段原始日志分别保留。

## 1. 完成的行为

新增 `orchestrate autonomy inspect` 与 `orchestrate autonomy adopt --batch <id> --expect <revision> [--preview]`。未采用时不读取自主来源；普通文档或类似字段不能自动启用。正式采用需要当前 global 项目阶段的有效 session binding，使用既有状态 CAS 锁，并在提交前重新核验来源。预览无需领取、没有 state/audit 或其他文件写入；同一未变化批次的重复采用是幂等读取。

采用记录只扩展现有 global Markdown state/audit：保存契约版本、batch/scope_revision、唯一来源路径、record_digest、scope_digest。普通保存不能替换或删除已采用范围，不引入第二套进度状态。采用后的 `next` 重读范围并附带 `autonomy_scope`；CLI `report` 处理前复核。来源或引用发生变化时拒绝继续，不能少算 AC、UI 或单元。采用前须完成工作流布局选择，采用后拒绝会改变 UnitRef 归属的 split。

读取两种既有来源位置中的唯一 batch：scenario-module-mapping 或 handoff。校验真实场景/AC/UI 定义、本地模块/单元、workflow 归属与摘要、基线、策略/矩阵引用和计划交付物。Markdown 正文提及、代码围栏内示例不作为真实条目定义。json-record-v1 绑定选定 record，追加无关 decision 和重排 JSON 对象键不会误使其失效。

implement/consume/verify 角色明确分开。consume 必须具有版本绑定与非空 evidence 引用；本步只核验文件摘要及 workflow 归属。依赖同时检查已登记的正向闭包、已有 evidence_inputs.depends_on_units，以及 implement 提供者的反向消费者闭包；跨模块消费者也必须有验证 check 或明确排除理由。所有相关依赖采用同一封闭字段校验，不能通过不放入 dependency_refs 来绕过验证。

只读投影保留批次目标、固定分母、各 unit 角色/版本引用、依赖、消费者、基线、policy/matrix、集成责任和交付物。它明确输出 `validation_level=scope-only`、`execution_authorized=false`、`gates_evaluated=false` 及未实施的验证项。

## 2. Core 与宿主边界

| 责任 | 本次实现 |
| --- | --- |
| Core | 解析及校验批次；保存采用身份；CAS、session claim 和提交前复核；范围防漂移；只读投影 |
| 宿主 | 提供当前真实 session binding、读取 directive、调用 CLI；继续使用原生模型与工具执行循环 |
| 本次未新增 | Core Supervisor、宿主持久循环、grant、准入凭据、受控验收 producer、候选整合或运行完成判定 |

未改变既有阶段选择、执行权限、人工审批或质量门禁。P1-01 也不会因为 units 中出现 consume 就放行依赖、因为 ui_refs 为空就认定无 UI，或把 enabled=true 解释为可无人值守实施。

## 3. 文件与契约调整

| 文件 | 调整 |
| --- | --- |
| [aidlc-autonomy.ts](../core/tools/aidlc-autonomy.ts) | 批次读取、引用解析、闭包校验、只读投影和显式采用 CLI |
| [aidlc-autonomy-state.ts](../core/tools/aidlc-autonomy-state.ts) | 独立的快照类型和封闭字段校验，避免状态模块循环依赖 |
| [aidlc-light-state.ts](../core/tools/aidlc-light-state.ts) | global 采用字段解析/渲染；普通保存冻结约束；审计摘要；锁内提交前复核 |
| [aidlc-orchestrate.ts](../core/tools/aidlc-orchestrate.ts) | autonomy 入口，next/report 复核，split 防归属漂移 |
| [CLI](../bin/cli.ts)、[手册](loeyae-aidlc-cli-guide.md) | 命令帮助、读取/采用方法和当前能力边界 |
| [专项测试](../tests/test_autonomy_scope.ts)、package.json、core-test-suites.json | 44 个测试场景；新增 npm 脚本并接入标准 Core 测试清单 |
| dist 下全部 10 个 Harness | 使用既有构建器同步新增 Core 工具和修改文件；逐字节一致性检查通过 |

契约第 3.1.1 节登记实际序列化、摘要及阶段限制；UnitRef 明确使用嵌套 workflow_ref，BatchUnit 补充 evidence_refs。已采用范围目前不支持 supersedes/原地重规划；本地 InputRef 限 repository_id=project；provider 仅本地 UnitRef；stub_policy 仅 denied。以上限制明确拒绝，不退化为默许。

本次未调整需求冲突、委托决策、审批降权、授权签发等规则；这些规则必须等 P1-02/03/09 对应机制实现后一起更新。完成当前代码的分发同步不等于 P1-09 整体完成。

## 4. 验收与真实验证

| P1-01 验收项 | 结果与依据 |
| --- | --- |
| 显式采用，旧模式兼容 | PASS：无 marker 不扫描来源；损坏的未采用来源不影响旧 next 预览；旧 state 往返保持 |
| 单批次固定分母 | PASS：唯一 batch 来源、版本/修订/摘要、场景/AC/UI/交付引用和快照校验；普通保存不能换范围 |
| 单元与依赖闭包 | PASS：三角色、真实 UnitRef、split 归属；正向依赖、跨模块反向消费者与明确排除记录 |
| 非法引用/修订拒绝 | PASS：外部 workflow、悬空条目、未知字段/版本、重复身份、越界/链接路径、内容漂移、陈旧 revision、过期/外来 session |
| 预览及检查无写入 | PASS：专项测试逐文件计算前后摘要；覆盖 CLI preview、inspect、无效输入和采用幂等 |
| 采用后复核 | PASS：CLI next 投影、next/report 对分母漂移拒绝；采用后 split 不改变状态 |

最终验证命令及退出码如下，原始输出位于 `docs/evals/autonomy/p1-01/`。所有表中命令均实际执行，未用本记录签发 AI-DLC evidence 或修改阶段完成状态。

| 命令 | 退出码 | 输出 |
| --- | --- | --- |
| node node_modules/tsx/dist/cli.mjs tests/test_autonomy_scope.ts | 0 | [44 scenarios passed](evals/autonomy/p1-01/autonomy-scope.log) |
| npm run typecheck | 0 | [类型检查](evals/autonomy/p1-01/typecheck.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_audit_state_cache.ts | 0 | [state/registry 缓存](evals/autonomy/p1-01/state-cache.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_mars243_sessions.ts | 0 | [会话、竞争及在途证据](evals/autonomy/p1-01/sessions.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_mars243_layout.ts | 0 | [global/module/integration 布局](evals/autonomy/p1-01/layout.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_delivery_summary.ts | 0 | [只读交付摘要](evals/autonomy/p1-01/delivery-summary.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_mars160_execution_policy.ts | 0 | [既有执行权限](evals/autonomy/p1-01/execution-policy.log) |
| node node_modules/tsx/dist/cli.mjs scripts/build.ts --all | 0 | [10 个 Harness 构建](evals/autonomy/p1-01/build-all.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_distribution_parity.ts | 0 | [2775 文件 / 10 Harness](evals/autonomy/p1-01/distribution-parity.log) |

未运行完整 npm test、实际业务试点或浏览器 UI 验收。早期测试在受限父环境遇到 esbuild spawn EPERM，后续在允许本地子进程的环境运行；未调整用户权限配置。扩充测试时修正过夹具的 session 泄漏及模块身份字段不足；最终日志对应当前实现。审查发现的下游闭包遗漏已修复并补测。

当前活动 workflow 属于 DeepSeek Harness 工作，与本任务无关；没有领取、采用、report、归档或改写该 workflow。state 与 audit 的前后 SHA-256 分别保持 `5e08e34d2e434edf0ab7d2667377080dc0caf06dd8dcfa178b877211c5c93d0f`、`1fa99dba9594b7ee1e2e7ad0d8e72c9b81b87e74f9577879795937b0af998686`。本次测试全部使用独立临时工作流。验证时点、文件摘要与原始日志索引见[验证清单](evals/autonomy/p1-01/verification.json)。

## 5. 退出与后续依赖

P1-01 的工程范围完成，可供 P1-02 和 P1-05 消费范围读取接口及快照。P0 G-01 在本次授权范围内解除，G-02/G-03 保持原条件化结论；P0 的历史验证没有改写为新能力通过。

| 后续项 | 仍需实现/验证 |
| --- | --- |
| P1-02 | 后续已完成策略/决策记录工程范围，详见第 6 节；运行授权和受控业务验收仍在后续任务 |
| P1-03/04 | 真实用户授权、grant 签发和复核、设计/环境/UI 接收准入 |
| P1-05 | 批次范围进入实际写入调度、依赖 capability/readiness/provenance 和共享修改传播 |
| P1-06 | 所选宿主的原生持续驱动、正确终止和预算退出 |
| P1-07/08 | 功能/UI 受控验证、完整验收矩阵、候选版本和批次结果 |
| P1-09/10 | 随上述能力同步规则与分发，执行两个独立内部试点的完整验收 |

现阶段不能据范围校验宣称自主实施准入 ready、依赖 ready、业务 verified 或 P1 整体通过。

## 6. P1-02 自主策略与委托决策

P1-02 已完成读取、校验、记录、结果投影和规则接入。新增 [aidlc-autonomy-policy.ts](../core/tools/aidlc-autonomy-policy.ts)，复用 P1-01 的 ScopeReader 与有界来源校验；不另建业务进度状态，不签发 grant，不修改现有阶段图。

### 6.1 实现与职责

| 项目 | 结果 |
| --- | --- |
| 策略读取 | 从固定 batch.policy_ref 读取已有模块/项目 development-handoff 或轻量 handoff 的唯一 policy；校验完整封闭字段、单批次范围、引用、AuthorityRef、原 AC/UI 保护和允许类别 |
| 条款校验 | 固定 category/fallback 身份、有限 Condition、允许动作和必需 check；冲突的 fallback/source precedence 拒绝；explicit-conflict/out-of-scope 或命中 escalation 的决定拒绝 |
| 需求完整性 | 决策只能影响条款已定义的细化槽位；不得改写 hard/AC/UI/禁止项/条款约束；原始约束必须进入 source_refs，不能用“合理细化”反转明确回答 |
| 决策记录 | autonomy record 使用真实 owner/session；精确 workflow/module/unit claim、既有发布锁、handoff 锁与 SHA-256 CAS；只原子替换 authoring fence，保留其他 records 与外围叙述 |
| 修订 | 新细化使用下一个批次 effective_revision；补实现/验证或首次人类复核仅增加记录 revision，不改选择、策略和验收分母；允许合法后继领取人以本次身份补引用 |
| 结果投影 | autonomy policy/decisions、next/handoff、state summary 返回 policy、决策、有效修订、人类复核统计、记录缺项及 handoff 摘要 |
| 完成保护 | pending 复核不加入 completion_blockers；缺实现、验证、必需 check 或存在复核返工要求会阻止工程完成报告，再继续执行原有质量门禁 |

Core 校验来源、版本、范围、条款身份和记录完整性。宿主负责真实人类输入的定位/真实性，依据已批准策略判断细节适用性，并执行需求完整性的自然语言反向检查、实现和验证。Core 不用关键词猜测新授权，也不能从合法 JSON 证明代码语义无误。

策略、人类复核和运行授权分开：初始策略确认不能复用为事后决策复核；非 pending 复核必须有独立来源、匹配 reviewer、有效 UTC 时间和必要 change/replacement 引用。手写 AuthorityRef 不是身份认证；真实授权签发仍由 P1-03 实现。

### 6.2 规则、契约与兼容

- [契约 v1 第 4.3 节](aidlc-autonomous-contracts-v1.md#43-p1-02-实现契约)明确实际落点、AuthorityRef 序列化、unit_ref/change_class/action、EvidenceRef.check_id、有效修订和受限更新语义。
- common-requirement-integrity、common-workflow-changes、common-session-handoff 和 aidlc-handoff Skill 接入已采用批次的受限委托路径；合法细化不重复请求人类决定，真实冲突、明确回答与 CR 边界继续保留。
- CLI 帮助与[使用手册](loeyae-aidlc-cli-guide.md#自主策略与委托决策p1-02)同步；新增 npm run test:autonomy-policy 并接入标准 Core 测试清单；全部 10 个 Harness 同步 Core、规则与 Skill。
- 未采用的 workflow 不读取这些来源，损坏的未采用文档不影响旧流程。已采用但只有 P1-01 简化 policy 的样本不能绕过新增完整校验；迁移必须使用明确的新 workflow/策略基线，不能手改冻结摘要。
- handoff 的 raw-file 基线、自引用、会被本次改写的 decision 段引用和超过 2 MiB 的输出在发布前拒绝，避免提交后来源立即失效。静态 authoring 记录不作为受控质量证据。

### 6.3 验收与真实验证

| 验收 | 结果 |
| --- | --- |
| 合法细化与兜底可记录、继续 | PASS：category/fallback 正例；next/handoff 保留普通实施路径，不因 pending 要求人工继续 |
| 明确决定不能反转 | PASS：硬约束、AC、越界影响、非授权行为/类别、冲突条款、缺少原约束来源均拒绝 |
| 人类复核与工程状态独立 | PASS：pending 且引用齐全显示 recorded-not-verified；accepted 且缺实现仍 incomplete；修改/否决须真实来源与增量变更引用 |
| 缺实现或验证仍阻塞 | PASS：completion_blockers 保留缺项，CLI build-and-test 完成报告拒绝；任何引用本身都不授予 verified |
| 发布与恢复边界 | PASS：CAS、幂等/preview 零写入、过期/外来 claim、拆分模块归属、共享 handoff 排他锁和自失效保护；不声称进程重启恢复已完成 |

最终验证输出与 source hashes 见[验证清单](evals/autonomy/p1-02/verification.json)。除明确列出的失败构建尝试外，下表均已实际执行并退出 0：

| 命令/检查 | 结果与原始记录 |
| --- | --- |
| node node_modules/tsx/dist/cli.mjs tests/test_autonomy_policy.ts | [55 个场景通过](evals/autonomy/p1-02/autonomy-policy.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_autonomy_scope.ts | [P1-01 的 44 个场景通过](evals/autonomy/p1-02/autonomy-scope.log) |
| npm run typecheck | [通过](evals/autonomy/p1-02/typecheck.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_stage_handoff_prompts.ts | [handoff 回归通过](evals/autonomy/p1-02/handoff.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_delivery_summary.ts | [交付摘要回归通过](evals/autonomy/p1-02/delivery-summary.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_mars243_sessions.ts | [会话/竞争/发布锁回归通过](evals/autonomy/p1-02/sessions.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_mars160_execution_policy.ts | [已有执行权限回归通过](evals/autonomy/p1-02/execution-policy.log) |
| scripts/build.ts --harness，逐个执行现有 10 个 Harness | [全部成功；逐次退出码与日志](evals/autonomy/p1-02/build-results.json) |
| node node_modules/tsx/dist/cli.mjs tests/test_distribution_parity.ts | [2785 文件 / 10 Harness 一致性通过](evals/autonomy/p1-02/distribution-parity.log) |

构建器的两次 --all 尝试分别在 Codex、DeepSeek 目录清理时发生本机 EPERM；原始失败保留于 [attempt-01](evals/autonomy/p1-02/build-all-attempt-01.log)、[attempt-02](evals/autonomy/p1-02/build-all-attempt-02.log)，没有将 --all 记为通过。随后按 Harness 分开执行、每个最多三次有界重试；Kiro IDE 和 ZCode 第三次成功，其他全部成功；不修改构建器、系统权限或安全配置，最终再用完整分发一致性核验收敛结果。

测试开发中修正了新文件括号遗漏及拆分夹具缺少 units-generation 登记，最终日志覆盖修正后实现。Spec/Standards 复核发现并修复了 policy 批准来源冒充复核、handoff 自失效、有效修订未递增和模块归属发布边界，详见[审查记录](evals/autonomy/p1-02/code-review.md)。

未运行完整 npm test、两个业务试点、浏览器、真实人类审批服务或无人值守宿主循环。测试中的人类 locator 和实施/观察字节均明确为 fixture，不当作实际人类批准或受控 evidence。没有修改或接管当前无关 DeepSeek 活动 workflow；前后 state/audit 哈希仍与第 4 节一致。

## 7. P1-02 退出结论（历史）

P1-02 工程范围完成，P1-03 可消费固定 policy/AuthorityRef/决策约束；P1-05 可消费单元归属与有效设计修订；P1-07/08 需把记录引用与真实 producer、候选、功能/UI 观察连接起来，再决定工程结果。

当前没有 grant 或自主准入 ready；引用齐全仍是 recorded-not-verified。P1-03/04/05/06/07/08 的功能和完整 P1-09/10 验收继续待实施，P1-02 不替代这些任务。

## 8. P1-03 单会话 ExecutionGrant

P1-03 的 Core 签发/校验与可信操作端入口已实现。新增 grant store/controller，并把授权复核接入既有工作流状态锁、受管发布锁、决策发布、受控验证和 Provider Runner。没有新建模型循环或 Supervisor，也没有对当前活动项目签发实际 grant。

### 8.1 实现与职责

| 项目 | 已实现行为 |
| --- | --- |
| 精确签发 | 完整策略与既有 global 领取先校验；Core 生成固定项目/批次、来源、操作、资源、HostRef、会话和参与 workflow；操作人确认完整请求摘要后消费进程内一次性批准对象 |
| 签名与来源 | Ed25519 签名的批准回执及 grant；普通 JSON、policy/decision、伪造字段或 --user-input 不能构造同等批准；私钥不进入工作树 |
| 显式激活 | 在原 global state 保存 Execution Grant Version/ref，复用 CAS 和 audit；普通保存不能增加、替换或删除授权引用，无标记保留原手工模式 |
| 单会话绑定 | 复用当前 AIDLC_SESSION_BINDING；同 owner/session/HostRef 在批准的项目血缘内换阶段需重新精确领取，grant 期限不变；新 session/host/config/越界单元拒绝 |
| 期限与资源 | 有限 lifetime/wall time，批准对象五分钟消费窗口，签发前后和发布时校验当前时间；不隐含续期；重试/活跃单元限制由后续宿主驱动实际落实 |
| 允许操作 | 15 种明确 OperationClass；业务文件写入检查目标路径，code/test 需要 implement 单元；consume/verify 无实施权限；候选提交、整合、push、受保护分支和部署分别声明 |
| 发布与撤销 | 状态/决策/evidence 在工作流锁和自主控制锁内复核，Provider/验证执行前也检查；撤销保存签名事件与 Git 控制目录锚点，删除工作区撤销 JSON 不会恢复有效 |
| 安全控制面 | 过期或无运行环境变量时可经独立操作输入撤销；重复已提交撤销只读；原生释放/暂停不授予实施权限；P1 不支持后继自动恢复 |

Core 负责签发记录、签名、固定来源、操作/范围和锁内校验。宿主负责真实操作输入、提供实际 HostRef/当前会话、每次外部工具副作用前复核，并落实重试/并发预算、取消长命令和对账。Core 拒绝撤销后的新发布，不宣称能回滚任意外部过程。

本版可信入口为 operator-terminal，依赖操作人实际输入；终端不能密码学证明操作者是人类，Agent 不得代输确认。原生 Codex/其他宿主聊天事件回执尚未接入，不把这个能力冒充已验证。测试正例替换了原生 TTY/readline 边界，所签记录全部在独立临时 Git 仓库，不能作为真实人类批准或业务执行证据。

### 8.2 文件与契约

| 文件 | 调整 |
| --- | --- |
| [aidlc-grant-store.ts](../core/tools/aidlc-grant-store.ts) | 进程内操作批准、签名、不可由普通 JSON 激活的存储、Git 内密钥/撤销锚点、共享控制锁和纯运行校验 |
| [aidlc-execution-grant.ts](../core/tools/aidlc-execution-grant.ts) | 请求校验、实际来源采集、单会话签发/绑定/检查/撤销及 CLI 视图 |
| [aidlc-autonomy-files.ts](../core/tools/aidlc-autonomy-files.ts) | 提取既有纯来源解析，供 grant guard 使用，避免 state → workflow reader 的运行时循环依赖 |
| aidlc-light-state.ts | 版本/ref 解析渲染、激活限制、状态发布复核、同领取的嵌套锁复用和 audit 引用；不因安全停止恢复运行权限 |
| aidlc-session.ts、aidlc-autonomy-policy.ts | 受管发布按具体操作复核；decision-record 不隐含 workflow-write |
| aidlc-evidence.ts、aidlc-provider-runner.ts | 执行前检查，结果发布再检查；保留原有 argv、沙箱、producer 和质量门禁 |
| aidlc-orchestrate.ts、bin/cli.ts | grant issue/inspect/bind/check/revoke；next/state summary 视图；普通路由/报告的实际操作校验 |
| [专项测试](../tests/test_execution_grant.ts)、tests/helpers/autonomy-fixture.ts | 隔离仓库、模拟终端边界、真实签名与存储、公共 CLI；接入 npm test 脚本及标准 Core 测试清单 |

详细请求、记录 schema、激活与绑定约定见[契约第 5.3 节](aidlc-autonomous-contracts-v1.md#53-p1-03-实现契约)和[CLI 手册](loeyae-aidlc-cli-guide.md)。会话交接协议与 handoff Skill 已同步；全部 10 个 Harness 使用既有构建器同步。P1 一个项目血缘可包含已有 global/module/integration 状态文件，仍以同一会话和限定单元集合控制，不能扩展到其他项目。

### 8.3 验收与真实验证

| 验收 | 结果 |
| --- | --- |
| 普通 JSON/文档不能自行签发 | PASS：伪造批准对象、手写 receipt、绕过版本激活、非 TTY/管道/--user-input、批准篡改/重放均拒绝 |
| 签发、绑定与单会话连续性 | PASS：实际签名/锚点、global 激活、绑定只读；同会话新 generation/阶段及选定 split workflow 正例；新会话或其他项目拒绝 |
| 期限与撤销 | PASS：过期、签发前时间、过期批准、撤销后状态/evidence 拒绝；在途结果拒绝；删除撤销文件不能绕过 Git 锚点；过期后撤销和重复撤销行为正确 |
| 操作与作用域 | PASS：缺少操作、权限不一致、未知类别、业务路径越界、未精确领取及 consume/verify 实施拒绝；candidate commit 不推导 push/main/deploy |
| 每次发布复核 | PASS：锁内重读 receipt/撤销/来源/领取，变更产品或新增依赖/消费证据漂移拒绝；共享锁冲突不偷取，普通 state 保存不移除授权 |
| 兼容 | PASS：旧模式的 P1-01/02、session、split/layout、handoff、交付摘要、Provider Runner 和原执行策略回归；源与分发一致 |

实际命令、时点、源码与日志摘要见[验证清单](evals/autonomy/p1-03/verification.json)。下表命令均实际退出 0，分发失败尝试另按原始记录保留：

| 命令/检查 | 输出 |
| --- | --- |
| node node_modules/tsx/dist/cli.mjs tests/test_execution_grant.ts | [48 个场景通过](evals/autonomy/p1-03/execution-grant.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_autonomy_scope.ts | [44 个场景通过](evals/autonomy/p1-03/autonomy-scope.log) |
| node node_modules/tsx/dist/cli.mjs tests/test_autonomy_policy.ts | [55 个场景通过](evals/autonomy/p1-03/autonomy-policy.log) |
| npm run typecheck | [通过](evals/autonomy/p1-03/typecheck.log) |
| tests/test_mars243_sessions.ts | [会话/竞争通过](evals/autonomy/p1-03/sessions.log) |
| tests/test_mars243_layout.ts | [拆分/过期/旧模式通过](evals/autonomy/p1-03/layout.log) |
| tests/test_stage_handoff_prompts.ts | [handoff 通过](evals/autonomy/p1-03/handoff.log) |
| tests/test_delivery_summary.ts | [摘要通过](evals/autonomy/p1-03/delivery-summary.log) |
| tests/test_provider_runner_gate.ts | [受限 Runner/Evidence/GateDecision 通过](evals/autonomy/p1-03/provider-runner.log) |
| tests/test_mars160_execution_policy.ts | [原执行策略通过](evals/autonomy/p1-03/execution-policy.log) |
| scripts/build.ts --harness，逐个执行 10 Harness | [全部成功；保留各次退出码](evals/autonomy/p1-03/build-results.json) |
| tests/test_distribution_parity.ts | [2815 文件 / 10 Harness 一致性通过](evals/autonomy/p1-03/distribution-parity.log) |

本机构建再次出现目录清理 EPERM，按每个 Harness 最多三次有界重试，全部成功；没有修改构建器或权限，失败输出与最终退出码均在 build-results.json 引用的日志。最终保留 session.ts 原有 CRLF 格式，按 manifest 精确同步该文件后再次通过分发一致性，见[格式同步记录](evals/autonomy/p1-03/format-sync.json)。测试开发中修正过 PEM 多行校验与签发激活时重复获取同一工作流锁的问题，当前专项覆盖修复结果。双轴问题与复审见[代码审查](evals/autonomy/p1-03/code-review.md)。

未运行完整 npm test、实际业务试点、真实用户终端确认、原生宿主聊天授权、浏览器、预算驱动或外部命令取消试跑。没有对当前工作区创建 grant/密钥，也未领取、推进或修改无关 DeepSeek workflow；state/audit 前后哈希仍与第 4 节一致。

## 9. P1-03 退出结论（历史）

P1-03 的 Core 授权机制、操作终端入口及工程验证完成，可供 P1-04 做实际授权、环境与设计接收预检，供 P1-06 消费绑定与工具前复核协议。它不代替真实所选宿主/操作入口的接收验证，也不把配置预算视作驱动已具备。

当前项目没有被授予运行权限，没有 autonomous admission ready 或业务 verified。P1-04/05/06/07/08、完整规则汇合及两个试点验收继续按计划实施；原生聊天回执、预算执行和暂停/取消后的实际进程对账不得在未验证时计为通过。

## 10. P1-04：设计接收、执行预检与自主实施准入

本轮按用户指令允许修改代码，实现 Core 接收计划读取、真实受限命令预检、八项硬检查、三种结果、受管准入凭据及首次实施拦截。继续保持当前 DeepSeek harness workflow 的 state/audit，不对当前仓库签发运行 grant 或创建 issuer。

### 10.1 实现与职责

新增 `core/tools/aidlc-autonomous-admission.ts`。冻结的 AdmissionPlan 必须在批次 baseline_inputs 中，接收包复用已有 development_acceptance / technical_review 及实际文件摘要，新增 autonomous_reception 对批次、UI 适用性、设计来源和未决问题的明确绑定。矩阵全部 check ID 与全部 AC/UI 均须映射，UI 明确设计/资产/视口/状态/容差和视觉、交互检查。预检实际执行 argv 命令，保持有限超时、输出缓冲与操作前授权复核。

八项检查为范围/策略、实际 grant、设计接收、依赖准备、验证计划、环境资源、宿主能力和命令预检。所有 required 检查均通过才可能 ready；存在合法委托细节时为 ready-with-delegated-decisions，是否待复核、是否形成完整实施输出另外显示。其余为 not-ready；unverified 不会被折算为 passed。待人类复核不降低硬检查和最终验收标准。

`aidlc-grant-store.ts` 复用 Git common directory issuer 签名 receipt/current 指针，凭据在 `.aidlc/evidence/autonomous-admission/<batch>/<revision>/`。Core 按固定 workflow 文件路径顺序取锁，再取 grant-control 锁，发布前重读授权、来源、checker、决策、环境和期限。receipt 上限 15 分钟，受 grant 和探针期限共同约束；来源、单元、命令、环境/可执行文件、决策、checker 或授权变化均使复用失效。它不保存人工 passed 布尔，也不成为新的授权来源。

首次共享契约物化、TDD（含测试代码）和代码生成在正式 native next 路由前、工具操作检查及受控发布时重验。只读 preview 仍可返回 planned 的路由建议，并同时投影 not-ready；建议不代表准入。显式采用但未签 grant 同样不能实施；旧 workflow 保持兼容。设计文档准备、接收调查和合法委托记录可以在准入前进行，避免接收自锁。I13、RED/GREEN、UI bridge、审查、C8 原阶段检查继续执行，准入不替代它们。

有效设计的新增决策或返工要求使准入失效；仅补写决策实施/验证结果、记录修订或接受复核不改变设计，不强迫整个批次重新接收。原决策校验与完成门禁仍读取最新输出，未知字段继续保守失效。

### 10.2 入口与宿主边界

```text
orchestrate autonomy admission run --input <frozen-plan.json> --preview
orchestrate autonomy admission run --input <frozen-plan.json>
orchestrate autonomy admission inspect
orchestrate autonomy admission check
```

preview 不执行命令/原生探针，不写 receipt/密钥/领取/状态。inspect 只读投影；check 仍需当前有效 grant/binding。next 投影同时给出 scope、decisions、grant 和 autonomous_admission；业务结果保持 business_verified=false。

Core 提供可信进程内 AdmissionHostAdapter.observe 协议，按随机 nonce、HostRef、预算、真实 probe_refs 和观察期限核验 model-turn、continuous-session、budget-enforcement；UI 适用时还要求 browser-dom/screenshot/interaction。原生模型和工具观察由宿主执行；Core 不新增 Supervisor。P1-06 尚未接入真实适配器，因此默认 CLI 实际 run 的 host-capabilities 为 unverified、整体 not-ready。这是明确的运行接入阻塞，不将单元测试夹具或 G-03 历史观察升级为本次实际宿主能力。

P1-05 尚未实现的多单元、split、consume/verify、能力版本、依赖及共享输入语义保持 not-ready。当前可验算无登记能力依赖、无共享输入的单实现单元及现有领取冲突；依赖记录不存在只代表已登记范围内的无依赖。P1-07 继续负责真实业务断言与 UI 还原、候选绑定，P1-04 的命令预检不等于业务验证通过。

### 10.3 验证记录

工程测试使用独立临时 Git 项目、模拟操作终端批准和测试专用宿主适配器，实际执行有界 Node 夹具命令；不声称真实人类批准、原生模型/浏览器或两个业务试点已验证。专项及回归输出、审查与校验摘要保存在 [P1-04 验证目录](evals/autonomy/p1-04/README.md)。

| 验证 | 结果 |
| --- | --- |
| 接收/预检/三态/签名/首次工具与发布、漂移、原生探针协议 | [40 个场景通过](evals/autonomy/p1-04/admission-verified.log) |
| 正式 native next 的首次 TDD 入口 | [通过，preview 仅 planned，state/audit 未变](evals/autonomy/p1-04/admission-route-verified.log) |
| 无依赖单实现、多单元、共享输入语义 | [3 个场景通过；P1-05 未提供的语义不记为 passed](evals/autonomy/p1-04/dependency-preflight-verified.log) |
| P1-01/02/03 回归 | [44](evals/autonomy/p1-04/autonomy-scope.log) / [55](evals/autonomy/p1-04/autonomy-policy.log) / [48](evals/autonomy/p1-04/execution-grant.log) 场景通过 |
| tsc --noEmit | [通过](evals/autonomy/p1-04/typecheck-verified.log) |
| 原生会话/竞争、split/暂停/过期/legacy | [session](evals/autonomy/p1-04/sessions.log)、[layout](evals/autonomy/p1-04/layout.log) 通过 |
| handoff、交付摘要、Provider Runner、原执行策略 | [handoff](evals/autonomy/p1-04/handoff.log)、[summary](evals/autonomy/p1-04/delivery-summary.log)、[runner](evals/autonomy/p1-04/provider-runner.log)、[policy](evals/autonomy/p1-04/execution-policy.log) 通过 |

修复及复验见 [双轴工程审查](evals/autonomy/p1-04/code-review.md)。development、route 和阶段复验日志均保留，没有覆盖失败记录。未运行完整 npm test、实际业务试点、原生模型/浏览器、实际终端批准、宿主持久驱动或中断恢复。

十种 Harness 均以最终源码重新构建通过，[2825 文件 / 10 Harness 一致性通过](evals/autonomy/p1-04/distribution-parity.log)。最终 DeepSeek 构建首次清理遇到 EPERM，第二次成功，保留 [每次退出码](evals/autonomy/p1-04/build-results.json) 和日志；未修改构建器或权限。session.ts 保留既有 CRLF，空白检查通过。

## 11. P1-04 退出结论（历史）

P1-04 的 Core 设计接收、有限命令预检、三态准入、签名凭据、来源失效及首次受控实施拦截已完成工程验证，可供后续任务接入。40 个核心场景、1 个 native 路由场景、3 个依赖预检场景及相关回归通过；源文件摘要、命令结果与环境保全见 [verification.json](evals/autonomy/p1-04/verification.json)。

业务自主运行仍为 not-ready，以下是后续接入条件，不用普通声明补齐：

| 条件 | 后续责任与验收 |
| --- | --- |
| 多单元、split、能力版本、consume/verify、依赖/共享输入及写范围语义 | P1-05：提供受控检查并接入本步 dependency-readiness；不能把契约可用误记为运行联调可用 |
| 真实所选宿主与原生探针、工具权限、预算和持续驱动 | P1-06：实现可信 AdmissionHostAdapter，验证 model-turn / continuous-session / budget-enforcement，UI 时验证三项浏览器能力；处理协调 binding、工具前复核与取消对账 |
| 两个试点的实际环境、数据、设计资产和可执行命令 | 按冻结批次准备 canonical 接收包/计划、真实资源与实际运行 grant；当前工程编码授权不代替业务运行授权 |
| 实际业务完整性、UI 还原与最终候选验收 | P1-07/08：以真实断言、页面/状态/视口、交互链路和候选证据验收；预检 exit 0 不替代这些门禁 |

默认 CLI 未接入真实宿主 adapter 时不得产生 ready 的实际宿主能力结论。当前项目未获得 grant，没有业务 verified，也没有把任何测试替身当成真实模型或浏览器。原 DeepSeek workflow 的 state/audit 保持第 4 节原哈希；没有创建当前仓库的 grant、admission receipt 或 Git issuer。

## 12. P1-05：多单元依赖、能力版本与写范围

本轮按用户指令实施并测试 P1-05，不改当前无关 DeepSeek workflow，不签发当前项目 grant。第 10/11 节的“P1-05 未实现”保留当时历史口径，现由本节和 contracts-v1 第 13 节取代。

### 12.1 实现与职责

新增 aidlc-autonomy-dependencies.ts（编排与消费控制）、aidlc-dependency-inputs.ts（无工作流写入的路径/来源扩展）和 aidlc-dependency-checker.ts（复用 Native 校验的只读进程）。ScopeReader 支持明示 ExternalRef、限定局部 stub，并将 canonical 单元/能力定义绑定现有采用快照与 grant 输入；不会因普通文档出现字段自动启用。复杂批次需要 unit-manifest 的 autonomy_version="1"。

Core 校验真实 UnitRef/workflow/split、行为/AC、capability 实际文件版本、各角色、typed checkpoint、阶段依赖与输入依赖环、共享/传递输入和写入 Owner。能力版本绑定真实 raw-file 输入，不填未来输出摘要。consume 读取固定受控证据并逐次核对，verify 绑定实际矩阵检查且保留 pending；两者不获得代码写权限。

contract_ready 读取提供者真实 C5/Native 契约证据，并重算当前声明；只解锁契约消费。implementation 采用保守整单元路径：提供者 code-generation/code-review 完成，实际 Native GREEN/review 证据有效，不等待项目 C8。runtime/external 没有 P1-07 运行生产者时保持 unverified，不能用契约、GREEN 或 stub 补齐。内部 implement 提供者尚未完成可通过计划准入，在真实消费点仍阻塞。

P1-04 dependency-readiness 现消费本模型，签发锁内、准入读取、公开 grant 操作、session 捕获、受控 state/publication 和 native 首次实施路径再次核验。只固定设计与 consume 证据，不把未来内部生产结果当作冻结输入，避免持续实施时每产生一个真实结果都被迫重冻结。原 I13、UI bridge、RED/GREEN、review/C8 门禁保持独立。

Core 不新增 Supervisor：宿主 P1-06 负责实际工具前检查、执行串行、进程/预算/取消/上下文恢复。Core 的受控入口无法阻止宿主任意直接改文件；不能把协议已实现说成所有宿主工具已拦截。

### 12.2 输入与规则调整

- canonical unit-of-work.md：封闭 unit-extension 与 capability records；unit-of-work-dependency.md：typed edges，实际可达 checkpoint，消费者闭包与局部检查引用。
- 输入范围：共享与依赖传递闭包进入 Native source scope；模块内缺少完整 evidence_inputs 时保持 module scope 与 serial_execution_required=true。显式 v1 对批次记账投影以解除固定 EvidenceRef 的自摘要环，正文和非 batch 记录仍绑定，完整批次来源继续受采用/授权快照保护。
- 契约范围：声明、清单、能力输入与共享输入；读取时重算 Native 契约扫描。仅 v1 使用项目内相对路径识别契约，防止工作目录名影响匹配。普通实现代码编辑不废弃未变契约，新增/修改声明及共享输入仍使旧证据失效。
- 写范围：私有/共享重叠拒绝，共享 Owner 和 coordination 一致；single-writer 仅 Owner，serialized 须先显式释放其他共享参与者领取；已知无交集单元不被笼统跨单元领取规则阻塞，未知范围仍保守处理。
- 原生路由：consume/verify/批次外单元不进入实施候选。scope-exhausted 只表示当前原生范围耗尽，batch_completed/workflow_completed=false，交回协调者等待 P1-08 实际候选与终态，不伪造 Native 完成/跳过。
- Native evidence 追加实际 workflow_id，消费严格绑定 workflow/module/unit/stage、producer、checker、命令、来源与时效，拒绝手写 passed 外壳。

已同步单元划分 stage/skill、session handoff、step completion、共享契约规则及 CLI 帮助/手册。共享契约规则提及的旧 .claude/workflows/aidlc-construction-batch.js 在本仓库不存在；本轮校验权威 Core 与全部 Harness 分发，不声称核验了仓库外旧适配器。

### 12.3 入口与验证

~~~text
orchestrate autonomy dependencies inspect
orchestrate autonomy dependencies check --checkpoint <actual-stage-or-check-id>
~~~

inspect 只读；check 需要当前有效 grant、精确活动 binding 和 validation-execute 权限。next 投影增加 autonomy_dependencies / dependency_frontier，明确 native_gates_evaluated=false、execution_authorized=false、business_verified=false。前沿只列依赖阻塞，不是 P3 完整能力调度器。

工程验证目录为 [P1-05](evals/autonomy/p1-05/README.md)，实际命令、退出码与摘要见 [verification.json](evals/autonomy/p1-05/verification.json)。夹具为独立临时 Git 项目，使用模拟操作终端和测试 adapter。正例通过现有 Core producer 实际执行 C5/GREEN/review（GREEN 执行真实 Node 断言）；reviewer 文本和测试 adapter 属协议夹具，不是实际业务审查、原生模型/浏览器、真人批准或两个真实试点通过证据。

开发中发现并修复：无 HEAD 导致来源摘要缺失、原 Native 命令/审查格式不匹配的夹具、消费证据的自摘要环、模块输入缺失时错误缩小范围、绝对目录名误匹配契约，以及私有范围覆盖共享 Owner 边界。原始失败日志保留，最终验收以 verified 日志和退出码为准。

## 13. P1-05 退出结论（历史）

P1-05 的 Core 多单元读取、版本与角色、依赖/输入/写范围检查及 P1-04 dependency-readiness 接入已实施，工程验收结果与限制汇总在 [P1-05 验证记录](evals/autonomy/p1-05/README.md)。当前工程编码授权不代替业务运行授权。

后续仍须 P1-06 的真实宿主 Adapter/工具前执行、预算及取消对账，P1-07 的实际 runtime/external、业务断言与 UI 还原观察，P1-08 的候选绑定和批次完成判定。完整能力级前沿、跨批次并发/跨仓库消费按后续阶段实施。默认 CLI 没有可信宿主 Adapter 时继续 not-ready；本轮不形成实际业务 verified 或完整 P1 通过。

未运行完整 npm test、真实业务试点、原生模型/浏览器、实际终端批准、宿主持久执行或重启恢复。当前无关 DeepSeek workflow 的 state/audit 前后哈希及本仓库未创建 grant/key/admission receipt 的检查在 verification.json 中保留。

最终工程验收：P1-05 20 个主要场景与 20 个边界场景、P1-04 40 个准入场景、1 个路由与 3 个预检场景，P1-01/02/03 的 44/55/48 场景及相关 Native 回归通过；共 20 项不同检查。类型检查通过，十种 Harness 重建完成，2855 文件分发一致性通过。额外完整 unit-ucd-scope 套件在完成前中止，未计为通过；原始失败、取消及复验记录均保留。分发生成目录短暂占用经验证目标边界后使用原生 PowerShell 清理恢复，未修改构建器或权限。

## 14. P1-06：实际 Codex 宿主、预算与取消

本轮按用户明确指令实施 P1-06。复用 Codex app-server 原生模型/工具 Supervisor 与已有 session binding；没有新增 Core 模型循环，也没有对当前无关 DeepSeek workflow 进行接管、签发运行授权或推进。

### 14.1 实现与边界

新增 Codex Harness runtime：aidlc-codex-host.mjs、host-kernel.cjs、deny-native.cjs。宿主负责同 thread 连续 turn、正式 next/report/evidence 协作、串行工具网关、预算、进程取消与操作观察。Core 新增 aidlc-native-host.ts，仅桥接已安装的受信任运行时、消费原生能力探针、提供私有 context/select 控制 IPC；模型循环与进程调度保留在 Harness 和原生 Codex。

AdmissionPlan.native_host_ref 绑定冻结宿主配置，HostRef 摘要绑定运行时、实际 Codex、Core CLI、配置及可选浏览器；原生有效配置使用规范化摘要核验。prepare 执行无工具、无业务实施的初始化 turn，输出可复用 thread_id，再按既有交接协议绑定该 ID、冻结输入并由真实操作端签发 grant。run 不替换授权、扩大权限、转交他人领取或自动 resume。

原生线程使用只读沙箱，关闭原生命令/patch、多 Agent、应用及已配置 MCP，PreToolUse 引导到结构化 aidlc_action。受支持副作用由宿主网关先调用真实 Core grant/依赖/路径检查；模型不能新增 shell 字符串、绑定身份、授权、人工批准或维护接管。冻结的受信任命令仍需在交接时审阅其副作用范围，不能把 Hook 描述成覆盖任意插件或 OS 操作的通用隔离边界。

正式实施前先执行非预览 next，只有 Core 实际进入精确实例才解锁 code/test 工具。路由切换复用 bind/release/CAS；依赖暂未就绪时选择已有前沿中的可执行提供者，当前单元耗尽可切换其他 implement 单元。所有单元耗尽仍返回批次待终结，不用模型 final 冒充 verified。准入失效可以受控回协调实例重验，原 grant deadline 不变。

### 14.2 预算与取消

运行期限取授权实际绝对期限和原始 wall deadline 的较早者；并发网关上限一，等价命令失败按实例/输入内容计数，最多初次尝试加配置重试次数。无源码或阶段进展的模型 turn 同样有界；不把 heartbeat、领取代次或宿主日志更新当作业务进展。

用户 SIGINT/SIGTERM 或预算到期停止新操作、请求 turn/interrupt，并取消所属命令进程树，等待实际 close。未确认退出保留 unknown/PID，不能自动重放或声称取消回滚了外部副作用。命令返回前再次核验授权，执行中撤销/过期/绑定变化不会得到可接受成功结果。Core publication 原有锁内复核仍独立有效。

宿主将线程定位、预算绑定、操作摘要与诚实退出写入 .aidlc/host-runs/<run-id>/，不保存第二份阶段进度或 binding 明文。已有 attempt 拒绝再次启动，不因重启清零计数、偷锁或注册新会话。P2 的自动拉起、后继授权、跨进程恢复和未知外部任务对账尚未实现。

### 14.3 实际探针与工程验证

实际原生探针在独立临时项目运行，继承本机 Codex 默认模型配置，未切换模型或复制认证文件。Core 适配器要求真实 nonce、同 thread 两次工具读取、原生 turn/interrupt、自有命令退出，以及按适用性执行的隔离浏览器 DOM/PNG/DOM click 检查。浏览器观察只证明基础工具能力，不是业务 UI 还原、坐标点击命中、角色/状态覆盖或端到端交互验收。

初次实际适配发现配置对象键顺序导致误失效，改为递归规范化摘要。prepare/resume 实跑发现空 thread 尚无 rollout，改为无业务副作用初始化 turn 后再交接；实际同 thread 的复用及动态工具读取已验证。取消探针中 turn/interrupted 与所属命令 close 的到达顺序不同，按真实对账结果等待，失败记录保留。

专项覆盖预算、串行、输入变化、路径/链接、真实命令退出、工具前实际 Core 校验、授权漂移、控制面精确领取、凭据过滤、正式阶段进入、跨单元路由、无进展退出和取消。测试中的授权/接收适配器是明确的协议夹具；实际 Codex/浏览器探针单独保存，不能把夹具当成原生证明。原始日志、源码摘要、退出码及双轴审查见 [P1-06 验证目录](evals/autonomy/p1-06/README.md)。

## 15. P1-06 退出结论（历史）

P1-06 接入一个实际 Codex 宿主的单会话运行机制；最终工程验证及原生观察以 [verification.json](evals/autonomy/p1-06/verification.json) 和 [验证汇总](evals/autonomy/p1-06/README.md) 为准。其他 Harness 不因共享 Core 分发而被记为同样已接入。

完整 P1 仍未验收：P1-07 需要真实功能/运行及 UI 观察，P1-08 需要候选/批次结果，P1-09 需要两个完整试点的无人值守交付实跑。P2 才验证故障后的自动拉起、后继与跨进程恢复。当前工程编码授权不代替实际业务运行授权；没有在当前仓库创建 grant/key、准入 receipt 或 host attempt，也没有修改原 DeepSeek state/audit。

P1-06 最终工程验收：28 个宿主协议/工具/预算/取消场景和 10 个持续路由场景通过；P1-01～05 与相关 Native 回归合计 18 项不同检查通过，最终类型检查通过。实际 Codex 0.164.0 / 配置模型 gpt-6.1-sol 的同 thread 工具调用、原生中断与命令 close 对账、隔离 Chrome DOM/PNG/DOM click 六项基础能力通过；prepare 后同 thread 复用及实际工具读回通过。十种 Harness 构建成功，2868 文件分发一致性通过。原生失败/复验和 Windows 清理记录全部保留；未运行完整 npm test、未完成两个真实业务批次或 P2 故障恢复。

## 16. P1-07：真实功能、运行依赖、UI 与候选观察

本轮按用户明确授权实施 P1-07。当前无关 DeepSeek workflow 继续保留，不签发本仓库业务 grant、不创建 issuer 或正式运行凭据。新增观察来自隔离临时 Git 项目和实际 Node/HTTP/Chrome 行为；操作终端批准、接收 adapter 及 H3 来源仍是明确的协议夹具，不能冒充人类授权或完整无人值守试点。

### 16.1 实现与职责

Core 新增 aidlc-observations.ts（冻结计划/执行/受控发布）、aidlc-observation-inputs.ts（候选/断言/PNG/凭据复核）、aidlc-observation-browser.ts（自有 Chrome/CDP）和 aidlc-observation-live.ts（消费点只读版本探针）。复用 grant-store 的 issuer、session publication 和现有 grant/binding；不增加模型 Supervisor。

计划以 raw-file 纳入 baseline_inputs，矩阵全部 check ID 恰好执行一次，covers 覆盖全部 AC；UI 精确对应冻结 PAGE/状态/角色/视口、关键元素/动作及 baseline/区域容差。Core 从真实命令 stdout JSON / HTTP body 取操作数，不接受 exit 0 或 assert True 代替业务断言；无 UI 必须经实际技术接收确认。

运行版本从真实 clean Git HEAD/完整 tree/制品字节确定。HTTP/UI 的实际服务在请求前后报告相同版本，内部服务须精确 candidate_commit；runtime/external 精确绑定 edge、CapabilityRef、版本/健康及外部 Owner。依赖 inspect 读取短期受控观察，实际消费 checkpoint 还重新请求版本/健康，服务漂移或凭据失效即拒绝。内部 contract/implementation 原 Native gates 保留。

前置外部依赖增加受限 `--dependency-preflight`，解除“等待外部观察才能准入、等待准入才能观察”的自锁：实际 grant/冻结计划下只执行 ExternalRef HTTP 子集，通过保持 partial，其他准入硬条件仍须原 producer 全部核验。来源上下文与真实外部能力版本绑定，消费者普通编辑不废弃未变外部契约；完整矩阵仍严格绑定当前 clean 候选。next 返回结构化 not-ready，公开 CLI 不在 observe/host 自校验入口前误套 workflow-write。宿主在准入刷新前自动请求该预检。

浏览器使用实际隔离 Chrome profile，默认沙箱，固定视口/DPR/reduced motion，等待字体/图片，核验 DOM、脚本/资源错误和坐标命中后的真实点击/输入。截图由 CDP 捕获并解码，与冻结整页及关键区域逐像素比较，记录差异边界；关键元素、交互和业务状态独立阻塞。没有通过源码元素计数或更新设计基准消除实现偏差。

ObservationBundle 与独立签名 current 指针绑定同一 CandidateRef、环境/可执行文件摘要、source/raw refs、producer/checker、grant/batch 和期限。发布锁内重新核对；候选/来源/环境/原始文件/授权漂移即失效，错误保留 failed/unverified。没有新增作者 JSON 签发入口。入口、封闭字段及消费规则见 [契约第 15 节](aidlc-autonomous-contracts-v1.md#15-p1-07真实观察与候选证据)。

Codex 的 observation_plan 为可选冻结配置，在 implement 单元 review 完成后、C8/范围耗尽时回原协调 binding 调用实际观察；模型受控 core 网关也可请求观察。宿主管理预算和取消，Core 管理受控结果；宿主不自动 commit，不把观察 passed 当批次终态。已更新交接、步骤完成、需求完整性、运行依赖、C8/审查规则、Codex/CLI 手册与测试入口。

### 16.2 实际工程样本

| 样本 | 实际执行与原始记录 |
| --- | --- |
| 订单分页 | 实际实现、上游 HTTP、120 行逐项内容/顺序与 50/50/20，空集、1/50/51 边界及真实超时传播；[orders-actual](evals/autonomy/p1-07/orders-actual/manifest.json) |
| 发布页面 | 独立于候选运行预先渲染的 HTML/PNG 基线，800×600 / 390×844 的 ready/draft/published/error/retry，共 10 个浏览器组合，另 3 项实际 API/结果一致性检查；[publish-actual](evals/autonomy/p1-07/publish-actual/manifest.json) |
| runtime | 对应候选的实际服务、功能/非法状态、能力版本与健康；消费点实际再查、服务版本漂移拒绝；[runtime-actual](evals/autonomy/p1-07/runtime-actual/manifest.json) |
| external | 独立 Git 服务版本、明确 Owner、鉴权/能力版本，凭据漂移与最新失败观察撤销就绪；[external-actual](evals/autonomy/p1-07/external-actual/manifest.json) |
| external 前置预检 | 实际 CLI 的 not-ready 诊断、HTTP partial、完整准入重验、普通消费者编辑与能力输入漂移；[external-preflight-actual](evals/autonomy/p1-07/external-preflight-actual/manifest.json) |

每个样本导出实际 signed receipt、fixture 公钥、候选源码快照、原始 JSON/PNG 及摘要映射；不导出私钥，不把当前项目变成业务运行现场。预置独立设计基线属于测试设计事实，不声称已取得正式业务设计审批。工程双轴审查与最终命令/退出码见 [P1-07 验证目录](evals/autonomy/p1-07/README.md)。

## 17. 当前退出结论

P1-07 已提供真实功能/HTTP/UI 观察、运行依赖消费点复查及候选证据绑定机制；最终工程退出以 [verification.json](evals/autonomy/p1-07/verification.json) 为准。P1-08 必须继续把最终整合候选、Native gates、全部验收和委托决策输出汇合，产生真实批次结果；本轮所有 observation 都保持 business_verified=false。

完整 P1 仍需 P1-09/10 对两个独立内部试点进行完整自主链路实跑，而非只运行本轮实现/测试服务。P2 才验证自动拉起、后继授权、跨进程恢复与未知外部任务对账。其他宿主不因获得 Core 分发而自动具备 Codex runtime。未运行完整 npm test、未完成真实业务批次或重启恢复；原 DeepSeek state/audit 与本仓库无 grant/key/正式证据的保全结果纳入最终验证记录。

P1-07 专项最终为 17 个功能/候选场景、11 个 runtime/external 场景、9 个 UI 场景通过，共 37 个；宿主 28 个控制/预算/取消场景与 13 个持续路由场景通过。P1-01～05、Native 会话/交接/执行策略/I13-TDD/Provider Runner 等相关回归合计 21 项不同检查均通过，类型检查通过。前置预检自锁及公开 CLI 在复审中补充验证，原始失败日志与最终定向复验分别保留；最终采用的日志、退出码、源码/签名/原始文件摘要见 verification.json。

十种 Harness 使用最终源码重建成功，2908 文件分发一致性通过。五组实际工程快照的签名、最终 checker、来源/原始/候选制品摘要封存核验通过；公开 inspect 只读返回 unverified，没有把当前工程仓库注册为自主运行现场。

## 18. P1-08：最终候选、Native、完整矩阵与委托决策汇合

本轮按用户授权实施批次终点，修改 Core、Codex 宿主适配、测试和文档。复用 P1-03～07 的 grant/session binding、准入、依赖和观察，保留当前无关 DeepSeek workflow。没有在根项目签发 grant、接收凭据、Native host attempt 或批次 receipt。

### 18.1 结果与职责

新增 aidlc-batch-result.ts、aidlc-batch-native.ts 和 aidlc-batch-scope.ts。终结入口从实际 clean Git 候选出发，核验当前完整验收分母、功能/UI 观察、依赖消费、必需制品、所有选中 implement 单元的原 Native 门禁、C8、条件全局审查以及 UI 原设计 full acceptance/当前还原证据。历史 RED/BASELINE 继续使用既有规则，不能靠补写 completed 或普通 JSON passed 替代。

批次投影不会要求未来单元先产出实现/审查；聚合 requires、UC-D 覆盖和 C8 输入仅遍历选中 implement 单元，原始 I13 仍完整验证。consume/verify 保留只读消费角色。单元阶段耗尽时宿主可切换到正式项目 C8，再回原协调实例终结，不用模型 final 或最后单元耗尽代替完成。

委托决策要求实施引用属于该单元的实际写入范围，并由同一最终候选的真实完整检查验证。声明依据可引用同批次签名历史观察，当前验证另外投影到结果，避免决策文件引用自身候选产生提交循环。普通 passed JSON 被拒绝；pending 人类评审独立展示，不阻止证据充分的工程 verified。后续人工变更通过有效设计修订和增量返工进入下一轮。

Core 发布签名不可变 BatchResult，state 只保存严格引用；同内容幂等，不新增第二套进度。候选/工作区/证据/检查器/决策/租期/依赖变化会使当前资格 stale，历史工程结论保留。verified/failed/blocked/incomplete 均可诚实记录；仅 current verified 的 batch_completed=true，批次终结始终不直接把项目设成 done。

Codex 宿主沿用原 Supervisor、预算与串行工具前校验。可选冻结 candidate_command 仅允许授权的 candidate-commit/candidate-integrate，由原协调 binding 执行实际准备/整合及所需环境准备；Core 不接管 Git 或服务生命周期。宿主等待操作对账、读取当前 Core 结果后退出，取消发生后不再尝试使用已中止的 Core 网关检查。Native 证据刷新只执行 Core 明确允许且不需人工审批的诊断，重试有界，不解锁源码写入。

### 18.2 规则与数据契约

具体 schema、字段、存储顺序、退出语义见 [契约第 16 节](aidlc-autonomous-contracts-v1.md#16-p1-08最终候选汇合与批次终点)。新增全局 AutonomyBatchResultRef、`## Autonomy Batch Result` 和 audit 引用；非全局 owner、移除当前引用、伪造 receipt 或不同 batch/grant 引用均拒绝。

`autonomy batch finalize [--preview]` 负责真实汇合，inspect/next/state summary 负责只读适用性投影。既有未采用项目行为保持原路径；采用项目仍需要所有原门禁。规则不允许以观察通过替代 Native，也不要求等待 pending 人类评审才能给出真实工程结论。

### 18.3 工程验证与证据边界

新增批次结果/汇合回归及真实 Native 生产者夹具，专项覆盖签名防篡改、幂等、候选/配置/原始证据漂移、租期、矩阵缺失、制品损坏、精确协调 binding、真实失败断言、未来单元隔离、委托普通 JSON 拒绝与 pending 人类评审通过。订单夹具执行真实 RED 失败、GREEN、I13/质量/追踪/结构/审查和 C8 生产者，运行真实本地 Node/HTTP 断言，再生成同候选签名 BatchResult。

夹具的 H3/操作端/审查人员/阶段 completed 行是明确的协议准备；生产者、命令退出、函数行为、HTTP 以及 P1-07 浏览器/截图另有真实原始证据。归档 orders-converged 的 verified 是隔离工程机制证明，不能记为实际业务授权或真实 Native 模型贯穿整个无人值守试点。UI 回归证明实际功能/视觉通过仍不能绕过缺失的 Native UI acceptance/alignment；完整 UI Native 正向试点留 P1-10。

最终检查、构建、分发、源码/日志摘要、签名/原始文件核对和同宿主双轴审查见 [P1-08 验证记录](evals/autonomy/p1-08/README.md) 与 verification.json。开发期失败日志保留，最终通过以汇总退出码和封存哈希为准。

## 19. P1-08 退出结论

P1-08 工程实现及对应验证完成，结果见 [封存索引](evals/autonomy/p1-08/verification.json)。23 项不同检查均取得最终通过；其中新增批次结果/汇合为 4 + 12 个场景，宿主配置/执行与持续路由为 29 + 22 个场景，真实功能/运行/UI 观察为 17 + 11 + 10 个场景。类型检查通过，十种 Harness 构建成功，2938 文件分发一致性通过。真实 Native 订单夹具最终签名结果为工程 verified、人类评审 pending、workflow_completed=false；签名、公钥、Native/原始引用与候选字节均经封存脚本核验。

P1-09 继续完成规则/模板/分发消费一致性收口；P1-10 才运行“发布页面”和“订单分页”两个完整真实宿主内部批次。完整 P1 尚未验收；P2 的进程重启、后继授权与恢复对账没有提前实现。

未运行完整 npm test、未进行受保护分支写入/push/deploy、未创建提交。当前根项目 state/audit 哈希和授权/运行目录缺席检查写入 verification.json。

## 20. P1-09：源协议、Skill、CLI 与选定 Harness 收口

按用户授权完成 P1-09，保留此前 P1-01～08 工作区变更。新增共享 common-autonomous-execution.md，统一 H1–H3 人类准备程度、实际接收/授权、连续执行、合法委托、硬阻断、冻结单元调度及最终批次判定。未采用模式继续原路由、人工模块选择及真实审批。

### 20.1 规则与契约

`next.autonomous_execution` 明确指向共享协议并保持 execution_authorized=false，RuleLoadPlan v1 仅在显式采用时增加 supplemental_protocols；原 selected/load_now/deferred 不改。源会话/连续性/步骤协议、handoff/continuity Skill 和选定 Codex Skill 都从这一入口读取，避免靠多个追加段推断当前行为。handoff 的触发词保留在 metadata，三个修改过的 Skill 经 skill-creator 校验器验证。

Construction 的功能设计、NFR 需求/设计、基础设施问答和 UI 目标落点增加条件明确的处理规则：确定来源直接复用、约束内工程选择自主处理、策略内细化/兜底记录后实现并验证；不把所有问题等待人类回答。未采用模式原问答和无法确定落点时的人工处理保留；真正 block、用户暂停/审阅、来源冲突、安全/外部权限、I13/TDD/UI/审查/C8 和完整矩阵保持硬条件。

CLI 指南、help、根 README 和 Codex 说明消除“等待 P1-06/07/08 实现”的过期当前描述，区分范围投影、实际授权、准入、观察与结果，并明确两个完整试点属于 P1-10。契约第 17 节记录新增只读字段及宿主衔接，不新建权威状态或 Supervisor。

### 20.2 真实执行衔接修复

本轮真实 CLI 检查暴露此前路由夹具没有覆盖的两处阻塞：

1. Core next 正常退出 2 的结构化诊断被宿主入口提前抛弃，Native 刷新分支无法收到原诊断。现在只对 reconciled 的正常 next/exit-2 JSON 错误保留结构化返回，其他失败/中断/非 JSON 继续拒绝。只有 Core 允许且不需人类批准的证据刷新可有界执行。
2. 成功 report 按原规则释放阶段 claim，宿主用旧 binding 读取 context/select 会失败。现在 run 从实际已完成的初始全局协调 binding 启动，工作实例切换时保留协调 claim；report 成功后清空源码写许可、切回实际所持协调 binding 并通过原 bind 续期，再走下一正式路由。原 report 释放语义不改，续期不延长 grant 或原 wall budget；过期、撤销、转交、缺失或错误凭据不能自动恢复。

协调 binding 仅保留于宿主内存和本进程 AIDLC_COORDINATOR_BINDING，不写模型、handoff、配置或日志。选回协调者时核验真实 owner/session/generation，不从 state 构造凭据。冻结 implement 调度只消费正式路由候选，模块和单元都由 Core 再核对；真实 block 和用户 choices 明确停止，网关继续禁止模型批准/转交/新授权。

旧模式回归另发现模板隔离检查器的封闭输入模块混入自主依赖解析，导致未采用项目的真实模板生产者也被拒绝。已将共享契约的 sensor 作用域选择移到 workflow-layout，生产者、门禁与复用计划使用一致的 sensor-aware 作用域及真实源码/嵌套仓库版本；模板输入模块恢复封闭依赖。保持原导入白名单、防伪及来源检查，新增实际共享契约 producer→Native gate→reuse-plan 验证，并补跑隔离检查器/输入范围及旧政策回归。

### 20.3 验证与选定分发

新增实际 CLI 规则/通知报告/协调衔接/未采用兼容回归，以及重建后 Codex shipped CLI 的双模式只读 smoke。宿主路由增加冻结候选筛选、越界和同名前缀拒绝、真实 block/choices 停止、exit-2 诊断送达有界刷新等场景。复用原 session/binding、grant、准入、依赖、Native、完整矩阵和批次结果回归，并扩展旧 report/Stop、规则加载/证据复用、审批政策和 Operations 拆分检查。

实际通知测试执行真实 next/report 和后续 context/select，不传逐阶段人类继续或批准；H3 前置行/布局选择、接收与操作端身份仍明确是协议夹具。多阶段驱动用例和真实 CLI 衔接分开记录，不能记为 Native 模型已贯穿完整无人值守业务批次。六组实际功能/HTTP/Chrome/批次归档在本轮目录重新产生，不覆盖 P1-07/08 历史归档。

十种 Harness 重建共享 Core/协议并核对分发，实际自主宿主仍只接入 Codex；选定分发进一步执行实际 copied tools 的 adopted/unadopted CLI、协议与 runtime 导出 smoke。最终源/日志摘要、退出码、签名、Skill 校验、构建及根状态保持见 [P1-09 验证记录](evals/autonomy/p1-09/README.md) 和 verification.json。

开发失败与复验分开保存：旧政策的隔离导入失败已修复；一次 Chrome 启动端口文件 EBUSY 产生真实 failed，完整 UI 独立复验通过；分发 smoke 的跨项目 binding 遗留被 Core 正确拒绝后修正夹具。EOF 空白清理只改变工具字节身份，已据此重新执行相关签名观察/批次汇合与类型检查，不复用旧身份收据。最终选中退出码和证据摘要以封存索引为准。

## 21. P1-09 退出结论

P1-09 工程实现与对应验证完成，见 [最终封存](evals/autonomy/p1-09/verification.json)。33 项不同主检查均取得最终通过，另有三个 Skill 结构校验和三个实际 Codex 分发 smoke 场景通过；自主规则/真实 CLI 衔接为 7 个场景，宿主路由为 32 个场景，宿主执行为 29 个场景。十种 Harness 最终构建成功，2948 文件分发一致性、根旧模式只读检查及 whitespace 通过。六组实际观察/批次归档的签名、当前最终 checker 身份及原始引用核对通过。

退出范围包括规则与实现一致性、无逐阶段人工确认的真实 CLI 衔接、未采用兼容及选定分发。P1-10 继续使用新冻结输入/HostRef/实际批准完成 UI 和无 UI 两类真实宿主试点；工具升级后的旧观察与 HostRef 不被当作新运行授权。P2 的自动重启/后继恢复未提前实现。

本轮未运行完整 npm test、未安装到用户全局 Skill、未重跑真实 Native 模型能力探针或完成两个完整业务批次。当前根项目保留原 DeepSeek workflow 的 state/audit，变更保留在工作区；未为根项目创建业务 grant/admission/host attempt/BatchResult 或提交/push/deploy。
## 22. P1-10 实施记录（本轮核验完成，P1-10 未通过）

最新结论：新 orders-r9 正常 incomplete 退出，publish-r13 宿主失联且没有正常退出记录，保留两个未对账领取。最终 [578 文件核验](evals/autonomy/p1-10/interrupted-attempt-audit-1794236912565/result.json) 已完成；32 项工程和三个分发检查通过不构成真实业务完成。当前阻塞为委托契约消费/重试语义、实际准入有效期与长命令窗口，以及宿主失联的持久身份和退出对账。两项均无最终业务 verified，整个 P1 未验收，P2 恢复未提前实现。以下按时序保留各轮原始记录。

P1-10 使用两个独立内部项目，既有单个本地 Node 服务；每个项目的交付所有权均为 `project/default`。发布 API/UI 在同一服务内共同验收，因此不制造独立单元或跨项目依赖。用户已明确确认两个单模块和发布页 HTML Mock；该选择不等于应用设计审批、运行授权或产品验收。

已完成一次真实订单 H5 与真实 Codex 宿主运行：workflow `8acc7f33-16dd-43f8-a6ce-9c5b1318e20f`，run `10a5520a-4028-4cfd-a76d-acdcc42ae0da`，模型 `gpt-6.1-sol`，Codex `0.164.0`。真实用户在操作终端签发授权；首次受控准入为 ready。运行最终为 incomplete/no-progress，business_verified=false，所有操作和领取已对账，没有自动重启，也没有伪造完成。公开原始运行、工具返回、准入与能力证据已保存于 [失败运行档案](evals/autonomy/p1-10/orders-r2/actual-failed-run/manifest.json)。

首轮发现 H4 在 I13 后新增故事，导致原派生未覆盖 US-001；模型也无法读取修复所需的公开 Native evidence。已修复 H4 顺序与最终重验，并补齐只读证据、原文摘要、Core 规则发现、公开记录身份、冻结命令清单与预览路由边界。模型/业务验证子进程不再继承四类 Core 私有授权环境。最终汇合允许在原会话和预算内补齐制品及委托决策引用，禁止借此修改代码/测试、批准阶段或替代 Core 验收；退出通过实际所持 binding 清理领取。

操作窗口的真实问题有两个：公开 CLI 管道包装丢失 TTY；Windows 父 readline 与 Core 子进程竞争控制台输入。已修复并由实际终端授权验证。用户的“现在可以输入并回车”只作为可用性反馈；授权证据来自 Core 的实际签发，未把聊天反馈映射成 grant。

UI 准备暴露两处实际拒绝：阶段名被误识别为 PAGE-PLANNING，以及设计说明滚动条使产品面板偏离居中。已统一页面词边界；真实模型修正 Mock 后，800x600 与 390x844 的 346x240 完整产品面板均为零差异像素。静态 Mock 的说明区域与四状态条件表仍按设计来源解释，不算实际产品行为。最终候选仍须实际 API、完整截图以及五状态/旅程乘两个尺寸的全部十个组合。

新订单准备工作流已在 I13 前完成故事，实际 UC-D 覆盖 US-001；最终批次采用后已重跑受控 I13。实际模型已记录 GAP-001 的合法兜底计划，implementation_refs/validation_refs 为空、human_review=pending；它是明确待实施的决策，不能直接完成批次。发布页已完成真实 Mock/交叉验证/执行计划，当前保留 application-design 的真实 block，正在先完成可供人类审阅的设计产物和实际门禁。准备脚本曾在异常路径遗漏领取清理，该失败准备记录保留；不得从 state 重建凭据或绕过接管授权。

已补充宿主只读/脱敏、正式路由许可、元数据补录、有界重试、终端和 Chrome 启动回归；真实功能/HTTP/浏览器观察及批次汇合工程回归通过。一次汇合回归因运行中工具来源发生变化被拒绝，保留原始失败，来源稳定后独立复验通过。十种 Harness 已重建，分发一致性和选定 Codex smoke 通过；工程夹具的模拟 H3/审批不能记作两个完整业务试点成功。

当前结论：P1-10 尚未退出，完整 P1 尚未验收。新试点的 H3、最终 H4 重验和真实 H5 均必须完成，随后才运行真实连续实施并汇合完整候选。旧失败 grant 不复用，工具身份变化后的历史收据不作为当前准入；P2 的后继、自动重启和跨进程恢复未提前实现。

后续核验：用户已明确批准发布页单服务应用设计，实际答复与定稿摘要保存在 publish-r6/application-approval-input.json，按 aidlc-approval 的阶段协议标记记录到 Core；这不是 H5。三个实际应用设计门禁在记录批准前重新执行通过。双轴审查补上文档写入分类及冻结输入的外部写保护；49 个运行授权回归场景通过。订单独立 oracle 增加调用前原值快照，并把真实 HTTP/超时放在导出函数调用内；新准备版本 orders-r4 保留原业务语义与真实 Native UC-D 来源。旧 UI 回归误用根仓库的分支已改为隔离目录，fixtureEnvironment 拒绝真实仓库；对该次测试写入按已记录摘要恢复精确原始 state/audit 字节，见 root-fixture-incident.json，修复后复验保持两个原摘要。

H5 前定稿：发布页原 r6 的测试目录归属在采用后的依赖投影被拒绝，旧状态保留、未签发授权；接收方 r7 在采用前明确 src/tests 同属 project/default。原实际业务设计批准经审批快照和文件摘要核对后正常记录，没有复制完成行；I13 要求的标题来源字段校正仅改引用格式，原快照和差异单独保存。r7 的全部十二个 UC-D、H4、真实模型兜底计划和当前接收生产者均通过。订单 r4 也已刷新当前 I13；两项目分别实测无 grant 启动拒绝，未创建 attempt 或实施测试。

最终工程轮 21 项检查全通过，297 个 Core/CLI/宿主来源保持一致；十种 Harness 构建、2948 文件一致性及三个分发场景通过。操作端准备复核补充第十四项真实 SourceReader 验收引用回归与类型检查，确认根目录原 state/audit 摘要及无自主授权/attempt。详见 [操作端准备记录](evals/autonomy/p1-10/operator-readiness-1794207507236/result.json)、[框架双轴审查](evals/autonomy/p1-10/code-review.md)和[两份精确请求说明](evals/autonomy/p1-10/h5-review.md)。同一真实操作窗口先后收集两份 H5 后执行，仍以两个实际最终 Core 结果决定 P1-10 是否退出。

两份 H5 实际签发后，orders-r4 在真实 TDD 写测试后被冻结 Native 命令绝对路径阻塞，以 no-progress/incomplete 退出；publish-r7 在实施前被 SUBSTANTIVE_FUNCTION_ASSERTION_REQUIRED 拒绝。两者均 business_verified=false，操作与领取对账完成、unknown 为空，原始档案保存在各自 actual-run；没有重启或复用旧 grant。

对实际拒绝的修复保持原契约：Native 命令使用合法 PATH 入口，观察断言真实响应/导航字段，页面通过 page_ref 单独绑定、浏览器明确、资产去重而保留十个组合。新增 Core 只读 previewObservationPlan 复用正式执行的完整校验，准备端还调用既有 Native 解析器和 admission 静态预览；没有实际授权时整体仍 not-ready。新准备 orders-r5 / publish-r9 不接收旧实现/测试。r8 的重复资产在 H5 前被新预检发现，失败准备保留且未签发授权。

当前验证见 [最新操作端准备](evals/autonomy/p1-10/operator-readiness-1794210174707/result.json)：297 工具来源一致；22 项不同检查的有效结论通过，其中 21 项在完整轮通过，新预检测试修正 fixture 设置后定向复验通过，首轮失败保留。15 项完整性、类型检查及最新十种 Harness/2948 文件/三个分发检查通过。两新项目的当前真实无 grant 启动拒绝和全部静态检查通过，业务结果仍待真实新 H5 后运行。

第二轮真实运行：orders-r5 的 H5 已签发，I13 因计划登记后的宽作用域变化需要刷新；模型修复轮拖至准入到期，重新探测宿主能力发生超时，以 admission-not-ready 退出。publish-r9 同样真实签发，连续进入功能设计后被 Core 的 UC-D 文件名后缀误计数阻塞，以 no-progress 退出。原始完整档案保留在各自 actual-run，均 business_verified=false，操作/领取全部对账，unknown 为空；父控制器已关闭所有自有服务。

本轮退出后完成三项宿主修复和一个检查器修复：并发原生工具排队串行；可信 Core 纯派生刷新直接通过受检网关执行，保留宿主执行标签而不冒充模型调用；真实宿主探测超时在原重试预算内复验；功能覆盖按正式 UC-D ID 归一并报告缺失清单，描述性文件名不是额外用例。新的 orders-r6 / publish-r10 在真实 H4 计划登记后刷新全部适用接收证据，准入 TTL 使用既有 900 秒上限、不延长 grant。17 项完整性与 35 项路由定向验证通过，当前 23 项新来源回归继续运行，尚未据此宣布 P1-10 完成。

最新授权前结论见 [operator-readiness-1794213892625](evals/autonomy/p1-10/operator-readiness-1794213892625/result.json)：工具来源 297 文件保持一致；完整工程轮 21 项通过，35 项宿主路由适配复验和 FD-only 单元范围/文件名/真正缺项正反例通过。完整两单元后续 RED/GREEN/审查流程触及十分钟测试上限，timeout 原始记录保留，定向检查不代表该完整流程通过。17 项完整性、类型检查及最新十种 Harness/2948 文件/三个分发检查通过；两新项目完成登记后刷新及全部实际无 grant 启动拒绝，等待新的精确 H5 后运行。

第三轮真实运行进展（2026-11-09 09:27 UTC）：两份 H5 已由真实操作终端签发，orders-r6 为 08:57:05 UTC，publish-r10 为 08:57:12 UTC。聊天回答仅确认窗口，不构成授权。订单在同一个实际 Codex 会话连续完成 TDD、代码生成及 C7，真实 RED 为 3/3 行为失败、GREEN 为 3/3 通过；最终候选局部提交为 `0b1438ab57879970c0ad5dc44bc21e1b2434f734`。09:14:11 UTC 退出为 incomplete，business_verified=false：Core 的真实公开空预览没有 `execution_status=scope-exhausted`，宿主未交接到项目级 C8；模型随后生成交付文档使宽输入作用域变化，单独刷新 test-quality 时未先处理失效的 GREEN，受控生产者正确拒绝。操作与领取均完成对账，unknown 为空。本轮不可重启或复用 grant。

发布页 publish-r10 此时仍在原授权内运行：真实 functional-design 已通过，RED 的十二个用例中十个行为失败，编译/环境均通过，TDD 已完成并进入 code-generation。API、最终 UI 还原、C7/C8 与批次 verified 尚未取得。运行期间不修改 Core/CLI/宿主来源；新增工程回归使用隔离临时项目，准备以实际公开 Core CLI 验证最后单元到 C8 以及依赖顺序刷新，不把安排的工程模型/审查阶段当作实际业务成功。两个父控制器服务关闭后再归档原始控制器尾部与退出记录。

第三轮已结束：orders-r6 与 publish-r10 均 incomplete，操作/领取和父服务已全部对账，unknown 为空。订单的真实 RED/GREEN/C7 与候选、发布页的 functional-design/RED/GREEN 成功片段和关键拒绝完整保留在各自 actual-run。发布页在 GREEN 时修正了 RED 测试中的错误正则转义，改变 tests/ucd.cjs 的原摘要，Core 拒绝正确；实际写入时间、原 RED 字节、当前字节摘要与差异另存 input-drift-analysis.json，未覆盖原工作流。

运行结束后修复三处宿主汇合衔接：精确识别真实局部空预览，候选处理返回协调实例后再选择 C8；完成代码生成阶段的派生失效按 Core 命令有序刷新 GREEN 与其依赖；最终汇合的实际 Native 失败也产生 Core 修复建议，宿主复用原预算和网关，不修改旧签名结果。最后一项由真实 CLI 回归进一步发现：交付文档使 I13 宽来源摘要失效，原宿主只处理 next 的诊断而遗漏 finalization 的拒绝。只有其他检查通过或只剩合法元数据缺项才自动刷新，真实功能、准入、权限与人类门禁仍阻断。

实际公开 CLI 汇合回归已通过，使用安排的工程模型/审查，不能算业务成功；真实 C8 构建/测试、观察和签名汇合都由 Core 执行，保留历史 RED 和测试字节。36 项路由、8 项完成和 10 项准入/预览边界回归通过，当前 27 项稳定来源回归进行中，FD-only 范围明确，不回填旧完整两单元 timeout。新 orders-r7 / publish-r11 已正常接收设计、显式采用最终 H4、由真实模型登记待实施兜底、登记后刷新全部适用接收证据，并通过真实无 grant 启动拒绝；仍无 H5、无业务实施。P1-10 和整个 P1 尚未退出。

最终授权前结论见 [operator-readiness-1794219368613](evals/autonomy/p1-10/operator-readiness-1794219368613/result.json)：[本轮 27 项工程检查](evals/autonomy/p1-10/engineering-1794218305792/results.json)全部通过，297 个 Core/CLI/宿主文件整轮保持一致；原始公开 CLI 汇合机制、真实 Native 构建/测试与观察链路通过，仍明确是工程模型/审查 fixture。FD-only 范围明示，旧完整两单元 timeout 保留。十种 Harness 构建、2948 文件一致性及三个分发场景通过；根目录原 state/audit 和无自主控制路径再次核对。两新项目在最终工具来源下重新执行适用接收生产者，当前请求、无授权启动拒绝与原始日志全部复核通过。双轴复审限工程范围，实际业务退出仍取决于新 H5 后的两个最终 Core 结果，设计批准未重问、旧授权不复用。

操作端首次输入后：orders-r7 的 H5 于 10:27:16 UTC 实际签发；publish-r11 空输入被拒绝，父进程关闭两项服务并释放原领取，未派发任何 Native attempt 或业务实施。用户明确要求重试，追加 [operator-retry-readiness-1794220551368](evals/autonomy/p1-10/operator-retry-readiness-1794220551368/result.json)：仅允许仍有效且从未派发的原 grant 在同一原生会话、相同宿主/范围/操作/预算下通过正常新领取首次启动，不重建旧凭据，不改变原截止，不恢复已有 attempt。这是首次启动前的显式操作重试，不是 P2 后继恢复。十二项正反工程场景、类型检查与实际只读核验通过；原 297 工具文件不变。只需发布页重新进行真实 H5；订单的原实际签发按原始日志与摘要保留，不冒充新批准。

2026-11-09 18:40:29（Asia/Shanghai）发布页 H5 已实际签发，订单在原授权内首次派发，随后通过实际准入并进入 TDD。两项按既定顺序运行；发布页等待订单结束再开始。原生会话仍为各自 H4 准备会话，工具来源冻结；当前未判为完成，需以实际 Native、完整功能/UI 观察和最终签名批次结果核验。

orders-r7 于 18:59:06 发布 incomplete/no-progress 退出，操作/领取对账完成，unknown 为空。实际 RED（三项行为失败）、GREEN（三项通过）、代码生成和 C7 完成，C8 的构建与三项测试通过，但阶段未完成：委托实施/验证引用缺失，项目级 C8 领取下正确的 design-write 被精确单元写入要求拒绝。后续无效写入参数没有绕过门禁。需修复 C8 前的精确单元元数据补录衔接，并以包含真实 H4 待实施决策的 CLI 工程回归覆盖；当前不能把已有构建/测试通过写成批次完成。

订单退出后，操作窗口文本选择暂停了父控制器同步输出。只读核对窗口标题和进程后，对该窗口发送 Escape 解除选择，父控制器于 19:05:23 正常记录原退出并首次派发发布页；没有重启订单或重建授权/领取。发布页进入 functional-design，继续独立验证。运行期间仍不修改 Core/CLI/宿主来源，当前两个业务批次均未取得最终 verified。

本轮实际试跑已全部结束：publish-r11 在同一真实 Codex 会话完成 functional-design、RED（十二项中十项行为失败，编译/环境通过）、GREEN（12/12 通过）和代码生成。首次生成报告的来源漂移与 tests/README.md 缺失 REQ 由 Agent 自行修正并重新取证；原 RED 命名输入未改。C7 受控 review-evidence 通过，但阶段尚未完成时原授权于 19:36:54.681 到期，实际退出原因为 HOST_TURN_TIMEOUT，19:36:56 发布 incomplete。不能把 C7 取证、零差异截图或 GREEN 当作批次完成。

真实核验见 [ended-attempt-audit-1794224298126](evals/autonomy/p1-10/ended-attempt-audit-1794224298126/result.json)：两份 grant 签名/会话身份、542 个公开原始归档文件摘要、两个历史 RED 输入全部通过；模型成功代填人类参数为零。两项 operations/claims 均已对账、unknown 为空、领取全部释放、自有服务全部关闭。发布页保存了 90 次通过的实际浏览器像素观察与真实结果导航，仍无最终候选签名矩阵。根无关工作流原 state/audit 摘要及控制路径缺席再次核对；运行结束前 297 工具来源保持原工程轮一致。没有 verification.json，P1-10 与整个 P1 未退出。

退出后修复：在完整 C7 与真实矩阵观察通过后、首次 C8 完成前，用正常 select 进入受影响精确单元，仅补录授权文档/委托引用，按单元在原预算内有界重试。之后重新准备候选并观察，再执行必要 Native 和正式 C8。显式人类 rework、审批 block、真实观察失败和历史输入变化继续阻断；Core 授权与数据契约不降低。补充真实公开 CLI 的预先 H4 决策、源/测试归属、补录、候选重观察、C8 与签名汇合回归，以及七项调度正反例。

操作端后续将两个独立试点在各自进程/环境/根目录和 grant 下并行派发，仍各为一个活动单元；两项均结束后才统一清理。原始运行流只落文件，终端总结在清理后输出，避免 Windows 控制台选中文字暂停调度或服务关闭。此修复未在旧 attempt 上热更新，旧两次仍保留原 incomplete。修复后的真实双试点尚待新工作流、新来源接收、当前工程/分发检查和真实 H5；本轮不重用旧授权，也没有请求新授权。

本轮工程收口完成，见 [post-run-validation-1794225940122](evals/autonomy/p1-10/post-run-validation-1794225940122/result.json)：30 项有效工程检查通过，整轮 28 项通过，两个夹具适配失败经单独定向复验通过，原始失败保持；不标记整轮全通过。36 项路由、七项 C8 前调度、真实 Core 写入范围及预先 H4 决策 → 单元补录 → 新候选观察 → 正式 C8 → Native → 签名汇合均有工程证据；其中模型/审查为安排的回调，不作为真实 Codex 业务成功。297 工具来源在整轮与复验保持同一摘要 a712110d3cfd85d9cb30cb4c41c088634b8a77db21ce0769ca97d4e2c4b444ac。FD-only 范围明示，不回填旧完整两单元 timeout。

十种 Harness、2948 文件一致性和三个选定分发检查通过；旧试跑实际使用的 297 工具原文另存 actual-tool-source-1794218305792，全部匹配原授权前来源。汇总复核两项 542 个原始公开归档、根 state/audit 原摘要与自主控制路径缺席，未生成业务 verification.json。P1-10 当前结论为“真实本轮已结束、修复工程已验证、实际业务验收未通过”；进入下一步仍需在修复来源上完成新的真实双试点，不能由本轮工程结果代替。

新一轮接收：按用户要求创建 orders-r8（workflow 9d775795-33c4-445e-9284-a67e1c30a17f，Native thread 01a1c056-cc14-7323-a714-2e7cd78d9a55）与 publish-r12（workflow e91b29bc-a974-4ee8-bf11-68c0b4a253e5，Native thread 01a1c057-5a1c-7970-b652-d3610496eecb），均为新隔离仓库和缺陷基线。发布页逐字节接收原获批设计与原基线对象，正常登记 H3；单模块/HTML Mock 使用原真实答复，没有复制完成行、旧证据、业务解法或 grant。两项当前 Native I13、完整 H4 显式采用与真实模型兜底计划完成，实现/验证引用仍为空、human_review=pending。

两项实际授权前预检见 [orders-r8](evals/autonomy/p1-10/orders-r8/pre-h5-1794228567628/result.json) 和 [publish-r12](evals/autonomy/p1-10/publish-r12/pre-h5-1794228889860/result.json)：真实服务、Native 计划、冻结入口语法、完整观察矩阵和静态接收/依赖项通过，缺陷基线确实被拒绝，未签名 preview 通过，真实 Codex 宿主无 grant 启动被拒绝。未创建 issuer/attempt，实施文件未变。运行期 Core/CLI/宿主来源继续使用修复后的同一版本；本轮补充测试 README 的预先需求追溯仅属新脚手架文档，发生在冻结前。

当前工程轮 engineering-1794228204922 按 H5 前严格要求重新执行完整 30 项，尚在收口；两项均无实际运行授权或业务实施。操作入口和原始证据归档范围已指向新批次，[新 H5 审阅页](evals/autonomy/p1-10/h5-review.md)保留精确范围、独立并行方式和真实终端要求，上一轮请求另存历史页。后续由真实终端签发两份新 H5，再开始实际连续实施，最终仍须两个真实 Core verified。

新轮 H5 前最终结论见 [operator-readiness-1794229484317](evals/autonomy/p1-10/operator-readiness-1794229484317/result.json)：engineering-1794228204922 完整 30 项本轮全通过，297 工具文件保持 a712110d3cfd85d9cb30cb4c41c088634b8a77db21ce0769ca97d4e2c4b444ac。distribution-1794229457122 的十种 Harness、2948 文件一致性及三个选定场景通过；首次构建目录占用的 EPERM 失败保留，检查结束后独立重建通过。最终只读核对两项新工作流/会话/范围、当前 HostRef、真实无 grant 启动拒绝、17 项完整性和类型检查，根无关 state/audit 原摘要与自主控制路径缺席均通过。当前工具 297 文件原文已另存 h5-tool-source-1794228204922。已完成可审阅的两份请求和实际预检，接下来打开真实操作端，仍不把静态准备写作 grant 或业务成功。

新窗口在 21:06:59（Asia/Shanghai）实际打开。两份 H5 由真实终端分别于 21:07:17.218、21:07:24.395 签发，Core issue 退出均为 0；订单 run 29a4112b-8765-41ab-9a58-ba202400c127 和发布页 run 5749eb49-195c-496b-b8eb-a61027d15aeb 于 21:07:24.396 / .402 首次并行派发。各自原生准备会话不变，未复用旧 grant 或 attempt，也没有代理终端输入。当前运行期间 Core/CLI/宿主来源冻结，需等实际 Native、完整功能/UI 与最终批次汇合；尚不判为通过。

orders-r8 于 21:19:29 incomplete 退出，operations/claims 对账完成、unknown=[]。它实际完成 RED（三项业务失败）、GREEN（三项通过）、C7 和候选 eca1049361d254a75fcfd687ff9371a2753e944e 的提交/自有服务重启。随后宿主直接执行完整 observe run，Core 的准入凭据到期检查拒绝，未取得完整矩阵和批次结果。原 grant 尚未到期，不等于准入凭据仍有效；当前只在普通实施路由刷新准入的宿主路径遗漏了 C7 后局部空预览/候选到完整观察这一衔接。不可降低 Core 拒绝或重启已结束 attempt。

纯工程调度回归 [admission-expiry-before-fix-1794230712023](evals/autonomy/p1-10/admission-expiry-before-fix-1794230712023/result.json) 在相同当前工具来源复现：候选成功后到期，observe run 之前没有重新检查准入，异常直接退出。发布页仍按原来源运行，暂不修改 Core/CLI/宿主；后续修复应在完整观察/汇合等宿主检查点重新验证准入，在原 grant/budget 内重新预检，避免重放已完成提交。原始失败与 C7/候选成功片段均保留，待两项服务结束后归档。

publish-r12 于 2026-11-09 21:39:36.923（Asia/Shanghai）以 incomplete/no-progress 结束，21:39:39.990 两个自有服务均关闭。实际 FD、RED（十二项中十项行为失败，编译与环境通过）、GREEN 12/12，以及十种状态/尺寸共 56 次通过的真实像素观察均保留；代码生成未完成，也无最终签名批次结果。单个 GREEN 生产者本来会成功退出并将证据写盘，但宿主错误要求 stdout 为 JSON，把成功空输出计入失败预算，之后真正的准入到期与重复重试拒绝阻断收口。不能将这些片段标为完整业务通过。

退出后先完成 [ended-attempt-audit-1794231674913](evals/autonomy/p1-10/ended-attempt-audit-1794231674913/result.json)：两个真实授权签名与会话、412 个公开原始文件摘要、历史 RED 命名输入、操作与领取对账、无未知操作及服务关闭均核验通过；运行结束时 297 工具来源仍为原 a712110d3cfd85d9cb30cb4c41c088634b8a77db21ce0769ca97d4e2c4b444ac。根无关工作流保持原 state/audit 摘要与自主控制路径缺席。之后才修改运行时，原 attempt 不恢复、原 grant 不复用。

本轮宿主修复在候选、完整观察和最终汇合前检查实际准入，过期时使用冻结计划和正常协调 binding，在原期限与预算内重新执行预检；已完成候选不因续验重放。只对已确认对账的 Core 准入竞态有界重试，未知操作、缺计划、不支持能力、授权到期与其他拒绝继续停止。单个 RED/GREEN/baseline 生产者的真实 exit 0 空输出仅投影为 command-completed、evidence_verified=false，阶段与业务有效性仍由 Native/Core 门禁判断。新增十二项准入检查点场景、十一项空输出边界，以及实际公开 CLI 单 GREEN 生产者回归均通过；正在执行修复来源完整 32 项工程轮，未把之前来源的检查冒充当前通过。

按用户要求创建全新 orders-r9（1e18639d-d49e-4b31-9dcf-afa6ba6de08e）与 publish-r13（da3b7b9d-b06e-4a0d-8469-6f7e1d8abfba），重新接收原真实设计、实际 Native 取证和 H4，发布页复用原已批准的逐字节快照及单模块/HTML Mock 选择。当前尚无新 H5 或实际业务通过；后续完成当前工程/分发与预检，再打开真实操作终端。

新轮最终授权前结论见 [operator-readiness-1794233768446](evals/autonomy/p1-10/operator-readiness-1794233768446/result.json)：engineering-1794232442296 完整 32 项本轮全通过，297 工具文件在整轮前后保持一致，摘要 63488681fff2a56f672440bbc38301e98b5943230e8464a8516cb16e8dec29d1，原文另存 h5-tool-source-1794232442296。distribution-1794233729366 的十种 Harness 构建、2948 文件一致性与选定烟雾共三项通过；全部工程进程结束后单独重建，没有并发清理分发目录。FD-only 范围保留，旧完整两单元 timeout 不冒充通过。

新订单 [pre-h5-1794232838792](evals/autonomy/p1-10/orders-r9/pre-h5-1794232838792/result.json) 与新发布页 [pre-h5-1794233150931](evals/autonomy/p1-10/publish-r13/pre-h5-1794233150931/result.json) 均核验实际服务、完整 Native/观察计划、冻结入口语法、缺陷基线拒绝、未签名 preview 和真实 Codex 无 grant 启动拒绝。最终操作端检查还核对当前独立身份/HostRef/范围、17 项完整性与类型检查、旧真实所有权拒绝、全部原始日志摘要及根 state/audit 原摘要和控制路径缺席。两项真实模型 H4 决策均缺实施/验证引用、human_review=pending；当前没有 grant、attempt 或业务 verified。已准备 [新请求审阅页](evals/autonomy/p1-10/h5-review-orders-r9-publish-r13.md)，接下来由真实终端签发，不能用工程结果替代两个业务的最终验收。

2026-11-09 22:17:18（Asia/Shanghai）已按用户要求打开标题 orders-r9 + publish-r13 的真实 H5 窗口，操作窗口进程 PID 39968。22:17:20 订单自有服务启动，等待真实操作人确认第一份精确请求；父进程不读写 stdin，两份签发后才并行首次派发。当前没有代理输入、聊天批准、运行 attempt 或业务成功声明，窗口待确认状态不构成 P1-10 退出。

用户随后在真实终端完成两份精确 H5。订单和发布页的 Core issue 分别于 22:18:50.602、22:19:08.012 exit 0，公开控制器签发事件均保留；22:19:08.064 / .069 两项首次并行派发，run 分别 bfa59bc3-e344-4775-b6a6-c4dd7403fe6d、e4992ddb-db87-4840-a0d1-59c76966bdb2。没有待签发请求，没有代输或将聊天窗口确认当作授权；当前工具来源继续冻结，仍待实际准入、Native、完整功能/UI 矩阵及最终签名批次验收。

orders-r9 于 22:38:10.291 发布 incomplete，end_reason=delegated-completion-exhausted；operations_reconciled、claims_reconciled 均为 true，pending_unknown=[]。实际 RED 三项行为失败、编译/环境通过，GREEN 三项通过，代码生成与正式 C7 完成；候选与完整矩阵观察通过，实际证明本轮准入检查点与单 phase 空输出修复已越过旧阻断。但三次有界元数据补录均未完成合法委托引用：实际返回包括 unsupported decision validation fields、validation must bind a real batch check 和 HOST_EQUIVALENT_RETRIES_EXHAUSTED。正式 handoff 仍为 revision 1、实施/验证引用为空，human_review=pending；没有 C8 或最终批次结果，不能将候选或矩阵通过改记为业务 verified。发布页仍在原工具来源下运行，暂不修改 Core/CLI/宿主；订单 attempt 不重启，等两项真实服务退出后归档和最终核验。

publish-r13 实际完成 FD 和 TDD，于 22:43:27 进入代码生成；接受的 RED 十二项中十一项业务失败、编译/环境通过，GREEN 12/12。首次完成报告因取证后计划文档变化而被 scope digest 拒绝，Agent 在原授权内重新预检并重跑 GREEN，最后成功工具事件为 22:54:24.919。其后宿主失联：实际进程查询未见 AI-DLC 宿主，已知窗口 PID 39968 与两个服务 PID 均不存在，两端口实际 ECONNREFUSED；没有 exit.json、控制器 result 或正常关闭记录，不能记为正常退出。

用户确认没有主动操作终端或电脑；目标时段的崩溃/电源日志查询仅返回 NoMatchingEventsFound，不能据此推断中断原因。只读 [失联调查](evals/autonomy/p1-10/publish-r13/interruption-investigation-1794236614888/result.json) 验证原授权签名，原到期时间 23:18:51.833 晚于最后活动；130 项已记录的网关操作都有终态，但原生 turn 最终状态仍 unknown。原 workspace-detection 与 code-generation 两个领取保留，未恢复 binding、释放领取、续签 grant 或重启 attempt；P1 单会话边界继续生效，P2 恢复没有提前实现。

本轮最终证据收口为订单 [83 文件正常 incomplete 档案](evals/autonomy/p1-10/orders-r9/actual-run/manifest.json) 与发布页 [495 文件异常中断快照](evals/autonomy/p1-10/publish-r13/interrupted-run/manifest.json)，后者 actual_exit=null，不伪造退出和清理回执。最终 [interrupted-attempt-audit-1794236912565](evals/autonomy/p1-10/interrupted-attempt-audit-1794236912565/result.json) 逐一核对共 578 个原始文件、两份实际授权签名与会话、历史 RED 输入、订单三份签名 matrix 观察、发布页 90 次通过的实际像素观察和十个状态/尺寸组合。私有授权留原目录，没有复制；根无关 state/audit 与控制路径缺席再核对通过，297 工具来源始终为授权前 63488681fff2a56f672440bbc38301e98b5943230e8464a8516cb16e8dec29d1。

订单 [决策诊断](evals/autonomy/p1-10/orders-r9/decision-diagnostic-1794235371529/result.json) 保存四次实际 record、零次成功，其中一次提案内容变化后仍被同参数重试限制拒绝；“内容变化”不等于“提案已合法”。后续需补齐可消费的 validation_refs 字段、真实 check IDs 与规范命令，并让重试键识别真实输入变化且不能被参数拼写/文件名规避。准入实际受固定五分钟 native report 限制，与长命令启动/结束校验的窗口也须衔接；失联前的持久进程/turn 身份和终态对账需补强，不能靠改旧收据、延长旧 grant 或手写 completed 掩盖。

退出结论：本轮两个新工作流、设计接收、H5 前检查、真实授权和试跑核验均已执行并保留原始证据，但 P1-10 与整个 P1 未通过。订单未完成合法委托引用和 C8；发布页未完成代码生成/C7/C8、最终候选和签名完整矩阵，且残留两个未对账领取。Native 功能/十组合 UI 的通过片段与 32 项工程、三个分发通过分别记录，不生成 verification.json，不将框架完成、业务完成或 P2 恢复提前宣布。

## 23. P1-10：三项阻塞修复、追加调查与新 H5 前准备

日期：2026-11-10（Asia/Shanghai）。本节替代第 22 节末尾“尚待修复”的当前工程状态，历史试跑事实保留。范围是用户明确要求的三项工程阻塞、失联调查、测试和新试点准备；没有签发新授权或开展新业务实施。

Core 从真实决策、策略和矩阵投影只读 write_contract，单一字段列表提供扁平 validation_refs、实际 check IDs、不可变提案、下一 revision 及 handoff CAS。宿主读取真实观察文件原始 SHA-256，提供可直接消费的补录提示；仍由模型读取实现、正常 record 并保留 human_review=pending。等价重试归一化参数和真实输入：文件名、JSON 排版、键顺序和 CAS 猜测不能绕限；提案内容或生产者实际输入变化可以重试，原 wall deadline 不变。

真实 Native 探针有效期改为自实际开始起最长 900 秒并以原授权截止封顶。长命令、受控生产者、报告、完整观察和最终汇合派发前，检查执行上界及 10 秒发布余量；不足时在原协调 binding 和冻结计划内重新准入，恢复精确正式入口。实际子进程期限受命令、wall budget 和准入窗口三重上限约束；未知操作和真实拒绝继续停止。

宿主在既有 attempt 中同步落盘生命周期 journal：OS 进程出生标识、Native/Core/tool 操作、turn 派发/绑定/终态、心跳、取消、实际关闭与退出。离线 inspect-run 在读取模型配置前执行，保留 PID 重用、身份不完整日志、未知 turn/操作和未关闭 Native 子进程的未对账结果，不写 exit、不释放未知领取、不重建 binding。两份真实 H5 后的首次启动改为一次性私有 IPC 转交独立 worker，服务/Native/日志不依赖父终端输出管道；已有 attempt、自动重启、successor 与接管恢复仍拒绝。具体字段和职责见 [契约第 19 节](aidlc-autonomous-contracts-v1.md#19-p1-10决策写入长命令与宿主失联)。

失联 [追加调查](evals/autonomy/p1-10/host-loss-followup-1794241286100/result.json)再次核对 578 个历史公开文件；Native 自身 rollout 最后同样只有 22:54:24 的 item_completed，没有 turn 终态。相关系统事件没有目标匹配，缺少记录不证明没有外部终止；用户已明确没有主动操作窗口或电脑。**具体 OS 终止触发者仍为 NEEDS_CONTEXT/undetermined**。已复现并修复生命周期耦合和可观测缺口，不把测试强制杀进程当作当晚触发者的证据。旧 publish-r13 的两个领取、日志、无 exit 状态与未知 turn 保持原样。

修复前失败保存为 blocker-red-1794238566566、1794238772697、1794239098042。第一完整轮 engineering-1794241285856 为 39/40，旧准入夹具漏掉新增受检 read；修正仅在夹具中补充 seeded 观察/契约，12 个场景通过，原失败保留。最终 [engineering-1794242556345](evals/autonomy/p1-10/engineering-1794242556345/results.json) **40/40 全通过**，包括完整真实 Core CLI 补录→候选→观察→C8 签名工程汇合、功能/浏览器、授权/依赖、异常进程、两个类型检查及 FD-only UC-D。后者不替代旧完整两单元流程。297 工具与 326 测试/控制器输入整轮不变；工具摘要为 `675f6436b73eb757d0fe509aada6ca852c9ffc0b97e3155689bfa862c1742e5a`，[297 原文归档](evals/autonomy/p1-10/h5-tool-source-1794242556345/manifest.json)逐一核验。

全部工程进程结束后，独立 [distribution-1794243641819](evals/autonomy/p1-10/distribution-1794243641819/results.json) 三项通过：十种 Harness、2948 文件一致性及选定烟雾。Core 源规则、Codex README、离线命令和契约说明已同步；未安装到全局 Skill。[双轴复核](evals/autonomy/p1-10/blocker-review-2026-11-10.md)在工程范围 DONE，真实业务验收仍 OPEN。

在上述验证通过后才创建 orders-r10（workflow 82acdaff-8be0-4169-b97b-bf495ea62744，thread 01a1c142-70fd-70e1-9a79-a6bd435a5c14）和 publish-r14（workflow 57b9e8da-2858-4e99-89ce-ca05f90ea750，thread 01a1c142-df17-7243-a773-8fb28b43e53f）。均为独立缺陷脚手架，重新接收原设计、执行当前 Native 生产者与 I13、H4 采用和真实模型兜底计划；发布页正常登记原逐字节批准的 H3 设计及原 Git 基线。没有复制旧实现、完成行、证据、授权或 attempt，也没有重复要求相同设计批准。

[orders-r10 H5 前检查](evals/autonomy/p1-10/orders-r10/pre-h5-1794243943209/result.json)与[publish-r14 H5 前检查](evals/autonomy/p1-10/publish-r14/pre-h5-1794244207890/result.json)均通过：实际服务、完整 Native/观察计划、冻结入口、静态接收/依赖、缺陷基线拒绝、未签名预览和真实 Codex 无 grant 启动拒绝。模型仍为实际 gpt-6.1-sol / Codex 0.164.0；原生配置摘要 86d159ab4ca8f0525245eab10fb8bc4330a756df7072c71cac8eb1ddbcbf3a5b。功能与 UI 分母、像素阈值均保留。

最终 [operator-readiness-1794244236646](evals/autonomy/p1-10/operator-readiness-1794244236646/result.json)与[只读审计](evals/autonomy/p1-10/blocker-exit-audit-1794244294631/result.json)确认当前来源、全部原始日志、根无关 workflow 16329858-cfdd-47ec-a168-9b8b6fd8850e 的 state/audit 原摘要及自主控制路径缺席；两项新批次无 grant、无领取、无 issuer、无业务 attempt、实施文件未变。两份完整可审阅请求见 [H5 审阅页](evals/autonomy/p1-10/h5-review-orders-r10-publish-r14.md)。本轮没有打开授权窗口，没有生成业务 verification.json。

退出结论：本次三项工程阻塞修复及新试点/H5 前准备已完成。历史失联触发原因仍未确定；新业务试跑尚待真实 H5。P1-10 与完整 P1 均未通过，P2 恢复能力没有提前实现。

## 24. P1-10 整体集成与执行效率复审：HOLD

用户要求先停止真实试跑，归并历次失败并审计效率，优化调整完成并确认后再试。当前 [整体复审与收口计划](aidlc-autonomous-p1-10-integration-review.md)完成，生产优化尚未实施，不继续请求 H5；第 23 节的 40/40 和预检保留原覆盖范围，不能作为整体 Go。

[离线历史审计](evals/autonomy/p1-10/integration-audit-2026-11-10/history-efficiency.json)核对 23 个准备项目、7 轮共 13 次真实运行及 13 个工程轮记录。业务最终 verified 为零。已观察项目时长合计约 230.2 分钟、墙钟并集约 199.0 分钟，单次中位数约 17.4 分钟；可计算的工程检查时段约 161.3 分钟，不能与项目时长简单相加。最后两轮 40 项检查合计约 36.1 分钟。原始文件 SHA、区间计算与不可归因部分均记录，不把未记录时间假定为模型思考。

根因归并为冻结/证据失效、可消费契约/准备校验、路由/完成顺序、窗口/预算、结果格式、重试/进度、生命周期、集成验证治理八族。已有局部修复有效，但不能推导同族所有路径关闭。四项 [局部工程复现](evals/autonomy/p1-10/integration-audit-2026-11-10/path-gaps.json)确认 command 输入依赖、metadata 窗口 hook、最长命令可行性及单 turn 语义预算仍有缺口；浏览器/服务/父 worker 关闭、候选/委托顺序、同 attempt 受控返修三项尚需注入/集成或设计确认。它们不都已导致当前试点失败，也不等于 Core 权限被绕过。

效率审计定位早期授权后串行排队、读规则/文档及模型往返、逐个 Node/Chrome 冷启动、重复 phase/候选验证、过粗能力探测和重复工程前缀。orders-r9 的 133 次工具调用中有 85 次 read/rule，而最终 GREEN 命令仅 280ms；publish-r13 的最终 RED/GREEN 分别为 126.1/81.2 秒且有多次重跑。39 份成功能力探针可测约 21.2 项目分钟，失败/超时未归档部分不计，不能称为全部探针时间。

收口顺序为统一动作/窗口策略、输入身份、同 attempt 合法返修设计、turn 内监督和耗时分段、全资源有界关闭、选择性预检/能力复用、控制面与 UI 性能、实际 wire/main/worker 集成，最后一次冻结来源验证。L0/L1/L2 使用无模型隔离工程、真实 CLI/HTTP/浏览器及明确的协议夹具；L3 只在优化 Go 和用户确认后进行，每项目一个授权 attempt，允许其中正常的预算内 TDD 修复，出现新框架缺陷或最终失败不自动开下一轮。

当前 [复审状态](evals/autonomy/p1-10/integration-audit-2026-11-10/review-status.json)为 HOLD_PENDING_OPTIMIZATION。该文件记录用户指令和文档状态，实际入口执行闸仍待 IT-00 接入，不能声称已改造运行时。r10/r14 保持未授权，旧发布页两项领取和失联结论不改；本次没有新试点模型会话/探针、业务试跑、授权、生产代码修改或旧 attempt 恢复。


## 25. P1-10 IT-00/IT-01：入口闸、统一派发与局部收口

按用户本次授权修改 Core 共享时间策略、Codex Harness 和 P1-10 评估入口；只完成 IT-00/01，保持 P1/P2 边界。真实试跑、原生模型探针、新试点、H5、旧 attempt 恢复均未启动。[验收索引](evals/autonomy/p1-10/it-00-01-acceptance.json)保存当前完整来源、原始日志摘要、通过项复用依据和现场保全；[设计/动作矩阵](aidlc-autonomous-p1-10-integration-review.md)第 9 节及[契约](aidlc-autonomous-contracts-v1.md)第 20 节同步更新。

IT-00 在固定 bootstrap 中先判断 HOLD/Go，HOLD 不读取试点状态、不领取、不启动服务/Native、不请求 H5。--check 输出结构化 HOLD/ready=false、空 pilots；--retry-unstarted、直接真实 runner/worker 与 PowerShell 路径不能绕过，历史单项目入口退休。Go 必须完整验证同一来源的 L0/L1/L2/分发、效率证据和宿主登记的用户确认，源/证据/确认漂移即拒绝。Go 只是工程闸，execution_authorized/business_verified 永远为 false，仍需当前设计/HostRef/准备检查和真实 H5；没有扩展普通未采用 workflow 的要求。

IT-01 以共享 describeAction/prepareDispatchAction 统一模型 Gateway 和宿主直接完整观察/汇合的派发检查。metadata 只开放 read/rule、受检 design-write、有限只读 Core 和 decision-record；任何冻结命令、证据生产、阶段 report/next（含 preview）、完整 observe（含依赖预检）、finalize 和代码/测试写入，在 Core 调用、窗口续验、失败计数和文件变更之前拒绝。origin/mode 不由模型提供，受禁参数等价写法也不能放行。Core 授权、撤销、领取、CAS 与 human_review.pending 保持原规则。

Core 与 Harness 消费同一 native-host-action-policy.json，字节参与 HostRef。能力上限 900000ms、余量 10000ms、普通 Core/阶段生产者 180000/600000ms；timeout+余量达到能力上限则配置提前拒绝。静态通过仍须动态实际窗口；宿主与模型长动作都受原 grant/wall budget、pending/unknown、正式重入检查约束。授权检查期间窗口过期会在子进程启动前拒绝，不再 clamp 成 1ms 启动；在途新动作拒绝，取消/持有绑定正常释放沿用旧链，不增加接管、重建或后继权限。

验证结果：18 个受影响测试文件组均有通过证据；新增 Node test 16 个场景及实际入口 13 项检查。两项类型检查、十种 Harness 构建、2958 文件一致性和选定 Codex 分发 3 个烟雾场景通过。没有再运行完整 40 项昂贵工程前缀，L2/L3 未验收。实际 Core CLI 的单 GREEN 无输出传输、C8 写入拒绝及单元决策补录仍通过，保留原 RED、源码测试与 pending 人类复核。

初始红测保留在 it-00-01-red；首个 17 组轮次为 16/17，失败是独立 Gateway 规则夹具漏装窗口检查器。修正夹具为消费真实 Core receipt，仅重验受影响组；此前六组夹具升级失败亦原样保留。最后为控制器增加输出目录隔离，并重验对应规则/入口；其他通过项在生产与各自测试输入不变时复用。汇合记录逐一验证原始日志 SHA-256，明确来源差异，不把失败轮改写为全通过，也不将局部耗时当作真实业务效率目标已达成。

现场核验：590 个历史离线审计输入摘要均未变；根无关 workflow 的 state/audit 原摘要及自主控制路径缺席未变；orders-r10/publish-r14 无 grant、无 active claim、无业务 attempt、无新 UC-D 实施测试。旧 publish-r13 的两份原始日志、两个领取和无 exit 状态未变，具体中断触发者仍 undetermined。

退出结论：IT-00/01 局部完成，IR-02/03 局部关闭；IR-01/04/05/06/07 和后续 IT-01B～08 继续开放。当前决策 HOLD_PENDING_OPTIMIZATION，整体优化、P1-10 与 P1 未通过，P2 未实施。当前工具来源变化使旧 readiness 不能充当 Go；本次不刷新现有试点、不派生新工作流。下一步按收口依赖处理同 attempt 返修和输入身份，再进入进度、生命周期、性能与分层集成验证。


## 26. P1-10 IT-01B：同一 attempt 的有界返修

按用户授权完成 Core 失败接收/合法回退与 Codex 宿主接续，保持 P1/P2 边界。[验收索引](evals/autonomy/p1-10/it-01b-acceptance.json)保存全部通过项、原始失败日志引用、来源摘要与复用边界；[设计第 10 节](aidlc-autonomous-p1-10-integration-review.md)及[契约第 21 节](aidlc-autonomous-contracts-v1.md)同步更新。没有启动真实模型、试点或新工作流，没有请求 H5，也未刷新 r10/r14 准备。

Core 新增 repair start/inspect/request/apply：从签名完整矩阵或实际 GREEN 失败观察接收证据，核验当前范围、源/环境、原权限、单元和活跃 attempt。模型只提出 code-defect/test-correction/scope-change/unknown；Core 生成带 plan_digest 的精确失效/回退计划，宿主正常 select/bind，Core 用普通 publication/save 协议更新状态，记录前后 revision 与 repair-reopened，保留旧 history/审批/设计。Core 不管理模型调度，宿主不手改 state、不自行裁定合法回退。

代码缺陷保留 TDD 和原 RED，重做代码生成/C7及必要项目消费者；测试修正只开放列出的测试输入，受控刷新原 I13、取得新 RED/BASELINE 后再实施，不能减少 UC-D/测试分母或改动独立验收/UI 来源。RED、输入、I13、受影响 Native 与真实失败先归档。失败 GREEN 单独签名留真实 stdout/stderr/退出码/输入/版本，原 GREEN 生产者仍拒绝，不把预期 RED 当失败。多单元矩阵归属不明、环境/外部依赖/未知问题或范围/权限变化均拒绝自动回退。

首次业务 turn 前用原协调 binding 注册当前宿主 OS 身份；旧 attempt 不能补登记，PID 不是凭据。周期合计最多原 max_equivalent_retries 且封顶两轮，分类/候选变化不清零，原 grant、wall deadline 与串行单元约束不变。诊断回合只读和 inspect/request；宿主也消费普通实施回合已经登记的计划。正常 turn 没有受控生产失败或 pending 计划时不额外探测。回退 applying→applied 无法对账时保留 uncertain/unknown 和领取，不重试、不接管、不重建，不提供 P2。

验证包括 23 个受影响测试文件组：Core 实际授权/HTTP/命令失败/精确回退和拒绝，真实 driveBatch/Gateway 的脚本化分类/中断/预算/部分未知，原生传感器与旧兼容回归。实际 Core CLI/生产者/Gateway 工程链在一次活跃 fixture 内完成“错误测试/实现→独立矩阵拒绝→新 TDD→失败 GREEN 留证→代码修复→GREEN/C7/C8→原完整矩阵通过”，耗时 173075ms；前置设计/审查与授权明确 seeded/simulated，不等于真实模型或业务 H5。[公开原始证据](evals/autonomy/p1-10/it-01b-1794277946642/case-test_attempt_repair_native.ts/native-repair/manifest.json)64 个文件、12 个 Ed25519 签名通过，原 RED 与失败可检查，未导出私钥或 binding。

验证治理：首个 23 组轮次为 22/23；补齐工程夹具的 C8 正式 next 后只重验该项。此前夹具保留自身领取、直接 CLI 报告后未使用生产 Gateway、短能力窗口与服务重启后未重新预检等失败均保留，生产拒绝未被放宽。此后加固“rejected 不能解除既有 accepted 的 RED/测试保护”和可选统计的签名往返，并只重验 Core/宿主/契约；最后将编辑工具产生的 CRLF 整文件差异规范为 LF，局部四组、类型与分发检查通过。验收程序逐一核验日志、当时 Core 原文、仅允许的拒绝/可选字段增量和纯换行差异；不把历史 Native 结果当作当前运行时证据，不宣称完成当前来源冻结 L2。没有重跑完整 40 项昂贵前缀。

最终当前来源验证：两个类型检查，十种 Harness 构建，2968 文件一致性及选定 Codex 三个 CLI 烟雾场景通过；未采用模式保持原行为。一次生成目录 EPERM 保留原日志，确认目标为仓库 dist/codex 普通目录后有界重试成功；未改变权限或安装全局 Skill。

只读现场保全核验通过：590 个历史审计输入摘要不变，根无关 workflow 的 state/audit 原摘要与自主控制路径缺席不变，r10/r14 无 grant/领取/attempt，新 UC-D 实施文件不存在；旧 publish-r13 两份日志、两个未知领取及无 exit 状态未变，具体外部中断触发者仍 undetermined。

退出结论：IT-01B 在声明的接收/拒绝范围内局部完成，IR-07 局部关闭；当前仍 HOLD_PENDING_OPTIMIZATION，IR-01/04/05/06、最终 L2 与整体效率验收继续开放，P1-10/P1 未通过，P2 未实施。下一主线为 IT-02 输入身份与变更分类，不启动真实试跑、不创建新试点。

## 27. P1-10 IT-02：输入身份、提案隔离与候选一致性

用户授权仅执行 IT-02；不启动模型、真实试跑、H5，不创建或刷新试点，不恢复旧 attempt。本项修改生产 Core、Codex Harness、协议和分发；[验收索引](evals/autonomy/p1-10/it-02-acceptance.json)记录通过证据、失败分类、来源与现场保全。

实际关闭的生产缺口：

1. IR-01 的冻结命令只哈希 input_paths，漏掉真实源码。Core 新增 execution_inputs，宿主合成真实源/文档、声明环境、冻结动作/可执行文件及额外文件依赖的身份。同 argv 别名、JSON 排版/路径、纯提交、控制证据或默认决策元数据不再买到等价重试；真正源/环境变化可获原预算内的新身份。身份缺失在派发前拒绝，原授权期限不变。
2. IR-06 的草稿可能随 delivery 提交。Core 派生暂存路径并校验精确单元/记录；宿主拒绝交付目录结构化提案与直接覆盖 handoff。只有 Core 合法 record 才原子合并规范元数据；拒绝草稿保留在控制区。候选检查另行拒绝强制加入 Git 索引的提案。
3. IR-06 的逐单元元数据更新反复生成候选。宿主在必要前置观察后分别刷新每单元 CAS，集中处理元数据后准备最终候选。四单元脚本调度检查断言候选与完整观察均仅初始/最终各一次；保留必要的两次完整观察，不将此作为真实多单元或端到端性能通过。
4. 候选准备采用提交敏感的 candidate_input_digest。Core 既有 clean、服务版本、环境和完整矩阵屏障继续生效；新元数据使旧矩阵失效，历史验证引用不替代最终 current_validation。新增真实 Core 观察器/HTTP 聚焦集成证明旧服务提交失败、新服务及完整矩阵通过，原成功/失败收据未改写。

验证顺序：先保存真实源码变化未改变 command key 的短 RED，再通过输入分类、Core/Gateway 暂存/拒绝/合并、精确单元和调度边界；随后只补聚焦候选集成。首轮六文件约 34.6 秒，候选集成通过约 20.8 秒；这些是工程检查耗时，不是业务交付效率。后续受影响的局部回归、类型检查与分发结果以索引为准，未运行完整 Native 长链或最终 L2。

测试夹具修正单独保留：最初的工程预算字段遗漏不是产品 RED；聚焦集成首次错误地只接受 ready，其后确认共享夹具只有 command 检查、不能验证 HTTP 服务提交，再修正 HTTP 断言 equal 操作符。分别在秒级检查内停止并保留原文；均不算生产缺陷或真实试跑。随后按真实 schema 检查完整边界后定向验证，不通过反复长链定位。

退出范围：IR-01 及 IR-06 的输入身份、草稿隔离、无效重候选和候选准备子路径局部关闭；完整原生传输/主进程/worker 集成与性能结论仍须 IT-07。IT-03 无进展预算、IT-04 全资源生命周期、IT-05/06 复用与性能、IT-08 Go/有限终验仍开放。P1-10/P1 未通过，P2 未实施，HOLD 不解除；r10/r14 保持未授权，旧 r13 失联原因仍未确定。

最终核验：14 个受影响局部/聚焦集成文件通过，选取的通过记录累计 67.3 秒（不是本轮总耗时或业务交付耗时）；两个类型检查、十种 Harness 构建、2978 文件分发一致性与 Codex 三个分发场景通过。Windows dist/codex 首次 EPERM 在核验普通仓内目录后仅重试一次，保留原始错误。当前 701 文件来源在冻结后未变，三份真实工程观察的 Ed25519 签名、原始输出及候选源摘要核验通过；没有运行 Native 长链或最终 L2。590 个历史输入、根 state/audit 和自主控制路径缺席均保持不变；r10/r14 无授权/领取/attempt，旧 r13 两份日志/两个未对账领取及无 exit 状态保持原事实。完整原文见 [IT-02 归档](evals/autonomy/p1-10/it-02-validation-1794282721539/results.json)。


## 28. P1-10 IT-03：回合内进度、预算与耗时

本项只执行用户授权的 IT-03，保持原 Supervisor、grant、session binding 和 P1/P2 边界；没有模型试跑、新试点、H5 或旧 attempt 恢复。[验收索引](evals/autonomy/p1-10/it-03-acceptance.json)保存来源、局部检查与原始 trace。

实际关闭 IR-04 的生产路径：

1. 原来 25 次相同成功读取在同一 turn 内全部放行。现在 Gateway 在回合内按规范动作和稳定结果识别重复，成功读取仍不算失败命令重试。默认允许六个相同结果，第七次读取观察到仍相同时停止；不在读取前猜测字节，真实新结果不会按旧结果误计。
2. 活动、未验证 work-change 与 Core 检查点分开留痕。新回执 UUID、PID、时间、心跳及单纯读取不刷新进展窗口；合法新内容和 Core 真正变化也不能清空全 attempt 步骤/回合额度。字节变化不宣称业务语义正确，原 Native/RED/完整矩阵仍为质量权威。
3. 冻结 supervision_limits 增加总步骤、总回合、每回合步骤、无进展步骤、重复、空闲及步骤/回合时间上限，只能收紧共享策略并绑定 HostRef。实际 Core/冻结命令在原受检上界内登记 bounded work；等待暂停空闲/模型控制计量，原 wall 和命令截止继续流逝，系统时钟回退不延长额度。
4. 所有实施、补录和诊断回合复用相同监督包装。停止走既有 abort/interrupt，ACK 不能当作 turn 结束；未确认仍 unknown。Native 提前 completed 也等待已排队工具及 Gateway 对账，不能提前推进。只加本项所需的取消确认上限，不宣称完成 IT-04 的全资源生命周期。
5. 原 host-runs 新增 execution-trace.jsonl 与 exit.execution_timing。步骤、回合、父 span、安全动作族、单调耗时/UTC、输入摘要和停止原因可追溯；Core 受控观察追加签名 timing。按区间归属处理嵌套/重叠，不把 queue、生产者和父回合重复相加，也不把 model-rpc 当成模型思考时间。

先保存旧读取循环的短 RED，再通过假时钟预算与真实 Gateway 边界；脚本化 RPC 对端运行真实 CodexClient、Gateway、driveBatch 和自有 Node 命令，覆盖 loop/idle/long/unknown/driver-loop/early-long 六种情况。使用真实 HTTP/Core 观察的聚焦候选回归验证签名 timing 与候选/环境门禁，未运行完整 Native 长链或真实模型。通过项、耗时与复用边界以索引为准，不据此宣布真实交付效率达标。

夹具与基础设施单独归因：node --test 的默认隔离子进程曾被沙箱拒绝，改为同进程 Node test 运行；RPC 隐私断言最初将合法 code-generation 阶段名误匹配为 generation 字段，修正字段正则后通过，原文保留。它们不是生产缺陷或真实试点失败。

退出范围：IR-04 在上述回合/步骤/计量生产路径局部关闭；整条 wire/main/worker、外层资源、选择性复用、真实耗时与最终 Go 仍由 IT-04～08 收口。整体 HOLD、P1-10/P1 未通过、P2 未实施保持不变，r10/r14 与旧 r13 现场不变。

最终核验：19 个受影响文件组有通过证据，选取通过记录累计 74.2 秒（不是本轮总耗时或真实交付效率）；两个类型检查、十种 Harness 构建、最终 Codex 定向重建、2979 文件一致性及三个分发兼容场景通过。六份实际 RPC/Node 运行 trace、三份 Core 观察签名/单调 timing 与原始输出已核验。最终审查另复现“问询被误当完成报告检查点”，仅收紧一行返回类型判断；新增问询/已接受/重复短用例和六项 wire 场景通过，精确字节差异证实 Core 生产者与其他依赖未变，复用已通过路径，没有重跑长前缀。遗漏 tsx loader 的夹具入口已补执行，原失败保留。当前最终来源共 706 文件，完整冻结 L2 与真实性能尚未通过。

只读保全：590 个历史输入摘要、根 state/audit 与自主控制路径缺席不变；r10/r14 无授权/领取/attempt，旧 r13 两个未对账领取、两份日志及无 exit 状态不变。证据与精确复用依据见 [IT-03 归档](evals/autonomy/p1-10/it-03-validation-1794285978284/results.json)。


## 29. P1-10 IT-04：资源归属、截止与异常对账

本项按用户授权完成 IR-05 声明路径的生产修复与局部验收，详见[契约第 24 节](aidlc-autonomous-contracts-v1.md#24-it-04-资源所有权截止与异常对账)、[整体复审第 13 节](aidlc-autonomous-p1-10-integration-review.md#13-it-04-资源生命周期收口2026-11-10)及[验收索引](evals/autonomy/p1-10/it-04-acceptance.json)。整体仍 HOLD，不构成 P1-10/P1 通过。

| 生产路径 | 本次关闭的缺口 | 局部证据 |
| --- | --- | --- |
| browser / CDP / profile | 实际 close 独立于 exit/终止请求；共享绝对清理截止；未知保留 profile；已知关闭后才删除精确拥有目录 | 14 项共享资源短边界、真实 Chrome 导航、startup 边界 |
| service / 生成的 test support | 创建即登记，startup/stop 有界；授权环境过滤；成功/回调失败均关闭；未知跨进程传播 | 真实 HTTP helper、worker normal / unknown-service |
| reload / candidate helper | 同请求幂等、在途串行；旧资源关闭才允许新建；close 期间取消 startup；ACK 绑定实际候选与资源状态；fetch 有剩余期限 | 7 项资源路径边界、真实 worker reload |
| Native / Core 命令与探针 | main 初始化失败也进入 finally；close 未知清除 RPC timer 并脱离自有句柄；未知 Core 子资源不能被 exit 0 覆盖；probe 未知保留 scratch | 真实 Node unknown / 初始化失败与诊断传播、Core 签名失败 |
| workerMain / 私有 IPC | 原授权、HostRef、精确 binding、重复 attempt 与原截止校验；收到当前私有清理绑定后等全部资源关闭才释放；缺 ACK/资源未知保留领取 | 10 项实际 workerMain/IPC 场景及原 launcher 回归 |

收尾审查另复现 started ACK 丢失：原实现从 workerMain 返回失败时已有 Native/run 存活，finally 提前关闭 service。新增单场景 RED 原文后，仅修正该行：原业务已开始时记录父端 ACK 丢失，原 worker 在原预算内等待既有 run 及清理；不创建新进程/会话或接管。修复后的十场景和 launcher/HOLD 入口已定向重验，没有重跑其他长前缀。两份来源快照的严格差异只有 worker 这一行及其测试；Core、Native、browser 与 command 实现字节未变。

默认 startup 5s、grace 1s、terminate 2s、force 5s、IPC 30s、reload 15s，覆盖仅可收紧并参与 HostRef；H5 等输入等待也有固定截止，超时不代签或重发。清理截止不续业务授权。发信号成功不能算已退出；实际 exit 缺 close 保持 unknown，不向已退出 PID 追加信号。Windows 父端断开工程场景实际观察到 exit 已发生但 IPC close 未确认，最终按事实分别记录，不能改写为已全部关闭，也不能解释旧 r13 失联。

Core 观察 bundle 保留完整冻结分母、原始未知资源及签名失败，停止后续动作；current observations 与自动 repair 拒绝未知。原 worker 的最终清理委托仅存在当前私有 IPC，不持久化、不向模型/业务环境传递、不从 state 重建。原领取只有在 Native、reload、service 和内部操作全部已知结束后才释放；worker 还须核验 Core 当前批次结果，脚本 candidate_business_verified=true 不能产生业务通过。P2 恢复/后继均未实施。

最终有 16 个受影响文件组通过，选取通过记录累计 139.4 秒；这是检查用时，不是本轮总耗时或真实交付效率。两项类型检查、十种 Harness 构建、2989 文件一致性与三个自主/未采用兼容分发场景通过；核验 4 份 Ed25519 工程观察签名及 8 份原始输出。前置设计/H5/Go 与脚本 Native 的工程身份均显式标记，不声称当前冻结 wire/main/worker 全链 L2、实际模型、UI 最终交付或 8/15 分钟目标已通过。

原始 service 无界 RED、started ACK RED、IPC close 诊断与 CLI 非零退出码断言修正保留原文；后者未修改生产行为。早期生成入口的夹具解析错误仅保留过程观察，首轮日志在独立归档前被后续执行覆盖，不计为验收证据，也不声称其原始日志全量留存。归档脚本一次抄录缺字的历史摘要已校正并重新核对原文，原历史日志未变。[本次归档](evals/autonomy/p1-10/it-04-validation-1794292425486/results.json)保留实施源码、检查输出、严格复用边界及保全结果。最终来源 715 文件，摘要 1ed8b114c1f742c57e64a19c492ea59044ca1cb44b3fafa5d1894994c3ddaa40。

只读保全：590 个历史输入摘要、根 state/audit 及七个自主控制路径缺席不变；r10/r14 无 grant/领取/attempt/实施测试，旧 r13 两个未对账领取、两份日志及无 exit 状态不变。真实试跑、新试点、真实 H5 均为 0，旧中断触发仍 undetermined。下一项为 IT-05 选择性预检/能力复用；IT-06 性能、IT-07 最终整链与 IT-08 用户确认和真实 H5 继续按既有收口计划执行。


## 30. P1-10 IT-05：采用前草稿预检与能力证据复用

按用户授权完成 IT-05 的局部生产收口，详见[契约第 25 节](aidlc-autonomous-contracts-v1.md#25-it-05-采用前草稿预检与宿主能力选择性复用)、[复审第 14 节](aidlc-autonomous-p1-10-integration-review.md#14-it-05-采用前预检与能力复用收口2026-11-10)与[验收索引](evals/autonomy/p1-10/it-05-acceptance.json)。P1-10 仍 HOLD，IT-06～08 尚未完成。

| 实际生产缺口 | 本次行为 | 权威与剩余边界 |
| --- | --- | --- |
| RF-02：采用前只能检查 scope，完整静态错误要等冻结/采用后才发现 | 新增 admission draft CLI；显式 draft scope 复用原 policy/dependency/admission/observation 验证器；H4 sealing 在采用/提交前消费结果 | Core 只读，不修改或伪造 adopted state；valid 仍 not-ready，不执行业务/Native/HTTP/探针，不签发/领取；真实运行门禁保留 |
| RF-04：每次 admission 刷新均重做完整实际能力探针 | Core 独立签名能力证据；满足原期限、grant 全约束、HostRef、checker、原始输入和全部必需能力时复用 | 每次仍检查授权/撤销/当前领取及真实 config/read；不缓存“已授权”，不延长日期或跨 run/grant |
| 配置仅凭冻结文件推断当前值的风险 | check-config 实际 initialize/config-read 后确认关闭；不创建 thread、模型 turn、工具或浏览器 | 冻结文件/HostRef 未变时，外部实际原生配置漂移仍拒绝；unknown、撤销、过期和篡改不触发 full-probe 兜底重试 |
| 宿主或静态检查失败后仍执行后续业务预检 | 前置硬条件失败则零业务预检；业务命令过滤私有授权/绑定环境 | 合法复用不跳过每次业务预检、依赖及来源/环境重验；最终 Native、完整功能/UI 分母和候选规则不变 |

能力原文保留原 nonce、observed_at 和 valid_until；新 admission 取本次窗口、原能力与原授权截止最小值。只有新的真实观察可以产生新的能力期限。没有可信 configuration_digest 或 revalidate 的旧适配器保持 fresh 路径，不能用普通 JSON 申请复用。能力集合不足必须重新探测，P1 未增加部分探针调度或跨授权缓存。

新测试覆盖 11 个草稿边界（含两单元依赖、私有写入重叠与逐文件无副作用）、10 个签名/时间/配置/授权边界和 4 个必要实际配置集成。后者经过生产 Core、adapter、host main 与真实 Node RPC/关闭，初始能力明确为工程夹具；记录只含 initialize/initialized/config-read，没有 thread/turn/browser，且 HostRef 漂移在启动前拒绝、外部配置漂移和撤销按预期阻断。两份 Ed25519 能力工程收据签名及原观察不变事实核验通过，不把它们称为真实模型或业务验收。

10 个文件组完整进程通过，另一个旧准入文件按有界分片覆盖全部 37 个主场景：首次执行在 24 项通过后触达 90 秒上限，原超时保留且 full_process_passed=false；仅增加测试范围选择器/耗时日志，逐字验证全部场景正文不变，再运行第 25～37 项，13 项通过，用时约 73.9 秒，没有提高超时或重跑前缀。后补多单元用例只重跑草稿文件。其后严格来源差异仅为三个测试/夹具文件；生产 Core、宿主、CLI 和协议/分发字节不变，复用已通过的生产路径，不宣称最终冻结完整 L2。

两项类型检查、十种 Harness 构建、2999 文件一致性及三个选定 Codex 分发兼容场景均通过。检查实际累计约 289.9 秒，包含保留的超时与补验，不是本轮总耗时或业务效率达标。原始两项生产 RED、夹具脚本摘要/命令声明/原授权期限封顶修正，以及新增 sealing 类型覆盖暴露的旧 unknown 访问类型修正全部留证；未放宽生产门禁。

[归档](evals/autonomy/p1-10/it-05-validation-1794295849887/results.json)保留源码、初始快照、各分片/失败原文、能力收据公钥、实际配置关闭记录和保全。当前 719 文件，来源摘要 e90871ebfc250ac89fbe07f298481e22dbc58b5227183038d05b4d32874de4e8。590 个历史输入、根 state/audit 与七个自主控制路径缺席不变；r10/r14 无 grant/领取/attempt，旧 r13 两个未知领取、两份日志及无 exit 保持原样，旧触发仍 undetermined。没有执行 sealing、刷新既有 H5 前准备、真实试跑、新试点、真实 H5 或 P2 恢复。下一项为 IT-06 控制面与 UI 性能，最终整链和 Go 继续按原计划执行。

## 31. P1-10 IT-06：控制面与 UI 性能优化

按用户授权完成 IT-06 声明范围的生产优化与局部工程验收，详见[契约第 26 节](aidlc-autonomous-contracts-v1.md#26-it-06-控制面与-ui-性能边界)、[复审第 15 节](aidlc-autonomous-p1-10-integration-review.md#15-it-06-控制面浏览器及用例隔离收口2026-11-10)、[验收索引](evals/autonomy/p1-10/it-06-acceptance.json)及[原始归档](evals/autonomy/p1-10/it-06-validation-1794299133206/results.json)。P1-10/P1 均未通过，实际入口继续 HOLD。

| 实际关闭的生产缺口 | 实现与权威边界 | 保留的校验 |
| --- | --- | --- |
| 同一动作重复获取上下文、逐条 Core/CLI 往返 | Core 公布 host preparation 能力；一次 CLI 调用内部仍逐条执行原 grant 校验，并返回当次实际输入身份；宿主只在当前动作内消费 | 原 binding、grant ref、精确检查清单、时间及 deadline；命令后的实时撤销检查继续独立。旧宿主未协商时走原路径，不缓存跨动作许可 |
| 每个 UI 断言启动一套 Chrome/Node 观察器 | Core bundle 与 Native phase 各自拥有一个浏览器，Native helper 惰性加载原 Core 模块；独立结果导航命令仍可拥有另一浏览器 | 每例新 context/target/session、关闭缓存/SW，真实鼠标/输入、DOM/网络/字体/图片/PNG 检查均保留；Core 最终验收独立执行 |
| 浏览器复用后客户端与服务端状态可能串例 | 每例全新 BrowserContext；新生成的 UI environment 明确声明独立 case_service，每例实际启动并关闭私有服务 | 用例前后真实 /version 与同一候选一致；完整发布/重试/结果链在同一用例内；没有新增 reset API、清空共享数据或修改既有采用计划 |
| 临时服务完成后固定等一秒才终止；关闭 ACK 被误当最终事实 | 用例结束立即通过原拥有句柄请求终止，再等实际 close；context 销毁后核验全部 context/targets 消失；pool 最后关闭 Chrome/socket/profile | 所有等待有界，unknown 停止复用并保留现场、证据和领取，不另起浏览器规避，不接管或恢复 |

短边界先验证 5 项浏览器超时/销毁/断连拒绝、9 项控制面边界，再补必要集成。最终冻结来源下 15 个定向文件完整通过，累计 124.1 秒；包含实际 Core、Node、Chrome 的 15 项签名矩阵（真实 API、结果导航、两尺寸十组合与真实生成 Native phase 的十项 UCD）、实际像素改变负例、候选/服务版本屏障、资源 unknown、30 项 Gateway 行为及六项实际 wire 场景。前置授权/准备为明确标记的工程夹具，不构成真实模型或业务交付。核验 5 份当前 checker 的 Ed25519 观察收据和 33 份原始文件；Core 的十组合 PNG 已导出，Native 中间 PNG 仅在测试临时目录产生，归档保留其实际 phase 输出、关闭指标和生成源码，不声称已导出这些中间图片。

| 分段实测 | 对比范围 | 原路径 | 优化路径 | 效果 |
| --- | --- | --- | --- | --- |
| 控制面，三对真实 CLI 采样的中位数 | 一次 admission inspect、一个声明写入范围、真实短命令；关闭/打开 preparation 协商 | 5 次控制请求，7394.8 ms | 3 次控制请求，5503.4 ms | 次数减少 40%，控制耗时减少 25.6% |
| 最终 UI，一对完整十组合 | 两侧均逐例启动真实私有服务；同候选、同用例、同独立 PNG/阈值；原观察器字节与当前 pool 比较 | 10 次 Chrome 冷启动，9898.0 ms | 1 次 Chrome 冷启动，4647.6 ms | 耗时减少 53.0% |

最终 UI 优化路径分段为：服务启动合计 1055.2 ms、服务实际关闭 68.9 ms、像素比较 503.5 ms；浏览器启动 342.9 ms、context 建立 729.1 ms、观察 1424.8 ms、context 清理 286.1 ms、浏览器关闭 163.1 ms。父子区间有重叠，不能重复加总或将剩余时间推断为模型思考。像素阈值、区域和两尺寸五状态的分母均未改变；真实结果 API 与 View result 导航仍断言实际响应/页面内容。UI 20 秒上界覆盖服务启动、动作和版本读取，受原 bundle/授权截止封顶；原步骤/回合预算与授权期限不扩大。

UI 一共三对短采样：引入立即终止请求前为 21.45→15.24 秒，其后为 9.76→4.72 秒，最终冻结为 9.90→4.65 秒；不同实现阶段不混合平均，全部原文保留。控制面三对采样发生在实施期间、后续 UI/lifecycle/docs 收尾之前，最终冻结下另做控制行为回归，没有重复性能采样或把它包装成当前完整 L2。上述均为局部机制微基准，不是旧整批任务端到端耗时，也不能宣称 8/15 分钟业务目标通过。

两项类型检查、十种 Harness 的复合构建、3019 文件一致性与三个实际 Codex 分发兼容场景通过。一次全构建在完成前九种后遇到 zcode 清理 EPERM，保留非零结果，核验绝对目标和非链接边界后仅重建 zcode；全构建原进程仍标记失败，不能改写为单次全通过。选取的最终定向检查、控制采样和常规检查累计 194.8 秒，另有单列 UI 采样；这不是本轮总耗时。没有重复原 Native 长前缀或单体准入长链，没有增加超时上限。初始生产 RED、夹具字段/拒绝码、临时目录 TSX 入口、缺失 plan/host、runtime 文件未忽略导致候选脏等过程失败均保留，修复未放宽生产门禁。

当前来源 726 文件，摘要 843e0236d581841d38339b08eaa17f8c988a97a4e76e2ebbb7e07d228e751e9a。590 个历史输入、根 state/audit 与七个自主控制路径缺席不变；r10/r14 无 grant/领取/attempt，旧 r13 两个未知领取、两份日志及无 exit 状态保留，历史失联触发仍 undetermined。没有执行 sealing、刷新已有 H5 前准备、真实试跑、新试点、H5 签发或 P2 恢复。下一项是 IT-07 最终冻结 wire/main/worker 整链、故障族与整体效率验证；其后 IT-08 审查和用户确认优化结果，才可准备有限真实终验。

## 32. P1-10 IT-07：分层整链验证与未关闭阻塞

**本轮验证已留证，IT-07 未通过验收，IT-08 不可进入。** [验收索引](evals/autonomy/p1-10/it-07-acceptance.json)、[故障族矩阵](evals/autonomy/p1-10/it-07-validation-1794315898058/evidence/fault-matrix.json)、[分段效率](evals/autonomy/p1-10/it-07-validation-1794315898058/evidence/efficiency.json)及[夹具整体复审](evals/autonomy/p1-10/it-07-fixture-review-20261110.md)分别保留通过、失败、严格复用与停止依据，没有生成 Go。

本项补齐了真正经过 launchAuthorizedWorker → workerMain → main → CodexClient → Gateway → 实际 CLI/Core 的工程接线。脚本 RPC 对端只根据公开 prompt、write_contract 与工具返回构造动作，不直接读磁盘、写状态或代 host commit/restart/f.run。上游设计/审查/授权/初始能力明确为工程夹具，普通模型和真实 H5 均未调用。原 600 秒工程 grant/wall budget、等价重试和 P1 无恢复边界不变；真实入口的 HOLD 只在工程库 seam 被显式替代，正式 CLI 和工作流没有绕过参数。

| 层级 | 实际结果 | 范围与用时 |
| --- | --- | --- |
| L0 | 六文件通过 | RPC 契约、动作策略、语义进度、返修契约/宿主、phase 传输，2045ms；RPC 入口变化后另补短检查 |
| L1 | 五文件通过，另补一文件 | 提案隔离、实际配置/能力复用、十项真实 workerMain/IPC、四组实际 Core 返修边界，165845ms；最终准备/窗口短检查 6349ms，合计 172194ms，在三分钟工程目标内 |
| 证据复用 | 十一组有效局部检查 | 与 IT-06 对照 409 个生产/分发来源逐字相同；核验旧归档 503 文件及当前断言/日志摘要。复用工程验证，不复用旧收据作为当前运行门禁；设计 PNG 作为输入复用，实际观察全部重做 |
| 类型/分发 | 通过 | 两项类型检查、实际十 Harness/3019 文件一致性、三个 Codex 分发兼容场景；仅测试/记录变化后补最终根类型检查，分发字节未变，复用有效构建 |
| L2 | **失败** | 最后一次整链进程 176986ms，在 C8 前以 admission-window-insufficient 正常停止；没有最终批次结果，不能把提前退出称为十二分钟成功交付达标 |

最后一次实际运行已通过两轮各十五项控制观察：十个 UI 组合、三个 API、真实分页断言和结果导航；两次候选提交与服务实际重载均由生产宿主执行。两份矩阵耗时约 12010/12196ms，每 bundle 一个 Chrome、十个创建及确认销毁的 context，像素区域/阈值未降低。委托补录经过真实 wire，代码写入在 metadata 回合被拒绝，合法提案与原始验证引用由 Core 消费。上述事实证明了到达的检查点，不能替代 C8/Native 汇合或最终候选 business_verified。

失败的精确窗口核算：原 grant 尚余 428168ms，下一 Native 动作需要 418168ms，而刚刷新收据仅余 295414ms。默认 Native phase 上界 600000ms、publication margin 10000ms；工程 plan lifetime 为 300 秒。原 grant 的 600 秒预算没有耗尽，问题是计划可提供的有效窗口与后续动作不兼容。原局部收口回调曾替代窗口 hook，故单独通过没有暴露此组合。真实试点生成器使用 plan=900秒、grant=3600秒；没有把本次工程窗口配置等同为既有两个试点配置已证实错误。

准备源码已在采用前将工程 plan 设为 600 秒，并使用实际 requiredAdmissionWindow 断言原 600 秒 grant 内的最大 590000ms 窗口；短用例同时保留 300 秒不足的负例。它只更正未运行的准备配置，没有修改已签 grant、旧 deadline 或增加 wall budget。按本轮停止线，仅做此短验证和类型核验，**没有第五次整链**。最终失败执行来源为 4bed5cbc32d2f5e7a06f181a14e67a2cc596200d1f0c8a9863ee1dba140fe8b0；最新源码含这一准备修正，共 730 文件，摘要 a7100914986806a0edae0732d746cd799a17ebea43a75784db369750bd65a760，current_frozen_source_L2_passed=false。

最后一次 main 监督区间 116850ms：host-control 71273ms、producer 22154ms、admission-refresh 7788ms、browser-visual 12381ms、evidence-publication 1677ms、Native cleanup 13ms，其他含未归因/队列/脚本 RPC。记录了 57 个 journal 覆盖的 Core CLI 请求；启动时尚未建立 journal 的上下文请求不含在内。区间不重复相加，脚本 RPC 毫秒不代表真实模型思考或未来 L3 成本。Native、全部已派发操作、服务和领取最终已对账，无 pending unknown；父 worker 清理与启动/前缀耗时在上级工程进程内另计。Native/C8 未完成，整体效率判定仍失败，订单八分钟/发布页十五分钟/三十秒首次派发均未验证。

过程共四次 L2 测试进程，计时合计 282711ms；其中一次 2.36 秒的 UI 来源遗漏在 grant/Native 前停止，一次约 39.4 秒在完成前缀后被工程入口静态 import 触发的正式 HOLD 拒绝，一次约 63.5 秒在实际 main 候选派发前因目录 input_paths 失败，最后一次为上述窗口拒绝。实际 Native 前缀构造三次、完整 main 启动两次，不声称只有一次前缀。前三项夹具错误统一复审后，配置、服务及 wrapper 改为与短检查共用生成器；模板转义、端口、缺失 stderr 遮盖原错误的诊断修正也保留。没有把这些失败归为新的业务缺陷或删除原失败。没有运行旧四十文件全套、重复性能微基准或提高 timeout；本段是已记录检查时间，不是含工具审批/编辑/等待的本轮总跨度。

进入 IT-08 前仍有三个工程阻塞：

1. **IT07-WINDOW-COMPATIBILITY**：在统一采用/交接准备入口联合校验宿主必需动作、admission plan、能力期限和原 grant，不能只检查命令相对最大能力窗口；不兼容应在昂贵实施前拒绝。当前工程夹具有采用前断言，正式统一入口尚未覆盖此组合。
2. **IT07-L2**：修正准备与入口后，仍需在一次冻结来源上完成剩余 C8/Native/最终候选/矩阵/清理的完整正向结果。不能恢复本次已结束 run、复制已签结果或重建旧 binding；通过的局部和设计输入按依赖复用。
3. **IT07-EFFICIENCY**：只有完整成功交付才能判定十二分钟工程目标；保留当前分段作为优化依据，不通过抬原预算或删门禁达标。

三项关闭后才可进入 IT-08 做来源/故障矩阵/性能复审、真实用户确认及逐项目即时 H5；旧 r10/r14 readiness 仍是历史证据，原采用基线需变更时统一合法派生，不能手改状态。工程验证的当前签名/公开文件已核验：12 份 Ed25519、152 个公开文件；590 个历史输入、根 state/audit、七个自主控制路径缺席、r10/r14 无授权/领取/attempt，以及旧 r13 两个未对账领取/两份日志/无 exit 均保持。历史 OS 失联触发仍 undetermined；没有实际模型、新业务试点、真实授权、旧 attempt 恢复或 P2 扩展。


## 33. P1-10 IT-07 剩余三个阻塞修复与工程退出（2026-11-10）

本节替代第 32 节的当前退出结论；原失败、来源摘要和当时停止决定保持历史原文。用户本轮授权修复三项阻塞，不包含解除真实试跑 HOLD。验收以[本轮索引](evals/autonomy/p1-10/it-07-fix-acceptance.json)、[原始归档](evals/autonomy/p1-10/it-07-fix-validation-1794319084355/results.json)及[效率分段](evals/autonomy/p1-10/it-07-fix-validation-1794319084355/evidence/efficiency.json)为准。IT-07 已完成，IT-08 复审可进入；仍未生成 Go、真实执行授权或完整 P1 业务通过结论。

| 阻塞 | 实际关闭的缺口 | 验收 |
| --- | --- | --- |
| IT07-WINDOW-COMPATIBILITY | 交接准备原来分别核对 plan/host/grant，不能提前发现 300 秒计划覆盖不了 Native 最大动作。新增共享 requiredActionWindow/executionWindowCompatibility；Core draft 读取显式冻结 grant request，prepare/issue 重算，admission 用真实 capability 原有效期再核对；main/worker 同策略防御 | 300 秒、过短能力、预算不足、配置/身份不符、缺冻结请求及改名计划绕过拒绝；600 秒工程窗口、900 秒真实计划数学与未选宿主兼容路径通过。原授权截止与 wall budget 不变 |
| IT07-L2 | 原整链未完成 C8/Native/最终候选汇合。补齐组合工程 UI 夹具的 Native 选择、设计锁、完整验收与真实受控证据；修复包装服务目录解析，父进程投影读取公开服务端点；worker 使用本项目原观察环境同步复核并在退出时恢复，记录具体 stale/error 原因 | 真实 launcher/worker/main/wire/CLI/Core/Native/HTTP/Chrome 链完成；Core 夹具 batch verified，委托决策 human_review=pending，补录后使用新的当前验证，原 RED/测试不变，两次必要候选/重载，完整十五项矩阵与两尺寸十 UI 组合 |
| IT07-EFFICIENCY | 以前只有失败时长，不能证明成功交付效率 | 当前完整成功链 242.82 秒，小于 720 秒；原 grant 600 秒，steps/turns、CLI/生产者/浏览器/清理有实际分段，不扩期限或减少验收 |

Core 负责输入/策略/授权与准入判定和签名证据；宿主仍使用既有 Supervisor、session binding、预算及资源归属。共享计算器不签授权、不续期、不代签人类选择、不增加常驻控制面。采用前 selected-host draft 需 --grant-request，且为同批冻结输入；检查仍只读，不运行探针或项目命令。Native/验收矩阵分母、原像素标准和 P1/P2 边界不变，契约见第 27 节。

本轮先运行十个受影响短/局部文件，后补 Native UI 当前门禁和包装服务真实结果导航短集成；最终覆盖十三个独立当前测试文件（含完整链），重复的窗口/draft 定向复验单独留时，不相加成更多独立文件。最终两个类型检查、十 Harness 全构建、3029 文件一致性及三个 Codex 分发场景通过。前一次全构建 zcode 的 EPERM 与定向重建记录保留，未覆盖失败原文。生产代码变化后不沿用“全部生产依赖未变”的旧表述；旧结果保留原摘要，窗口入口/受影响路径重验，浏览器/既有 Supervisor 和返修算法按未改动范围复用。没有再跑整套旧长链或性能微基准。

| 成功整链分段 | 实测 |
| --- | --- |
| 工程设计/授权种子及真实 Native 前缀准备 | 46.86 秒 |
| 生产 launcher/worker/main 至实际退出与清理 | 192.93 秒 |
| 完整成功链 | 242.82 秒 |
| 测试进程（含导出核验） | 244.21 秒 |

上述工程前缀中的设计/审查、初始能力和 H5 是显式测试种子；RPC 是脚本对端，实际模型耗时没有测量。实际 HTTP、浏览器、生产者、候选提交/重载、Core 汇合、资源及领取对账都执行。每观察 bundle 复用一个浏览器并确认销毁十个 context；独立结果导航有自己的浏览器，不能声称整批只有一个 Chrome。签名 12 份、原始引用 50 份及公开导出 166 文件核验，父子耗时不重复相加。未来 L3 订单 8 分钟、发布页 15 分钟及首次派发 30 秒仍未测得，不能由工程结果代替。

本次实际构造四个完整工程测试进程：第一项 234.118 秒到 C8 后被 Native 拒绝缺 UI 准备；第二项 125.539 秒因包装服务无法解析 UI 模块导致真实结果导航失败，已正常退出与清理；第三项 235.456 秒已完成 Core verified，但 worker 用继承环境投影导致外层 incomplete；修复并用短边界核验项目环境作用域及原 IPC 后，第四项才为成功链。连同第 32 节原四项，累计八个 IT-07 工程整链进程。失败日志、来源及资源事实均保留，没有恢复已结束 attempt、清除原失败、复制旧签名或续原授权。短夹具启动/阶段/追溯诊断也保留在工具历史与归档，不把提前失败当作速度改善。

最终冻结来源 735 文件，摘要 196791093833f10e9a91b3575aaba43e9fe0211c0fa0f5fa859171fd28c23e86；十项早期局部检查的原来源、后续 Core 计划发现与 worker 投影的差异及定向复验、最终 UI/整链来源均在 source-linkage.json 留证。根无关 state/audit、七处无授权现场、590 个历史输入摘要、既有未授权 r10/r14 和旧 r13 两个未对账领取/原始日志保持；历史 OS 中断触发仍 undetermined。本轮既没有恢复旧领取，也没有实现 P2 恢复。

IT-07 退出后剩余工作属于 IT-08：复审冻结的分层证据/效率/限制，取得用户对优化结果的明确确认；届时按未变的既有基线合法复核准备，若必须改变已采用输入则统一派生工作流；实际每项目 H5 仍由人类精确签署。按订单先行、发布页即时授权、失败即停的既定次序进入未来真实验证。本轮不创建新试点、不打开授权窗口、不自动切 Go。


## 34. P1-10 IT-08 冻结审查、准备复核与真实 H5（2026-11-10）

本轮按用户在 IT-07 结果说明后实际发出的“继续IT-08：审查冻结证据与优化结果，再完成试点准备复核和真实 H5”推进，实际消息原文、摘要、解释及 Go manifest 绑定保存在 [审查目录](evals/autonomy/p1-10/it-08-review-1794319860614/review.json)。它确认本次工程优化结果并允许有限终验准备，不能替代真实终端的精确 H5。

735 个冻结来源与 IT-07 成功 L2 完全一致，755 个归档文件、12 份签名、50 个原始引用、590 个历史摘要核验；八个故障族声明范围通过，无当前工程未决项。242.82 秒成功工程链满足 720 秒目标；脚本 RPC 与真实模型的限制、旧 OS 触发未知和 P2 未实现保持原结论。来源绑定入口返回 GO、execution_authorized=false。没有重跑未变的长链/分发。

旧 r10/r14 已采用输入中的 HostRef 与当前工具不同，因此没有改写旧基线或恢复旧 attempt。统一派生一次 orders-r11 / publish-r15；原 single-module、发布页 html-mock 选择和已批准应用设计有真实用户来源，接收时逐文件比较原批准快照。通过正常 Core next、真实生产器与 report 完成 H3/I13，没有复制完成行、控制收据、产品实现或旧 grant。Mock 实际浏览器接收、完整设计锁/验收、最终采用范围后的 H3 生产器均重新核验。

准备脚本的普通 gate/语义 producer 选择，以及仅 thread/start 没有持久 rollout 的问题均留证：前者改用正式普通 report，后者在 H5 前执行真实 READY-only 会话准备、更新未签发的外部 H4 描述，已采用字节与 scope 不变。后续只按 Core 的精确 artifact-stale 诊断刷新受影响派生证据。以上属于授权前准备，未恢复任何已签授权或实施 attempt。

[两项最终准备记录](evals/autonomy/p1-10/it-08-review-1794319860614/prepared-pilots.json)与[实际入口检查](evals/autonomy/p1-10/it-08-review-1794319860614/operator-readiness.json)确认：独立 workflow/thread/run/root、当前 HostRef、单活动单元、3600 秒原请求预算、最多两次等价重试、本地候选提交；push/deploy/protected/successor 均未授权。真实服务可用，故意缺陷仍被独立 oracle 拒绝，Native 未授权启动被拒绝，tests/ucd.cjs 不存在，领取为空，没有签发 grant。

当前 IT-08 仍在执行：先由人类在订单 r11 窗口亲自输入 Core 显示的 Approve digest，签发后由原 Supervisor 连续实施；只有订单最终 Core/worker、完整功能与资源对账及 8 分钟/30 秒目标都通过，才打开发布页即时 H5。发布页最终目标 15 分钟、两尺寸十组合和像素/交互标准保持。任何实际失败保留原始证据并回到工程，不自动创建下一轮或恢复。实际 grant 与 L3 结果后续追加，本节不是完整 IT-08/P1 通过声明。


## 35. P1-10 IT-08 首次真实终验结果与回到工程（2026-11-10）

[IT-08 验收索引](evals/autonomy/p1-10/it-08-acceptance.json)和[订单实际运行记录](evals/autonomy/p1-10/orders-r11/it08-result.json)记录本轮最终结论：未通过，入口恢复 HOLD。第 34 节的准备及当时 Go 事实保留；当前不得继续真实试跑或打开发布页 H5。

人类在真实窗口完成 orders-r11 精确 H5，Core 实际签发 3600 秒、successor disabled 的原授权；唯一 run_id 为 932ba849-ab62-41c2-a998-42c289c3b290。Native 首次派发距签发 3.669 秒，首模型回合 68.270 秒，首工具调用 82.911 秒，分别记录，不能把不同起点混为一次启动时长。原请求到签发的人类等待 11.443 秒单列。

实际模型连续完成 TDD，受控 RED 为行为失败（命令 exit 1、checker passed），BASELINE 依无 characterization UC-D 的正式契约为 not_required。之后写入实现并通过冻结独立 oracle；在请求 code-generation/green-test-evidence 前，宿主准入刷新被 Core 拒绝，终止原会话并实际对账。未取得受控 GREEN、C7、C8、最终候选观察和签名批次完成，不能将 oracle 通过称为完整业务通过。

授权至结束清理 390.547 秒；这是失败早停时长，成功交付效率仍未验证。首次导出摘要曾仅按早停小于 480 秒标记 efficiency_passed；最终审计已改为 unverified-incomplete-delivery，初始摘要原文及校正依据保留于 result-reviewed.json，未据此放行下一试点。宿主不重复计时的分段为 model/RPC 209.44 秒、host-control 106.95 秒、admission-refresh 55.17 秒、producer 6.65 秒及其余发布/清理等；模型/RPC 包含协议等待，不能推断为纯思考。共 66 steps、2 turns，未记录无进展循环终止，原授权期限与预算没有扩大。

[只读重放](evals/autonomy/p1-10/it-08-review-1794319860614/reuse-window-reproduction.json)使用实际失败时刻、签名能力凭据和原 grant：capabilityReuseReason 返回 null，仍选择 reused；该凭据未过期，但只剩 525675ms。随后联合窗口检查要求 610000ms 而正确拒绝，原 grant 仍余 3200122ms。Core 复用选择只验证未过期及配置/能力集合，没有先消费动作所需最小剩余窗口；选择 reused 后的检查直接形成 not-ready，没有转为一次真实新探针。这是能力复用与动作窗口同族的生产遗漏，不能把它算作已修复。

IT-07 工程证据仍真实，但覆盖边界不足：600 秒工程 grant 会把所需窗口按原剩余动态缩小；真实 3600 秒 grant 在数分钟后仍要求 610 秒，而 900 秒能力凭据已消耗到不足。此前局部短能力负例证明了拒绝，没有证明“仍未过期但覆盖不足时重新选择真实探针”。本轮没有增加等待、改旧 valid_until、续 grant 或恢复原 attempt。

6 份签名、64 个公开导出文件已核验，原 RED、模型工具流、实际 H5/退出及准入失败原文保留；没有最终观察 raw refs 是因为尚未到该阶段，不能记为通过。资源与领取均已对账；根无关 state/audit、七处无授权现场、590 历史摘要、旧 r13 未知现场及原 r10/r14 保持。发布页 r15 已完成准备但未签发 grant、未启动实施；后续工程改动若影响其已采用 HostRef，仍须按 P1 契约重新评估准备，不能复用旧 readiness 偷改基线。

下一项工程应先把动作所需剩余窗口纳入 capability 复用资格，再在原 grant/配置/精确 binding 都有效时选择一次真实新探针，保持旧 receipt 原期限不可改和 unknown/撤销/配置拒绝；补 fake-clock 的 3600 秒 grant + 已消耗但未过期的 900 秒能力、配置轻检耗时跨阈值、发布前耗时和原 600 秒 clamp 边界，再做必要聚焦 Core/宿主集成。修复后重新审查来源/证据并核对 HostRef，未经新的人类 H5 不开始下一真实运行。本轮没有继续修改生产代码或自动重试。

## 36. 跨层续验契约、独立路径证据与旧关闭结论重评（2026-11-10）

本节回应用户要求同时纠正跨层契约和验收方法；[设计复核](aidlc-autonomous-continuation-review.md)、[契约第 28 节](aidlc-autonomous-contracts-v1.md#28-跨层执行继续判定与逐路径验收)、[验收索引](evals/autonomy/p1-10/continuation-review-acceptance.json)及[原始证据](evals/autonomy/p1-10/continuation-review-validation-1794324360185/results.json)是本轮结论依据。没有启动真实模型、试点/H5、新业务工作流或恢复旧 attempt，保持原授权/预算及 P1/P2 边界。

### 36.1 实际关闭的生产子路径

Core 与选定宿主共用 `aidlc.execution-continuation/v1` 纯判定器，不新增 Supervisor、授权或恢复服务。`continue` 要求原剩余窗口充分；`reprobe` 只在原授权有效、已知配置合法而能力到期/不足时选一次真实新观察；未知状态、非法授权/来源/配置、预算不足以及新观察/发布后仍不足为 `stop`。原 ready / ready-with-delegated-decisions / not-ready 三类准入结果和八项检查保持，新增判定记录纳入签名收据。共享判定自身始终 `execution_authorized=false`。

| 子路径 | 本轮变化 | 独立证据 |
| --- | --- | --- |
| 能力复用选择 | 消费当前动作的所需剩余窗口；轻量配置检查前后重算，3600s grant + 900s 能力推进到 525675ms 时选择 fresh，充分时继续复用 | CC-01～05、CB-01 |
| 安全失败分类 | 配置漂移/unknown、原 grant 到期/撤销、原始证据篡改不能靠重新探测掩盖 | CC-06、10～13；CT 安全分支 |
| 准入完成与发布 | 新探针、业务预检、发布锁均可能消耗窗口；再次核对，短窗口不发布 ready，锁内不探测 | CC-07～09 |
| 精确阶段重入 | 抽取并复用原宿主的续验闭包；恢复原精确 stage 后取得正式 directive 并重算，新增 block/choice 不绕过 | CD-01～04 |
| 最终派发 | 权限准备耗时导致不足时，此边界最多一次续验及重新实时权限检查；仍不足零派发，原等价失败计数既不增加也不清零 | CD-05～10、CB-01 |

同步修正 IT-05 旧协议与收口计划中的“检查期间过期”歧义：原授权过期/撤销始终停止，能力本身在轻检期间已知到期可以合法重新探测。旧 capability receipt 不改日期，新的观察有新 nonce 和真实期限；新 admission 受本次实际能力与原 grant 截止限制，不续 grant、不接受旧 checker 作为当前业务凭据。

### 36.2 分层验证与效率边界

[逐路径清单](evals/autonomy/p1-10/continuation-review-validation-1794324360185/path-registry.json)有 41 条独立记录：17 条纯时间判定、13 条真实 Core 时钟边界、10 条实际宿主/脚本 Core 边界及 1 条真实 Core→原宿主→Gateway→实际 Node 命令桥接。工程授权、native adapter 和时钟推进均显式标注；“真实 Core/实际命令”不能推导为真实模型或 Native 完整业务通过。Bridge 的六份公开签名及两份 raw probe 引用已核验。

每条路径独立绑定场景 ID、预期转换、实际断言、测试/来源摘要和原始日志。校验器核对精确 ID 集合、每条 PASS/实际 bridge 输出、对应成功进程与原始 JSON 行，再核对签名和摘要；缺一条、重复一条、摘要不符、来源不符四类负例均拒绝。由此停止使用旧 archive 脚本中将一个成功 L2 批量赋给八个故障族的关闭方法。

受影响的 19 个独立测试文件通过，含原阶段路由的 36 场景与实际 workerMain 的 10 场景。两项类型检查、十 Harness 全构建、3039 文件分发一致性与三个选定 Codex 分发场景通过。两个回归失败原文保留：旧断言只认旧错误名，现严格检查结构化 stop、零派发和零重试消耗；另一个旧宿主夹具缺少原授权 deadline，补真实 3600s 截止后原 36 场景通过。没有以修改生产代码恢复旧错误名、放宽拒绝或扩大超时。

通过文件选取耗时累计 188.213 秒，不能作为本轮总耗时、整体业务或成功性能。41 路径运行后仅两项无关测试断言/夹具改变，最后清理两段协议文字歧义；运行时代码、四个路径测试及其 helper 没有变化，已有证据按精确差异复用。协议同步后重新执行类型/构建/分发检查，未重跑约 75 秒 Core 前缀或历史完整 Native/UI 长链。各次原来源、失败、后缀和最终文档差异均在 source-linkage.json 中单列。

最终冻结来源 740 文件，摘要 `dfb599f27121b8099de45a22fe57907301cff6fd56d7e3a323272bea6a24507e`。根无关 state/audit、七处自主权限路径缺席、590 历史输入摘要、IT-07 原归档 755 文件及 IT-08 实际公开归档 64 文件完成保全核验。r10/r14/r15 未授权；r11 只有原失败运行且无活动领取；旧 r13 两个未对账领取、两份日志及 absent exit 不变，触发原因仍未知。

### 36.3 旧结论重评与停止条件

[逐族重评](evals/autonomy/p1-10/continuation-review-validation-1794324360185/closure-reassessment.json)保留旧 IT-07 的 600s 工程成功与 IT-08 实际失败。IT08-CAPABILITY-REUSE-WINDOW 现在只按本轮声明路径局部关闭；RF-01～07 分别列出新的局部断言和未重验的组合范围。RF-08 没有新的完整交付/UI/效率证明，仍开放。状态中原 `current_frozen_source_L2_passed=true`、工程整体优化完成、当前十 UI 组合等过宽字段撤回，原文存档；历史成功不改写为失败，旧签名也不改写成新版本通过。

解除工程 HOLD 前仍需要四类独立证据：当前最终来源完整 wire/main/worker/Native/C8/候选/委托汇合；当前真实 API/导航、两尺寸十组合和原像素标准；完整成功后的效率分段；其后有限 L3 真实模型交付。下一次完整工程链应使用与实际请求相同的 3600s 预算配置，显式记录能力老化场景和注入来源，不能继续用 600s clamp 证明长预算，也不能把 fake clock 的模拟推进写成实际墙钟耗时。

完整工程验证只在来源冻结、所需局部证据齐全时执行一次；若失败，保留原日志，先分类根因并定向验证，未经新来源/明确受影响路径不循环重跑长前缀。任何签名/来源不符、未对账操作、实际退出未知、新 block/choice、原授权或预算不足、新续验仍不足、候选/矩阵分母不完整即停止。失败早停不建立成功效率，局部通过不自动 Go；完整发布复核、试点 HostRef 准备复核与真实人类 H5 仍各有入口。本轮到上述工程记录收口，未创建或启动下一真实轮。

最终附加格式检查中，本轮受影响范围的 `git diff --check` 通过；整个共享工作区仍有本轮范围外的既存空白/CRLF 提示，未批量格式化其他改动。原文、路径及与实施前来源相同的规范文件见[格式检查](evals/autonomy/p1-10/continuation-review-workspace-check/result.json)，不将全局检查记为通过。

## 37. P1 控制与验收成本收缩（2026-11-11）

用户确认七项目标后要求按评估建议实施，并明确避免改一点就跑测试项目。本轮先完成以下整组代码、协议和回归修改，之后仅执行一次集中定向检查。没有运行订单/发布页真实试点、完整 Native/UI 业务长链，没有创建业务工作流、签发 H5 或恢复旧 attempt。

| 项目 | 实际实现 | 边界 |
| --- | --- | --- |
| 能力证明与当前准入解耦 | 可信 Codex adapter 协商 run-config；首次完整真实探针产生原 run/grant/config 的签名能力证明。续验校验原始来源并执行实际 config/read 轻检，当前 freshness 单独写入签名 admission | 旧观察日期/签名不改；原授权、配置、能力集合和原始证据均严格验证；未知/漂移/篡改/撤销停止。不跨 run/grant/旧 attempt。旧 adapter 未协商时保留原窗口语义 |
| 按依赖复用工程证据 | 完整 source snapshot 继续追溯；source_impact 把引擎 tests/ 与仓库 README 的变化分别标为回归与说明变化，原冻结执行证据可继续引用 | 新测试没有被标记通过；Core 规则、规范契约、宿主、构建配置和试点验收资产及未知路径仍导致运行复审。业务项目测试/UC-D/UI 基线不属于这一豁免 |
| 精简宿主续验 | 使用本次 admission run 返回的受控结果，省掉紧随其后的 inspect；当前已在协调实例时省掉 select；刚核验有效的依赖不重复观察 | Core 仍复核依赖，竞态失败最多补一次观察；精确正式阶段重入、最终实时权限、预算、未知资源和结果判定保持。没有新 Supervisor 或控制服务 |

能力证明 checker 也按实际职责收窄：生产、校验、授权存储和资源依赖变化才影响能力证明；准入路由/窗口变化由准入 checker 负责。HostRef 补入实际使用的共享派发判定源码，避免缺少执行依赖绑定。这样减少无关重探，同时保留真实运行变化的失效。

集中执行的 11 个文件覆盖三态、同授权能力复用、旧适配器兼容、续验调用次数、正式阶段恢复、实际 Core→Gateway→Node 命令、36 场景原阶段路由、权限准备、Go 失效分类、实际配置 RPC 及窗口兼容。新增同授权场景验证能力尚未过期但不足、已经过期、配置漂移/unknown、慢轻检、原始证据篡改、原 grant 到期和撤销。最后两项类型检查、十 Harness 全构建、3039 文件一致性和三个 Codex 分发场景通过。日志和来源仅保存在一个[结果目录](evals/autonomy/p1-10/simplification-2026-11-11/results.json)，未再复制一整套历史源码档案或新增验收服务。

可量化的实现效果：同一个 3600s grant + 525675ms 老化观察 + 610000ms 动作场景中，实际 Core/Gateway 聚焦链的完整工程探针从先前的两次降为一次，后续只进行一次配置轻检，真实 Node 命令执行成功；能力观察原文件和 grant 截止均保持。协调实例已有当前依赖时，原代码路径的 inspect/select/dependency-preflight/run/inspect 五次 Core 请求收缩为 inspect/run 两次；发生依赖竞态则明确补一次观察与一次 admission。该数据是受控测试的调用计数，不是实际模型时延或完整业务性能声明。

本轮没有新增人工确认环节、扩大授权期限、增加重试预算或削减功能/UI 分母。与旧 run-config 未协商路径分别验证，不用假时钟结果冒充实际模型。所有集中检查一次通过后停止扩大测试范围；当前完整真实业务交付、UI 整链和成功交付性能仍未验证，HOLD 不由本轮定向结果自动解除。最终来源、公开工程签名及根/旧现场保全见同目录 acceptance.json。

## 38. 剩余工程收口与验收边界（2026-11-11）

第 37 节三项生产简化已经完成。本轮没有继续增加控制层、Supervisor 或恢复机制；只修正最终工程夹具与实际配置的偏差，完成原先缺失的整链、当前 UI 和成功工程过程耗时核验。生产源码未再变化。最终来源为 742 文件，摘要 `98150581763372ca11887c49ca8fc0e5b4cbc52bae5520c2280da5751d202945`，相对上一轮仅 `tests/test_it07_pipeline.ts` 改变。

工程夹具在首次签发前使用与实际试点一致的 3600s grant、900s admission，以及没有被短授权缩小的 610000ms Native 窗口；原始 run-config 能力证明显式标识为工程种子，生产续验通过真实 config/read，并断言整链结束后原证明不变。正常路径使用实际墙钟；老化至仅余 525675ms 和过期后的续验继续引用上一轮独立假时钟/真实 Core→Gateway→Node 证据，不将其写成这次实际等待。原授权和预算没有运行中延长，工程等待另受 12 分钟上界约束。

| 验证层 | 本轮处理 | 结论 |
| --- | --- | --- |
| 局部契约与边界 | 核对来源及原日志摘要，复用上一轮 11 个测试文件；不重复运行 | 原用例与运行依赖均未变化，新整链夹具不冒充已经验证 |
| 类型与分发 | 类型检查 5.408s，3039 文件一致性检查 0.777s；沿用未变输入的全构建及 Codex 分发回归 | 通过，没有重复构建十套分发 |
| 完整工程链 | 实际 launcher/worker/main/wire/Core/Native/HTTP/Chrome；脚本 RPC 代替模型 | 当前候选、C8、Native、委托记录与批次投影全部汇合，53 steps / 2 turns |
| 功能和 UI | 两份完整观察各 15 项，均包含两尺寸十组合；真实 API/结果导航，原像素标准 | 每份观察仅启动一次浏览器、销毁十个隔离 context；两次必要候选重载 |
| 证据及退出 | 12 份签名、50 份 raw、166 个公开文件摘要；原 RED/测试、原 deadline、资源与领取 | 全部核验通过；最终委托记录仍可 pending 人类事后复核 |

有一次 8.593s 的夹具准备失败，尚未进入生产派发：观察时间与到期时间分别取时，导致 900s 上限多出毫秒，Core 正确拒绝。本轮保留[原失败](evals/autonomy/p1-10/engineering-close-2026-11-11/preparation-failure.json)、原夹具源码及现场；统一由原 observed_at 计算到期时间后只继续未完成的整链，没有放宽生产校验，也没有重跑成功的局部组。最终完整生产链执行一次并通过。

完整工程耗时 **248.448s**（外部测试进程 249.526s），其中夹具准备 49.258s，生产链 196.030s，其余是断言/收尾等。宿主内部互不重复的主要分段：host-control 105.156s、producer 33.152s、evidence-publication 23.719s、browser-visual 15.748s、admission-refresh 5.039s。脚本 RPC 约 0.044s 不代表真实模型时延。

旧完整工程样本总耗时 242.824s、生产链 192.932s、host-control 103.962s；本次没有显示整体加速。两次授权/续验配置及机器负载不同，不能据此计算可靠加速率。能够确认的是局部重复探针/请求减少、当前真实配置能够完整通过、12 分钟工程预算满足。**“成功工程耗时已测量”不等于“整体效率显著改善”，也不等于真实模型 8/15 分钟目标达成。** 控制面仍占主要时间，作为后续真实结果的归因观察项保留；没有为追求更好单次数字继续修改或循环跑链。详见[分段实测](evals/autonomy/p1-10/engineering-close-2026-11-11/efficiency.json)。

本轮关闭 CURRENT-FROZEN-L2、CURRENT-UI-MATRIX、成功工程过程耗时和原能力复用窗口的工程复核。八个故障族按实际证据更新，不宣布所有组合路径穷尽：本次没有强制触发返修，返修仍使用独立局部证据；历史 r13 的 OS 失联触发仍未知。根无关 state/audit、七处无授权现场、590 历史摘要、四个原试点状态以及旧 r13 两项领取与无 exit 状态均保全。

`engineering_optimization_complete` 与计划内优化完成标记现为 true，仅表示本轮工程整改收口；`business_verified`、`p1_10_exit`、`overall_go`、`real_trials_permitted` 仍为 false，入口 HOLD。余项是最终冻结证据/优化结果复核、实际确认、试点已采用输入与当前 HostRef 准备复核、真实逐项目 H5，以及有限真实模型成功交付/效率验收。没有创建新业务试点、启动模型或签发真实授权。

停止条件继续有效：没有新实现变化或失败断言，不重复完整工程链；真实运行若失败，保留原 attempt 并停止，不自动派生下一试点。unknown 资源、范围/config 变化、撤销/到期、预算或窗口不足、候选/矩阵不完整均停止，不能用新探针或重试掩盖。后续属于受控最终验收，不再扩大 P1 机制，也不进入 P2 接管/恢复。

## 39. 清空已有实现后的真实试跑与新暴露缺口（2026-11-11）

用户明确要求“删除测试项目的已有实现，全新跑一次，看看有没有问题存在”。核对 orders-r11 / publish-r15 无领取和有效执行授权后，将 src、tests、delivery 下 10 个文件逐一校验归档，再从原工作目录删除。历史授权、状态和失败原文保留，旧 r13 未知现场不变。新 orders-r12 / publish-r16 使用独立 workflow/thread/run；只接收原批准设计和独立验收输入，产品代码分别为 NOT_IMPLEMENTED 接口、501 接口和空白 HTML，没有复制旧实现、Agent 测试、完成行或受控证据。删除清单、基线摘要及 H5 前空实现复核见[本轮目录](evals/autonomy/p1-10/fresh-run-2026-11-11/result.json)。

准备中发现并记录了历史设计接收缺口：结构清单引用的旧根提交未随新仓库带入，以及源仓库文档已格式规范化而与原审批快照字节不同。前者只补入精确历史基线 Git 对象供结构比较，不检出实现；后者按原审批快照接收，再执行既有格式规范化。准备命令顺序和沙箱 spawn 拒绝也单独记录。Core 均正确拒绝，未放宽门禁；这些修正发生在 H5 前，不冒充实现 attempt 的结果。

用户在真实终端亲自完成 orders-r12 的 H5。唯一 run 为 `27d23c71-8336-413a-a7c8-2aa4aacf9545`，原授权 3600s、successor disabled，签发后 4.274s 派发。桌面 Agent 只读观察，没有在运行中修改产品、测试、状态或授权。原宿主连续完成 TDD、code-generation、code-review 和委托记录，共 4 个模型回合；两次签名功能观察均通过，包含冻结独立 oracle 的完整边界、真实上游及错误传播。但 build-and-test/C8 没有完成，也没有签名 BatchResult，因此业务最终结果仍为 incomplete。

**真正的终止原因是续验证据进展遗漏，不是已证明的无效重复循环。** 最后一次已识别 progress 后，宿主先后刷新 code-generation 全部 sensors，以及 code-review 的 review-evidence、test-quality、ui-design-alignment，四个不同修复命令均返回 passed。Core 的 progress_digest 主要覆盖阶段/范围状态；Gateway 对受控 evidence refresh 成功没有对应的、可验证阻塞减少的进展消费。最后 32 次控制步骤仍被记为无进展，原 Supervisor 正确执行已配置停止条件，却中止了仍在推进的有限续验链。使用实际 ProgressBudget 对原日志尾段做只读短重放，重现相同停止；没有再次运行试点或证明修复已通过。

最后两次候选提交间仅 `docs/aidlc/handoff.md` 变化；产品代码和测试没有在元数据回合改写。停止时未刷新的 traceability 仍绑定采用基线/dirty 工作树，而已刷新的审查证据绑定最终候选。这要求整体复核“真实编码后的工作树→候选提交→元数据提交→Native 证据续验”的身份和进展语义。此前工程 L2 的 C7 前缀由准备好的实现和受控生产器构造，不能据其通过推断这条真实续验链已验证。

| 实测项目 | 结果 |
| --- | --- |
| 授权至最终清理 | 890.379s，约 14 分 50 秒；订单目标 480s，且未完成交付 |
| 宿主步骤/模型回合 | 194 steps / 4 turns；终止时 32 steps_without_progress |
| model/RPC | 456.177s，包含模型和协议等待，不推断为纯思考 |
| host-control | 314.495s |
| admission-refresh | 38.876s；与控制调用合计约 353.371s，占宿主墙钟约 40.3% |
| producer / evidence-publication | 53.214s / 10.628s |
| 能力探针 | 一次完整证明，两次原证明复用；未重复完整模型探针，原期限未延长 |
| 证据与清理 | 10 份签名、2 份 raw、82 个公开导出文件核验；worker 最终资源和领取均对账 |

另有 7 次工具拒绝：3 次路径不存在、一次误用不支持的 semantic sensor `no-todo`、两次审查文档未满足显式双轴结论/完整文件覆盖，以及一次 observe 参数格式错误。原模型在同一 attempt 内修正了这些问题，但增加了轮次。原 RED 与失败原文保留，未通过修改历史证据掩盖。worker 外层给出的 current_status=unknown、空 blockers 对具体停止原因解释不足，本次依据原生 exit 与 trace 记录真实结论。

本次只运行订单一次。发布页已完成独立空实现、设计接收、范围采用、真实模型交接决策及 H5 前检查；按照“首项失败即停止”约束，没有打开它的 H5 或启动实施。没有自动重试、增加步骤/期限预算、接管或恢复旧 attempt，没有更改生产源码。全局入口已恢复 HOLD，优化完成标记重新打开；第 38 节工程通过证据保留，但不再支持当前整体关闭。

下一步应先处理 Core 可验证的有限续验进展与宿主预算消费，并合并已知修复集合中的重复 next/context/select/inspect；仅靠新收据时间戳不得重置进展，也不能提高阈值掩盖。精确 sensor 清单和审查格式/覆盖合同应在模型开始前可消费，以减少猜测式失败。优先用本次真实尾段建立短跨层验证，覆盖真实候选切换和连续不同 sensor 修复，再决定后续真实终验。此处记录修复方向，本轮没有实施这些新修改。

## 40. Native 有效续验进展与控制调用收缩（2026-11-11）

本轮仅处理第 39 节已捕获的跨层缺口。Core、选定 Codex 宿主及源协议/契约已同步，未新增 Supervisor、持久恢复或业务授权机制。最终来源为 `5cfc20d9511fc8690239a182f77516ca3a921070074d912d78a8324a6d85993a`（745 文件）；原始失败、阶段记录、试点授权与源码保留。入口保持 HOLD。

| 边界 | 实际改动与不变量 |
| --- | --- |
| Core 生产器 | 对 `--refresh` 的语义派生证据，复用现有输入、来源、checker、上下文和 freshness 校验。只有原来无效、受控重生成并发布后当前有效，才返回 `evidence_progress`；单项与 actions 批次投影一致。身份绑定目标事实，不含收据时间/UUID。 |
| 宿主消费 | Gateway 从可信 Core 通道核对工作流、精确实例、请求 sensor 和 regenerated 转换，交给原 ProgressBudget 去重。重发、reused、失败、错误绑定不能重置进展。原总步数、回合、32 步无进展上限及 grant/预算均未改变。 |
| 调度收缩 | Core 将同一 completed 实例已知失效的语义派生合并为同一条 `--sensors` 命令；宿主执行后再取正式路由。阶段、单元、历史相位、人工审批和行为失败边界保持。completed 项目级修复补齐显式 `--instance`，避免误入 active 路径。 |
| 完成判定 | 进展回执仅证明指定派生证据取得进展；不代表 Native 全绿、C8 完成、业务/UI 或批次通过。部分批次失败仍保留已发布证据，但不返回整批成功。 |

验证先使用原捕获尾段，再补短集成，没有重复业务长前缀：

| 独立证据 | 结论与范围 |
| --- | --- |
| 原始尾段 | 核对 orders-r12 的 82 个公开文件哈希，重放 32 个实际控制步骤。旧响应复现 `no-progress-step-limit`；三个不同续验响应按新契约经真实 Gateway 消费后可继续。transport 响应是显式契约夹具，没有重放实际业务执行或声称 C8 成功。 |
| 真实 Core→Gateway | 7 次短 CLI 调用覆盖输入改变/候选提交、复用、显式 freshness 过期、证据缺失、无效绑定及检查失败。同一目标的多个真实生产器响应仅建立一个 checkpoint。 |
| 真实 Native review | 脏输入形成候选提交，再提交 handoff 元数据；真实 C7 review gate 先失败，Core 刷新后通过，Gateway 记录一次进展，再次刷新复用。此轻量夹具只证明 review gate，不宣称全部 C7/UI 或批次通过。 |
| 同输入调度对比 | 四个 C7 已知派生修复：生产器调用 **4→1**、宿主控制调用 **17→5**，后者减少约 70.6%。这是同输入脚本化调度实测，不包含真实模型思考、全套 Core 预检或完整交付耗时。 |
| 拒绝与资源边界 | 既有步数/空转/重复动作、原截止、阶段恢复、窗口不足、审批、作用域、unknown 等局部回归保持；真实 wire 七场景验证合法长命令与循环的区别。 |

集中结果包含 12 个局部测试文件、两个类型检查、全构建及两个分发检查；10 Harness、3039 文件一致性通过。首次集中检查中 wire 旧夹具失败：起始 20s grant 低于双发布余量，工具实际拒绝，旧测试却只按模型 turn/completed 判断“命令完成”。本轮将工具成功结果纳入断言，保留原 20s 必须拒绝案例；合法长命令案例从起始使用可行的 60s **测试夹具** grant，不延长任何运行中的 grant、不改变生产 3600s 授权或政策。只重跑这个被修正的测试，其他通过证据按运行来源未变复用；原失败日志仍在。

测试开发期间的夹具纠正也记录在验收中：completed 项目目标需精确 instance；内容绑定证据的年龄本身不失效，过期测试应显式声明 freshness；无 UI 路线的轻量 C7 不应被误称为真实 UI 门禁覆盖。没有为这些测试改宽生产门禁或上限。

证据：[验收与范围](evals/autonomy/p1-10/native-refresh-2026-11-11/acceptance.json)、[集中原始结果](evals/autonomy/p1-10/native-refresh-2026-11-11/checks-1794331925719/result.json)、[wire 补验](evals/autonomy/p1-10/native-refresh-2026-11-11/wire-corrected.stdout.log)、[最终来源与补漏差异](evals/autonomy/p1-10/native-refresh-2026-11-11/final-source-v2.json)、[补漏与最终分发](evals/autonomy/p1-10/native-refresh-2026-11-11/receipt-churn/result.json)、[HOLD 核验](evals/autonomy/p1-10/native-refresh-2026-11-11/entry-check.json)。根 workflow 两份状态/审计、7 个不存在的授权路径、590 个历史输入哈希、82 个捕获公开文件和 publish-r16 空实现均核验保全。

`REAL-NATIVE-REFRESH-PROGRESS` 仅在上述生产边界及捕获尾段范围关闭。旧完整 L2 已归回历史来源，不再显示为当前来源通过；当前完整 Native/批次汇合、实际模型成功交付、发布页 UI 与成功耗时仍未验证。本轮新模型运行/试点/H5/恢复均为 0，P1-10 不退出，P2 未实施。后续不得通过增大步数或直接另开试点替代对剩余路径的证据审查。

最终复审补漏：旧 stageInputs 摘要包含源码及上游证据的 mtime，仅排除本次回执时间仍不足以防止间接时间抖动。最终进展 identity 已排除该旧摘要，使用源码范围内容身份和专用传感器的内容哈希。新增真实 C7 断言：输入内容不变、仅改 mtime，生产器即使重新生成证据，也返回同一个目标身份，Gateway 仍只有一次进展。只补验三个受影响短测试、类型与分发；未改动的宿主调度/权限/预算回归复用。早先局部验收原文另存为 acceptance-before-receipt-churn.json；最终验收指向 final-source-v2.json 和 receipt-churn/result.json。
