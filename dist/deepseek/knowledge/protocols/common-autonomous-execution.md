> 适用范围：以下强制路由、凭据和状态写入规则仅适用于显式选择的旧受管引擎。默认实施遵循 [宿主执行协议](host-execution.md)，不加载本协议作为开工或续作门禁。业务质量要求仍按任务需要使用。

# 自主批次实施协议

## 自主宿主执行摘要

只有显式采用的有限批次、有效 ExecutionGrant、当前精确 session binding 与 Core 准入共同成立时才实施。人类已确认的设计和硬约束不变，常规阶段无需逐阶段确认；真实 block/choices、缺少权限、未知资源仍停止。宿主负责调度，Core 决定阶段、返修与完成；模型只执行当前指令，完成 report 或收到 return_control_to_host 后立即交回宿主。

缺失的兼容实现细节只按已批准兜底策略委托，记录理由、实现和真实验证，human_review 保持 pending；业务范围、接口、验收与生产授权不能委托改写。决策提案只写 Core 的 proposal_path，记录前读取当前完整 write_contract 与精确引用。最终批次需当前候选、Native 门禁、完整验收矩阵、委托记录全部汇合，不能把单项通过或模型总结当作完成。

保持原期限、预算、RED 和失败证据；代码缺陷、测试缺陷与范围变化交给 Core 分类。合法长命令使用现有窗口判定，可执行证据返修按原预算续验；重复无进展停止，不靠加步数、改过期时间或刷新收据伪造进展。资源必须有归属、有界等待和实际退出对账；终止信号不等于退出。未知状态保留证据与领取，不自动接管。

按需阅读本协议中适用的委托、候选、续验、资源或 P2 章节；P2 仅在原授权允许的检查点/后继契约内执行，不能自行换 thread 延续授权。规则摘要、证据摘要及未变内容引用只减少模型阅读，所有完整校验仍由 Core 执行；detail="full" 可取得必要原文。

## 内容核对与控制成本

公开文件 read/rule 使用宿主路径隔离、原期限、取消与预算检查，不为每次只读调用请求 Core 的业务操作许可；写入、命令和证据发布仍执行原授权和门禁。一次只读 prepare 批次可以复用已验证的冻结输入摘要，不能跨工具执行或发布复用许可。局部证据核对使用局部内容摘要，生产证据和最终候选保留完整所需版本绑定。

Core 不规定模型选择与通用并行调度；Harness 负责实际工具与 Supervisor。当前受限 Codex gateway 仍是已实现的适配方式，未具备可信工具拦截和审批来源的其他宿主不能被宣称已经支持原生自主执行。

本协议仅适用于 global state 已显式采用 `Autonomy Contract Version: 1` 的有限批次。采用、范围投影或本协议都不授权执行；实际操作仍要求有效的同会话 ExecutionGrant、精确 binding、当前准入与原 Native 门禁。未采用的 workflow 保持原路由、模块选择和审批规则。

## 人类交接与执行边界

人类在 H1–H3 确定本次批次的场景、implement/consume/verify 单元、全部 AC/UI 分母、业务硬约束、明确决定、依赖/写入 Owner、资源及具体委托兜底。Agent 完成接收/预检；真实操作端在 H4/H5 签发运行授权后，由选定宿主持续执行。无需先完成整个项目设计，也不在实施中重新逐项询问已冻结内容。

当前实际持续入口是 Codex Harness 的 `runtime/aidlc-codex-host.mjs`，复用宿主原生 Supervisor。其他 Harness 共享协议与 Core 分发不证明其已接入同样的工具前校验、预算、取消或真实运行能力。P1 不自动恢复已有 attempt、跨会话继承授权或处理后继接管。

## 无逐阶段人工确认

每个阶段都重新读取正式 directive 和精确实例，完成产物及真实证据后 report，再进入下一阶段。`approval=notify/none` 的摘要、handoff_prompt 和 next_stage_prompt 用于观察与续作，展示后继续，不请求“是否继续”或为普通计划再造批准。阶段规则或模板中的“收集回答”“解决歧义”按下列分类执行；不能用文字模板把 notify 升级为 block。

1. 已有明确决定或真实来源：直接读取、核验和引用，不重复问答，不反转决定。
2. 约束内普通工程细节：遵循既有规范、实际代码与写入范围自主实现，不把目录/命名/可逆内部布局选择自动升级为产品决策。
3. 策略明确允许的细化槽位或 fallback：用 `autonomy policy/decisions` 核对条款，通过 `autonomy record` 记录所选方案、实现/验证依据与调整计划，先实现并验证，human_review=pending 留待实施后复核。
4. 反转明确决定、改变范围/AC/UI 分母、安全或外部权限边界、来源冲突且无合法兜底、真实 block 审批：保留准确阻断及问题，按现有审批/CR 处理。不能虚构人类回答、批准或验证通过。

Implementation 中如果反复落入第四类，应记录前置设计/澄清缺陷并改进下一次 H3；不能靠不断中断执行补齐本应交接前确定的产品事实。原 `block`、用户明确暂停/审阅要求、grant 撤销/期限、质量失败和权限不足始终有效。

## 冻结范围内的调度

普通 workflow 的多模块选择仍由用户决定。已采用且实际准入/授权有效的批次，宿主可从正式路由列出的目标中，按冻结 implement 单元顺序选择精确实例、调用已有 select/bind 并继续；不重复询问已确认的批次分工。不得选择批次外模块/单元、把 consume/verify 变成实施、领取他人实例或自动 resume。没有合法候选时保留阻断，不能随机挑选。

授权内证据修复只接受 Core 的结构化诊断和当前来源；重试遵循原有限预算。实际进程异常、未知操作、真实批准要求或缺失权限不得降级为“可自动修复”。Core 发布与工具执行前的授权、依赖和写入范围核验继续独立执行。

## 完整交付与终点

### 委托补录的可消费契约

`autonomy decisions` 的只读 `write_contract` 由 Core 从当前策略、矩阵和原决策派生，提供 handoff 路径/CAS 摘要、下一 revision 提案及真实 required check IDs。模板不是新授权或已通过证据。补录保持原身份、effective_revision、治理来源和 human_review；实现引用使用真实普通 InputRef。`validation_refs` 是平面字段 `check_id/sensor/stage_instance/path/digest/workflow_id/batch_id`，不能包成 evidence_ref，也不能混入 repository_id/digest_mode。runtime-observation 必须指向实际受控观察，digest 使用文件原始 SHA-256，不能替换为签名正文摘要。

全部 C7 与当前矩阵通过后，宿主在精确单元补录 turn 中附上 Core 提案及由实际观察读取填充的验证引用；Agent 仍须读取代码/测试、填入实现引用并通过 Core CAS 登记。Core 的真实检查、不可变字段、范围和人类复核要求保持有效。重试按规范化命令和真实输入计数；改参数顺序、文件名、JSON 排版或猜测 CAS 不产生新预算，真实内容变化有独立的有限尝试，原 wall deadline 不变。

### 长命令窗口与宿主失联

新的真实能力探针报告最长覆盖自观察开始起 900 秒，且受原 grant 截止约束；不是延长旧报告或授权。长命令派发前，宿主要求剩余准入窗口覆盖本次有界执行和发布余量，不足时在原协调 binding 内重新预检，再正常恢复同一工作单元和正式入口。新窗口仍不足则在派发前停止。实际 Core 进程超时取原命令、授权和准入窗口扣除发布余量后的最小值，不能发布过期结果或以失败重试代替续验。

宿主对模型请求与直接派发的动作使用同一分类器。metadata 补录只允许 read/rule、受检 design-write、autonomy inspect/policy/decisions/dependencies/record、observe inspect 和 batch inspect；validation-execute 是 Core 操作类别，不代表 metadata 可执行任意验证。冻结命令、evidence run、report、next（含 preview）、observe run（含依赖预检）、batch finalize 和代码/测试写入均在窗口刷新、Core 调用与文件变更之前拒绝。补录后由宿主退出 metadata 回合，按正常受检路径准备候选、观察及汇合。

`tools/data/native-host-action-policy.json` 是 Core 与 Codex Harness 的共享时间策略：能力上限 900000ms、发布余量 10000ms、普通 Core 命令上界 180000ms、阶段生产者上界 600000ms。冻结命令 timeout 加发布余量达到或超过能力上限时，配置在采用/请求 H5 前拒绝；不是静默缩短配置或延长能力。可行配置仍须通过当时真实剩余窗口检查；授权检查后、实际子进程启动前再检查期限。准入刷新使用原 binding/grant/wall budget，不受过期旧 receipt 阻挡；取消对账与持有凭据的普通释放也不依赖旧能力窗口，不提供 P2 恢复。

宿主在既有 host-runs 下持久记录自身/原生进程的 OS 身份、turn 派发/绑定/终态、操作与心跳。PID/日志只供观察，不能替代 session/generation。只读 inspect-run 将进程消失、PID 重用、半条日志和未知 turn 保留为未对账；不得写伪 exit、释放未知领取、重建绑定或重放操作。正常停止先完成工具与实际原生子进程关闭，再以仍持有的精确 binding 清理领取。失联后的接管恢复仍属于 P2。

### 完整门禁

原 I13、TDD、UI bridge、审查、必要全局审查、UI full acceptance 和 C8 全部保留。未来单元不进入本次新增实施分母，consume/verify 的依赖及 UI 消费条件仍核验。不得以替身、截图文件名、exit 0 或普通 JSON passed 冒充完整功能/UI 验收。

同一仍活跃 attempt 中，真实受控 GREEN 或完整候选观察失败可由 Core 的 `autonomy repair inspect/request/apply` 契约决定有界返修。Agent 只提交 code-defect/test-correction/scope-change/unknown 诊断；已登记请求后立即返回宿主。代码缺陷保留原 TDD/RED，测试修正回到新 TDD 周期并归档原 RED/失败，不能减少 UC-D 或测试分母、改动独立验收/视觉基线。宿主只按 Core 的精确失效/回退步骤正常 select/bind，取得正式 next 后再执行；原 grant/wall budget 内最多原重试额度且封顶两轮。Core 在 report/finalize 继续验证新 Native、C7/C8、完整矩阵和历史档案；预期 RED、范围/权限变化、环境/未知失败不产生回退许可。首次业务派发前注册活跃宿主身份，旧 attempt 不能补登记；部分发布未知时停下并保留领取，本返修入口不接管或重放；后继必须满足下文 P2 独立策略。

宿主按冻结 candidate_command（如有）和独立权限准备最终 clean 候选及对应环境，完成正式 C8 和当前完整矩阵，再回全局协调 binding 执行 `autonomy batch finalize`。只在 inspect 返回 current verified 且操作已对账时表述批次完成。failed/blocked/incomplete、失效原因与 human review 分开保留；pending 复核本身不阻塞真实工程 verified，实施/验证缺项仍阻塞。scope-exhausted、模型 final、观察 passed 或宿主退出不完成批次，批次结果不直接设置项目 done。

### 输入身份、委托提案与候选屏障

私有 host context 的 `execution_inputs` 使用 `aidlc.execution-input-identity/v1`。Core 提供当前业务源码及普通文档、规范决策元数据与声明环境的身份；宿主将 Core 的 command_digest、冻结 argv/操作、实际可执行文件字节及声明 input_paths 合成命令重试键。只修改入口脚本清单无法隐去真实源码变化；相同 argv 的冻结别名和纯提交变化不增加命令额度。控制证据输出不形成新业务输入；普通文档保守视作真实输入。准入/探针收据换号、时间和控制日志不进入环境身份，声明变量/可执行文件的当前值仍由 Core 观察。身份不是授权或证据租期，不能跳过 grant、准入或依赖检查。

委托提案只能写到 Core write_contract 的 `proposal_path`；新记录使用 proposal_directory 下的 `<record_id>.json`。暂存命名空间为 `.aidlc/proposals/decisions/<workflow>/<record_id>.json`。仍使用结构化 write 的 design-write 输入形式，宿主将其分类为 decision-record 控制操作；Core 检查原权限和精确实施单元，不开放其他控制路径。Agent 不能直接覆盖规范 handoff；Core record 校验合法策略、来源、引用、记录身份和 CAS 后才原子合并。拒绝的草稿保留在控制区，不进入候选。受管授权下 Core record 拒绝从交付目录发布提案；候选检查还拒绝被强制加入 Git 索引的暂存提案。未采用模式的原记录入口保持兼容。

宿主在一份必要前置观察后，为各精确单元分别取得最新 write_contract/CAS，完成有界元数据回合，再统一准备候选；不能每处理一个单元就重跑全矩阵。Core 的 candidate_input_digest 同时包含真实源码/文档、已合并元数据和当前提交，避免字节相同但服务提交变化时漏掉准备。元数据默认不重置普通命令失败额度，但会使旧候选/矩阵失效；显式声明为命令文件依赖的原文仍参与该命令身份。最终候选必须 clean，实际 HTTP/UI 服务版本、最终完整矩阵、Native 和委托 current_validation 仍由 Core 校验；旧矩阵可以保留为合法历史引用，不能改名为当前通过证据。


### 回合内进度、预算与耗时（IT-03）

Codex Harness 在原 Supervisor、Gateway 和 session 中实施 progress budget，不增加 Core Supervisor。冻结配置 supervision_limits 只允许收紧共享策略上限，纳入 HostRef；原 grant、wall deadline、max_active_units 和等价失败重试不变。总步骤、总回合、每回合步骤、无进展步骤、重复动作、空闲与回合/步骤时间分别检查，实施、补录、诊断共用一份计数。新回合/新输入不重置总额度。

重复识别使用规范动作与稳定结果；回执换号、PID 和时间不算新进展。相同内容成功读取、读不同文件、心跳和 RPC 活动不构成实施进展，不能增加失败重试计数。真实新输入不按同一结果误计，但仍受总步骤与停滞限制。受控源码/测试/设计的新字节记为 work-change，Core 观察到的实际阶段/源状态、合法决策合并、当前候选完整矩阵和返修计划分别记为检查点；重复检查点/字节往返不刷新窗口。work-change 只是实施活动，不能代替 Native、完整验收或 Core 完成判定，持续改写仍受全局与回合额度限制。

实际派发的 Core 命令/冻结命令按其原受检上界登记；等待已知有界操作期间暂停空闲和模型/控制耗时计量，自身 deadline 与原授权总期限照常计算。普通消息、心跳、未派发请求不暂停。超限经既有取消/中断链停止；没有实际 turn/completed 时只能记 unknown 并保留事实，不能把 interrupt ACK、发信号或超时当作已退出。即使模型提前报 completed，也先等待已排队工具和原操作对账。取消等待不延长授权、不发起后继或恢复旧 attempt；资源关闭与未知状态传播遵循下文 IT-04 规则。

同一 host-runs 内新增 execution-trace.jsonl，使用 aidlc.execution-trace/v1：安全动作族、步骤/回合序号、父 span、UTC 与单调耗时、阶段、输入摘要和预算原因；不记录 argv、正文、环境值或私密 binding。对 queue、host-control、model-rpc、producer、browser-visual、evidence-publication、admission-refresh、cleanup 分段；exit.execution_timing 通过区间归属划分总耗时，父子和重叠等待不重复相加。Core 观察器只提供受控检查的单调耗时，不管理执行循环。model-rpc 包含原生/RPC 等待，不能解释为模型思考；监督开始前的时间只记为未归因，不声称掌握人类等待或完整外层资源耗时。



### 资源拥有者与有界清理（IT-04）

Core 只管理自身观察命令/browser/socket/profile；宿主原 Supervisor 管理 Native、worker、service 和 reload。创建即登记确切句柄、资源 ID、原拥有者与截止，使用随 Core 分发并计入 HostRef/checker 的 aidlc-owned-resource.cjs 和 resource_limits。所有等待有界；资源参数只能收紧。业务截止不因清理延长，资源清理不产生新执行权。

终止请求、实际 exit 和 close 分别留证；exit 缺 close 或 kill 成功缺 close 都是 unknown。只操作原仍活跃 ChildProcess 的句柄/树，禁止从 PID 文件接管或向已退出 PID 发信号。unknown 时脱离本进程的流/IPC/定时器引用，保留原始证据、profile 与领取，晚到 close 不自动升级清理结果。Core/宿主/worker 跨层传播 resource_reconciliation；外层 exit 0 不覆盖内层 unknown，完整分母不减，拒绝 current observations、自动返修和业务 verified，不恢复或重启。

有外层 service 的原 worker 必须最后释放领取。Native 仅在自身操作与资源已知结束后，通过当前私有 IPC 将实际持有绑定交给原 worker 清理；身份和 ACK 均受检有界，不写盘、不传模型/业务环境。worker 等 Native、reload、service 全部关闭后，核验 Core 当前最终结果并以原精确凭据释放；缺 ACK/绑定/关闭事实保留领取。此操作只做原活跃 Supervisor 的清理，不属于 P2 接管、凭据恢复或后继执行。


### 选择性预检与能力复用（IT-05）

本节的原观察窗口规则用于未协商能力证明复用的适配器。选定 Codex 使用下文的 run-config 规则；不得将旧观察到期与原授权到期混为一类，也不因旧观察到期反复运行完整模型探针。

采用前可运行 orchestrate autonomy admission draft --batch <id> --input <plan> [--observations <plan>]。它显式传入只读 draft scope，复用正式 scope/policy/dependency/admission/observation 验证器，不改 state、不签发、不领取、不执行项目命令/Native gate/探针或网络。static_result=valid 只表示已声明静态语义，始终 not-ready；授权、活跃领取、依赖实际证据、运行时和功能/UI 仍未核验。已经采用的批次使用原 admission run --preview。

正式 admission 每次仍核验当前设计/依赖/输入/环境、真实 grant/撤销/领取与业务命令。Core 仅允许原 run/batch/grant 全约束、HostRef、配置、checker、原始 probe、必需 supported 能力及原剩余窗口全部满足时复用独立签名能力证据。真实宿主再运行 config/read 轻检并确认资源关闭；匹配且窗口充分时不重跑模型 turn/浏览器。配置漂移、篡改、unknown 或检查期间原授权过期/撤销继续拒绝；仅能力在轻检期间已知过期或窗口不足、原授权仍有效时，按下文续验契约选择一次真实新探测。旧 observed_at/valid_until 不重置；复用时新 admission 不超过旧能力和原授权截止，新探测则使用新能力的实际期限。能力复用不代替业务/Native/完整矩阵，不跨授权或恢复旧会话。


### 控制面与 UI 复用（IT-06）

原 Supervisor 可消费 Core 公布的 host prepare 能力，把同一动作的当前输入身份及原 operation/path 检查合并；核对当前 binding/grant/检查清单/时间/原截止后只在此动作内使用。Core 原授权、撤销、领取、消费与发布检查继续执行；命令后独立复核，模式/预算不变，不缓存权限。旧适配器按未协商路径保持原行为，模型不能直接调用 host prepare。

一次观察或 Native phase 内可复用拥有的 Chrome，每个 case 创建独立 context/page，禁用缓存/service worker，保留真实动作、API、结果导航与完整 PNG/像素标准。声明 case_service 的用例拥有独立服务，前后验证实际候选版本，链路完成才请求关闭并确认 close。旧计划没有该声明时不能声称后端已隔离。context 关闭须同时确认 contexts/targets 已消失；unknown 不重建、不恢复，保留证据与领取。20 秒用例截止、原授权/预算和完整分母保持；输出前关闭全部 phase 资源，按分段实测性能，不把微基准作为整体业务或 Go 结论。
## 续验的继续、重新探测与停止

Core 与选定宿主共同使用 `aidlc.execution-continuation/v1` 的时间判定；它只表达 `continue`、`reprobe`、`stop`，`execution_authorized` 固定为 false，不能替代当前 grant、精确 binding、来源/配置与资源检查。

- `continue`：当前授权/身份/来源及已知资源均有效，能力或准入凭据的原剩余期限足够覆盖当前动作。未过期本身不构成可继续条件。
- `reprobe`：原授权仍有效、当前配置已知且匹配，现有能力已过期或覆盖不足。Core 每次准入最多选择一次真实新能力探测；宿主按原授权/预算执行。保留旧凭据原文和日期，不向人类重复请求阶段确认。
- `stop`：授权/领取/来源/配置不合法、原预算不足、资源未知/仍在途、当前窗口事实未知，或新探测/正式阶段恢复后仍不足。发布锁内不执行探测，窗口在预检或发布期间被消耗时不发布 ready。停止不恢复原 attempt、不清除 unknown、不重置预算。

宿主恢复原精确阶段后须重新取得正式 directive；新增 block/choice 仍停止。最终权限准备后再次校验窗口，该边界最多续验一次并重新做实时权限检查；仍不足时命令不派发，原等价失败计数不增加、不清零。模型与宿主控制动作使用相同边界，继续使用现有 Supervisor，无新增恢复或授权服务。

## 同一授权内的能力证明与轻量续验

可信 Codex adapter 显式协商 qualification_scope=run-config。首次实际探针仍证明模型回合、工具、预算和取消等能力；签名证明绑定原 grant/run/batch、HostRef、配置、必需能力及其原始文件。它的 observed_at/valid_until 是历史观察事实，始终保持原文。后续同一授权内，时间推进本身不要求重复完整探针：Core 校验该证明与原始来源，再执行实际 config/read 轻检和资源关闭核验，生成当前 admission 中独立的 freshness（当前检查时刻及受原 grant/900s 上限约束的期限）。freshness 不改写旧观察，不是权限缓存或新授权。

缺少证明、证明生产/校验依赖改变、必需能力增加时才能选择新的完整探针。配置变化、unknown、来源篡改、原授权到期/撤销继续停止；慢轻检或业务预检消耗当前窗口时不发布 ready。未协商的 adapter 保持原观察窗口规则。真实工具执行、当前精确 binding、预算、撤销、动态资源与最终 Native/业务/UI 验收仍各自检查；不跨 grant、进程或旧 attempt 复用。

宿主续验直接消费 Core run 返回的新受控准入收据，不立即再发一次 admission inspect；最终实时权限与派发窗口检查保持。已经处于协调实例时不重复 select。刚检查通过的当前 admission 可免去重复依赖预检，Core 在重新准入时仍检查依赖；如期间依赖变更，最多补一次真实依赖观察后重新准入。新 block/choice、unknown 和原失败重试/期限约束均保持。

## P2-01 持久检查点基础

`orchestrate autonomy run inspect` 只读当前原授权的检查点链；`run checkpoint --input <file> --expect <head-digest|absent>` 由宿主显式调用。checkpoint 不运行模型、项目命令或恢复操作，也不推进阶段。Core 在原授权与精确 session binding 的发布锁内读取实际 state/source，签名追加到现有受信控制存储；同一 expected token 至多提交一次，丢失响应后先 inspect，不重复覆盖。检查点不包含 binding/generation 明文或凭据。

`aidlc.host-checkpoint-input/v1` 的预算是单调累计观察，不是恢复后的可消费余额。pending/unknown 不能通过改写检查点清除或退回 prepared；未实施操作对账入口前继续保持未决。过期/撤销/错误绑定不能追加。检查点损坏、断链或范围变化拒绝，不把读取失败当空记录。

P2-01 仅建立恢复输入基础，响应恒为 `recovery_allowed=false`、`execution_authorized=false`。不启用 successor、不自动重启、不重建旧 binding，不变更 P1 grant 的 disabled 策略或期限。后续必须完成派发前操作/预算持久化、后继注册/fencing、旧执行者与外部资源对账、正式 directive 重入以及实际自动拉起验证，才能声明 restart-recoverable。旧未知 attempt 不因本命令可用而被接管。

## Native 派生证据续验的有效进展

旧 stageInputs 的 mtime/上游回执时间摘要只用于原证据的刷新判断，不能进入进展 identity。进展目标使用源码范围的内容身份及有专用契约时的内容哈希；相同字节仅更新时间导致的重生成仍去重。

Core 的语义生产器在 `--refresh` 下，仅对原证据不满足当前校验、且受控检查与发布后的证据满足当前复用校验的转换，返回 `evidence_progress`：`version: "1"`、`transition: "invalid-to-current"`、`workflow_id`、`stage_instance`、`sensor`、`identity`。单传感器结果在顶层返回，多传感器结果在各 `actions[]` 中返回。identity 绑定工作流、精确实例、传感器、输入与来源范围、checker/argv 身份和显式 freshness 配置；不包含本次回执时间或 execution UUID。有效证据复用、失败、单纯新回执不构成进展；相同输入目标的再次过期或缺失不能生成另一个进展身份。此字段是当次可信 Core 响应，不是授权或跨进程恢复凭据。

宿主只消费可信 Core 工具通道中成功 `evidence run --refresh` 的匹配结果，核对工作流、命令目标实例、请求的传感器与 regenerated 转换，交给现有 Supervisor 按 identity 去重。首次有效转换可清除无进展计数，重复转换不能；总步数、回合、原授权期限、资源预算和重复动作限制不重置。该转换只证明指定派生证据取得进展，不能代替后续正式 Native 门禁、功能/UI 矩阵或批次完成判定。

Core 可将同一已完成实例中已经诊断为缺失/失效的多个语义派生证据，投影为同一条 `--sensors` 续验命令。宿主选择一次实例、执行一次生产器，再返回正式路由复验；不能自行扩大传感器或单元范围。RED/GREEN/BASELINE、人工审批、真实行为失败、不同实例不混入该批次。生产器仍逐传感器检查当前领取、授权和发布边界；部分失败保留已发布证据，但不返回整批成功或完成。项目级 completed 实例也必须显式携带 `--instance`。



## P2 持久执行与有界后继（2026-11-11）

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
