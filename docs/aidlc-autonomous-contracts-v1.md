# 自主实施契约 v1：P0 定稿

当前 P1-10 阻塞修复增量见第 19 节；原章节保留各阶段契约演进，真实双试点仍须另行验收。

| 项目 | 内容 |
| --- | --- |
| 契约版本 | aidlc.autonomy/v1；设计定稿 1.0，2026-11-08 |
| 状态 | P0 契约已定稿；P1-01 范围采用、P1-02 策略/决策、P1-03 单会话 grant、P1-04 准入及 P1-05 多单元消费/写范围的 Core 与 P1-06 Codex 原生宿主已实施，其余能力按阶段推进；文档本身不是运行授权、业务审批或门禁证据 |
| 总体方案 | [自主实施与持续交付设计](aidlc-autonomous-implementation-design.md) |
| 演练与阻塞 | [P0 执行记录](aidlc-autonomous-implementation-p0.md) |
| 实施与验证 | [P1 实施记录](aidlc-autonomous-implementation-p1.md) |
| 优先关系 | 本文具体化总体方案第 10 章；实现仍以现有代码为准，采用与迁移必须显式执行 |

## 1. 通用约定

### 1.1 类型、版本与校验

- R 表示必需；O 表示可省略。除表中明确 nullable 字段外，不接受 null 代替缺失值。
- ID：`[a-z0-9][a-z0-9-]{0,63}`。run/attempt/grant/operation 使用 UUID；既有 workflow、module、unit、REQ、AC、PAGE、UC-D 继续采用其原 ID 规则，不为迁移改名。
- Revision：正安全整数，首值 1，受管 CAS 更新严格递增；时间为 UTC RFC3339，禁止使用时间戳代替内容版本。
- Digest：64 位小写十六进制 SHA-256。绝对路径只用于受管本机项目身份，不进入可移植业务 InputRef。
- 数组中的身份引用去重；实现使用稳定排序进行摘要。顺序有语义的 precedence、fallback_rules、argv 保留原顺序。
- v1 对每种对象使用封闭字段集；未知字段、版本、enum、重复 ID、悬空引用或不完整必需字段拒绝。新增含义先升级受支持 schema，不能默默忽略。
- 可写 authoring records、受管 receipts、宿主执行观察分别校验。解析有效只说明格式正确，不代表准入、授权或质量通过。
- 自主模式采用标记为 `autonomy_contract_version: "1"`。没有标记保持原流程；旧文件出现类似字段不自动启用新模式。

### 1.2 摘要规则

文件 InputRef 默认绑定实际原始字节。结构化段位于既有 Markdown 的唯一 `aidlc-autonomy` JSON fence，顶层为 `schema: "aidlc.autonomy-source/v1"` 与 `records`。每条 record 以 record_type/record_id 唯一定位，不允许同身份出现两次。

段级摘要使用 `json-record-v1`：选定 record 解析为 JSON，按递归键排序、无额外空白的规范 UTF-8 JSON 计算；数组顺序按字段语义处理。不做任意“忽略元数据”的投影，不在 record 内写其自身 digest。引用方或受控凭据保存 digest。

这使同一 handoff 内追加 decision 不会仅因字节变化使未变化的 policy 失效。其他仍按整文件绑定的现有 sensor 不自动获得该优化，继续遵循其实际算法。

### 1.3 CommonEnvelope

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| schema | 固定字符串 aidlc.autonomy/v1 | R | 契约版本 |
| record_type | 本文定义的对象名 enum | R | 对象身份，不能任意替换 |
| record_id | ID 或该对象专用 UUID | R | 对象稳定身份 |
| workflow_id | 既有 Workflow ID | R | 本次血缘归属，不能借用无关 workflow |
| revision | Revision | R | 该 record 的修订 |
| inputs | InputRef[] | R | 可为空仅限尚不消费业务输入的能力观察，业务/准入/验收记录不得空 |
| created_at | Timestamp | R，受管记录 | 实际签发/记录时间；手写来源不能伪装受管记录 |

顶层 record_type 取 batch/unit-extension/capability/dependency/policy/decision/grant/host-capability/admission/candidate/validation-matrix/observation/batch-result/run/attempt/host-checkpoint。引用和嵌套值不再次包装 CommonEnvelope。record_id 与对象专用身份字段须一致；batch 的 revision 与 scope_revision、policy 的 revision 与 policy_revision 一致，禁止维护两个冲突版本。decision 的 effective_revision 绑定有效设计，和其自身记录修订分开。

## 2. 引用契约

| 类型 | 必需字段 | 可选字段与约束 |
| --- | --- | --- |
| WorkflowRef | workflow_id、owner_kind=global/module/integration | module_id 在 module 时必需，其他情况不出现；保留现有布局解析 |
| UnitRef | workflow_ref: WorkflowRef、module_id、unit_id、definition_digest | workflow_ref 为嵌套对象；module 必须属于该血缘；定义摘要由解析器核验 |
| InputRef | repository_id: ID、path: 相对路径、digest: Digest、digest_mode=raw-file/json-record-v1 | selector 仅 json-record-v1 必需，包含 record_type/record_id；path 不得越界、含链接绕行或不可读 |
| SourceItemRef | InputRef、item_id | 指向该来源真实定义的 REQ/AC/PAGE/状态等，单纯正文提及不等于定义 |
| PolicyRef | InputRef、policy_id、policy_revision | 必须选择 policy record，匹配摘要与修订 |
| EvidenceRef | sensor、stage_instance、path、digest、workflow_id | batch_id 在新自主证据时必需；来源/producer/checker 校验不因有引用而省略 |
| CapabilityRef | provider_ref、capability_id、version_digest | provider_ref 为 UnitRef 或明示 ExternalRef，禁止把外部系统伪装成本地 unit |
| ExternalRef | external_id、owner、contract_ref、version_ref | 实际环境定位由环境记录引用；未知 Owner/版本不能 ready |

引用缺失时不自动建立对象。P0 演练中的文档标签不是已签发的 WorkflowRef 或 EvidenceRef。

嵌套类型采用以下封闭字段，避免实施时再猜测默认含义：

| 类型 | 字段与类型 | 约束 |
| --- | --- | --- |
| ArtifactRequirement | artifact_id: ID、kind: candidate/run-instructions/evidence-index/decision-index/other、required: boolean、source_ref?: InputRef、target_path?: 相对路径、purpose?: 字符串 | other 必须增加非空 purpose；尚未生成的目标以计划相对路径描述，不能伪造现成 InputRef |
| SourceRule | rule_id: ID、scope_items: SourceItemRef[]、preferred: InputRef、supersedes: InputRef[]、authority_ref: AuthorityRef | 仅在指定范围和有真实替换依据时消解冲突；否则不匹配 |
| Condition | kind: enum、refs: SourceItemRef[]、expected: JSON scalar/array | v1 kind 仅 missing-detail/existing-convention/compatible-internal-change/explicit-conflict/out-of-scope；不执行任意 JavaScript 或日志文本 |
| CategoryRule | category_id: ID、when: Condition、allowed_actions: string[]、forbidden_changes: SourceItemRef[] | allowed_actions 是允许的设计/实现类别，不是任意 shell 命令 |
| FallbackRule | rule_id: ID、when: Condition、default_behavior: 非空字符串、constraints: SourceItemRef[]、required_checks: check ID[] | 行为必须可由指定断言验证，不能仅写“合理/保守”；重叠且结论不兼容时拒绝 |
| HostRef | host_id: ID、version: 非空字符串、entrypoint: 本机定位、config_digest: Digest | CLI 版本不同即不同能力观察，桌面会话不隐含 CLI 等价 |
| CandidatePermissions | candidate_commit: boolean、candidate_integrate: boolean、push: boolean、protected_branch_write: boolean、deploy: boolean | 全部字段明确填值，不从其他权限推导 true |

ArtifactRequirement 的计划路径使用独立 target_path 字段；已有 source_ref 与 target_path 二者恰有一个，不能把未来路径与已存在来源混淆。候选实际交付时再绑定真实产物摘要。

## 3. 业务定义：单写位置与字段

### 3.1 DeliveryBatch

权威位置：现有 scenario-module-mapping.md 的 `aidlc-autonomy` 段，record_type=batch。新轻量流程若原本不要求场景清单，P1 首版在既有 handoff.md 中唯一存放同种 record；同一批次只允许一处权威位置，不为省略流程复制两份。

| 字段 | 类型 | 要求 | 校验 |
| --- | --- | --- | --- |
| batch_id、scope_revision | ID、Revision | R | scope 改变新建修订，保留原记录与 supersedes |
| goal | 非空字符串 | R | 有限交付目标 |
| scenario_refs、acceptance_refs | SourceItemRef[] | R，非空 | 固定验收分母，引用必须真实存在 |
| ui_refs | SourceItemRef[] | R，可空 | 空仅在可信无 UI 适用性下成立 |
| units | BatchUnit[] | R，非空 | 每个 UnitRef 对应 implement/consume/verify 角色 |
| dependency_refs | SourceItemRef[] | R，可空 | 无依赖必须有设计依据，不能只因未登记而为空 |
| consumer_closure | ConsumerCheck[] | R | 包含必须验证和明确排除依据；允许有据为空 |
| baseline_inputs | InputRef[] | R，非空 | 产品与设计基线，不绑定实现的未来内容 |
| policy_ref | PolicyRef | R | 本批次自主策略 |
| integration_owner | 角色 ID | R | 协调责任，不授予其他 unit 写权限 |
| validation_matrix_ref | InputRef | R | 固定必要验证矩阵 |
| delivery_artifacts | ArtifactRequirement[] | R，非空 | 候选、运行方法、证据和决策引用 |
| supersedes | 旧 batch_id/scope_revision 和 diff InputRef | O | 不能无差异原地覆盖已确认范围 |

BatchUnit 包含 unit_ref、role、expected_capabilities、可选 evidence_refs: EvidenceRef[]；consume 的 evidence_refs 非空，且必须绑定已验证版本及证据，不能被动把未来未实现能力作为可复用输入。ConsumerCheck 包含 consumer_ref、required_checks、exclusion_reason；有 exclusion_reason 时不得同时声称该项验证通过。

### 3.1.1 P1-01 已实现的采用与校验边界

采用命令为 `orchestrate autonomy adopt --batch <id> --expect <global-state-revision> [--preview]`；读取已采用范围为 `orchestrate autonomy inspect`。正式采用要求既有有效的 global 项目阶段 session binding，以既有 CAS 锁保存 state/audit。preview 无需领取并保持零写入；不能从来源记录自动采用。

global state 保存 `Autonomy Contract Version: 1` 与 `## Autonomy Batch` JSON 快照：`version="1"`、`batch_id`、`scope_revision`、`source_path`、`record_digest`、`scope_digest`。快照是范围身份，既非完整业务定义副本，也非授权/验收凭据。普通保存不得移除或替换已采用快照。来源修订不能原地接管；P1-01 拒绝 supersedes，需新 workflow。采用前完成 split 布局，采用后拒绝改变 UnitRef 归属的 split。

P1-01 按本地实际模块/单元清单核验 UnitRef：未拆分时 owner_kind=global；拆分后 owner_kind=module 并匹配 registry 对应 workflow_id、module_id 和血缘。definition_digest 绑定单元清单中该 unit 的完整 JSON 条目，模块定义也进入范围摘要。只支持 repository_id=project 和本地 provider UnitRef，ExternalRef、外部仓库和可用替身的评估留待后续任务；stub_policy 当前仅接受 denied。

校验固定场景、AC、UI、基线和交付产物引用，拒绝悬空定义、重复身份、错误版本和不安全路径。读取已登记的相关依赖，检查所选消费者的上游提供者/边，以及 implement 提供者的下游 consumer_closure；下游必须有真实矩阵 check ID，或非空排除理由。已有 evidence_inputs.depends_on_units 也不能遗漏。验证的完整性仍以已登记且真实的设计输入为前提，P1-04/05 继续检查设计接收、依赖语义和就绪性。

只读投影返回 `enabled`、`validation_level="scope-only"`、`execution_authorized=false`、`gates_evaluated=false`、快照、范围字段与 `pending_validation`。policy/matrix 本步仅校验公共 envelope、引用身份/摘要和必要 check ID，未检查其完整策略与断言语义；consume 仅校验能力版本绑定及 evidence 的文件摘要/归属，不声称 producer、时效或就绪校验已完成；空 ui_refs 不代表无 UI 已通过。后续 P1-02/03/04/05/07 必须补齐相应检查，再作自主实施准入。

范围摘要纳入 batch record 与实际解析输入的摘要。json-record-v1 使用递归按键的码点排序，所有数组保持来源顺序；P1-01 数组重排同样视作范围变化。raw-file 按原始字节绑定。未变化 record 的 JSON 对象键顺序、空白或同文件追加无关 decision 不改变摘要。`next` 在路由前重读采用范围并返回投影；CLI `report` 在处理前重读；不改变现有阶段选择与质量门禁。以上是本步范围防漂移能力，不覆盖任意内部 API 或磁盘写入。

### 3.2 UnitDefinition 扩展

原 unit_id/name/service_id/conditional_stages/req_refs/evidence_inputs 沿用现有定义。新增以下受版本标记保护的字段：

| 字段 | 类型 | 要求 | 校验 |
| --- | --- | --- | --- |
| behavior_refs、acceptance_refs | SourceItemRef[] | R，非空 | 实现单元拥有可验证行为；纯声明/无行为范围按既有可信适用性处理 |
| capability_refs | CapabilityRef[] | R，可空 | 可独立解锁时必须有能力定义和相应验证 |
| write_scope | WriteScope | R | 含 private_paths、shared_writes；不与 evidence_inputs 混用 |
| integration_checks | SourceItemRef[] | R | 无跨单元检查可有据为空 |
| ui_owner_refs | SourceItemRef[] | R | UI 单元列页面/区域责任，无 UI 单元为空并有适用性来源 |

WriteScope 中 private_paths 为项目相对路径；shared_writes 为 path、owner_unit_ref、coordination=single-writer/serialized。独占冲突拒绝或调整执行方式。evidence_inputs 私有路径仍须完整互斥；依赖图和输入传播分别校验，不从其一推断另一完整。

同一 unit 定义修订最多一个活动 implement 批次。批次冻结后改变 unit 边界需要影响分析和 scope_revision，不把“移动代码”当成已有授权自然覆盖。

### 3.3 DependencyEdge

权威位置：unit-of-work-dependency.md 的唯一结构化段；unit-manifest 只引用边 ID 与摘要。

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| dependency_id | ID | R | 唯一依赖身份 |
| provider、consumer | UnitRef/ExternalRef、UnitRef | R | 无虚构消费者 |
| type | contract/implementation/runtime | R | none 用有依据的空边集合表达，不建立假边 |
| capability_ref | CapabilityRef | R | 对具体能力，不对模糊的整个服务 |
| consumer_checkpoint | 实际 stage slug 或 validation_matrix 中检查 ID | R | 明确阻塞位置，不支持任意虚构阶段 |
| required_state | contract_ready/capability_verified/runtime_ready | R | 与 type 一一对应 |
| readiness_evidence | EvidenceRef[] | R，可在设计时为空 | 设计定义可未就绪；消费时不得为空或失效 |
| stub_policy | denied 或包含局部 check ID 与 contract_ref 的对象 | R | 默认 denied；永不能满足真实 runtime 门禁 |

P1 先落实试点所需 contract/runtime 及“无法独立证明则等待 unit 实现完成”的保守路径。完整能力级增量前沿调度留 P3；不能因为新状态名存在就提前放行。

## 4. 自主策略与决策

### 4.1 AutonomyPolicy

权威位置：已有 development-handoff.md；不使用该产物时在 handoff.md。record_type=policy。

| 字段 | 类型 | 要求 | 规则 |
| --- | --- | --- | --- |
| policy_id、policy_revision | ID、Revision | R | 内容变化换修订，grant 绑定旧摘要不自然扩权 |
| scope_refs | batch_id/scope_revision[] | R，非空 | 不允许无范围通配授权 |
| hard_constraints | SourceItemRef[] | R，非空 | 包含明确业务决定、范围和必要质量约束 |
| source_precedence | 有序 SourceRule[] | R | 仅对明确范围生效，不能以文件较新擅自替换决定 |
| delegated_categories | CategoryRule[] | R | 每类含 id、条件、允许动作、禁止变化 |
| fallback_rules | 有序 FallbackRule[] | R | rule_id、条件、默认行为、约束、required_checks；冲突必须可解析 |
| allowed_change_classes | 既有分类的受限集合 | R | 实现细化、回归基线的缺陷修复等；语义变更不得靠分类改名逃避 CR |
| escalation_conditions | Condition[] | R | 真正越界或不可解析核心冲突，不能默认覆盖所有技术选择 |
| validation_requirements | SourceItemRef[] | R，非空 | 不允许为兜底删除原验收 |
| authority_ref | AuthorityRef | R | 人类确认策略的真实来源；演练方案没有此运行资格 |

AuthorityRef 含 source_kind=host-user-message/host-approval/operator-instruction、source_locator、source_digest、scope_summary、actor_locator；引用可定位、内容与授权范围一致。宿主对来源真实性负责，Core 做完整性、范围和记录一致性校验。普通路径、字符串或 `--user-input Approve` 本身不构成外部身份认证。

### 4.2 DelegatedDecision

权威位置：handoff.md 的 decision record；相关详细设计仅保存有效规则与 decision 引用。

必需字段：decision_id、policy_ref、policy_clause、question、source_refs、chosen_option、rationale、affected_refs、effective_revision、implementation_refs、validation_refs、adjustment_plan、recorded_by。刚作出决策时 implementation_refs/validation_refs 可空，但完成门禁必须验证相应实际产物和观察。

human_review 包含 status=pending/accepted/change-requested/rejected；pending 不填虚假 reviewer。非 pending 必须有真实 reviewer、AuthorityRef 和时间；修改/否决需 replacement/change_ref。

effective_revision 只覆盖策略允许的空白细化，不改变 scope_revision 的验收分母。硬约束改变、功能排除或设计基线替换必须采用新的范围/策略授权。未复核委托决策可以伴随工程 verified，未实现/未验证则不能。

### 4.3 P1-02 实现契约

策略从 batch.policy_ref 精确读取，位于现有 `docs/aidlc/modules/<module-id>/inception/development-handoff.md`（或项目级 `docs/aidlc/inception/development-handoff.md`）；轻量流程使用 `docs/aidlc/handoff.md`。同一 workflow 只能有一个权威 policy 落点。策略的 envelope、封闭字段、单批次 scope_refs、所有 SourceItemRef/InputRef、条款 ID、条件、允许动作/类别、来源优先关系和必要 check ID 均校验。validation_requirements 必须包含批次全部 AC，hard_constraints 必须包含全部 UI 引用；其他明确产品回答、权限和数据约束在设计接收时完整登记为 hard_constraints。

AuthorityRef 的 scope_summary 在本版精确序列化为 `<batch_id>/<scope_revision>`。source_kind 仅 host-user-message/host-approval/operator-instruction；locator、actor、SHA-256 均必需。Core 校验引用完整性、范围和记录一致性，宿主负责真实输入及内容真实性；这不等于人类身份认证，也不签发 ExecutionGrant。

`policy_clause` 使用 `category:<category_id>` 或 `fallback:<rule_id>`。Condition 由固定策略定义 kind、真实来源 refs 与 expected（JSON scalar 或 scalar array）；decision 只能引用已登记条款，不能传任意表达式或自造谓词。宿主仍需依据来源检索判断其确为未指定细节/已有惯例/兼容内部变化，并执行需求完整性的反向检查；Core 不用自然语言关键词推导授权。explicit-conflict/out-of-scope 不作为合法委托条款执行，命中已登记 escalation 的决定拒绝。重叠且不兼容的 fallback 或 source precedence 拒绝，不能以排序或较新文件静默裁决。

Decision 在第 4.2 节字段外必需 `unit_ref: UnitRef`、`change_class` 和 `action`。unit_ref 必须属于批次 implement 单元；change_class 限 implementation-refinement / baseline-defect-fix / behavior-preserving-refactor，分别对应既有实现细化、回归基线的缺陷修复和无行为重构。语义变更不属于这些分类。category 的 action 必须在 allowed_actions；fallback 的 action 与 chosen_option 均须等于授权 default_behavior，不能记录为“兜底”却选择另一行为。

affected_refs 只能落在所选条款的 when.refs 细化槽位内，不得与 hard_constraints、validation_requirements、forbidden_changes 或 fallback.constraints 相交。source_refs 必须包含条件、硬约束、原验证要求和条款约束。新决定不能以另一 ID 覆盖同一槽位的不兼容选择。

implementation_refs 为 InputRef[]，validation_refs 为增加必需 check_id 的 EvidenceRef[]；实际文件、摘要、单元 workflow、batch_id 与 check ID 均须匹配。可在初次决策时为空，投影显示缺项；fallback 的每项 required_checks 必须有对应引用。文件存在且摘要匹配只说明引用已记录，不证明 controlled producer、freshness、断言、候选或 UI 验收已通过。

新增 decision 的 revision=1，effective_revision 取本批次现存决策最大值加 1，无决策的派生视图为 0；决策有效修订应组成从 1 开始的连续唯一序列。补充实现、验证或首次人类复核时 revision 严格加 1，effective_revision 与原问题、选择、影响、策略等保持不变，recorded_by 记录本次实际发布 owner/session。已经记录的非 pending 人类复核不能由 Agent 改回 pending 或改写结论；需要变更时按新显式来源和增量范围流程处理。

human_review=pending 只能包含 status。非 pending 需要 reviewer、authority_ref、reviewed_at；reviewer 与 actor_locator 一致，UTC 时间真实有效；复核必须有与初始策略确认不同的 locator 和 digest。change-requested/rejected 另需实际 replacement_ref/change_ref；它们在投影中要求增量返工。Core 不代替宿主证明此输入真的来自人类，不把普通 authoring JSON 当审批认证。

写入命令为 `orchestrate autonomy record --input <项目相对 JSON> --expect <handoff-sha256|absent> [--preview]`。proposal 是临时输入，不作为第二个权威落点；正式记录仅替换 handoff 唯一 autonomy fence，保留其他 records 和外围叙述。精确 claim 必须属于目标 implement 单元的 workflow/module/unit；使用既有 workflow 发布锁加 handoff 文件排他锁，在锁内重新校验来源和 SHA-256 CAS，再原子替换。preview 和幂等重试不写状态或文档；异常、锁竞争、陈旧来源、过期会话均拒绝。不改动 workflow 阶段、修订号或 audit；decision 的 revision 是业务记录修订。

禁止把待追加的 handoff 作为 raw-file 基线、决策实施/观察来源或被当前更新改写的 decision 段引用；不能通过写入使自身引用或冻结基线失效。输出限制 2 MiB，超限在写入前拒绝。崩溃后的锁/临时文件恢复、跨会话自动接管不在 P1-02 范围，冲突不得自动覆盖。

`autonomy policy`、`autonomy decisions`、`next` 与 `state summary` 返回只读 `autonomy_decisions`：policy、effective_revision、decisions、human_review_summary、completion_blockers、handoff_digest，以及 `execution_authorized=false`、`engineering_verification=not_evaluated`。record_status 为 incomplete / recorded-not-verified / rework-required。human_review=pending 不加入 completion_blockers；引用缺失和增量返工要求会加入。CLI 的 build-and-test、implementation-report 等工程完成报告先检查这些缺项，之后仍执行原门禁；本投影不能自己决定业务 verified，最终候选与运行观察的完整绑定由 P1-07/08 接入。

## 5. ExecutionGrant 与信任边界

### 5.1 字段与存储

Core 管理 `.aidlc/autonomy/grants/<grant-id>/` 下的签发与撤销记录。它是运行授权记录，不是可编辑业务配置。与现有本机操作 journal 相同，采用本机受信签发和内容校验；不承诺隔离拥有同一文件系统权限的任意进程。

| 字段 | 类型 | 要求 | 说明 |
| --- | --- | --- | --- |
| grant_id、run_id | UUID | R | 一个 run 对应一个有效授权修订，不自动延长 |
| batch_id、scope_revision | ID、Revision | R | 精确交付范围 |
| project_identity | realpath、repository identity | R | 与 binding 所在项目一致 |
| workflow_refs | WorkflowRef[] | R，非空 | P1 一个 workflow，不能借此接管现存无关工作 |
| policy_ref、baseline_digest | PolicyRef、Digest | R | 绑定策略与基线 |
| authority_ref | AuthorityRef | R | 真实人类操作授权，不能由来源文档生成 |
| issued_at、expires_at | Timestamp | R | expires_at 大于 issued_at；发布时使用可信当前时间核验 |
| revocation_revision | Revision | R | 当前授权世代；撤销记录使旧凭据失效 |
| allowed_operations | OperationClass[] | R，非空 | 设计/代码/测试、环境、提交、整合分别列明 |
| executor_constraints | HostRef、session_id、scope limits | R | P1 绑定一个宿主会话 |
| successor_policy | disabled 或 versioned policy | R | P1 仅 disabled；启用自动后继为 P2 |
| resource_limits | ResourceLimits | R | 无缺省无限预算 |
| integration_permissions | CandidatePermissions | R | main/push/deploy 显式字段，缺省均 false |
| issuer_provenance | Core 签发身份与完整性引用 | R，受管 | authoring record 不得自行填入以获得授权 |

ResourceLimits 必需 wall_time_seconds、max_equivalent_retries、max_active_units；均为有限整数，重试上限可为 0，active units 至少 1。成本/调用限制为可选，只有宿主能够真实观测/执行时才声明该限制；无法观测不能伪造余额。测试运行可采用预先确认的小额资源配置，不能当作本次 P0 的运行授权。

### 5.2 生效与撤销

1. 人类在宿主真实交互入口确认精确范围、允许动作和限制。
2. 宿主提交 AuthorityRef；Core 验证内容/范围、保存批准来源并签发 grant。
3. 后续每次受管变更和 evidence 发布在现有锁内核对 grant、撤销修订、期限和当前 stage binding。
4. 宿主在工具副作用前复核范围，撤销后停止新动作并取消仍运行命令；已发生副作用按真实结果对账。

仓库文档、模型输出、Provider 输出、演练记录不能成为第 1 步。Core 签名证明记录由其签发且未被篡改，不证明独立的人类生物身份。当前宿主未提供可信来源转交/保存适配前，不宣称“已解决不可伪造的人类授权”。不以完全关闭沙箱作为无人值守前提。

已有 session generation 仍按每个精确实例领取；grant 不替代 bind，不替代 block 审批。P1 不允许换会话凭 grant 自动 transfer，原显式交接路径继续适用。

### 5.3 P1-03 实现契约

本版支持可信操作端的 operator-instruction 入口：`orchestrate autonomy grant issue --input <request.json> [--preview]`。正式签发在实际终端展示 Core 生成的完整请求，要求操作人输入 `Approve <该请求摘要>`；非 TTY、管道 JSON、普通 AuthorityRef、`--user-input Approve` 和 Provider/文档输出不能构造签发所需的进程内批准对象。Agent 不得代输确认。终端本身不证明操作者是人类；本版依赖可信操作端遵循真实输入约定，不宣称已有原生 Codex/其他宿主聊天事件认证，也不抵抗拥有同一用户全部文件/进程权限的主动伪造。

request.json 使用封闭字段：run_id、lifetime_seconds、allowed_operations、host、resource_limits、integration_permissions、write_paths。run_id 为规范 UUID；host 为完整 HostRef，entrypoint 是实际本机入口文件；lifetime_seconds 为有限正整数且不大于 wall_time_seconds；max_equivalent_retries 为非负整数，P1 的 max_active_units 固定 1。集成权限五个布尔字段全部明确填写，与对应操作是否列入 allowed_operations 一致，不推定权限。write_paths 是有限项目相对业务路径，禁止覆盖 .git/.aidlc/工作流控制面。授权 payload 上限 1 MiB。

OperationClass 首版取 design-write、code-write、test-write、validation-execute、environment-write、decision-record、workflow-write、stage-report、evidence-publish、provider-execute、candidate-commit、candidate-integrate、push、protected-branch-write、deploy。code/test 修改需要已批准 implement unit 的精确阶段领取；consume/verify 归属不产生实施权限。design/code/test/environment 文件写入的 check 必须给出真实目标路径。候选提交/整合、push、受保护分支、部署分别检查，任何一项都不自动授权另一项；具体目标和工具行为仍由宿主及对应交付入口复核。

Core 从实际采用范围生成 grant_id、batch/scope、policy_ref、baseline_digest、输入清单、同项目血缘的 workflow_refs、模块/单元和 implement 单元集合。单批次可以包含既有 split global/module/integration 状态文件，但不能授权其他项目或未选模块；它仍是一个项目 workflow 血缘和一个执行会话，不是多个独立项目的运行授权。

受管记录 schema 为 aidlc.execution-grant/v1；批准回执为 aidlc.grant-approval/v1，撤销为 aidlc.grant-revocation/v1。它们与业务 authoring 的 aidlc.autonomy/v1 分别校验：authoring 中即使存在 record_type=grant 也没有运行资格。受管 grant 除第 5.1 节字段外保存 request_started_at、实际 inputs 和 approval_digest，issuer_provenance 使用 Ed25519 key_id/algorithm/signature。批准回执保存实际终端响应、时间、操作者定位及完整请求摘要；源响应按 UTF-8 实际字节摘要。签名证明 Core 签发与内容完整，不证明外部人类身份。

私钥存于 Git common directory 的 `aidlc/autonomy/issuer.json`，不进入工作树；同处 anchors 下按 project realpath 和 grant_id 保存签名撤销锚点。工作区的 `.aidlc/autonomy/grants/<id>/` 保存 approval.json、grant.json、可选 revocation.json。初始撤销修订为 1，撤销后为 2，P1 不恢复原 grant；删除撤销 JSON 会与锚点不一致并拒绝，删除密钥/锚点也不自动重建或恢复有效。完整本地控制数据备份/回滚不具备外部单调性保证，需要操作人对账。

签发在既有精确工作流发布锁和自主控制锁内复核当前领取、固定来源与请求，再保存 receipt/锚点并通过既有 CAS 激活 global state：`Execution Grant Version: 1` 和 `## Execution Grant` JSON，引用包含 version、grant_id、run_id、digest。普通保存不能增加、替换或移除该引用；无标记保持原手工模式，不从普通 JSON 或 grant 文件自动采用。激活前失败的孤立记录不产生运行权限，不自动接管恢复。

宿主在本会话 Core 子进程中传入实际 HostRef 的 `AIDLC_AUTONOMY_HOST`，用 `grant bind` 验证当前精确领取并取得 ref，再通过 `AIDLC_EXECUTION_GRANT` 传给后续命令。grant 绑定 session_id/owner/HostRef 和限定 workflow 集合；每次发布仍验证当前实例的 generation/期限。初始 binding 仅用于防止批准后领取被替换，不把整个运行永久固定在首个阶段 generation 上。同一会话切换阶段可重新 bind，原 expires_at 不变；新会话、owner、host/config 或不支持的 successor 直接拒绝。

期限从 Core 准备请求时开始计算，issued_at 为实际提交时间，不能通过延迟签发延长期限；进程内批准超过五分钟不能消费。发布时用当前系统时间复核 expires_at 和 wall_time，不允许早于签发时间。max_equivalent_retries/max_active_units 同时交给宿主驱动执行；本步不声称已实现预算调度或外部命令计量，P1-04/06 仍需验证对应能力。

签发后每次受管状态/决策/证据发布在锁内重读 grant、签名、批准摘要、撤销锚点、来源和当前领取；Provider Runner 在执行前检查 provider-execute，受控验证入口/项目命令检查 validation-execute，最终发布再次复核。产品来源、policy、单元/依赖清单、消费证据或原来不存在的依赖输入改变会失效；合法新增 decision 不修改固定 policy/source record 摘要。宿主仍须在外部工具副作用前执行 `grant check --operation <class> [--path <target>]`。Core 不拦截任意进程直接改盘，不替代原工具沙箱、argv 约束、阶段执行策略、block 审批或质量门禁。

`grant revoke --expect <revocation_revision> --reason <text> [--preview]` 使用独立的实际操作输入，在运行 grant 过期、撤销环境变量缺失或执行会话不可用时仍可撤销；与发布共享控制锁。重复已提交撤销只返回原状态，不再次索取批准。新的发布拒绝，已在外发生的副作用由宿主取消/对账。原生 release、明确 park 和静止维护是安全控制面，不因此恢复业务实施权限；暂停仍需明确原生续作，不能凭 grant 自动恢复。

inspect、bind、check、next 和 state summary 的 grant 视图与业务 verified 分开；inspect/bind 不返回泛化的执行成功。check 仅在当前具体操作通过时返回 execution_authorized=true，admission_evaluated 仍为 false。P1 不续期、不替换既有 grant、不自动跨会话恢复；需要新授权时沿明确新 workflow 或后续受控恢复设计处理。

## 6. HostCapability 与准入

### 6.1 HostCapability

宿主记录 host_id、version、entrypoint、config_digest、observed_at、capabilities、probe_refs、limits。能力状态固定为 supported/unsupported/unknown；supported 须指向实际观察，命令存在与模型执行成功使用不同能力键。

至少分开以下键：cli-entrypoint、model-turn、continuous-session、compaction-continuation、session-resume、process-relaunch、external-task-control、browser-dom、browser-screenshot、browser-interaction、budget-enforcement。

模式 session-continuous 需要原生会话连续驱动以及所需工具可用；restart-recoverable 额外需要重启、后继授权和对账探针。`--version`/`--help` 只能证明入口，不能证明认证、网络、工具权限、持续运行或恢复。

### 6.2 AdmissionReceipt

Core producer 发布到 `.aidlc/evidence/autonomous-admission/<batch-id>/<scope-revision>/<receipt-id>.json`。业务来源无 passed 字段；receipt 绑定 producer/checker 身份，必须沿既有证据验签和来源规则消费。

必需字段：batch_ref、grant_ref、policy_ref、baseline_inputs、unit_definition_digests、dependency_versions、environment_refs、capability_probe_refs、command_config_digest、checks、delegated_decision_refs、issued_at、valid_until、producer/checker。

checks 每项包含 check_id、required、status=passed/failed/not-applicable/unverified、reason、InputRef/EvidenceRef；required 的 failed/unverified 不能 ready。不适用需要可信条件，不能由工具缺失推导。

admission_result 仅为 ready/ready-with-delegated-decisions/not-ready。未实现的后端不必阻塞契约允许的前端编码，但必须在 dependencies 中作为尚未满足的联调前置；设计和验证条件应完整，不能提前记录 runtime_ready。

P1 设计阶段通过不等于运行准入：合法授权、环境和真实验证资源尚缺失时，仍返回 not-ready。

### 6.2.1 P1-04 接收计划与受管发布

`AdmissionPlan` 使用 `schema="aidlc.admission-plan/v1"`，是接收计划，不是 passed 凭据。计划文件必须以 raw-file InputRef 纳入批次 `baseline_inputs`，在 P1-03 实际授权前冻结。未知字段、缺失模块、悬空引用、未覆盖矩阵或 AC/UI 分母均拒绝。

| 字段 | 约束 |
| --- | --- |
| batch_id / scope_revision | 与采用快照完全一致 |
| lifetime_seconds | 1..900 秒，同时受 grant、能力探针期限限制 |
| reception[] | 精确覆盖 implement 模块；module_id、ui=none/required、source_refs；UI 适用时给出 ui_baseline |
| ui_baseline | design_refs、asset_refs、viewports(width/height)、states、tolerances.max_diff_ratio；不能以空 ui_refs 或缺少浏览器推导无 UI |
| commands[] | command_id、绝对可执行文件 argv、timeout_ms、input_refs；不用 shell 拼接，单项最长 30 秒、合计最长 60 秒、每项输出缓冲最多 1 MiB |
| validation_bindings[] | 与冻结矩阵完整 check ID 集合相等；check_id、covers(SourceItemRef[])、command_id、assertion、kind=behavior/ui-visual/ui-interaction；UI 必须同时规划视觉与交互检查 |
| resources[] | kind=environment/test-data/design-asset、input_ref；环境与测试数据均须显式可读且摘要一致 |
| environment_variables[] | 所需变量名，值只按摘要绑定，不写入凭据；缺少变量不能通过 |

接收复用现有 cross-validation-report 的包索引、development_acceptance 和 technical_review，核对真实包文件摘要与 review 身份/结论。technical_review 增加 `autonomous_reception={batch_id,scope_revision,ui,source_refs,unresolved_decisions}`；未决项必须逐一对应合法委托记录。未实施或未验证的决策输出保留完成阻塞，不因人类复核 pending 阻塞初次实施；明确拒绝或待返工的问题不能当作普通兜底。

`orchestrate autonomy admission run --input <plan> --preview` 只读，不执行探针/命令，不创建密钥、领取或凭据。实际 run 由 Core 运行受限命令，返回全部八项检查：scope-policy、execution-grant、design-reception、dependency-readiness、validation-plan、environment、host-capabilities、execution-preflight。退出码、信号、错误、argv 摘要和 stdout/stderr 摘要属于运行观察；预检通过不等于业务测试或最终候选通过。

Core 在所有相关 workflow 文件按固定路径排序获取锁后，再获取 grant control 锁，重验授权、来源、checker、环境与时间并发布 Ed25519 签名 receipt 和签名 current 指针。沿用 Git common directory 的可信 issuer；不新增业务文档签发入口。凭据额外绑定 checker_digest、decision_digest、environment_variables、executables/environment_binding、command_observations。environment_refs 与 capability_probe_refs 为已校验 InputRef 数组，完整原生观察另存在 host_observation；不把观察对象冒充引用。checker 在接收、签发与消费时强制刷新，不受调用方缓存影响。inspect 始终 `execution_authorized=false`、`business_verified=false`；执行仍需实时 grant/binding 与原阶段门禁。

原生能力通过可信进程内 `AdmissionHostAdapter.observe` 接入：Core 提供随机 nonce、已批准 HostRef、必要能力键及预算；适配器返回同一身份/nonce/limits、观察期限和逐能力实际 probe_refs。普通 JSON、CLI `--version` 或命令自行打印 supported 不能成为此适配器。P1-04 提供消费与校验接口，P1-06 才接入实际宿主。默认 CLI 缺少该适配器时，host-capabilities=unverified，结果为 not-ready；不虚构原生模型、持续驱动、预算或浏览器能力。

P1-05 已将多单元、capability/dependency、consume/verify、split、共享输入与写入范围校验接入 dependency-readiness；具体读取、消费、来源失效及保守限制见第 13 节。缺少定义或无效版本仍为 not-ready；发布和受控消费时再次核对。P1-07 仍负责真实运行断言、UI 还原和最终候选验收；本步验证计划的可执行准备及分母绑定，不签发业务 verified。原有 I13、RED/GREEN、UI bridge、review 与 C8 门禁继续独立执行。

决策失效绑定只覆盖有效设计和返工语义。单纯递增记录 revision、补写 implementation_refs / validation_refs / recorded_by，或把人类复核从 pending 记为 accepted，不引入新设计事实，不使接收失效；这些输出仍由决策读取和完成门禁独立校验。新增有效决策、改变有效设计、拒绝/要求调整或出现未知字段仍需重验。只要存在有效委托细节，准入结果保留 ready-with-delegated-decisions，实际待复核数量与工程完整性另外投影。

### 6.3 变化处理

| 变化 | 处理 |
| --- | --- |
| 新增合法委托决策 | 核对 policy，增加 effective_revision，重验受影响设计/断言；不改变原验收分母 |
| scope、硬约束或 policy 扩权 | 新范围/策略修订与实际授权；旧 grant 不自然覆盖 |
| 实现/候选变化 | 使受影响实施证据失效，设计未变不要求重新人类交接 |
| 环境、命令、checker 变化 | 按实际绑定复核/失效，不能仅更新时间续用 |
| 仅无关业务记录追加 | 只有采用 json-record-v1 的相关来源可以按选择段复用；未知范围继续保守校验 |

## 7. 候选、验证和结果

### 7.1 CandidateRef

必需 candidate_id、repositories、artifacts；repositories 非空，每项含 repository_id、commit（完整 Git OID）、tree_digest、dirty、worktree_locator、relevant_inputs。dirty 为真实观察，不能强填 false；交付候选必须可重建并由门禁确认。P1 使用一个提交完整、干净的隔离候选；多仓固定组合在 P3 才验收。

source snapshot 与最终 candidate commit 分开：新代码可能尚未产生最终提交，期间证据继续使用已有 dirty/worktree 摘要机制；提交后按 sensor 实际来源算法复核，不能凭“只提交了相同文件”自行修改证据。

### 7.2 ValidationMatrix 与 Observation

矩阵定义 mandatory acceptance IDs、check IDs、UI combinations、risk checks、candidate requirements 和环境。每项 check 含 kind、command/tool_ref、expected_assertions、scope、required、适用性来源。命令采用现有 argv allowlist，不能执行错误日志里的任意脚本。

Observation 必需 observation_id、check_id、candidate_ref、environment_ref、实际 command/tool identity、started_at/ended_at、exit/result、assertion_results、raw_output_ref、producer 绑定。来源和声明均必须可复核。编造 exit=0、assert True 或源码标记只能支持其实际检查的结构事实，不能替代业务断言。

UI Observation 额外绑定 PAGE/region/action、状态、角色、视口、设计来源/资源摘要、实际截图、交互步骤/结果、差异区域和审查。屏蔽和容差必须在观察候选前固定来源，不能在发现实现偏差后修改设计基准。

### 7.3 BatchResult

必需 batch_ref、scope_revision、effective_revision、candidate_ref、environment_refs、acceptance_observations、ui_observations、review/build/test/risk_refs、decision_refs、delivery_artifacts、engineering_result、human_review_summary。

engineering_result=verified/failed/blocked/incomplete，由 Core 汇合真实结果。human_review_summary=pending/accepted/changes-requested，不能用它覆盖工程结果。必要验收覆盖=全部选中必要条目都有有效观察；不会按“已登记成功项”的数量计算分母。

生命周期状态沿总体方案第 11 章。verified 只适用于精确候选；current/stale/unknown 是当前适用性投影。跨候选不得仅复制历史 passed。

## 8. Run、恢复与 operation

P1 在现有受管 state/audit 中记录 grant/run/batch 引用和诚实退出结果；不新增可独立手改的运行进度文件。宿主可以保存定位和日志，但其 final response 不能决定 verified。

Run 必需 run_id/grant_ref/batch_ref/session_locator/current_attempt/budget_observation/state_ref。Attempt 必需 attempt_id/session_id/predecessor（首个为空时省略）/host_environment/start/end_reason/claim_refs。P1 仅一个 active session；后继转交、重启和恢复在 P2 启用。

HostCheckpoint 必需 checkpoint_version/run_ref/attempt_ref/session/state_revision/instance_ref/claim_ref/worktree_ref/design_digest/evidence_refs/pending_operations/external_task_refs/rebuild_refs/diagnostics/budget_observation。任何 binding 秘密不直接写业务文档或检查点，新 session 必须受控取得新 binding。

Operation 必需 operation_id、binding_digest、输入摘要、kind、status、result_refs。状态遵循现有 journal 的 prepared/dispatched/succeeded/failed/unknown，不另创互相冲突的“已发送”含义。现有 journal 主要用于 MCP/UI 写入；它不是当前所有 report 已具备幂等保护的证明。P2 对 report 接入须单独实现与验证。

当前 journal 的实际转移为 prepared→dispatched/failed、dispatched→succeeded/unknown、unknown→succeeded，succeeded 仅允许同语义重复，failed 终止。不能假定它已支持 dispatched→failed 或任意回滚；P2 若需不同含义须版本化演进，不能直接改变历史事件解释。

恢复时校验授权 → 核对实际 Core/磁盘/外部任务 → 处理旧进程 → CAS 新领取 → 补环境 → 复核有效证据 → 正式 next。顺序中旧进程处理与新领取的发布应按锁和隔离契约实现，不能让两个进程共享写现场。未知外部副作用先查询，不盲重放；不宣称 exactly-once。

## 9. 结构化拒绝原因

以下错误码属于新契约设计，不是现有 CLI 输出。新诊断必须携带目标引用、实际原因、下一步、是否需要真实新授权；不把所有失败解释为补测试。

| 原因码 | 触发条件 | 处理 |
| --- | --- | --- |
| AUTONOMY_SCHEMA_INVALID | 版本/字段/类型/引用不合法 | 修正来源，不创建隐含默认批准 |
| BATCH_SCOPE_CHANGED | 范围、单元或验收分母变更未接收 | 新修订与影响分析 |
| DEPENDENCY_NOT_READY | 消费阶段缺少真实所需状态 | 等待/修复该前置，继续其他就绪动作 |
| WRITE_SCOPE_CONFLICT | 独占写范围或共享责任冲突 | 串行/隔离/受控重规划 |
| AUTHORITY_SOURCE_UNVERIFIED | 缺真实授权来源或可信保存链 | 通过真实用户入口完成授权 |
| GRANT_INVALID_OR_REVOKED | 范围/期限/撤销/会话不匹配 | 拒绝新写入，保留现场 |
| HOST_CAPABILITY_UNVERIFIED | 必需宿主/工具能力未知 | 执行针对性探针，不自报支持 |
| ADMISSION_INPUT_CHANGED | 准入绑定变化 | 重验受影响检查 |
| DECISION_OUT_OF_POLICY | 兜底越界或反转明确决定 | 保留冲突，限制受影响动作 |
| ACCEPTANCE_UNCOVERED | 选中必要行为没有真实断言 | 补实现/测试，不能删分母 |
| UI_RUNTIME_UNVERIFIED | 只有静态标记或无运行证据 | 真实渲染、交互和视觉验证 |
| CANDIDATE_EVIDENCE_MISMATCH | 证据对应不同候选/环境 | 正常受控复验 |
| OPERATION_RESULT_UNKNOWN | 可能已有副作用但结果不明 | 查询/对账，禁止盲重试 |

## 10. P1 与后续版本边界

P1 必须实现显式采用、单批次范围、自主策略、单 session grant、准入、必要依赖/输入范围、宿主持续驱动、实际验收及诚实结果。完整后继恢复和 journal 泛化为 P2；多批次实例、完整能力前沿、多仓和跨宿主为 P3。

存量缺失字段不强制按 v1 解释；显式采用时逐项迁移。已有语义证据、RED/BASELINE/GREEN 和 UI full acceptance 仍保留其受控生产、审批和不可变要求。本文不能被加载为“所有仓库已授权”的规则。

## 13. P1-05 已实施契约与消费边界

本节具体化第 3 节，覆盖该节中 P1-01 历史实现的限制。Core 解析与校验已实施；真实宿主、运行探针和最终交付仍按 P1-06/07/08 验收。本地仓库仍仅支持 repository_id=project，ExternalRef 可声明但不会从普通 JSON 获得 ready。

### 13.1 显式采用、单元定义与能力版本

复杂批次的 unit-manifest.json 条目必须显式带 autonomy_version="1"，其完整条目继续绑定 UnitRef.definition_digest。仅凭文档出现新字段不启用新证据语义。未声明能力、共享/上游输入的单实现单元保留原 module scope 兼容路径。

权威文件为 docs/aidlc/modules/<module>/inception/application-design/unit-of-work.md 的唯一 aidlc-autonomy fence，每个选定单元恰好一条 unit-extension。封闭字段集为 CommonEnvelope 加 unit_ref、behavior_refs、acceptance_refs、capability_refs、write_scope、integration_checks、ui_owner_refs。空行为不能手写豁免：须已有可信 I13 适用性、unit exemption 及无本单元行为的受控结果。implement 单元必须拥有批次 AC。verify 必须在 consumer_closure 中绑定实际矩阵检查，初始 verification_status=pending；consume/verify 均无实施写权限。

同文件的 capability 记录为 CommonEnvelope 加 capability_id、provider_ref、version_digest、artifact_refs；record_id=capability_id。artifact_refs 为非空真实 raw-file InputRef 数组，版本为 SHA256(canonicalJSON({capability_id, artifact_refs}))。数组顺序保留，provider 身份独立由 CapabilityRef/UnitRef 核验，避免定义摘要自引用。必须绑定已经存在的声明/输入文件，不能预填未来产物。新增记录、路径或版本改变须在冻结前完成，否则范围/授权来源漂移。

### 13.2 分阶段依赖与实际证据

DependencyEdge 位于同模块 unit-of-work-dependency.md，批次通过带 item_id 的 InputRef 引用。provider 为真实 UnitRef 或显式 ExternalRef；consumer 为当前血缘 UnitRef。consumer_checkpoint 必须是实际可执行的 Core stage 或矩阵 check ID；条件阶段未选择时不可作为虚假解锁点。

| 类型 | 消费所需状态 | P1-05 的实际依据 |
| --- | --- | --- |
| contract | contract_ready | 提供者 C5 实例完成；同 workflow/module/unit 的受控 contract-baseline；当前声明重新扫描通过，来源、checker、命令、期限与版本一致 |
| implementation | capability_verified | 保守等待整个提供单元 code-generation/code-review 完成，实际 Native GREEN 与 review gates 通过；不要求项目 C8，不实现独立能力级前沿 |
| runtime | runtime_ready | 尚需 P1-07 的实际运行观察；契约、GREEN、review、替身均不能代替，当前显示 unverified 并在消费检查点阻塞 |
| ExternalRef | 与边类型对应 | 显式 owner/contract_ref/version_ref 仍须真实外部观察；当前保持 unverified |

consume.expected_capabilities 每项须有精确版本和固定 EvidenceRef：实际文件字节摘要、workflow、实例、producer、checker、source、时效及 Native gate 均校验。只有契约证据的 consume 不能满足 implementation 依赖。作者手填 passed 或手造证据外壳不能解锁。内部 implement 提供者可以尚未产生结果，准入只确认计划和可达生产路径；消费检查点仍逐次阻塞，绝不预记就绪。

stub_policy 仅接受 denied 或 {check_ids, contract_ref}。所有 check_ids 必须是矩阵 kind=local，contract_ref 精确绑定同能力且已有真实 contract_ready。只放行这些命名局部检查，不能通过真实联调或最终 C8。阶段图与输入图分别查环：同阶段 implementation 环拒绝，编码后的 runtime 联调环可计划但不提前 ready。

### 13.3 来源、写入范围与执行投影

evidence_inputs 与 write_scope 分别描述完整读取和允许写入。所有模块单元都有完整 evidence_inputs 才缩小到单元声明输入；否则保留 module 范围并串行执行。共享输入和依赖传递闭包加入 Native scope：contract 加实际声明文件，implementation 加提供者源码/共享输入/单元定义/产出相关文档及其传递输入。拒绝路径逃逸、控制目录、链接、输入环与私有范围重叠；Windows 写范围按大小写无关路径身份比较，不靠缩小范围让旧证据继续通过。

private_paths 不能跨单元重叠或侵入共享写区；shared_writes 必须有一致的 owner_unit_ref 和 coordination，且在共享 evidence_inputs 内。single-writer 只允许 Owner 写；serialized 必须为 implement Owner，其他共享参与者的活动领取须先按原 session 协议显式释放。consume/verify 为只读，不通过重新领取变成 implement。未知外部领取保守视为模块写范围冲突；Core 不自动偷取领取、创建工作树或做多批次并行调度。

显式 v1 的单元证据对 scenario-module-mapping.md 或 handoff.md 仅投影批次记账 record，保留正文和全部非 batch records，避免 consume EvidenceRef 形成自摘要环。采用快照与授权仍绑定完整批次内容：修改目标/成员/版本继续失效。契约 scope 单独绑定声明、定义及共享输入；重算现有 Native 声明扫描，普通业务实现变化不会使未变契约失效，声明/共享输入变更仍失效。旧单元继续使用原算法。

入口为 orchestrate autonomy dependencies [inspect]；消费命名检查为 orchestrate autonomy dependencies check --checkpoint <stage|check-id>，后者须持当前有效 grant 和精确活动 binding。next 增加 autonomy_dependencies，含 dependency_frontier：仅表达依赖阻塞，native_gates_evaluated=false、execution_authorized=false、business_verified=false，不代表完整调度或授权。

已采用批次的 consume/verify 和批次外单元不进入实施候选。原生阶段耗尽返回 execution_status=scope-exhausted、workflow_completed=false、batch_completed=false、needs_batch_finalization=true；P1-08 完成真实候选/批次终态前不得把它换成项目 done。Core 负责读取、准入、检查和发布复核；宿主 P1-06 必须在实际工具副作用前调用检查并执行串行/恢复，Core 不能拦截任意宿主直接文件写入。

## 14. P1-06：Codex 原生宿主契约

此节新增一个实际宿主接入，复用 Codex app-server Supervisor。Core 只提供受信任适配桥、准入消费和精确领取；持续路由、工具网关、预算、取消与操作观察位于 Codex Harness runtime。其他 Harness 没有该运行时则保持 HOST_RUNTIME_UNAVAILABLE，不推导为全部宿主已支持。

### 14.1 冻结配置与交接

AdmissionPlan 新增可选 native_host_ref: raw-file InputRef，指向 aidlc.codex-host/v1 配置；引用在冻结计划内，实际文件在 scope-policy 解析、捕获并纳入准入失效检查。省略时保持 P1-04 默认 unverified；普通 JSON supported 不能代替探针。

宿主配置封闭字段：schema、codex_entrypoint、core_cli、commands；可选 native_config_digest、admission_plan、browser_entrypoint、observation_plan（P1-07）、candidate_command（P1-08）。两个入口是实际绝对文件路径，browser_entrypoint 适用时同样验证。commands 每项含 id、argv、operation、timeout_ms、input_paths、write_paths；只执行预先冻结的 ID，不接收模型新增 argv。argv[0] 为实际绝对可执行文件；write_paths 每项为 {path,operation}，operation 为 design/code/test/environment-write。command operation 与提交/整合/push/deploy 仍分别校验，不能互推。

HostRef.host_id=codex-app-server、version=1、entrypoint=实际 Harness runtime 文件。config_digest 绑定配置原始字节、三个运行时文件、实际 Codex 可执行文件、Core CLI 和可选浏览器文件。native_config_digest 对原生有效配置做递归键排序摘要，避免跨进程对象键顺序造成误失效；配置变化拒绝复用。

交接顺序如下：

1. H3 前运行 prepare <seed-config> <new-output-config>，使用只读原生沙箱和一个无工具、无业务实施的初始化 turn 固化原生 thread；仅 thread/start 的空会话在本机版本尚不可复用。输出 thread_id、配置与 HostRef，不签发授权。
2. 人类按既有交接协议把协调实例绑定/转交给该 thread_id；冻结配置、批次与包含 native_host_ref 的接收计划，沿既有实际操作终端签发单会话 grant。
3. 仅在该宿主进程子环境传递当前 AIDLC_SESSION_BINDING、AIDLC_EXECUTION_GRANT、AIDLC_AUTONOMY_HOST，运行 run <frozen-config> <same-thread-id>。不写机器全局环境；不从文档/模型输出补签授权。
4. 宿主检查真实 grant 的 thread/owner/workflow/HostRef，复用同一原生会话；必要时回协调 binding 运行准入，然后按正式 next 继续。领取只使用现有 bind/release/CAS，无 transfer、偷取、自动 resume 或后继授权。

### 14.2 工具前控制与实际能力

Codex 原生线程使用 read-only 沙箱，关闭原生 shell/patch、多 Agent、应用及已配置 MCP，配置 PreToolUse 将本地工具导向 aidlc_action；原生权限请求不自动批准。Hook 对所有工具的覆盖并非通用安全边界，不能据此宣称能控制任意宿主/插件。支持的实施副作用通过宿主结构化网关：

- rule：只读读取已安装 Core 的 stages/knowledge/skills Markdown，供执行实际阶段规则，不扩大业务写范围。
- read：受限业务文件读取，不读取 .git/.aidlc/活动 workflow 控制数据；控制状态从 Core 路由获得。
- write：给出实际路径、内容及写类别，先 Core grant check、依赖与 unit write_scope 检查，再写入；禁止链接/硬链接、越界路径和控制目录。
- command：仅冻结命令，先核验其类别与声明的写路径，再执行，并于返回结果前再次核验。受信任命令的副作用范围须在交接时审阅，不能靠解析任意 shell 推断；外部系统副作用不自动回滚。
- core：受控 next/report/evidence/委托决策和只读依赖/策略入口；拒绝授权签发、转交、人工批准、阶段 approved、维护接管、新 workflow 与自动 resume。

代码/测试写入还要求宿主已通过正式非预览 next 进入精确实例，预览建议不解锁实施。

模型获得经过过滤的路由/结果，binding generation 和私有 host_context 不注入提示词。Core 的 host context/select 是宿主控制面 IPC，使用真实现行授权与精确领取；仅 select 可以机械切换已授权 implement 范围并释放自己的旧领取，不改变完成状态。其控制面不被失效实施准入自锁，业务写入仍必须重新通过准入。

真实能力探针由 Core 调用已安装的受信任 Harness runtime，绑定随机 nonce、HostRef、期限与预算。原生模型在同 thread 完成两次动态工具读取，再以 turn/interrupt 中断第三次工具调用，实际等待自有命令退出。可选隔离 Chrome 检查真实 DOM、PNG 截图和 DOM click handler 的状态变化；这不是业务页面还原、真实用户坐标命中或完整交互链验收。缺少浏览器时三项保持 unknown，UI 准入不得 ready。原始事件、DOM 和 PNG 字节随 probe_refs 绑定，不能只保存 supported。

### 14.3 预算、退出与取消

wall deadline 取 grant.expires_at 和 request_started_at + wall_time 的较早者，不因模型新 turn、准入刷新或领取切换重置。max_active_units=1 同时限制网关并发；等价命令按操作/输入内容/实例计数，允许初次尝试加 max_equivalent_retries，真实输入变化才获得新键。无状态或源码进展的完整 turn 同样有界，不以模型 final 当完成。

用户 SIGINT/SIGTERM 或预算到期停止新操作，发原生 turn/interrupt；已发出自有命令用所属进程树取消并等待实际 close。未能确认退出时记录 unknown/PID，不能宣称全部对账完成或自动重放。已执行的外部副作用保持真实结果，取消不保证回滚。Core 受管 publication 的实时授权检查继续有效，返回前授权变化使结果不能被接纳为成功。

宿主将定位与操作观察写入 .aidlc/host-runs/<run-id>/，只保存 thread、grant 摘要、binding 摘要、输入摘要、prepared/dispatched/terminal 和退出原因，不保存另一套阶段进度或 binding 明文。一个 P1 grant 仅一个进程内 attempt；目录/attempt 已存在则拒绝重新拉起，避免重启后清零预算或重放未知操作。自动拉起、后继会话、跨进程续作与未知外部任务对账仍属于 P2。

scope-exhausted、原生 final、Hook 退出和预算退出均不直接产生 verified。宿主在完整观察与 Native 检查后执行 batch finalize，并以当前 Core 结果和操作对账决定退出；未满足条件保持真实未完成。两个完整试点的无人值守交付按 P1-10 实跑。

## 15. P1-07：真实观察与候选证据

本节具体化第 7 节，并替代第 13 节“等待 P1-07 生产者”的历史限制。内部 contract/implementation 继续使用原 Native 证据；runtime 和 ExternalRef 仅消费本节实际观察，没有观察仍为 unverified。生产者不发布批次终态，不写 Native completed，不替代 I13、RED/GREEN、审查、UI full acceptance 或 C8。

### 15.1 冻结计划与环境

入口为 `orchestrate autonomy observe run --input <frozen-plan.json>` 与只读 `orchestrate autonomy observe inspect`。完整 run 要求实际 grant 同时允许 validation-execute / evidence-publish、当前精确全局协调 binding 及有效准入 receipt。协调实例不带 module/unit 后缀；它不获得实施写权限，用于避免运行依赖观察被自己的待验证消费点锁住。

前置外部依赖可先运行 `run --dependency-preflight --input <同一冻结计划>`：不要求已经取得实施准入，但仍要求实际 grant、精确协调领取、冻结范围、完整合法计划及环境。Core 仅选择绑定明确 ExternalRef 的 HTTP 检查，不执行候选命令/UI/内部 runtime；没有这类检查时返回未签发的 not-applicable。通过只发布 coverage=dependency-preflight / status=partial，供依赖准备检查使用，不能用于完整矩阵通过或实施准入的其他硬条件。

ObservationPlan 封闭字段如下；schema 为 aidlc.observation-plan/v1，整个文件 raw-file 引用必须事先在批次 baseline_inputs 中。修改计划或断言不是普通执行重试。

| 字段 | 约束 |
| --- | --- |
| batch_id、scope_revision | 与已采用快照精确一致 |
| lifetime_seconds | 1～300，另受原 grant 绝对期限和 wall deadline 限制 |
| environment_ref | 当前实际环境文件的 raw-file InputRef |
| candidate_artifact_paths | 非空、已提交且可读的项目内文件路径 |
| ui_applicability | {kind: required\|none, source_refs: 非空 InputRef[]}；与 scope.ui_refs 一致 |
| checks | 矩阵全部 check ID 恰好一次，非空 covers 仅引用选中 AC，并覆盖全部 AC |

环境 schema 为 aidlc.observation-environment/v1；封闭字段为 schema、isolated=true、endpoints、variables、inputs、可选 browser。endpoints 每项为 {origin, version_path, header_variables, kind}，kind 为 candidate 或 external；仅允许明确 HTTP(S) origin，无内嵌凭据。origin 可用已声明的大写 `${ENV_NAME}`，header_variables 为请求头名到环境变量名的映射。变量实际存在且不能是 AIDLC_ 控制变量；凭据值不写计划和日志，仅其环境摘要参与绑定。browser 是实际浏览器绝对文件路径。isolated 是已审阅的环境约定，不声称 Core 为外部服务创建 OS/网络隔离。

check 的公共字段为 check_id、kind、covers；命令支持 argv、timeout_ms、assertions；HTTP 支持 endpoint、path、method、body、expected_status、assertions、可选 dependency_id；UI 支持 endpoint、path、page_ref、combination_id、viewport、state、role、initial_expectations、steps、expectations、baseline_ref、design_refs、tolerance。未知字段拒绝。HTTP 只接受 GET/POST 和同 origin 相对路径，禁重定向；状态和 JSON 内容都实际核验。冻结命令 shell=false、绝对可执行文件、最长 60 秒、输出有界；命令副作用必须在交接时审阅，grant 不授权任意命令或生产数据操作。

assertions 每项为 {assertion_id, pointer, op, expected}，ID 唯一，使用非根 JSON pointer，op 仅 equal / length / includes / ordered-by。Core 从实际 stdout JSON 或 HTTP JSON 获取操作数，缺字段不能与 null 相等，ordered-by 使用显式字段的字典序。仅 exit 0、passed 布尔或 assert True 不能满足功能断言；每项 command/http 都须有实质内容断言。断言语义仍需 Spec/Standards 审查，Core 不声称能证明任意受信任测试程序没有伪造输出。

无 UI 不能由观察计划自行豁免：scope.ui_refs 必须为空，实际 technical-review.autonomous_reception.ui 必须为 none，接收及来源摘要同时绑定。UI 必须覆盖全部冻结 matrix.ui_combinations；每项组合绑定 PAGE、state、role、viewport、required_selectors、required_actions、baseline_ref、tolerance。观察不能减少组合、改视口、删除关键元素/动作或放宽基准。

### 15.2 候选、服务与运行依赖

CandidateRef 从实际 Git HEAD、完整 tree 摘要、真实 dirty 状态和已跟踪制品字节生成；排除控制日志不等于忽略业务脏文件。完整矩阵拒绝任何业务脏文件，不同 commit 即使字节相同也不能复用。外部预检的项目 CandidateRef 仅为当时来源上下文，明确记录实际 dirty，不是最终候选验收；它绑定已跟踪的冻结计划和真实能力输入，而不要求尚待实现的制品已存在。P1 仅 project 单仓；创建提交/整合仍由宿主按 candidate-commit / candidate-integrate 权限执行，本入口不自动 commit。

每个 HTTP/UI endpoint 都须有真实版本端点；请求前后版本 JSON 必须一致。candidate endpoint 返回 candidate_commit，必须等于实际 CandidateRef.commit，不能只给截图贴 Git 标签。dependency_id 精确关联现行 edge/provider/consumer/CapabilityRef；还要求 ready=true、精确 capability.version_digest，内部服务绑定候选 commit，外部服务绑定 ExternalRef.owner。外部响应提供 candidate_commit 时也纳入后续活性检查。真实功能响应、错误码和版本/健康均通过才可生成 passed。

依赖投影逐次读取受控凭据并校验候选、环境、来源、原始文件、checker、授权和期限。只有对应 edge/provider/version 的全部观察通过，才得到 runtime_ready，或外部边相应的 contract_ready/capability_verified。旧快照仍可作为有界历史观察；实际 consume/checkpoint 还执行只读 live probe，重查版本和健康，漂移立即拒绝，不能靠 5 分钟前的通过记录继续消费。显式固定 EvidenceRef 必须匹配当前受控 receipt 的真实文件摘要；split 场景 runtime-observation 属于全局协调 workflow，Native 证据仍属于提供者 workflow。

外部预检绑定真实能力文件、冻结设计/计划、外部服务版本/Owner、环境、授权和期限；后续消费者普通实现编辑不会使未变外部契约失效。完整矩阵始终要求当前精确候选。全局准备实例仅在 validation-execute/evidence-publish 操作下允许“定义合法但外部就绪尚缺”的投影，admission_ready 仍为 false；真实消费者/写入和正式阶段继续逐项阻塞。只读 next 以结构化 not-ready/依赖投影返回，不能因诊断读取失败而自锁预检入口。

### 15.3 浏览器与视觉验证

Core 使用实际 Chrome/CDP 的隔离 profile，保留浏览器默认沙箱；加载候选 HTTP 页面，固定视口、DPR=1、reduced motion，等待字体与图片。读取 DOM/可见性/禁用/属性，坐标点击须通过实际 elementFromPoint 命中检查，使用 Input.dispatchMouseEvent / Input.insertText 执行；不执行作者提供的任意脚本来“宣布交互成功”。步骤前后均断言，网络资源失败及脚本异常使检查失败。

截图来自 Page.captureScreenshot 的实际 PNG；Core 校验 PNG、尺寸并解码像素，对照冻结 baseline 的整页与关键区域容差，保存区域差异。关键元素/业务状态/交互失败独立阻塞，不能被整页平均比例稀释。本阶段不提供动态区域遮罩；字体、资源、状态、容差和关键区域须在候选观察前冻结。跨平台原生 UI 不冒充 Chrome 验证，需要对应平台生产者。

tolerance 的封闭结构为 {pixel_delta, max_diff_ratio, regions}。pixel_delta 为 0～32 的整数，max_diff_ratio 为有限 0～0.1；regions 非空且 region_id 唯一，每项为 {region_id, rect:{x,y,width,height}, pixel_delta, max_diff_ratio}，坐标/尺寸为视口内整数。整页和每个关键区域都必须通过；结果保存 changed_pixels、diff_ratio、diff_bounds 和逐区域结果，实际截图与基准均有原始摘要。

协议依据：[CDP Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/) 与 [CDP Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/)。UI 静态 alignment 与实际截图审查继续保留，两者互补。

### 15.4 受控发布、宿主与退出

ObservationBundle schema 为 aidlc.observation-bundle/v1，绑定 workflow/batch/grant、完整 CandidateRef、环境 InputRef 及变量/可执行文件摘要、source_refs、raw_refs、逐项 observations、live runtime_checks、producer、checker_digest、started/ended/valid_until、coverage、status，business_verified 恒为 false。coverage 为 matrix 或 dependency-preflight；全部实际检查通过时分别为 passed 或 partial，任一失败为 failed。逐项 observation 也绑定同一完整 CandidateRef/environment_ref、check/covers、起止时间、raw_output_ref；原始文件保存实际命令/HTTP结果、Core assertion_results，UI 另存 DOM、网络、坐标步骤、PNG/基准及区域差异。

复用原 Git common directory issuer 与现有 session publication/grant 锁签发 receipt 和独立 schema 的 current 指针；路径为 .aidlc/evidence/autonomous-observations/<batch>/<revision>/。锁内重读授权、领取、批次、候选、来源、checker、环境和期限。原始文件或来源改动、不同候选、授权撤销/过期、checker/可执行文件/环境漂移均失效。run 失败可产生诚实 failed receipt；发布复核失败不产生可接受成功结果。普通 JSON passed、复制外壳或未签指针不能生成受控观察。

宿主配置可冻结 observation_plan；准入未就绪时先回协调实例执行外部依赖预检，再执行原完整准入，不延长 grant。全部 implement 单元 review 完成并进入 C8/范围耗尽时执行完整矩阵，失败后由批次终结发布真实 failed 等结果。模型通过受控 core 网关也可请求观察，但路径/计划/操作/授权仍由 Core 核验。宿主继续负责原 wall budget、取消进程树与未知结果对账，Core 不增加 Supervisor。第 16 节将本节证据与 Native gates、委托决策输出、最终整合候选及完整批次终态汇合；partial/passed 观察、scope-exhausted、原生 final 均不等于 verified。

## 16. P1-08：最终候选汇合与批次终点

本节替代第 13～15 节中等待 P1-08 的历史限制。P1-08 已实现批次终结入口；P1-09 负责规则/分发同步收口，P1-10 才验收两个完整内部试点。历史 P1-06/07 文字中的未来任务编号以本节和总体设计任务表为准。

### 16.1 入口与归属

`orchestrate autonomy batch finalize [--preview]` 复用同会话 ExecutionGrant、session binding 与 publication 锁。必须由实际全局协调实例执行，分别核验 validation-execute、evidence-publish 和 workflow-write；单元领取、只读投影、模型 final 均不能授权终结。preview 只诊断，不运行 Native 汇合或发布 receipt/state/audit，不能得到 verified。

`orchestrate autonomy batch inspect`、`next` 的 autonomous_batch_result 和 `state summary` 的 delivery_summary.autonomous_batch_result 返回只读投影，execution_authorized=false。未采用批次保留旧工作流语义；显式采用后范围耗尽只说明实施前沿耗尽。终结入口只写批次结果引用，不自动补写 Native completed、项目 done、protected branch、push 或 deploy。

Core 负责读取冻结分母、核验真实证据、受控签名与发布复核。宿主负责准备和整合候选、实际服务环境、模型/工具执行、预算与取消。可选 candidate_command 必须引用冻结 commands 中 operation=candidate-commit 或 candidate-integrate 的 ID；宿主回原协调 binding 执行，操作授权与原预算保持不变。Core 从实际 clean HEAD、tree 与制品字节确定候选，不能用命令成功或模型填报替代。跨仓库候选整合仍不在 P1 支持范围。

### 16.2 完整汇合

同一最终候选必须同时满足：

- 当前受控 admission、完整 matrix 观察、原始输出与环境仍有效；每个 check ID 恰好一次，所有 AC、UI 组合与 consumer_closure.required_checks 均在分母内并通过。partial 不能进入完整验收。
- 每个 implement 单元的 I13、历史 RED/BASELINE、当前 GREEN/质量/追踪/结构和审查实例已完成，真实 Native checkSensors 及原有历史证据规则通过。C8、条件触发的 global-review-evidence、原 UI 设计 full acceptance 和所选 PAGE 的当前 ui-design-alignment 独立核验。
- 原 I13 不裁剪或重写；聚合 Native requires、UC-D 所有权与审查输入仅遍历本批次 implement 单元。consume/verify 通过依赖消费边界和所选 UI 证据验算，不成为本次新增实施工作；批次外 future 单元不要求先产出 GREEN/review。
- 在 build-and-test 消费点重验依赖，包括实际 runtime/external 活性与版本；必需 delivery_artifacts 的 target_path 或 source_ref 指向安全、非空、Git 已跟踪的真实文件。
- 委托决策记录完整、实施引用可解析且已跟踪，验证 check 属于其单元验收范围并在当前完整观察中通过。validation_refs 只能引用真实 Native 已复核证据，或同批次、同工作流的历史签名完整观察中实际 passed check；普通 JSON passed 无效。

历史签名观察用于保留决策的声明依据，最终结果在 decision_refs.current_validation 投影当前候选的 observation IDs 和 receipt_ref。它不重写原决策，因此不会产生“先改决策文件再提交、导致决策所引候选再次过期”的循环。历史引用本身不授予当前验证资格。human_review=pending 不阻塞真实工程 verified；缺项、伪造依据及待返工要求继续阻塞，人工变更以后形成增量迭代。

### 16.3 结果与存储

receipt schema 为 `aidlc.batch-result/v1`，至少保存 workflow_id、batch_ref/scope_revision/effective_revision、grant_ref、candidate_ref、environment_refs、完整 acceptance_observations/UI observations、observation_ref、Native 检查与 refs、review/build/test/risk/dependency refs、decision_refs/human_review_summary、delivery_artifacts、checks、source_refs、checker_digest、state_facts/native_context/working_revision、时间、producer、convergence_digest 和结果。

| engineering_result | 判定 |
| --- | --- |
| verified | 完整矩阵与所有适用 Native/决策/制品/依赖检查通过 |
| failed | 当前受控完整观察存在真实失败断言；lifecycle_status=verifying，允许授权内修复后重验 |
| blocked | 准入/Native/依赖/决策依据等受阻，不能验收；失效或不足的实际 grant 在入口直接拒绝发布 |
| incomplete | 缺少完整当前候选/矩阵/必需制品等，且没有优先级更高的失败或阻塞 |

优先级为 failed > blocked > incomplete > verified，diagnostics 保留每项原因。human_review_summary.status 独立为 not-required/pending/accepted/changes-requested。只有工程 verified 才发布 batch_completed=true、business_verified=true；workflow_completed 恒为 false，该字段只描述本次终结操作。项目完成仍走原 Native 生命周期。

结果使用已有 issuer 的 Ed25519 签名，保存于 `.aidlc/evidence/autonomous-results/<batch-id>/<scope-revision>/<UUID>.json`。全局 state 的 `## Autonomy Batch Result` 保存严格 AutonomyBatchResultRef：version="1"、result_id、batch_id、scope_revision、path、digest（receipt 文件原始 SHA-256）。先原子写不可变 receipt，再按现有 state/audit/CAS 发布引用；state 发布失败留下未被引用的 receipt，不成为当前结果。相同 convergence_digest 幂等返回原引用，不新增 state/audit；当前引用只在原 state 保存，不新增第二进度来源。

### 16.4 历史结论与当前适用性

只读投影分开给出 engineering_result 与 current_status=current/stale/unknown。签名/引用无法验证为 unknown；候选、工作区、检查器、Native 输入/证据拓扑、受控原始输出、决策或观察期限变化为 stale；实际依赖消费失败也使 verified 失去当前资格。历史 engineering_result 不改写，batch_completed 仅在 current 且 verified 时为 true。

签发前在原 session publication / grant 锁内复核候选、原始来源、工作区、Native 上下文、检查器、决策输入及依赖；不能把汇合期间已变化的证据发布为当前 verified。结果存档不延长 grant、观察租期或宿主运行期限。归档夹具中的 verified 仅证明隔离工程机制，不构成当前业务项目授权或两个完整试点已通过。

## 17. P1-09：协议、Skill、CLI 与选定分发一致性

新增共享协议 common-autonomous-execution.md；`next.autonomous_execution` 只读投影 mode=autonomous-batch、protocol_file、routine_stage_confirmation=not-required、module_selection=frozen-implement-units、protected_gates=unchanged、execution_authorized=false。RuleLoadPlan v1 增加可选 supplemental_protocols，仅实际 global state 显式采用时由 Core 注入。旧模式不增加该字段或授权/准入门禁，原 selected/load_now/deferred 集合与顺序保持原语义。该投影不能启动运行或替代 grant/准入。

源会话/连续性/步骤协议、handoff/continuity Skill、Codex Skill 及 CLI 说明统一为：notify/none 在已有真实授权内连续执行；读取确定来源、普通工程细节自主处理、合法 policy/fallback 记录后实现并验证，pending 人类复核后置。Construction 的功能/NFR/基础设施问答及 UI 目标落点不再将所有细节升级为人工决定；真实产品冲突、block、安全/外部权限、用户暂停/审阅与全部 Native/功能/UI 质量门禁保持阻断。

Core 的普通 module-selection 保持原 API，未采用 workflow 由用户选择。选定 Codex 驱动在实际 grant/准入内，只从正式路由候选按冻结 implement 顺序选择精确实例；不进入批次外模块/单元，不将 consume/verify 变为实施。Native host select 同时校验模块和单元范围。真实 block、仍带用户 choices 的阶段和非模块人类选择明确停止；模型网关继续禁止批准、转交、恢复及新授权。

### 17.1 真实报告与协调 binding

P1-09 的真实 CLI 验证发现：成功 report 会正确释放已完成阶段的精确 claim；旧宿主随后用已释放 binding 读取 context/select 会失败。本步保留原 report 释放语义，修复宿主衔接：run 必须从实际已完成的全局初始协调实例及其当前 binding 启动；切到工作实例时保留该协调 claim，实际阶段报告成功后切回所持协调 binding，并经原 bind 续期，再读取下一路由。

协调凭据仅在宿主内存及本进程子命令的 AIDLC_COORDINATOR_BINDING 中保存，不写源文件、handoff、模型消息或宿主日志。选回协调者时 Core 要求真正持有匹配 owner/session/generation 的有效凭据；不能从 state 重建凭据、使用旧/外来代次或接管他人。源码写许可在 report 后清空；进入下一正式精确阶段才再次开放。claim 续期不延长 grant、原始 wall deadline 或有限预算，已过期/撤销/转交/暂停不自动恢复。

### 17.2 结构化错误与分发

真实 Core CLI 的 next 正常退出 2、reconciled=true 且 stdout 是 kind=error 时，宿主将完整诊断交给驱动；只有 Core 明确允许且不需人工批准的 Native 刷新进入有界修复。进程异常/未知结果、其他退出码、非 JSON、其他命令错误或真实人类决策不变成修复许可。所有工具前与 publication 核验仍执行。

本次选定实际宿主继续为 Codex。十种 Harness 重建共享 Core/协议并核对一致性；选定 Codex 分发另外执行真实 shipped CLI 的采用/未采用只读 smoke 与 runtime 导出检查。其他分发通过不代表拥有相同原生模型、工具、取消或预算适配。Skill 校验保留原描述和触发语义，handoff 的项目 triggers 信息移到兼容 metadata 内。

升级会改变工具/checker 与 HostRef；已有运行凭据不能因分发重建而延长或迁移。P1-10 使用新冻结输入、实际操作端和新 HostRef 做 UI/无 UI 两个完整试点；P2 后继/重启恢复未由本次实现。工作区分发收口不自动安装到用户全局 Skill，也不接管当前无关 workflow。

隔离检查器兼容边界：template-completeness 的输入模块保持原封闭依赖图，不导入自主工作流解析。共享契约的专用输入作用域在 workflow-layout 选择，evidenceScopeForInstance/evidenceSourceRevision 增加内部可选 sensor 参数；受控生产者、Native 门禁和复用投影共同使用，原省略参数的行为保持。source revision 保留真实嵌套仓库信息，不能因分离模块而缩小模板输入绑定或放宽导入白名单。
## 18. P1-10 真实试跑发现的宿主与交接约束

本节记录真实试跑引出的实现收口，不代表两个业务试点已通过。实际退出状态以 P1-10 验证记录为准。

### 18.1 真实操作终端

公开 CLI 只有实际 `autonomy grant issue/revoke` 的操作端路径继承终端 stdin/stdout；preview 和普通 JSON 命令保留管道行为。管道调用不能凭字符串 Approve 签发。Windows 操作窗口的父进程不得预先打开 readline 或保留控制台读取；精确挑战只由 Core 子进程读取，Agent 不提供 stdin。

两个独立试点分别持有自己的范围、工作流、会话和 grant；可在同一真实操作窗口依次核对两个请求，再开始各自的实施。未签名提案放在忽略的运行目录，不能作为未跟踪业务文件污染最终 clean candidate。聊天中的“可以输入”只是终端可用性反馈，不是运行授权。

### 18.2 模型可读输入与权限

宿主只读开放 Core 的阶段、知识和 Skill Markdown 路径发现，以及业务文件和指定的公开 Native evidence/冻结命令计划。目录读取有数量界限；路径穿越、Windows 尾随点或空格别名、链接、私有控制目录和 issuer 文件继续拒绝。JSON 结果对模型移除 binding/generation 等私有字段，同时返回原文件 SHA-256；摘要标识原始受控文件，不表示模型已验过签名。公开证据仍不可由模型写入。

实际非预览 `next` 返回当前精确实例、非 block 且没有未决 choices 时，才打开该实例的代码/测试写许可。公开 `print + preview + next_stage` 与已绑定 `run-stage + preview` 都是只读路由，不能签发此许可。模型获得实际 owner/session 的公开记录身份和冻结 command ID 清单；不获得凭据或可任意拼接的命令入口。

模型进程与业务验证命令子进程保留所需业务环境，移除不区分大小写的 `AIDLC_SESSION_BINDING`、`AIDLC_COORDINATOR_BINDING`、`AIDLC_EXECUTION_GRANT`、`AIDLC_AUTONOMY_HOST`。私有 Core 桥继续持有实际凭据；不能把业务子进程返回值当作 Core 权威。

### 18.3 有界汇合与退出

选定 Codex 配置可声明 `design_write_paths`；省略时仅开放 `docs/aidlc` 与 `delivery`，文档写入格式限 Markdown、文本、JSON、SVG、HTML。模型不能把源码、测试或可执行脚本改标为 design-write；声明的命令写范围也逐项经过同一检查。Core 在外部 design/code/test/environment 写入前拒绝命中 grant.inputs 的文件及其祖先目录，并核对实际文件身份以覆盖原生路径别名。受控决策记录仍通过专用 API、实际领取和发布锁追加；普通文件写入不能替代该 API。

当前候选、Native 和完整观察均通过后，若 Core 仅报告缺少必需交付制品或委托决策实施/验证引用，宿主可在原模型会话、原期限与等价重试预算内补录。此路径关闭代码/测试写入和阶段推进，只允许既有授权内的文档、决策记录与验证操作；human_review 必须保持 pending，不能由模型宣布人类已接受或拒绝。真正的 Native、验收、范围或人类门禁失败不能转入文档补录而被消除。

补录改变来源后重新准备实际候选、刷新适用证据和完整观察，再由 Core 汇合。无进展、超时、中断或任何未通过结果都不能按模型 final 判为完成。受控工具结果与拒绝进入脱敏原始事件日志。退出只用宿主实际持有的精确 binding 经现有 inspect/release CAS 清理；存在 unknown 操作时保留领取，不从 state 重建凭据。

Native evidence 命令沿用既有十分钟上限，并受原执行预算的剩余 wall time 限制；普通 Core 命令保留三分钟上限。退出后的有界对账不延长原 grant，不开放新实施操作。

### 18.4 H4 输入定稿与 UI

故事、验收分母和所有影响 I13 的行为来源必须先定稿，再派生 UC-D；采用最终批次后、H5 前再执行实际受控生产者，核对当前完整来源。缺项不能留到自主实施中靠缩小分母修复。准备脚本从取得领取开始就必须覆盖 try/finally，正式路由错误也须释放仍持有的领取。

单元的 evidence_inputs 必须落在所属模块的路径内，包含实际测试目录；准备端在采用前调用现有 evidence scope 校验，不能等采用后修改冻结的模块归属。已批准设计在新的未授权准备工作流中接收时，使用原审阅快照、逐文件摘要和原始实际答复；接收方重新运行当前生产者，不复制批准行或旧证据。未采用文档切片的 not_applicable 证据同样绑定 schema、generator、workflow、module 和 scope，错误身份仍拒绝。

H5 前同时校验三类不同契约：Native 阶段命令使用 Core 允许的 PATH/项目内可执行入口；宿主/观察的冻结命令使用其要求的实际绝对入口。准备端复用现有 Native 配置解析器，不能仅验证宿主命令。Core 的 `previewObservationPlan` 复用实际观察执行的完整 prepare 校验，只返回范围、检查 ID 和来源，不执行命令、启动浏览器、生成 key 或发布收据；不产生业务通过。观察 covers 只映射验收定义，UI 页面通过 page_ref 绑定；准入 validation_bindings 另保留验收与页面完整分母。功能命令必须断言实际响应状态、业务字段等实质结果，只有 passed 布尔标志的计划继续拒绝。实际授权前的 admission preview 允许静态检查通过，但缺少真实 grant 时整体仍为 not-ready。

登记真实 H4 委托计划后，再刷新当前全部适用 Native 接收证据；delivery 下的计划属于当前宽作用域输入，不能把登记前的范围摘要直接用于实施。准入凭据在既有 900 秒上限内按实际宿主耗时定稿，期限仍受原 grant 与能力观察限制，不在运行中修改冻结参数或延长授权。

同一原生会话的并发结构化工具由宿主以有界队列串行执行，队列等待计入原预算，实际派发仍执行工具前校验。Core 指定的纯派生刷新由宿主受检网关执行精确命令，模型不负责猜测 CLI、修改来源或代替人类审批；实际命令和结果以 host-evidence-repair 标记保存，不能冒充模型工具调用。仅实际宿主探测超时可在原重试预算内重做真实准入，其他能力/设计/授权失败继续拒绝。

真实公开的局部空预览为 `kind=print, preview=true, stage_instance=null, next_stage=null, next_stage_status=none`；它不保证有 `execution_status=scope-exhausted`，也不表示整个项目完成。全部冻结 implement 单元的 C7 已完成且 C8 尚未完成时，宿主在候选处理返回协调实例之后精确选择项目 C8，再获取正式 next；前置门禁和人工 block 仍由 Core 判断。候选处理前的 C8 binding 不得在处理返回协调实例后被误用。

已完成的 code-generation 若 test-quality、traceability-matrix 或 structural-invariants 因来源变化失效，Core 的精确修复诊断可指定该唯一阶段的 `--all-sensors --refresh`，由既有生产者先执行 GREEN 再执行其依赖语义检查。宿主不得自行扩大诊断命令，实际失败和历史 RED/BASELINE 输入变化仍保持原拒绝或恢复要求。普通缺失语义证据的现有自动补齐仍保持其语义限定，不因此改为重复测试。

最终 batch finalize 同样可从本次实际 Native 拒绝产生公开修复建议，放在 directive 的 `repair_diagnostics`，不修改已签名的历史结果。宿主仅在其他非 Native 检查已通过、或仅剩合法制品/委托引用缺项时复用同一有界修复入口；人工审批、真实功能失败、准入和其他阻断仍停止。刷新后重新核验当前候选、观察和 Native 并发布新结果，原 blocked/incomplete 结果保留，不能将建议命令当作权限或先行成功。

模型每次实施 turn 只负责当前正式阶段；阶段 completed 报告成功后返回控制，由宿主切换下一精确实例。RED 接受前检查断言对符合设计的行为能成立，优先复用已有断言助手；RED 之后的命名测试/I13 输入变更不能被当作无关文档漂移。错误诊断列出实际变化的输入路径。真正的测试缺陷需要合法的新 TDD 周期或受控历史恢复；当前适配器不支持的恢复保持 incomplete，不把修正后的 GREEN 或手写历史 JSON 当作原 RED。

功能设计覆盖使用与 I13、unit_refs 一致的正式 UC-D ID；索引链接中的描述性文件名不是新用例。缺失正式 ID 时仍拒绝，并返回具体缺失清单；不得通过重复列文件名或删除用例来消除真正覆盖缺项。

已登记的 H4 委托缺项在首次 C8 完成门禁前汇合：全部冻结 implement 单元 C7 完成且真实完整矩阵观察通过后，宿主从 Core decisions 读取缺项，使用正常 select 获得受影响精确单元的 C7 binding，关闭源码、测试和阶段推进，只补录允许的文档和实现/验证引用。每个单元的等价重试仍受原 grant 次数与总 wall time 约束；实际观察失败、审批 block 和人类 rework 不自动降权。随后返回持有的协调 binding，重新准备候选并观察，刷新必要 Native，再进入正式 C8。观察后若只有协调实例的局部空预览，重新选择项目 C8；不能把该空预览当作可执行阶段。原有 C8 后制品补录仍保留，不能成为 C8 前置委托缺项的唯一处理入口。

此调整复用现有 decision、InputRef、EvidenceRef、handoff CAS 和 session binding，不增加授权字段。声明的 runtime-observation 引用使用证据文件原始 SHA-256；签名 body digest 与 raw-file digest 不混用。记录使候选发生变化时，声明可以保留受控历史观察，最终 current_validation 必须由 Core 重新绑定当前候选完整矩阵；不能回填过去的通过状态。

UI generation lock 与语义检查使用相同的 PAGE 标识词边界，阶段名 `ui-page-planning` 不构成页面。Chrome 端口文件的 ENOENT/EBUSY 只在原截止时间内有界重试；其他读错误、无效端口或已关闭进程继续失败。解释型 Mock 的产品面板渲染接收与最终候选完整截图验收分别保留事实范围；设计说明区不能替代产品像素、状态或交互验证。

## 19. P1-10：决策写入、长命令与宿主失联

### 19.1 决策引用与等价重试

Core decisions 只读投影增加 `write_contract.schema=aidlc.decision-write-contract/v1`，包含真实 handoff CAS、各决策的不可变提案及下一 revision、该批次的实际 check_id 和字段模板；`template_only=true`、`execution_authorized=false`。validation_refs 是扁平字段 `check_id/sensor/stage_instance/path/digest/workflow_id/batch_id`；implementation_refs 使用 `path/digest`。宿主通过受检 read 获得观察文件的原始 SHA-256，并把真实 producer、workflow、batch 和证据路径填入提示。模板不验证实现、不代写决策、不批准 human_review，也不绕过正常 record 校验。

重试键按实际输入含义归一化。相同决策 JSON 即使换文件名、空白、键顺序或猜测 handoff CAS，仍消耗同一个失败计数；内容真正改变才形成新输入。生产者/报告使用规范化参数、精确实例及 Core 返回的当前输入或来源摘要，参数重排不能重置次数；输入内容实际变化可以重新取证。任何新输入仍受原总期限和授权约束。私有路径、非法 Core 命令与未冻结命令继续拒绝。

### 19.2 长命令准入窗口

真实 Native 探针从实际开始时刻计算最长 900 秒能力有效期，并以原 grant 截止时间封顶。它不延长原授权。每次冻结长命令、证据生产、阶段报告、完整观察或最终汇合之前，宿主检查剩余准入窗口是否覆盖命令上界和 10 秒发布余量；原 wall budget 较短时缩短命令上界并保留余量。窗口不足只允许在原协调 binding、冻结计划和原期限内重新预检；随后恢复原精确实例及正式阶段入口，不能扩大源码写权。

实际 Core 子进程和冻结命令均以原命令上界、原 wall budget 和准入截止减余量中的最小值为执行期限。重新准入本身不受过期旧 receipt 阻挡。新预检仍不足时在派发前停止，不制造一次失败业务操作；真实不支持、未知操作、授权撤销/过期仍拒绝。

### 19.3 生命周期与异常退出对账

宿主在既有 attempt 下以追加并同步落盘的 `lifecycle.jsonl` 记录 `aidlc.host-lifecycle/v1`：run/thread/grant 摘要、宿主和 Native 子进程的 PID/OS 出生标识、Core/tool 操作、Native turn 派发与绑定、心跳、取消请求、实际关闭和进程退出。禁止写入 binding、generation、私钥或环境凭据。业务完成仍只来自当前 Core 批次结果及真实对账。

`inspect-run <run-id>` 在读取宿主配置或创建 Native 客户端之前执行，只读检查日志与 OS 存活；旧的带 config 参数形式仍可用于诊断。它区分运行、已记录退出、失联未对账、PID 重用、存活未知和旧运行无生命周期记录；部分尾行、身份错误的 JSON 行、未结束 turn/Core/tool 操作及未观察到关闭的 Native 子进程保持未知。所有返回值均为 `execution_authorized=false`、`business_verified=false`、`automatic_recovery_allowed=false`。它不补写 exit、不释放领取、不重建 binding、不重启运行。

### 19.4 授权终端与试点执行所有权

内部试点在两份真实 H5 后、任何首次 Native 业务派发前，通过一次性私有 IPC 将当时实际持有的 binding/grant 交给独立工作进程。父终端可正常结束；服务、Native 子进程及原始文件日志由工作进程拥有，不能依赖终端输出管道。交接失败和启动确认丢失必须记录；已转交的凭据不能由父进程猜测回收。工作进程拒绝已有 attempt，重新校验原授权、范围与 HostRef。

这是同一批新授权的首次启动传输。P1 不提供进程丢失后的自动重启、后继授权、领取接管或持久化私有恢复凭据。外部整棵进程树被终止仍可能中断；只有证据足够时才能判明具体触发者，新增日志不能反推旧失联原因。

## 20. IT-00/IT-01：工程入口闸与统一派发

### 20.1 P1-10 HOLD/Go 入口

这是内部评估入口的工程准入，不改变普通 Core workflow，也不签发授权。固定读取 `docs/evals/autonomy/p1-10/integration-audit-2026-11-10/review-status.json`；缺失、损坏、未知 schema/decision、未完成优化或仍有未关闭项均 HOLD。`--check` 返回结构化 HOLD、空 pilots 和 `ready_for_actual_terminal_review=false`，不读取项目状态；真实入口退出 2，先于领取、服务、H5 与 Native。`--retry-unstarted`、直接 runner/worker 入口也不能绕过；历史单项目入口退休。不存在覆盖状态路径或直接放行的 CLI/env 开关。

Go 必须有 `review_complete/optimization_complete/real_trials_permitted=true`、两个未决项数组为空，并引用带原始 SHA-256 的 `aidlc.integration-go/v1` manifest 与 `aidlc.integration-confirmation/v1` 确认记录。manifest 的 source/validation/efficiency refs 分别使用 integration-source/validation/efficiency v1；source 保存完整文件摘要映射，validation 要求 L0/L1/L2/distribution 全 passed、无 open_findings 且原始证据引用可验，efficiency 包含实际毫秒/预算毫秒和证据引用。二者绑定同一 source_snapshot_digest。确认记录保存真实宿主用户消息的 message_ref、过去的 confirmed_at、confirmed=true、manifest 原始摘要及 execution_grant=false；记录校验只表明宿主登记的工程确认包完整，不以此替代真实 H5。

完整来源映射覆盖 Core、bin、Harness、tests、scripts、包/编译配置、协议设计/复审文档及评估目录顶层控制器；新增、删除、修改均使 Go 失效，不包含历史证据输出目录。引用限定在本仓库评估目录，拒绝穿越、私有目录、链接、摘要漂移。入口闸所有结果仍 `execution_authorized=false/business_verified=false`。Go 之后仍须当前设计/HostRef/原生准备检查，以及真实操作终端签发精确 H5。当前只完成 IT-00/01 时保持 HOLD。

### 20.2 动作描述与 metadata 白名单

Harness 内部 `describeAction` 输出 `family/operation/timeout_ms/needs_window/core`，origin 与 mode 来自宿主调用点，不由模型 payload 提供。模型和宿主的长动作经过同一 `prepareDispatchAction`；只有宿主能调用 host context/select、admission inspect/run、grant check 和持有绑定的 module inspect/release。它不增加 Core 操作、授权或恢复路径；Core 继续核验授权、范围、期限和领取。

metadata 只允许 read/rule、design-write、autonomy inspect/policy/decisions/dependencies/record、observe inspect、batch inspect。禁止所有冻结命令、生产者、完整观察/依赖预检、finalize、report、next/preview 和 code/test-write；拒绝在 Core 调用、窗口刷新、重试计数和文件变更之前发生。design-write 仍受文档目录/扩展名约束，record 仍要求原始引用、CAS 和 human_review.pending。模型不能通过 origin 字段或 `--user-input=...` 等等价写法取得宿主权限。

### 20.3 时间窗口可行性与启动屏障

共享不可变策略 `core/tools/data/native-host-action-policy.json` 由 Core 与 Harness 共同消费，其字节参与 HostRef 配置摘要。能力上限 900000ms、发布余量 10000ms、普通 Core 180000ms、阶段生产者 600000ms；冻结 timeout 加余量必须严格小于能力上限。因此 900000ms 与 890000ms 配置提前拒绝，889999ms 仅通过静态可行性，实际派发仍取决于当前剩余窗口与原 wall/grant 期限。不能以此承诺所有近上限命令都能启动。

证据生产、阶段报告、冻结命令/候选、完整观察、最终汇合均在派发前检查并按冻结计划有界续验；原有限重试、正式阶段重入与 pending/unknown 拒绝保留。缺少检查器或新窗口仍不足则零派发；授权检查后若已过期，子进程启动前再次拒绝，不能 clamp 为 1ms 后强行启动。准入刷新不依赖旧 receipt，已持有凭据的取消/释放维持原对账链。来源/委托内容身份、语义进度、资源全生命周期、选择性能力复用及整体性能属于后续 IT 项，P2 恢复未实现。

## 21. IT-01B：同一活跃 attempt 内有界返修

### 21.1 失败接收与分类

Core 只接收当前作用域内的受控失败：签名完整矩阵中可确认的候选行为/UI 断言失败，或实际 Native GREEN 生产者生成的签名失败观察。后者以 `aidlc.attempt-phase-failure/v1` 单独保留真实 stdout/stderr、退出码、命令摘要、测试/I13 输入绑定和源版本；不生成成功 GREEN，不推进阶段。预期 RED 仍是正常 TDD，不登记为返修。编译/环境失败、超时或未知副作用、证据篡改、旧源、外部依赖/版本不一致及无法确定受影响单元时拒绝自动回退。

Agent 提交诊断分类及理由；Core 决定该分类在当前证据、冻结范围、权限和阶段下是否合法，不从模型的自然语言结论推导质量通过。`code-defect` 返回代码生成；`test-correction` 返回 TDD 并开启新受控周期；`scope-change/unknown/expected-red` 不产生回退许可。修改需求、验收/视觉基线、UC-D 责任或授权范围，继续走设计/范围变更，不在此 API 中采用。多单元矩阵缺少可验证单元归属时明确拒绝；原生失败则使用签名记录的精确单元。未覆盖的错误格式不通过消息关键词猜测为可修复。

### 21.2 Core 命令与签名记录

`orchestrate autonomy repair start --pid <owned-host-pid>` 仅供宿主在新 attempt 的首次业务派发前注册。必须持有原 grant 的初始协调 binding，实际 attempt/run/thread/grant 一致，宿主 OS 身份仍在，attempt 开始不超过 60 秒，生命周期日志没有业务 turn/停止/退出事件，且尚无注册。PID/出生标识只作拒绝失联后的使用检查，不构成凭据。旧运行没有该登记也不能补登记恢复；重启、后继、绑定重建仍属于 P2。

`repair inspect` 输出 `aidlc.same-attempt-repair/v1`，包含 status、当前真实 failure_ref、失败检查、可定位单元、remaining_cycles、当前计划；所有输出 execution_authorized/business_verified=false。`repair request --kind <class> --unit <module/unit> --failure <raw-sha256> --reason <diagnosis>` 由 Core 重新接收实际失败，不能用任意文件或分类自授权。同一失败只登记一次分类，变换理由/参数不重置计数。rejected 分类关闭本 attempt 的后续返修请求；历史 accepted 周期的测试/RED/归档保护仍保持有效，不能通过后续拒绝清除。合法计划绑定原 grant/batch/单元、失败来源及不可变归档、精确 steps、失效实例和 plan_digest；范围/未知分类保留为 rejected 诊断记录。

`repair apply --expect <plan-digest>` 仅宿主可经网关调用。每步必须先用既有 host select/bind 取得该步精确实例；Core 再校验原权限、当前失败/归档、领取、状态与计划，使用普通 workflow 写入协议回退，不能直接编辑 Markdown。先失效已完成的项目消费者，再回退目标单元。每步保存 workflow_id 和前后 revision；原 history、审批与上游设计保留，新增 repair-reopened 历史。Core 不选择模型、发起 turn 或管理调度。

私有 `aidlc.attempt-repair-state/v1` 登记位于原 grant 控制目录，公开签名日志位于 `.aidlc/evidence/attempt-repairs/<run>/journal/<revision>.json`。失败原文和归档按 sequence 保留；原 Native JSON、测试输入、RED/BASELINE、模块 I13 和受影响 Native 产物均可追溯。公开记录没有 session binding/generation 或私钥。每个周期最多使用原 max_equivalent_retries 允许数，并额外封顶两轮；跨分类、候选或新失败都不能清零。原 grant、wall deadline、max_active_units=1 和撤销规则不变。

### 21.3 写入、证据与完成屏障

代码缺陷保留 TDD 完成与原 RED/BASELINE，失效代码生成、C7 及其已完成项目消费者。Core 拒绝把测试文件伪装为 code-write，拒绝重产受保护原 RED。测试修正只允许原 RED 声明的可写测试输入，TDD 期间不改变实现；先按原设计/UC-D 受控刷新模块 I13，再生成新 RED/BASELINE，保留原 RED 归档。新 RED 不能减少 UC-D 集合或测试分母；之后代码生成阶段不能再次静默替换测试。无法取得真实新 RED 时保持门禁拒绝，不制造历史证据或使用人类豁免占位符。

返修后的受影响语义传感器必须取得 applied_at 之后的新受控产物，内联 Native 检查继续由原正式门禁实时执行。代码生成、C7、必要全局审查、C8 与最终候选下完整功能/UI 矩阵仍独立必需。旧 failed 和旧签名结果保留为历史，不改成 passed。Core 在正式 report 和 batch finalize 核验返修档案、原 RED、新周期分母及重新完成的实例；模型 final 不构成完成。

宿主诊断回合只允许 read/rule、有限只读 Core 与 repair inspect/request，禁止写入、命令、生产者、报告、推进和自行 apply；提交后立即返回宿主。宿主也消费普通实施回合已登记的合法计划，使用同一派发器、准入窗口、原授权和剩余预算执行，随后取得正式 next，再实施。受控失败仍可修复，真实审批 block、scope/permission 变化和未知状态不能降权。

回退先签名记录 applying，成功后记录 applied；准备后的发布失败标记 partial-transition-unreconciled。Core 不猜测重放，宿主记录 unknown、停止并保留领取；不写伪造成功、不释放未知领取、不恢复进程。正常完成与取消仍复用原 Supervisor、Gateway 和 session binding。当前仅完成 IT-01B 时依旧 HOLD，整体集成与真实试点验收未通过。

## 22. IT-02：输入身份、提案隔离与最终候选

### 22.1 ExecutionInputIdentity

私有 `host context.execution_inputs` 的 schema 为 `aidlc.execution-input-identity/v1`，由 Core 只读生成，不是凭据、准入收据或业务通过证明。

| 字段/变化域 | 来源与失效规则 |
| --- | --- |
| source_digest | 当前 Git 列举的业务文件，包括未忽略的新文件和普通文档；沿用既有 source revision 对控制区的排除 |
| command_source_digest | 同一真实源快照默认排除规范 handoff 的可变决策元数据；冻结 policy 等基线仍由原 grant 检查保护 |
| environment_digest | Core 从签名准入报告的声明中重新读取变量和可执行文件；绑定当前值，不绑定探针/收据换号或时间；尚未接收时为空 |
| command_digest | command_source_digest 与 environment_digest 合成；缺真实源/环境时为空，宿主在执行前拒绝 |
| candidate_input_digest | 当前提交与完整 source_digest 合成；已接受元数据、普通文档、业务源和提交变化均使候选准备失效 |
| control-output | aidlc/.aidlc 的状态、日志、证据、暂存提案不重置源身份；不表示可以忽略其权限、有效期或签名检查 |

冻结命令身份还包含当前精确实例、真实 argv/操作、可执行文件字节和排序去重的声明 input_paths。不同 ID 指向同一冻结动作不重置失败数，纯提交不重置命令失败数；实际实现、普通文档、声明环境或额外输入变化形成新身份，但原 grant/wall budget 不变。显式声明为命令依赖的 handoff/控制文件仍按原文字节参与该命令身份。仓外文件、Git 忽略的业务依赖必须显式声明在受支持的冻结输入中；不能把模型“输入已更新”的陈述作为身份，也不宣称自动发现任意动态依赖。普通文档目前保守触发源失效，细化复用属于后续选择性预检。

### 22.2 DecisionWriteContract 的暂存扩展

既有 v1 write_contract 增加 proposal_directory、proposal_rule 以及每条更新的 proposal_path，字段为只读路径提示，不授予写权限。暂存路径为 `.aidlc/proposals/decisions/<global-workflow>/<record_id>.json`；新记录必须匹配其 record_id，既有记录只能由其原实施单元处理。新记录仍通过原策略/范围校验，不因暂存路径而获得新授权。

宿主内部 `autonomy host proposal --path <path>` 检查原 decision-record 权限、活跃 binding 与精确实施单元。Gateway 的结构化 design-write 在该命名空间分类为 decision-record 控制操作，不开放一般 .aidlc 写入。其他控制路径、错单元、错记录身份、直接覆盖规范 handoff、在交付目录写结构化 decision 草稿均拒绝。受管授权的 Core record 只从合法暂存路径发布；未采用/无受管 grant 的既有记录入口保持兼容。

草稿不是有效决策；record 仍执行原来源、策略、不可变字段、修订、引用、human_review 和文件 CAS 校验，并以既有精确会话发布原子合并 handoff。拒绝前后规范 handoff 和候选身份不变，草稿原文保留。候选检查拒绝 Git 索引中的暂存提案，包括 force-add；不是仅靠 .gitignore 隔离。

### 22.3 Candidate/decision barrier

宿主保留契约要求的前置完整观察，各实施单元分别使用当前 Core write_contract/CAS 完成有界元数据回合，然后统一准备候选。四单元调度边界断言为两次候选/两次完整观察；不以此宣称真实四单元交付或整体性能达标。部分拒绝不会发布该草稿，也不会撤销已合法接受的记录；后续回合仍受原重试/预算限制。

元数据接受后旧矩阵只保留为历史引用，不能冒充当前候选验收。Core 继续校验 clean 提交、候选源/文档、真实 HTTP/UI 服务版本、环境、最终完整矩阵、Native 和委托 current_validation。IT-02 增加暂存提案索引屏障和提交敏感的候选输入身份，复用现有签名/候选/环境校验；不修改旧收据、不减少验收分母、不新增 P2 恢复。相关短边界与聚焦集成见 [IT-02 验收索引](evals/autonomy/p1-10/it-02-acceptance.json)。

## 23. IT-03：进度预算与 ExecutionTraceEvent

### 23.1 Host supervision limits

Codex 配置 v1 增加可选 supervision_limits；缺省使用共享 native-host-action-policy.json 的冻结值，只接受已知字段和正安全整数，覆盖值不能大于共享上限。配置、共享策略及 host-progress.cjs 均绑定 HostRef。不能运行中调大额度或改变原 ExecutionGrant；新宿主进程仍受既有 attempt 启动拒绝规则，不提供恢复。

| 字段 | 缺省/上限 | 语义 |
| --- | ---: | --- |
| max_steps | 512 | 全 attempt 的顶层模型动作及宿主控制步骤；同一步中的权限/身份子调用留痕但不重复扣步骤 |
| max_turns | 64 | 实施、元数据和诊断回合合计 |
| max_steps_per_turn | 64 | 单回合步骤；新回合不重置全局额度 |
| max_repeated_actions | 6 | 同一进展窗口中，同一规范动作/稳定结果允许次数，非只统计连续重复 |
| max_steps_without_progress | 32 | 没有新实施检查点的步骤；成功读取也占步骤，但不是失败重试 |
| idle_timeout_ms | 120000 | 无新实施检查点的模型/控制时间 |
| turn_timeout_ms | 600000 | 单回合模型/控制时间；即使持续写新内容也有上限 |
| step_timeout_ms | 30000 | 普通步骤的模型/控制时间；实际有界命令另外登记其原受检上界 |
| interrupt_grace_ms | 5000 | 取消后等待实际原生 turn/completed 的上限；未确认保留 unknown |

原 grant/wall deadline、撤销、精确 binding、max_active_units=1 与失败重试继续单独校验；新增额度只能更严格。单调时钟还约束初始剩余 wall 时长，系统时钟回退也不能延长本次运行。

### 23.2 活动、实施变化与 Core 检查点

读取内容、目录、RPC 和心跳是可观察活动，不刷新进展窗口。同一动作/相同结果按规范身份计重复；新的真实字节/声明环境不是等价结果，不能用回执 UUID、PID、时间或参数排列制造新结果。无进展步骤和总预算仍生效。

合法 code/test/design 写入的新内容记 work-change；暂存提案和相同字节不计，已见过的路径/字节版本不再次刷新。此类变化代表尚未验证的实施活动，不能宣称业务语义正确。Core 的 progress_digest、已接受 completed 报告、合法决策合并、实际通过的当前候选完整矩阵和合法返修指令是相应检查点，重复同一检查点不刷新。所有变化均不改变质量分母、原 RED 或 Core 完成权威。字节持续变化仍受步骤/回合硬上限，不能无限运行。

### 23.3 已知操作与停止

只有实际派发且有受检上界的 Core/冻结命令登记 bounded work。其等待区间暂停空闲与模型/控制计时；命令自身截止和原 wall 正常流逝，嵌套区间不重复暂停。已知命令到期、无进展、重复或步骤/回合超限，通过原 Gateway abort 和原生 interrupt 停止。重试计数仍只由原执行结果计量，成功读取导致的监督停止不伪装为命令失败。

原生 ACK 不证明 turn 结束；仅实际 turn/completed 记录可对账，超出取消等待记 unknown。模型先报告 completed 时等待其 toolTail 与 Gateway 在途操作，再判断进度和路由。实际命令/原生进程仍按既有关闭事实决定是否清理 claim；未知不接管、不伪造退出、不恢复。该最小取消等待服务本项停止条件，不宣称 IT-04 全资源关闭已完成。

### 23.4 Trace 与计量边界

事件 schema 为 aidlc.execution-trace/v1，持久化于既有 .aidlc/host-runs/<run>/execution-trace.jsonl。字段仅含 span/parent、phase/family、公开阶段、输入摘要、步骤/回合序号、UTC、monotonic_ms、duration/exclusive、结构化 stop reason 与剩余预算；禁止正文、argv、环境值、私钥和 binding/generation。窗口/准入、身份/权限、队列、回合、真实命令、受控检查和清理分段可追溯。

Core observation bundle 及各 observation 追加 timing（clock=monotonic、duration_ms，单项另有 offset_ms）；受原签名保护，不改变观察结果。单项 UI 检查覆盖浏览器/交互/像素验证整体，非单纯浏览器等待；bundle duration 不含最后签名发布。宿主将受控子区间嵌入对应 Core 传输区间，位置按返回端对齐且裁剪，内部与外层时钟不冒充同一原点。evidence-publication 代表受控发布命令整体，不声称精确磁盘写入耗时。

exit.execution_timing 按区间的最深活动及固定优先级归属唯一 phase，重叠 queue 和父子不重复加总，未覆盖记 unattributed。model-rpc 是模型/原生/RPC 合并等待，不推断思考耗时。grant_request_to_supervision_ms 仅记录监督开始前的 UTC 间隔，不能据此细分人类/设计/外层 worker 等待。完整外层服务/资源耗时及未知关闭继续留待 IT-04/06；本项不宣称达到真实订单/发布页性能目标。
## 24. IT-04 资源所有权、截止与异常对账

Core 与宿主共用 `tools/aidlc-owned-resource.cjs` 的资源事实和时间策略，分别管理自身创建的资源。Core 观察执行器拥有浏览器进程、CDP socket 和其 profile；原宿主 Supervisor 拥有 Native、受控命令和 worker；原 worker 拥有 service、reload 及 Native host。资源必须在创建后立即登记确切句柄，不可凭文件里的 PID 认领。Core 仍只验证授权、领取、证据及完成条件，不调度模型、不提供进程恢复。资源策略与实现参与 HostRef；观察器实际依赖参与 checker identity。

`aidlc.owned-resource/v1` 的公开事实包括 resource_id、kind、owner、pid、created_at、deadline_at、started、process_exited、close_observed、exit_code/exit_signal、termination_requests、helper 关闭事实、status、reconciled 与 eventloop_detached。PID、kill 返回值、interrupt ACK、exit 事件、close 事件分别记录。只有实际 close 且清理 helper 已对账，才发布 closed/reconciled；exit 缺 close 保持 unknown，并禁止晚到的 PID 信号。unknown 结果在本次清理中不可被晚到事件自动升级。日志和事实不含私有 binding、generation、环境凭据或可恢复上下文。

默认资源上界：启动 5000ms、正常关闭 1000ms、终止等待 2000ms、强制关闭 5000ms、IPC 30000ms、reload 15000ms。HostRef 绑定的覆盖项只能收紧，未知字段、零值、非有限数和放大上界拒绝；通用命令必须有有限正整数 timeout。清理使用单调绝对截止，同组关闭并行消费同一截止。业务启动和 reload 继续受原 grant/wall 限制，截止后仅允许清理，不延长业务授权。发信号、执行 taskkill 或取消请求都不证明退出；只对当前仍活跃的原 ChildProcess 精确句柄/进程树操作，helper 自身也须有界对账。

未知时关闭/脱离本进程持有的流、IPC、socket 和定时器引用，使父进程可有界返回；这不证明 OS 资源已消失。保留 profile、原始失败、资源事实及领取；不自动接管、重启、续租或恢复。`resource_reconciliation:{reconciled:false,resources:[...]}` 必须跨观察 bundle、Core transport、Gateway、Native exit 与 worker result 传播；外层进程成功退出不能覆盖内层 unknown。stderr 的保守拒绝标记 `AIDLC_RESOURCE_UNRECONCILED` 仅用于阻断和留证，不能授予执行或替代受控签名。完整矩阵保留全部检查，未知后的检查标记失败/未执行；current observations 与同 attempt 自动返修均拒绝 unknown。

原 worker 的外层 service 若晚于 Native 关闭，Native 不可先释放领取。仅在 Native 内部操作和资源已确认时，通过原私有 IPC 发送 `aidlc.cleanup-delegation/v1`：当前 run_id、grant_digest、thread_id 与最多两份实际持有的 private_bindings。原 worker 核对原身份、owner、workflow 和当前精确领取后 ACK；两端 ACK/退出等待均有界。该私有载荷不得写盘或进入模型、业务环境或公开日志。它只用于同一仍活跃 Supervisor 的最终检查与释放，不能启动业务、从 state 重建凭据或恢复旧 attempt，属于 P1 清理职责。

worker 确认 Native 实际关闭、reload 完成、service 关闭、内部操作已对账后，以收到的原凭据核验 Core 最终结果并释放精确当前领取。缺 ACK、未知退出、无可信清理绑定或任一未知资源时保留领取。Native 的 candidate_business_verified 仅为内部候选信号；worker 的 business_verified 还须 Core 当前批次 verified、batch_completed、原退出码及资源/领取全部对账，脚本布尔值不能替代。父端私有初始化已发出但未确认时标记 handoffUncertain，禁止父端自动收回领取；不是 P2 接管。


## 25. IT-05 采用前草稿预检与宿主能力选择性复用

公开只读入口为 orchestrate autonomy admission draft --batch <id> --input <AdmissionPlan> [--observations <ObservationPlan>]，仅用于尚未显式采用的真实 global workflow。它直接使用 readAutonomyBatch 得到显式 draft 上下文，并把该上下文传给原 policy、dependency、admission 和 observation prepare 验证器；不临时修改 state，不伪造 adopted 字段，不执行 project command、Native gate、宿主探针或 HTTP/browser，不生成 issuer、grant、claim、锁或证据收据。只读 Git 元数据/文件检查不表示项目验证执行。

输出 aidlc.autonomy-draft-preflight/v1、validation_level=draft-static、enabled=false、static_result=valid/invalid，始终 admission_result=not-ready、execution_authorized=false、business_verified=false。结构/来源级错误可直接拒绝；已采用模式保持原 run --preview，不允许用 draft 覆盖采用状态。验证当前批次依赖闭包、策略与委托、已声明计划摘要、技术接收、完整 AC/UI 分母、写入归属、资源与环境声明；提供 --observations 时运行与实际观察完全相同的 prepare 语义。环境变量须可解析，但不会请求其端点。缺少可判定产品/设计输入仍拒绝。

draft 不核准当前授权、活跃领取、Native 消费证据、运行时依赖或实际能力；未执行项显式列入 pending_validation，不给出准入 ready。依赖草稿可检查定义及 I13 静态来源，但不运行 Native 子检查器，不把未核验 consume/runtime 说成已就绪。后续正式采用、真实 H5、admission run 与消费检查仍使用原门禁。H4 sealing 在采用/提交前消费此接口；环境占位值只供静态解析，不作为在线环境证明，不改写已有试点。

能力证据采用独立签名域 aidlc.host-capability-receipt/v1，位于 .aidlc/evidence/native-host/<original-run-id>/capabilities/，指针也签名并绑定本项目 realpath。Core 在原 publication 锁内签发，绑定原 batch_ref、grant_ref、完整 grant 约束摘要、实际 checker 依赖摘要、host observation 和原始 probe 输入。业务准入失败不会删除独立能力证据，重新接收也不能重写原能力日期。普通 JSON、手工 passed、别的 run/workflow 的收据及无可信配置绑定的旧适配器结果不能获得复用资格；旧适配器保持原 fresh 探针行为。

复用条件全部成立才可命中：签名/指针/原始输入有效，原 observed_at 不在未来，原 valid_until 尚未到达且不超过原 observed_at+900 秒及原 grant/wall 截止；checker、原 grant 全约束、run/batch、HostRef 与资源上限一致；原 supported 能力覆盖本次全部必需集合。Core 每次重新核验原授权、撤销、期限和当前精确领取。缺失/过期/能力不足/上下文变化需要当前授权下的新实际探针；篡改、配置漂移或 unknown 直接拒绝，不以完整探针重试掩盖。P1 不增加跨授权、跨宿主迁移或部分能力探针调度框架。

命中后真实适配器还执行 check-config：在原预算内启动原生 app-server，仅 initialize/config-read 后关闭，不创建 thread，不执行模型 turn、工具或浏览器。实际原生配置摘要必须等于冻结配置及原能力配置摘要；同时重新核对 HostRef、配置文件、可执行入口字节和资源已关闭事实。配置原文的外部来源变化即使没有改变冻结 HostRef 文件，也须被真实 config/read 捕获。检查原文单独留证，并在返回后和签发前复核原授权/能力期限/原始输入；期间过期、撤销、领取变化或未知均不得产生 ready。

新 admission 记录 host_capability_reuse.mode、reason、原 capability receipt ref、必需能力集合及当前 configuration_check；复用的 host_observation 原文保持原 nonce/observed_at/valid_until，不产生新的能力期限。新 admission 期限取本次计划窗口、原 capability valid_until 和原授权截止的最小值。未命中只允许新的真实观察更新能力指针，旧签名文件保留。独立能力通过不等于业务依赖、预检或质量通过：每次仍重读设计/策略/来源/环境、消费条件并执行实际业务预检，最终 Native、完整功能/UI 矩阵及候选一致性规则不变。

静态接收或宿主检查失败时不启动业务预检；业务子命令剥离原私有授权/绑定环境。Core 负责来源、合法复用及门禁，宿主原 Supervisor 负责原生执行、预算与资源关闭；缓存不是 grant、admission 或恢复上下文，没有 P2 接管、重启、后继或原授权延期。


## 26. IT-06 控制面与 UI 性能边界

Core 的 host context 显式公布 control_prepare.schema=aidlc.host-preparation/v1 与 supported=true。可信宿主才可调用 host prepare --checks <JSON array> [--context]，最多 65 个原 operation/path 检查，严格字段白名单；模型不能调用或以动作字段伪装宿主。Core 仍通过原 checkCurrentExecutionGrant 逐项核对当前 grant/撤销/领取、路径和消费条件；可在同一请求计算真实输入身份，最后再核验当前权限及原截止。它不写状态/领取，不签发凭据，不返回可缓存的许可。

宿主只在当前动作局部使用 preparation，核对 schema、当前 binding 摘要、原 grant ref、精确检查清单、检查时间及不放大的原 deadline；输入身份仍包含实际代码、测试、声明依赖、可执行文件和环境。对普通冻结命令，把上下文与一个/多个启动前权限检查合并；执行后的实时检查继续独立，正式 Core 写入/报告的发布检查继续存在。模式/路径/阶段约束在原 Gateway 内先后均检查，原失败身份、步骤/回合预算、max_active_units、授权期限及取消对账不变。未协商能力的旧适配器继续原 CLI 路径，拒绝或 unknown 不自动回退重试；不跨动作缓存权限。

一次观察 bundle 或一个 Native phase 拥有一个浏览器 session，不能跨候选、授权、进程或 attempt 保存/恢复。每个 UI 用例创建新的 BrowserContext 与 target/session，重建页面和事件收集器，禁用缓存及 service worker；保留原 DOM、真实鼠标/输入、字体/图片就绪、网络/错误、完整 PNG 与像素比较。CDP 创建/销毁机制遵循 [Target 协议](https://chromedevtools.github.io/devtools-protocol/tot/Target/)。dispose ACK 不代表关闭：须确认 getBrowserContexts 与 getTargets 中原 context 及其所有 target 已消失。创建响应未知、销毁未确认或断连均停止复用，不另开浏览器规避。

case_service 是冻结 ObservationEnvironment 的可选字段：真实绝对 executable/argv、1..5000ms 启动上界及非空 input_refs；使用原 prepare 校验器和实际输入/可执行文件摘要。UI case 声明该能力时，每用例启动独立的本地服务，验证前后真实 /version 与当前候选一致，完成整个用例的发布/重试/结果链后再关闭。没有新增 reset API，不清空生产/共享数据库。浏览器与服务的身份、原始观察和实际关闭事实记录在证据中；旧计划未声明时仅保证新的浏览器 context，不能冒充服务端状态已隔离。未来发布页生成器明确声明 case_service，既有采用范围不被自动改写。

UI 的 20 秒用例上界同时约束服务启动、浏览器动作和版本读取，不因复用重新获得时间；pool 的上界受原 bundle/授权期限限制。清理只使用有界的原资源关闭策略，不扩展业务期限。临时服务在用例结束即通过原拥有句柄请求终止，再等实际 close；没有把 SIGTERM 当退出。Chrome/root socket/profile 只在所有用例完成后收尾；任一资源 unknown 保留现场/证据/领取，外层退出不能覆盖内层 unknown，完整分母仍保留，不接管、重启或恢复。

生成的 Native test-support 在同一 phase 内惰性加载受 checker 绑定的 Core TS 模块，复用一个浏览器；默认 assertUi 为各用例创建独立服务，显式 origin 表示调用者拥有服务生命周期。真实 API 状态、发布结果持久性与 View result 导航仍验证；Core 最终观察继续独立执行。原 phase 模板在输出观察前关闭 UI pool，异常路径同样关闭；关闭未知属于环境失败，不能成为 RED 行为失败或成功 GREEN。独立结果导航命令可拥有另一个进程内浏览器，不能据此声称整个批次只有一个 Chrome。全部两尺寸十组合及像素阈值/区域保持，既有 RED、Native/矩阵/决策和最终候选要求不变。

browser_reuse.metrics 记录冷启动数、context 创建/确认销毁数、startup、context setup、真实观察、context cleanup 与 browser close 毫秒。单检查 timing 还包含独立服务、HTTP、像素与控制开销；微基准另测服务启动/关闭、像素比较、Core CLI 次数/响应字节与耗时。父子区间不能重复相加，不能把剩余时间解释为模型思考。微基准不增加授权/等待预算，不减少验收项，最多三次短采样；记录中间实现和最终实现的区别，不挑最好结果冒充重复实验。实际业务 8/15 分钟、最终完整冻结 L2 与 Go 仍待 IT-07/08，当前 HOLD。


## 27. IT-07 联合执行窗口与交接准备

Core 在选定 native_host_ref 的 draft、正式 grant prepare/issue 重算及 admission 检查联合校验宿主动作、计划有效期、能力原期限与原 grant/wall 截止。宿主同一计算器还用于逐动作准入及 main/worker 启动防御，不新增 Supervisor、授权延期或恢复。Native 阶段最长 600000ms 加 10000ms 发布余量，仍按原授权剩余减发布余量封顶；可用窗口为 plan lifetime 与原能力剩余的最小值。原 600 秒工程 grant 的初始需求为 590000ms，300 秒计划不兼容；600 秒计划可覆盖原预算，原 deadline 不改变。

采用前选定宿主的 admission draft 必须提供 --grant-request <request.json>，该请求须为草稿冻结 baseline input；静态输出仍未授权、不执行探针/项目命令，不签收据。没有选定 native_host_ref 的既有模式保持兼容。正式 prepare 同时扫描该批次冻结的 selected-host admission plans，拒绝不兼容请求，不能以跳过 draft 绕过 H5 前检查。真实 capability 返回后再次用其原 valid_until 核验，失败禁止项目预检。检查不把 capability 最大上限视为当前观测事实。

共享返回 aidlc.execution-window-compatibility/v1：required_ms、available_ms、grant_window_ms、requirements 和 execution_authorized=false；admission 的 host_window_compatibility 由 Core 生成并纳入原签名收据。selected host/config/plan 的不一致或未知会拒绝，检查本身不发布授权、不修改 plan、不写状态、不启动模型/浏览器。真实 H5、原授权/撤销/精确领取、完整 Native/验收分母与 P1/P2 边界不变。
## 28. 跨层执行继续判定与逐路径验收

本节的时间三态保持；Codex 完整能力探测的触发按第 29 节收缩，reprobe 表示重新取得当前准入事实，不总是重新执行模型探针。未协商适配器保留本节的旧观察窗口行为。

Core 能力复用、准入完成/发布与选定宿主的续验、阶段恢复和最终派发消费同一 `aidlc.execution-continuation/v1` 时间状态。返回 `decision=continue|reprobe|stop`、`reason`、`phase`、`required_ms`、`available_ms`、`original_remaining_ms`、`refresh_attempts` 及 `execution_authorized=false`。它是当前判定记录，不是可缓存许可；所有原授权、撤销、精确领取、真实配置、来源和已知资源检查先行。

| 条件 | 判定与动作 |
| --- | --- |
| 当前有效且原剩余窗口充分 | continue；保留现有能力原日期，仍运行当前业务预检 |
| 旧能力未过期但不足，或已过期；原授权有效、配置复核匹配 | reprobe；一次准入最多一次真实 observe，保留旧 receipt，不续 grant |
| 轻量配置检查期间跨过能力阈值/到期，但原授权仍有效 | 重新计算窗口后 reprobe；已知时间消耗与配置 unknown 分开处理 |
| 新观察本身已不足、业务预检后不足、发布锁内不足 | stop；不产生 ready，锁内不探测，不以反复探测刷通过 |
| revoked/expired grant、stale binding、篡改来源、配置漂移/unknown、pending/unknown 操作 | stop；不以 fresh probe 掩盖安全失败 |
| 正式阶段恢复后窗口耗尽或出现新 block/choice | stop；不得凭旧 readyInstance 继续 |
| 最终权限检查后窗口不足 | 最多一次宿主续验并重查实时权限；仍不足则不派发，不增加或清空等价失败预算 |

真实配置的必需组合包括 3600 秒原 grant、900 秒能力及 600 秒 Native +10 秒发布余量，并推进到 525675ms 剩余；600 秒 grant 的原剩余 clamp 另列兼容性路径，不能替代长 grant。配置轻检、预检、发布、阶段恢复及权限准备的耗时边界分别取证。

验收以独立路径为最小结论：每行有场景 ID、预期状态转换、实际断言、测试文件/来源摘要、日志/原始记录摘要和证明范围；缺一项则不标记当前已证。纯判定、真实 Core、脚本化宿主与真实 Core→Gateway→真实短命令集成分层标识。禁止把一个正向 L2 或文件退出码批量映射为整个故障族关闭。旧工程证据、当前局部证明、当前发布整链和真实业务终验分别记录，失败早停不建立成功效率；任何新来源需要重新评估依赖，HOLD 不由局部通过自动解除。

## 29. P1 控制与验收成本收缩

可信 adapter 可协商 qualification_scope=run-config，Core 把该字段写入签名能力证明。复用要求原 grant/run/batch 全约束、HostRef、配置、证明 checker、必需能力和原始输入均合法；同时执行当前 config/read 轻检并确认其资源已关闭。旧观察即使已经过了 valid_until，仍仅作为原时刻的能力证明；原 observed_at、valid_until、nonce 和签名不变。当前 freshness 另存于签名 admission.host_capability_reuse，包含 observed_at、valid_until、basis 和 capability_receipt_ref；其截止不超过轻检开始+900s 及原授权/wall 截止，慢检查不会重新获得完整窗口。项目预检和发布再次校验该窗口。

完整探针用于无有效能力证明、其生产/校验依赖变化或必需能力增加；不能用它掩盖配置漂移、unknown、来源篡改、原授权失效。能力证明的 checker 仅绑定生产、校验、授权存储和资源依赖，准入路由和窗口代码变化由当前 admission checker 校验；HostRef 包含实际宿主和共享派发判定代码。未协商适配器保留原语义，不从 JSON/Provider 输出取得协商权限。

宿主刷新直接使用本次 admission run 返回的受控结果，省掉紧随其后的 inspect；已有正确协调绑定时不重复 select。当前有效 receipt 已检查过依赖时免去重复依赖观察；Core 仍复核当前依赖，若发生竞态最多补一次依赖观察。最终动作权限检查、精确阶段正式重入、预算与资源对账不缓存或删除，不新增 Supervisor、长驻服务或 P2 恢复。

P1-10 工程 Go 保留完整 source snapshot 与原验证证据；source_impact 单独列出 execution、verification 和 documentation 变化。仓库 tests/ 是回归来源，README.md 是说明；只改这些文件可复用原已审阅的执行证据，但返回 current_verification_sources_validated=false 及 changed-regression-tests 要求，不声称新测试通过。Core 规则、规范契约、构建/锁文件、宿主、试点控制器和验收资产仍为运行依赖；任何未知路径保守归入 execution。原始证据/确认摘要、未关闭问题、真实人类 H5 均不放宽。该分类不适用于业务项目的 UC-D、测试或 UI 基线，它们仍参与候选验收与失效。

先完成相关设计、实现与文档的一整组修改，再集中运行受影响检查。通过项不因无关文件变化重复运行；失败仅针对实际原因补验。当前完整业务交付及 L3 只能由其实际结果证明，不因定向检查或复用判定自动完成。

### P2-01 Run / Attempt / Checkpoint 基础（2026-11-11）

P2 开始工程实现，任务与依赖见 `aidlc-autonomous-implementation-p2.md`。本项不启用后继恢复，所有 P1 disabled grant 保持原语义。

`aidlc.run-checkpoint/v1` 包含 run_id、原 grant_ref/batch_ref/host_ref、sequence/previous_digest、recorded_at/原 deadline_at、首次生成并保持的 attempt_id/session_id/owner/observed_started_at、精确 claim_ref 的 binding_digest、Core 读取的 state_refs/source_revision，以及宿主的 host_observation。记录由现有受信 issuer 签名，在发布锁内通过 expected head CAS 追加；不写第二份阶段进度，不持久化原 binding 或秘密。observed_started_at 是首次登记时刻，不能冒充宿主实际启动时间。

host_observation schema 为 `aidlc.host-checkpoint-input/v1`。reason 限 binding-change/before-operation/operation-dispatched/result-committed/candidate-prepared/context-boundary/stopping；budget_observation 必含非负整数 steps/turns/active_elapsed_ms；pending_operations 仅允许 operation_id/status/binding_digest，最多 512 项且 ID 唯一；candidate_commit 可选且须与 Core 实际 HEAD 一致。未知字段、自由文本、凭据和通过标志拒绝。预算观察不得倒退或超出原 wall 上限；prepared 可到 dispatched/unknown，dispatched 仅到 unknown，unknown 不能被删除或降级。这是检查点观察契约，不改变既有 Operation journal 的转移语义。

命令 `orchestrate autonomy run inspect` 返回历史投影；`run checkpoint --input <file> --expect <head-digest|absent>` 必须持有原有效 grant 和精确领取。Codex action policy 只向 trusted host origin 开放这两个命令，模型不能发 checkpoint，更不能发 resume。记录不触发 Supervisor 语义进展，不增加授权、预算或完成项。

全部返回显式 `budget_is_observation_only=true`、`recovery_allowed=false`、`execution_authorized=false`。未知操作须后续受控对账，预算须后续派发前持久预留，不能直接用观察字段启动新 attempt。整个受信存储被回滚及 Windows 断电目录项丢失仍是待对账边界；不宣称 exactly-once 或完整自动恢复。P2-02～06 未由 P2-01 实施结果自动完成。

### Native 续验进展响应（2026-11-11）

`evidence run --refresh` 增加可选 `evidence_progress`，单项在响应顶层，批次在 `actions[]` 的相应 sensor 行。字段为 `{version:"1", transition:"invalid-to-current", workflow_id, stage_instance, sensor, identity}`。仅当原派生证据不满足当前校验、受控重生成及发布成功、当前派生证据通过校验时返回；reused、失败、phase 观察分支不伪造此标志。identity 是绑定输入/来源/精确实例/传感器/checker/argv/显式 freshness 配置的 SHA-256，不含回执时间和执行 UUID。同目标反复失效不能制造新进展。

宿主消费可信 Core 响应并核对请求目标，沿用 Supervisor 的 seen 去重及原授权内计数。新目标的有效续验可重置无进展计数，不重置总步数、回合、重复重试上限或 grant 截止；无新进展的循环仍必须停止。字段不代表原始观察续期、阶段完成、Native 全绿、UI 合格或批次验收通过，也不作为跨进程恢复记录。

`repair_diagnostics[].command` 可对同一 completed 实例的已知语义派生失败返回相同 `--sensors` 命令，宿主执行一次后重取正式路由。不得包含跨实例、RED/GREEN/BASELINE、人工审批、行为测试失败；当前作用域、逐项生产/发布校验、部分失败证据保留均不改变。completed 项目级目标使用显式 `--instance`。详见源协议 `core/knowledge/protocols/common-autonomous-execution.md` 的“Native 派生证据续验的有效进展”。



### P2 持久执行与有界后继（2026-11-11）

新 H5 请求可显式包含 successor_policy={version:"1",mode:"same-host-session",max_restarts:1..3}。省略仍为 disabled；既有签发不迁移、不延期。Core 保持 run/grant/HostRef、同一 owner/native session、范围、输入和原截止；宿主只在旧执行者及所有已登记资源实际不存在后注册新 attempt，续签精确 claim generation，并使用新的私有 attempt token。CAS 竞争只有一个后继获权。PID 重用只有在出生标识不同且可证明时才视为旧进程不存在；未知、活跃旧资源、无 PID 的 spawn intent 均停止，保留领取与证据。

选定 Codex runtime 的 supervise <frozen-config> <original-thread> 是有界外层拉起入口，复用原 Gateway、ProgressBudget 和 driveBatch。run 仍支持原 disabled 模式。独立模式管理 Native/Core/command；外层 worker 模式使用冻结配置中的 worker_entrypoint 和私有父子 IPC，由 Core 记录 worker/服务/reload 身份并签发一次性子进程准入凭据。旧 worker、permit 子进程、宿主及登记资源必须确认退出，才允许在原期限和重启额度内重建服务、续用同一原生 session。未知状态不接管。跨机器、新原生会话、并行调度不在此策略内。

派发前先追加操作预留、步骤/回合预算和资源 spawn intent；派发后绑定真实 PID/出生标识，实际关闭后结算。steps/turns、无进展计数、语义去重、等价失败、路由返修计数、空闲耗时均跨 attempt 保留；中断不增加期限或额度。明确取消是持久停止，不能变为自动重启。仅已对账的 Native transport 中断允许新代次尝试；旧进程未退出仍拒绝。

Core 受信 Git common 存储使用 aidlc.recovery-state/v1 检查点与 aidlc.recovery-delta/v1 增量签名链，每 32 条建立完整快照；普通读取最多重放 32 条，恢复时完整核对历史。追加先 fsync，再更新签名 head；孤立追加、损坏、断链、未知锁所有者停止。受信存储整体回滚及断电目录项持久性不宣称 exactly-once。普通 P2-01 checkpoint 仍只是观察；run inspect 的 durable_execution 也不授予执行权。

report 的 operation_ref 与阶段 history 同一个原子 state 写入并 fsync；响应丢失后按精确 operation/input/workflow/instance 对账。相同操作重发只返回既有提交确认，不再次推进。不同输入拒绝。文件写入只在当前内容摘要精确相同时确认；未知命令不重放。冻结 command 可配置只读 recovery_query（绝对 argv、最长 15 秒且受原截止限制），通过 stdin 查询原 operation_id/input_digest；仅精确 terminal/not-executed 观察可解除未知，查询不构成业务验收。命令得到稳定 AIDLC_OPERATION_KEY，私有 attempt/session/grant 凭据继续从业务/模型环境剥离。

恢复后不复用旧进程句柄、浏览器页或服务连接；由原环境/依赖预检、观察生产者和正式 next 重新建链。已失效的环境、候选、Native 和 UI 证据仍须重做，当前有效来源才可按既有规则复用。两尺寸十组合、真实 API、结果导航、完整功能断言及像素标准不变。后继工程检查不改变 P1 真实交付 HOLD，也不把脚本化 RPC 探针称为真实模型验收。


### P2 外层 worker 与服务恢复契约

worker_entrypoint 必须是冻结的绝对文件路径，其字节参与 HostRef。受信 Core 账本的 outer_worker 保存 PID/出生标识、适配器摘要、epoch/replacements、资源 intent/started/closed 和私有凭据摘要；run inspect 只投影状态、代次及未关闭数量，不输出 token、permit 或 binding。资源最多 4096 条，原有总账本上限仍生效。

原 worker 通过私有 IPC 为直属子进程请求一次性 permit，绑定 run/grant、子进程 PID/出生标识、nonce 和 expected revision，最长 10 秒且不超过原 grant/wall 截止。Core 消费 permit 时同时核验真实父进程、活跃服务和原授权；新的 attempt token/精确 coordinator binding 仅经当前 IPC 交回 worker。业务子进程不继承这些凭据，模型没有该注册或恢复入口。

同 worker 内的后继与整个 worker 的替换均沿用原授权、session、HostRef、步骤/回合消费及重启上限。reload、服务、旧宿主及其已记录子进程全部确认结束后才能重建环境；spawn intent 无 PID、仍活跃或未知资源拒绝。旧 permit 的子进程也在对账范围，不能因尚未形成 attempt 而漏掉。已终止、取消、撤销或到期的 run 不再派发。关闭记录允许在授权到期后追加，但不授予新执行权。

外层 worker 等当前 attempt 的正式 exit、真实资源关闭、Core 结果投影及精确领取清理完成后结束 run；内层宿主不能提前结束外层 lease。每个 attempt 保留独立原始结果；旧结果不能冒充后继输出，后继预检失败不反复启动。原父 Supervisor 存活时有界重新派发已退出 worker；父 Supervisor 也已退出时，宿主须经原私有授权上下文重新进入，磁盘检查点和模型输入都不能重建凭据。

恢复是工程能力，不能替代真实模型的完整功能/UI/效率验收。选定内部试点入口仍服从 HOLD/Go；旧 disabled grant、历史失联 attempt 和不属于本次任务的根 workflow 不变。
