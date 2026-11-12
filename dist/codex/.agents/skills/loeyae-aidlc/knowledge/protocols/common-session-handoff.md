> 适用范围：以下强制路由、凭据和状态写入规则仅适用于显式选择的旧受管引擎。默认实施遵循 [宿主执行协议](host-execution.md)，不加载本协议作为开工或续作门禁。业务质量要求仍按任务需要使用。

# Session 交接提示词

## 先核对内容，再恢复受管写入

续作入口为 `orchestrate state context [--module <id>] [--unit <id>]`（集成使用 `--integration`），再以最新 `next --preview`/正式 directive 路由。视图只读，无需领取，不扫描 audit 或其他模块状态；它不是准入或门禁通过证明。旧 handoff/progress/state 展示文本不作为第二份当前状态。

按 `rule_load_plan` 与 `business_document_load_plan.reading` 读取当前任务。切片的 private 与 inherited 共同组成输入；私有文件为空不表示无需求。只访问当前 manifest 指向的对象，不递归读取 objects、history、branch-snapshots 或 verification。共享接口、UC-D、UI 状态与验收标准按精确引用完整取得，不能为了节省上下文省掉必要行为。

`orchestrate state artifact --path <公开过程产物>` 默认将 JSON 投影为结果字段和原文件摘要，不展开源码哈希表、环境及原始日志；Markdown 默认返回 8,000 字符，按 `next_offset` 分页并核对 sha256。可用 `--offset` 和 `--limit`（最多 16,000 字符）调整阅读，不是工作流时限/质量门禁。需要失败细节时用宿主原生工具精确读取对应字段/日志；完整机器证据继续由原校验器读取，不更改签名或证据格式。

新增 legacy `STATE_UPDATED` 审计使用 delta-v1，只记变化领取的身份前后值、handoff 摘要及当前 revision/status，保留专门审批/转交事件。旧审计不删除、不改写；审计不承担当前领取的恢复权威。无变化状态仍不写入。

`orchestrate state changes [--from <完整提交ID>] [--paths <JSON数组>]` 提供独立于 workflow/claim 的只读 Git 视图。状态缺失、损坏或领取过期时，先核对已有设计和实现，不为读取、比较或诊断而申请全仓维护。视图包含未提交和非忽略未跟踪内容，不代表批准、证据有效或阶段完成；已有批准和报告不可凭文件存在重新生成。

正常未过期的同 owner/session 续领保持 generation；过期恢复或显式转交轮换 generation。旧 binding 遗失时，先 inspect 精确目标，再按真实人类指令转交到新 session；`resume` 仅用于 parked 的 current instance，不能替代领取恢复。局部转交不要求无关模块释放领取。全仓 maintenance 只用于确需全仓静默的布局或状态修复。

无变化状态保存不产生 revision/audit；仅无关领取或选择变化可在锁内合并。范围、批准、业务进度或同目标所有权冲突仍需重新核对，禁止盲目覆盖。不同工作树之间的并行实施以内容差异和最终合并候选验证为准，不能以另一工作树中的阶段复选框代替验收。

证据复用和门禁失败处理遵循 [Evidence reuse and targeted repair](evidence-reuse-repair.md)：当前目标以外的阶段延后，`verify` 不意味着重跑测试，修复按结构化诊断定位传感器，相同阻断不得等价重试。

`handoff_prompt` 是当前工作流的面向人的交接文本。它来自 `orchestrate next` 与成功的 `orchestrate report`，Agent 必须原样展示。

与用户交互时，回复首句称呼 **BOSS**（用户显式指定其他称呼时优先遵从用户）。完成 `completed`/`approved` 报告后，先展示完成摘要和 `handoff_prompt`，再用独立的 `text` 代码块原样展示 `next_stage_prompt`，不能只说“继续下一阶段”或只给一条 next 命令。`next --preview` 也返回该可复制提示词，便于新会话重新读取最新路由。

展示提示词不表示暂停，不增加确认轮次：已获授权的续作展示后继续，只有真实审批门禁或用户明确要求等待时才等待。旧 runtime 未返回 `next_stage_prompt` 时，仅展示已有 `handoff_prompt`，不得自行猜测下一阶段。

global state 已显式采用自主批次时，额外读取 [自主批次实施协议](common-autonomous-execution.md)，遵循当前 directive 的 `autonomous_execution` 与 `rule_load_plan.supplemental_protocols`。notify/none 不逐阶段询问继续；澄清先复用确定来源，再按有效 policy/fallback 记录合法委托。未采用模式的人工模块选择和真实 block 审批保持原规则；投影不授权。

`next_stage` 是建议任务的范围与产物摘要；`next_stage_status=planned` 仅表示路由建议，未验证准入。`blocked` 须先解除列出的阻断，`none` 表示当前预览范围没有下一任务，不等于全项目完成；`unavailable` 表示完成已提交但预览失败，应恢复路由信息，不重复报告已完成阶段。复制提示词后仍先预览、inspect/bind 精确实例并取得正式 directive；提示词不携带旧会话的领取凭据，也不授予接管或审批权限。

## 内容要求

提示词必须清楚说明：

- 工作目标；
- 当前阶段和 stage instance；
- 当前 module/unit（适用时）；
- 需要生成或验证的产物；
- review、构建、测试与报告的下一步。

## 使用方式

恢复工作时先运行：

```bash
loeyae-aidlc orchestrate next --preview
```

再读取返回的 `handoff_prompt` 和当前布局的 state（per-module 布局读取 registry 与目标模块 state）。按下文完成精确 session 绑定后，再运行写入型 `next`。提示词帮助成员理解下一步，但不能替代命令、改变阶段或跳过质量门禁。

## 团队交接

已显式采用自主批次时，`next` 和 `state summary` 附带 `autonomy_decisions`。交接应保留所绑定 policy、各 decision_id、human_review_summary 与 completion_blockers；pending 复核不是实施等待点，缺实现/验证、实际冲突或返工要求则按真实原因处理。结构化 policy/decision 是业务定义，依契约写入既有 development-handoff/handoff 的唯一段；不能将其扩展为另一份进度、审批或质量状态。handoff 的来源引用优先使用 json-record-v1，按 raw-file 冻结后不得靠追加决策破坏基线。运行授权、会话绑定与质量门禁仍分别有效。

成员可补充简短的人类说明，例如已完成的 review、待处理风险或目标分支。单元分工以 Markdown state 中的 unit selection 为准，交付以 review、构建、测试和 merge plan 为准。


## 会话范围与人类转交（MARS-243）

Stop 只是只读回合边界。结束回合可以保留 running 阶段；不需要 report 或 park，不能为退出而批量停驻其他模块。阶段完成仍必须通过 report 的证据、依赖、RED/GREEN、审批与 merge 门禁。

写入前使用当前宿主的 session/thread ID；宿主没有提供时，为本会话显式选择一个唯一 ID。owner 是稳定成员标识；branch/worktree 和 `AIDLC_ACTIVE_MODULE` 只是上下文，不能授权写入。

先用只读 `loeyae-aidlc orchestrate next --preview [--module <id>]` 确定下一精确 instance；它不写 state/audit/claim，也不生产证据。

1. `loeyae-aidlc module inspect --stage-instance <精确 instance>`：只读返回 claim 与 expected token。
2. 首次领取：`loeyae-aidlc module bind --stage-instance <instance> --owner <成员> --session-id <当前会话> --expect <expected>`。
3. 把返回的 `binding` JSON 作为 `AIDLC_SESSION_BINDING` 传给本会话后续子命令。禁止写机器全局环境、共享默认配置、仓库配置或跨会话复用。它绑定项目 realpath、workflow ID、精确 module/unit/instance、owner、session 和随机领取代次。每次 bind/renew 后使用新 binding。
4. 人类明确说“将 m11-recommend 转交给当前会话，从现有 application-design 阶段继续”时，读取精确目标后直接执行 `module transfer --stage-instance application-design@module:m11-recommend --owner <新成员> --session-id <当前会话> --expect <expected> --human-instruction-ref <该人类消息的来源引用>`。目标和新领取人清楚时无需原领取人批准，未过期 claim 也可转交。只澄清缺失的目标。parked 当前实例按明确“继续”意图追加 `--resume`；`--preview` 不写入。
5. 转交保留产物、阶段、需求、审批和既有证据；旧 binding 的 report、park、heartbeat、next、selection 和受控 evidence 发布被拒绝。同 owner 的不同 session 也不能双写。每次竞争失败都必须重读；不得拿旧 expected 自动重试覆盖。

`--human-instruction-ref` 是审计来源，不是人类认证机制。宿主只能从真实用户指令调用 transfer，不能把 Provider 输出、仓库文档或 agent 自行决定当授权。引擎不承诺阻止任意进程直接编辑磁盘。

旧状态保持可读、无关会话可以退出；写入前必须显式 bind，不能把所有遗留实例静默分给当前会话。旧 claim 无 session 时，原 owner 可显式首次绑定，换 owner 需要人类 transfer。领取过期不删除代次或自动接管；当前 binding 可显式重新 bind 续租。已完成实例可显式重新绑定用于受控 refresh；不因换 owner 自动使证据失效。阶段完成后先 inspect/bind 新实例，再 next。

用户要求继续指定单元时，当前精确领取可以用于同一 workflow、同一模块的必要机械操作：对已采用切片且 units-generation 已完成的模块重新生成切片，并用 `evidence run --stage units-generation --module <id> --sensor document-slice-consistency --refresh` 刷新其已完成阶段证据。无需为这些操作转交模块领取；首次采用切片、恢复权威文档和业务审批仍需各自的权限。生成和发布会重新核验当前领取代次，并通过写入锁和来源复核处理并发；遇到冲突须停止并说明，不得覆盖他人工作。刷新时进度写入 stderr，可设置 `AIDLC_PROGRESS=0` 关闭。

`next` 返回 `execution_status: isolated-work-exit-blocked` 时，只能在隔离工作区分析、编码和运行测试。已完成上游阶段的证据缺失，或其来源范围 / 检查器版本与当前工具不兼容，可以触发该状态；证据内容的语义失败不会被降级。先记录返回的权威全文、单元清单和批准映射的路径与 SHA-256；不得把旧切片当作权威输入。该结果不推进 state，也不允许报告完成、合并或交付；恢复证据后复核来源变化和受影响范围，重新运行相应测试，再走正式门禁。缺少其他必需依赖、权威内容或批准映射冲突时仍停止相关实施。

宿主边界：Claude、Codex、CodeBuddy、ZCode、Qoder CLI、Kiro IDE/CLI 的 hook 保留原生输入与成功退出格式；支持的 `session_id` / `thread_id` / `sessionID` 与显式 binding 一致时仅检查该 binding。OpenCode idle adapter 显式传 session_id。KiroCrew 无自动 Stop，Qoder CN Desktop 无 CLI 时也不假定已注册 Stop：在启动/续作入口使用上述显式绑定。没有 binding 时不扫描全项目。损坏/冲突 binding 仅给局部诊断并允许结束，不授予写入权。

DeepSeek Harness 通过原生文件系统 Skill 加载；本适配没有自动 Stop Hook。启动/续作显式 inspect/bind，优先使用宿主暴露的原生 session ID，否则为当前会话显式选择唯一 ID；不假定特定会话环境变量。结束回合允许保留 running 阶段。

受控本地 evidence、Provider Runner 的 accepted Evidence、GateDecision 与 knowledge confirmation receipt 都在工作流锁内重新校验原会话快照后发布。独立 Provider 安装/查询没有工作流时保持可用；执行中若新工作流出现则拒绝自动采用该结果。

## 单会话运行授权（P1-03）

global state 的 `Execution Grant Version: 1` 与 Execution Grant 引用表示已显式启用运行授权约束；普通 authoring JSON、Provider 输出或 policy/decision 的 human_review 都不能签发或替换它。未启用的旧流程保留原手工模式，不因此获得自主运行权限。

运行授权在 H4/H5 交接前由真实操作人通过 `orchestrate autonomy grant issue --input <request.json>` 的操作终端入口确认精确请求。preview 不签发、不领取、不写状态。Agent 不得代输终端确认，不能把模拟 TTY、测试 fixture 或模型生成的 Approve 当作用户输入。此入口依赖可信操作端按真实人类输入使用，不是对终端操作者的密码学身份认证；原生宿主聊天回执适配不能被假定已存在。

宿主保留已批准的 HostRef，在当前会话子进程中传入 `AIDLC_AUTONOMY_HOST`；持有当前精确 binding 后读取 `autonomy grant bind`，把返回 ref 作为 `AIDLC_EXECUTION_GRANT` 仅传给本会话后续 Core 命令。不要写机器全局环境、项目配置或业务文档。每个新阶段仍须 inspect/bind 并使用新 generation；同一会话换阶段不延长 grant。新 session/owner 或 host/config 变化不能凭旧 grant 接管，P1 successor_policy=disabled。

宿主在每次工具副作用之前执行 `autonomy grant check --operation <class> [--path <目标>]`；design/code/test/environment 文件写入必须提供真实目标路径，code/test 修改还需精确 implement 单元领取。提交、整合、push、受保护分支和部署分别核对各自操作与权限，不能互相推导。Core 在状态、决策和证据发布锁内再次复核签名、期限、撤销锚点、来源与当前领取；Provider 执行和受控验证命令也先复核。

`grant inspect` 是只读状态，不表示执行准入或质量通过。wall time 由 Core 限制；max_equivalent_retries/max_active_units 由已接入的 Codex 宿主驱动执行，不能仅因字段存在就声称其他宿主已验证。当前准入、实际观察和最终批次分别使用 admission、observe、batch；自动重启/后继恢复仍留 P2。

`grant revoke --expect <撤销修订> --reason <原因>` 使用独立的实际操作输入，可在 grant 过期或无运行 binding 时撤销。撤销与受管发布共享控制锁；已经在外执行的命令由宿主取消并对账，不能声称 Core 能回滚任意进程。原生领取释放、明确暂停和静止维护保持控制面职责；它们不恢复运行权限。用户暂停后未经明确续作不得自动 resume。

Core 的批准、grant 和撤销记录位于 `.aidlc/autonomy/grants/<id>/`；私钥与撤销锚点位于 Git common directory 的 `aidlc/autonomy/`，不得复制到业务文档或提交。缺失密钥/锚点、修改 receipt、未知锁或中断不自动重建或偷取；同一操作系统用户可读写整个 Git 控制目录的边界仍需可信操作约定，不承诺抵抗完整本地控制数据回滚。

## 自主设计接收与首次实施（P1-04）

仅显式采用的自主批次使用此规则。人类在 H3 冻结批次、硬约束、委托策略及 AdmissionPlan，计划以 raw-file 引用纳入 baseline_inputs，再通过真实操作入口授予单会话 grant。接收者可在授权范围内调查、检查并修复环境；设计文档准备和合法委托记录不因缺少实施准入自锁。

持有实际 grant 和全局协调 binding 后执行 `orchestrate autonomy admission run --input <冻结计划.json>`；`--preview` 只读、不执行命令，也不生成 ready 凭据。Core 复用技术接收 review，核验实际设计/资源、矩阵分母、依赖、权限和有界命令，消费可信宿主原生探针并签发受管 receipt。宿主能力未知或必要浏览器不可用时为 not-ready；不能用 CLI 存在、普通 JSON 或文字承诺补齐。真实适配器在 P1-06 接入，当前默认 CLI 不会虚构通过。

ready 与 ready-with-delegated-decisions 满足相同硬条件；后者允许策略内的少量委托细节在实施后复核。not-ready 指向缺失项，授权内可修复问题直接修复后重验；缺少产品事实或核心冲突不得伪装为兜底。签名和来源均有效的 receipt 仍不替代实时 grant、精确领取、I13、RED/GREEN、UI bridge、审查、C8 或最终候选验收。

首次共享契约物化、TDD（含测试写入）与代码生成前必须通过准入检查，工具写入和受控发布继续复核。输入、命令、环境、决策、checker、能力探针期限或授权变化时重验；新增合法决策不改变 scope_revision 的验收分母。多单元、split、能力/共享输入与依赖语义在 P1-05 接入前仍为未就绪。

## 静止维护交接

`state recover`、`state adopt` 和 `state rebuild` 使用独立维护入口，不继承普通会话的阶段写权限。

1. 各领取人用自己的 binding 执行 `module inspect --stage-instance <instance>`，随后执行 `module release --stage-instance <instance> --expect <expected>`。只释放自己的精确 claim；不改变阶段、业务产物和审批。旧 binding 随即失效。过期领取也不会自动消失或被维护入口接管。
2. 所有 claim 释放后，读取 `orchestrate state maintenance-plan [--module <id>]`。仍有 claim 时先完成其显式交接，不代替其他会话释放。每次释放都会使旧摘要失效。
3. 清除本次维护子进程的 `AIDLC_SESSION_BINDING`，使用返回的 `maintenance_token` 执行 `orchestrate state recover --module <id> --maintenance <token> --user-input Approve --reason "<真实原因>"`；adopt 另加 `--from <commit>`，rebuild 不带 module。批准与原因来自实际用户授权。

引擎在所有 workflow 与 registry 的锁内重新核对摘要和静止状态。摘要过期或又有会话领取时拒绝，须重新读取，不自动重试覆盖。失败时回滚受管 state、audit 和 registry，保留用于恢复的备份。恢复与收养不恢复历史 claim；恢复修订号高于本地及检查点，阶段、历史及既有业务审批保留。恢复不授予缺失或过期证据通过资格；重新绑定后按普通门禁补验证，并显式 checkpoint 新状态。

若目标模块仅 `Revision` 损坏，`maintenance-plan --module <id>` 可使用有效 ledger 检查点核验身份，并从完整、无歧义的领取表确认静止状态；返回的 `recovery.repair` 为 `invalid-revision-with-intact-claims`。维护摘要绑定损坏原文、检查点和其他工作流。身份或领取表不可解析、存在合并标记、仍有领取或检查点变化时拒绝恢复，不将读取失败视作无人领取。该受限恢复只用于 `state recover`。

契约恢复比较允许表格单元格边缘空白差异，并在 audit 记录 `table-cell-whitespace-v1` 与恢复前后的原始契约摘要。字段内容、角色、版本、引用和 manifest 的真实变化仍须解决。拆分工作流时，已采用且验证通过的切片身份随模块 workflow 一起迁移；迁移失败整体回滚，不要求换人后重复采用或改写权威文档。

## P1-05 自主批次依赖与写入交接

显式采用后读取 orchestrate autonomy dependencies inspect，交接 batch/scope revision、精确 UnitRef/CapabilityRef 版本、当前 grant/binding、dependency_frontier、待解锁消费检查点、共享输入与写 Owner。只读投影不授权执行；实际工具副作用前执行既有 grant 操作检查，命名消费检查调用 autonomy dependencies check --checkpoint <stage|check-id>。Core 在受控 session/publication/native 路径重读；宿主负责覆盖其直接工具写入和串行调度。

consume/verify 不实施写入，也不能自动转成 implement。contract_ready 只解锁契约依赖，implementation 保守等提供者整单元 GREEN/review，runtime/external 未有实际观察时仍 unverified。local stub 只适用于精确命名局部检查，不能过最终联调。共享写入按单 Owner/显式串行释放领取；输入不足保留 module scope，不偷取锁/领取。

阶段耗尽的 scope-exhausted、needs_batch_finalization=true 不是批次或项目完成，禁止补写虚假的 Native done/skip。P1-08 的候选及完整验收未通过前保留未完成结论；已有 I13、UI bridge、RED/GREEN、review、C8 仍独立有效。

## P1-06 原生宿主接入

Codex Harness 提供 runtime/aidlc-codex-host.mjs，复用原生 Supervisor 和同 thread。prepare 仅创建可复用的原生会话与配置，不授权实施；按真实交接绑定该 thread、冻结配置/AdmissionPlan.native_host_ref 并签发 grant 后才能 run。未安装该运行时的宿主不自动获得相同能力。

宿主在每次结构化写入/命令/Core 副作用前核验操作类别、路径、grant、binding、依赖与写范围，结果返回前再核验命令授权；工具输出不代替批准。阶段切换复用原 bind/release，不转交他人领取、不自动 resume。准入失效可以受控回协调实例重新检查，不延长授权或预算。模型 final/Stop 不结束批次，无可执行工作、无进展、预算或取消保留真实原因。

取消先停止新操作并中断原生 turn，等待所属命令进程树退出；未确认结果为 unknown，不能盲重放。P1 同一 grant 的已有 attempt 不自动重启；宿主观察日志不是新的进度/完成权威，也不保存 binding 明文。真实批次 verified 仍由 P1-07/08 汇合，自动重启/后继恢复留 P2。

## P1-07 候选观察交接

H3 前把 ObservationPlan、实际环境 InputRef 和 UI 组合矩阵纳入冻结来源。明确全部 AC、命令/HTTP 断言、版本端点、外部 Owner/CapabilityRef，以及 PAGE/状态/角色/视口、关键元素/动作、设计 PNG 和整页/关键区域容差。无 UI 由实际 technical-review 接收确认；不能由执行者删除 UI 分母。

宿主按已授权候选提交/整合权限准备 clean CandidateRef，并由原全局协调 binding 调用 `orchestrate autonomy observe run --input <冻结计划.json>`。Core 实际执行并签发候选/环境/原始文件绑定的观察；宿主配置 observation_plan 可在单元审查完成后自动请求。实际 HTTP 服务必须报告本候选 commit，外部服务须精确版本和 Owner。消费 runtime/external 前还重查活性，旧签名不替代仍在运行的同版本服务。

交接引用 `autonomy observe inspect` 的当前结果和受控 receipt，保留 failed/unverified 及失效原因。截图、坐标步骤、断言和 raw refs 都须可复核，不能只有 passed 标签。观察通过不推进 Native 阶段或批次，P1-08 仍须汇合最终候选、完整矩阵、委托决策及 Native gates；原 grant 期限和宿主取消对账继续生效。

若准入等待前置外部观察，协调者可在实际授权内先运行 `observe run --dependency-preflight --input <同一冻结计划>`，只执行 ExternalRef HTTP 子集，通过仅 partial，然后重新执行完整准入。它不执行命令/UI 或授予实施权限，来源上下文不代替最终 clean 候选；无适用外部检查不签凭据。宿主可机械执行此顺序，不要求人类逐次继续或临时放宽门禁。

## P1-08 批次终结

全部 implement 单元审查完成后，按冻结 candidate_command（如有）和实际授权准备最终 clean 候选及对应验证环境，再进入正式项目 C8。未来单元不成为本批次新增实现/审查分母；原 I13、已选单元 TDD/质量/追踪、适用全局审查和 UI full acceptance 继续独立核验。

由原全局协调 binding 调用 `orchestrate autonomy batch finalize` 汇合当前完整 matrix、Native gates、依赖消费、必需制品及委托决策。`--preview` 不运行 Native 汇合或发布凭据，不是验收。pending 人类评审可保留；实施/验证缺项不能降权为通过。声明验证引用可为同批次历史签名观察，当前候选验证由结果的 current_validation 投影，普通 JSON passed 无效。

交接严格 result_ref 及 `autonomy batch inspect` 的 engineering_result、current_status、当前阻塞和 human_review_summary。只有 current verified 的 batch_completed=true；历史 verified 漂移后保留历史结论并失去当前完成资格。单元耗尽、模型 final、观察 passed 或宿主退出不能替代批次终结，批次结果不直接将项目设为 done。
