# P1-10 框架与评估入口双轴审查

2026-11-10 当前工程复核见 [三项阻塞修复复核](blocker-review-2026-11-10.md)：最终 40/40 回归与三个分发检查通过，新 r10/r14 已完成 H5 前准备。下文保留此前各轮发现和当时状态，不把历史 OPEN 误作当前工程未修复；真实 P1-10 双试点验收仍 OPEN，旧发布页失联触发者仍未知。

## orders-r9 / publish-r13 本轮最终结论（OPEN）

orders-r9 于 2026-11-09 22:38:10（Asia/Shanghai）以 delegated-completion-exhausted / incomplete 退出，操作和领取均已对账、unknown=[]。真实 RED/GREEN/C7、候选和完整 matrix 观察通过，原准入屏障与成功空输出修复已经越过旧拒绝点；但正式 handoff 仍为 revision 1、实施/验证引用为空，无 C8 或最终结果。不得将中间候选或观察的通过当作 P1-10 通过。

新问题一：模型无法稳定从现有可读契约构造合法决策 validation_refs，实际出现不支持字段及“validation must bind a real batch check”拒绝。Core 对字段、真实 check、raw SHA 和历史/当前候选的要求保持正确；应补齐可直接消费的字段形状、真实所需 check IDs 与规范命令示例，不能降低校验或由人类代填决策。当前完整 CLI 工程回调预先知道正确对象，不足以证明模型能按现有公开指导完成此环节。

新问题二：Gateway 的 Core 工具等价键使用参数和 stage_instance，不包含 record --input 文件内容。实际修改提案后仍遇到 HOST_EQUIVALENT_RETRIES_EXHAUSTED；应核对内容变化与真正等价重试的区分，并保证预算键规范化不允许仅改参数拼写或文件名规避重复限制。修复须保留同内容重试上限、原 wall deadline、授权/领取/路径与 CAS 约束。

发布页仍运行，已暴露时长衔接问题：admission-plan 虽声明 900 秒，实际 native host report 由 Core 固定为五分钟，准入有效期取其较早值；约两分钟的真实 RED 若在剩余有效期不足时启动，完成后会因准入到期拒绝。当前曾在模型修正测试后正常重跑，仍在执行结束处遇到真实 expiry。需要区分操作前可运行窗口、重新预检时机与失败重试记账，不能延长旧 grant、修改旧收据或把已执行却未发布的结果当成 accepted RED。

最终发生宿主失联：publish-r13 最后事件为 22:54:24.919，其后确认窗口 PID 39968、已记录服务 PID 与对应端口均不在，未见实际 AI-DLC 宿主进程。没有正常 exit 或控制器 result，workspace-detection 与 code-generation 两个领取保留，原生 turn 最终状态 unknown；130 项有日志的操作均有终态不等于完整取消/领取对账。用户确认未主动操作，目标时段未返回匹配崩溃或电源事件，中断原因仍未知。不能将它包装为正常 incomplete 退出，不能手写退出或重建 binding。

最终 [interrupted-attempt-audit-1794236912565](interrupted-attempt-audit-1794236912565/result.json) 已核对 578 个公开原始文件、两份真实签名、RED 输入、订单三份签名矩阵和发布页 90 次通过的十组合像素片段；297 工具来源保持授权前 63488681fff2a56f672440bbc38301e98b5943230e8464a8516cb16e8dec29d1，根状态原摘要与控制路径缺席。订单档案 actual-run、发布页独立 interrupted-run 均未复制私有授权，发布页 actual_exit=null。32 项工程和三个分发检查保持通过，但 P1-10/整个 P1 不放行，没有 verification.json。

以上新增项保持 OPEN。应补齐决策 schema/真实 check 的可消费契约、内容感知且规范化的等价重试、能力有效期与命令窗口调度，以及宿主持久身份、生命周期和失联对账。当前没有修改冻结运行来源、恢复 attempt 或自动清除未知领取；P2 接管恢复未提前实现。

## orders-r8 / publish-r12 退出后的本轮复审

状态：修复来源的完整 32 项工程轮、三个分发检查与最终操作端核对均通过；真实业务退出仍 OPEN。证据见 engineering-1794232442296、distribution-1794233729366、operator-readiness-1794233768446，297 工具来源保持 63488681fff2a56f672440bbc38301e98b5943230e8464a8516cb16e8dec29d1，原文已归档。审查模式仍为同一主 Agent 的 INDEPENDENT_DUAL_AXIS，无独立子 Agent 声明。上一轮完整 30 项通过不足以证明本次暴露的路径。

原始事实：订单 C7 和候选提交后，完整观察因准入到期失败；发布页真实 GREEN 12/12 后，单阶段成功空输出被宿主错误记为失败，随后准入到期与等价重试耗尽阻断。两次均 incomplete。先完成 ended-attempt-audit-1794231674913，核对 412 个公开档案、授权签名、RED 输入、实际关闭/对账、根状态和运行来源冻结，然后才修改运行时。

Spec：宿主在候选、完整观察和最终汇合前检查实际 admission；过期时用冻结计划重新预检，保留已完成候选的来源，禁止因续验重放提交。正常路由准入刷新仍保留真实能力探测与失败结果；仅已对账 Core 的 ADMISSION_INPUT_CHANGED 竞态可以按原等价预算有界处理。单阶段生产者 exit 0 空 stdout 只表示命令完成，明确 evidence_verified=false，不代表 Native 门禁或业务验收通过。

Standards：原授权到期、撤销、claim 校验、原 wall deadline 和资源预算均保留。未知操作阻断续验/提交/汇合，未知进程错误不重试；缺计划、畸形 inspect、不支持能力和真实业务失败继续关闭。没有接管旧 attempt、替换 RED 输入、伪造人类批准、放宽 Core 数据或写入契约。新增十二项准入屏障和十一项传输边界通过；隔离真实公开 CLI 实际复现单 GREEN 成功空输出并核对委托写入拒绝/允许，工程模型/设计安排均不冒充真实业务试点。

- 状态：DONE；限当前工程变更，不表示 P1-10 两个业务批次已完成。
- 模式：INDEPENDENT_DUAL_AXIS。Spec 与 Standards 分别形成结论；执行者为本次 Codex 主 Agent，同一上下文，无独立子 Agent 或另一审查人员声明。
- 影响域：公开 CLI 操作终端、Codex 模型/工具桥、写入与凭据边界、Native 来源身份、Chrome 启动、测试隔离、独立试点评估入口。
- 规格：总体设计第 15.3.3 节、契约第 18 节、P1 实施记录第 22 节、common-session-handoff 与 common-autonomous-execution；保留原 C7/C8 和完整 UI/UC-D 门禁。
- 当前验证来源：engineering-1794204912961 的 21 项检查、source-stability.json，distribution-1794204890193 的构建/一致性/smoke，以及 operator-readiness-1794207507236 的实际工具摘要复核、14 项评估完整性场景、类型检查与原始输出。工程记录均明确 business_verified=false。

## Spec 结论

当前框架变更符合单宿主、单会话、有限批次的契约。操作端必须获得真实终端输入，预览与设计批准均不签发运行授权。正式 next、原绑定、当前 grant、预算和每次副作用检查共同控制写入；模型 final 不构成完成。最终补录只处理 Core 明确列出的制品/决策引用缺项，不能豁免 Native 或 UI 失败，也不能代填人类复核。

两个试点保持独立工作流和冻结验收。订单覆盖原值、边界、真实 HTTP、真实超时和原错误身份；发布页保留聚合 AC、十二个故事 AC、真实状态及十个 UI 组合。真实候选仍须 Native RED/GREEN、C7/C8、UI full acceptance/alignment 和 Core 批次汇合。两份 H5 尚未签发，正向业务结果、最终 CandidateRef 和事后交付包仍待真实运行。

## Standards 结论

路径检查拒绝链接、穿越、私有控制目录和 Windows 尾随点/空格别名；Core 对冻结输入及其父目录、实际文件身份作额外写保护。模型和业务命令环境移除四类私有授权变量，Core 桥保留实际凭据。公开 JSON 对模型脱敏且保留原始文件摘要，原始工具返回和拒绝可定位。子进程有原期限内的超时及取消对账；未知操作不释放领取，不重建凭据。

最终工程轮采用受控进程、独立临时项目与两个工作进程；297 个 Core/CLI/宿主来源文件在验证期间及操作端准备前保持一致。未采用模式兼容与选定分发均有实际 CLI 回归。根目录的无关 state/audit 保持原摘要，未在根仓库创建授权、宿主 attempt 或自主控制证据。

## 问题与复审

| 问题 | 严重度 | 修复及当前证据 |
| --- | --- | --- |
| 公开 CLI 管道丢失 TTY、父 readline 竞争输入 | 重要 | 仅实际 issue/revoke 继承真实终端；父入口不读取 stdin。orders-r2 实际终端签发及 CLI 选择回归；不把聊天反馈当授权 |
| 业务/模型进程继承私有环境、证据读入口不足 | 重要 | 四变量移除；有界公开证据/规则读入口、原文 SHA 和真实工具结果记录；native_host/readiness 与 integrity 回归 |
| 文档操作可误标源码写入、冻结输入缺少外部写保护 | 重要 | 文档目录/格式约束、命令写范围同检；Core 拒绝冻结文件、父目录与别名，49 项授权场景通过 |
| 预览误开实施许可、补录范围与清理不明确 | 重要 | 只接受精确正式路由；补录关闭代码/测试/阶段报告；实际持有 binding 经 CAS 清理，unknown 保留；readiness/completion 回归 |
| H4 后增故事、原值快照太迟、测试目录归属缺漏 | 重要 | 故事先于 I13；调用前原值快照和真实 upstream；模块纳入 tests，采用前调用现有 evidence scope 校验。旧失败保留；新的 14 项完整性检查通过 |
| 聚合 AC 引用了非定义位置 | 重要 | 聚合 AC 与 GAP 指向原始 pilot/spec，十二个故事 AC 保留 canonical 定义；真实 ScopeReader 遍历全部覆盖引用并拒绝错误源 |
| 阶段名误识别为页面、Chrome 端口读暂态、NA 文档切片证据自拒绝 | 重要 | 页面词边界统一；原截止内只重试 ENOENT/EBUSY；NA 同样带真实 workflow/module/scope 身份。实际 producer→Native gate 与 UI/启动回归通过 |
| UI 回归误用真实根仓库 | 重要 | 分支移到临时项目，fixtureEnvironment 拒绝真实 repository；按预先摘要精确恢复本次测试污染，原始污染字节和复验保留 |

当前工程范围没有未解决的重要审查问题。P1-10 退出仍受实际业务试跑约束：两个项目尚未取得最终 verified，不能依据本审查或工程夹具放行整个 P1。两项目均为单交付单元；不据此声明真实多单元连续交付、其他宿主或 P2 恢复能力。

## 实跑后的第二轮复审

orders-r4 / publish-r7 的真实失败揭示两处准备缺陷，均为重要问题：Native 命令绝对路径违反其既有 allowlist 契约；观察计划只断言 passed 标志，并混入页面 covers、漏掉浏览器和重复资产引用。旧运行及失败没有被覆盖，操作/领取均已对账。

修复保持 Core 的原拒绝条件：Native 使用合法 PATH 入口，观察断言实际状态/业务字段/导航结果，页面绑定与验收覆盖分开、明确 Chrome、八个唯一资产仍对应十个组合。Core 新增只读 `previewObservationPlan`，复用执行路径的同一个 prepare，只输出范围、ID 和来源，不执行命令/浏览器、不发布收据/创建 key。准备端额外调用既有 Native 解析器和 admission preview，缺少真实 grant 时整体仍为 not-ready。该函数没有另开宽松校验或授权入口。

当前来源验证见 engineering-1794209345020（297 文件保持一致）：21 项通过；新增预检测试的首轮 fixture 误选不存在的 command，修正为实际非 UI HTTP check 后三个场景通过，原失败保留。操作端准备复核 operator-readiness-1794210174707 保留定向复验完整原始输出、当前测试摘要与全部 22 项有效结论，不把首轮全通过记为 true。15 项完整性、类型检查及 distribution-1794209949229 的三项分发检查通过；一次并发清理分发目录 EPERM 原始失败保留，回归进程结束后重建通过。

Spec 复审：完整十三项验收与十个 UI 组合保留，两个新未授权项目无预供实现/测试、无旧 grant。Standards 复审：只读校验前后临时项目字节完全一致，错误断言/页面引用继续拒绝，当前两项目真实未授权启动仍拒绝。修正后的 orders-r5 / publish-r9 全部授权前检查已通过，当前工程范围无遗留重要审查问题；实际业务 verified 仍未取得。

## 第二轮实际退出后的复审

orders-r5 因宽作用域刷新、准入到期及真实能力探测超时未完成；publish-r9 因 functional-design 将描述性文件名也当作另一用例而未完成。两个真实失败已保留，操作、领取和父控制器服务都已对账结束，之后才调整工具来源。

Spec 结论：功能覆盖归一到 I13/unit_refs 使用的正式 ID，仍逐项拒绝真正缺项，并列出缺失清单；没有通过删用例或改设计绕过门禁。确定性的 Core 派生诊断由宿主执行原命令，模型继续负责实际设计、代码和审查，不能把宿主刷新冒充模型调用。新批次在 H4 委托登记后刷新接收证据；900 秒准入期限在既有上限内定稿，仍受原 grant/能力观察约束。

Standards 结论：原生并发工具在最多 32 项队列中串行执行，每项仍进入既有工具前检查；错误不污染后续队列，溢出在派发前拒绝。仅真实 HOST_TURN_TIMEOUT 可在原重试预算内重新执行能力探测，其他失败继续停止。派生刷新期间 readyInstance 为空，不开源码权限。当前业务试跑尚未开始，不以工程回归判定完成。

验证见 operator-readiness-1794213892625：297 个工具来源与 engineering-1794212736208 保持一致；完整轮 21 项通过，旧宿主 fixture 未适配新调用方式的失败经全部 35 项路由复验通过；完整两单元后续 RED/GREEN/审查流程超出十分钟预算，其超时保留，针对本次改动的 FD-only 范围、描述性文件名和缺失 ID 拒绝通过。该定向结果没有被表述为完整两单元流程通过。17 项完整性、类型检查、最新十种 Harness/2948 文件一致性及三个分发检查通过。当前修复范围无未解决重要问题；完整业务退出仍待 orders-r6 / publish-r10 实际 H5 后验收。

## 第三轮真实运行发现（待修复复审）

orders-r6 的真实 RED、GREEN 和 C7 通过后，最终汇合仍未完成。两项重要问题推翻了上一轮工程检查对这段路径的充分性判断：真实公开空预览为 `kind=print, preview=true, stage_instance=null, next_stage=null, next_stage_status=none`，没有 fixture 提供的 `execution_status=scope-exhausted`；候选阶段写入交付文档后，单独刷新 test-quality 时，其 GREEN 仍绑定旧的宽来源作用域。Core 对错误实例和过期来源的拒绝是正确边界，不应通过降低门禁消除。

新增 `test_native_host_core_convergence.ts` 用隔离临时工程、真实公开 CLI、真实 Native 命令与观察复现：工程 C7 后实际收到上述空预览，现有宿主没有进入正式 C8，回调前 readyInstance 未开启。工程模型/审查与阶段安排明确为 fixture，不能当作 Codex 业务证据。准备复验还将覆盖候选处理返回协调实例后重新精确选择 C8，以及刷新依赖顺序；测试本身的 tsx 路径与原持有 binding 适配失败均没有被计为通过。

2026-11-09 09:31 UTC：publish-r10 仍在原工具来源下运行，真实 GREEN 十二项已通过。Core/CLI/宿主来源在本轮结束前不修改；以上两项重要问题尚未修复，当前 P1-10 不能退出，旧审查结论不构成当前最终放行。

## 第三轮退出后的修复复审

状态：当前工程修改 DONE；P1-10 业务退出仍待两项实际 verified。模式保持 INDEPENDENT_DUAL_AXIS，由同一主 Agent 分别检查 Spec 和 Standards，不声明另一位审查者或子 Agent。真实订单/发布页失败、原工具返回、原 RED 字节与新测试差异均单独保留。

Spec：实际空预览只代表局部无下一阶段，全部 implement 的 C7 完成后在候选处理之后重新精确选择 C8，正式 next 继续判定门禁。完成代码生成的派生摘要失效由 Core 指定唯一阶段 all-sensors refresh，先执行真实 GREEN；普通语义自动补齐仍保留不重复测试的原约束。完整 CLI 回归进一步暴露最终汇合的 I13 来源失效，现由 Core 在 directive 产生实际 Native 修复建议，宿主使用同一受检入口、原预算和计数有界执行，不修改已签名结果。真实功能/准入失败与人工门禁不能被此修复消除。

Standards：所有新增修复命令仍来自 Core，经过原 grant、binding、操作与预算校验；刷新期间 readyInstance 为空，不授予源码写权限，不接管已结束试点。历史 TDD 输入约束没有降级，只增加实际变化路径以便定位。发布页的正则修正确实改变 RED 测试，旧结果保持 incomplete；新增指导不能被当作业务成功保证。工程 CLI 回归明确安排 Inception/审查/模型，正常模拟 report 后清空当前实例并用原持有 binding 释放领取，未把这些 fixture 带入实际准备/实施。

验证：engineering-1794218305792 的 27 项工程检查全通过，297 工具文件在整轮前后保持一致，摘要 a3b058b7ec5e243b6f6bdb6d459413a4156d5736c6776b69165251dd09f0b803；真实公开 CLI C7→C8→Native 修复→签名汇合回归通过且 RED/测试字节不变。36 路由、8 完成、10 准入/预览边界场景通过。FD-only 用例范围明确，旧完整两单元 timeout 未改为通过。distribution-1794219164259 的十种 Harness 构建、2948 文件一致性及三个选定分发场景通过。最终 operator-readiness-1794219368613 核对日志、当前工具、当前真实无 grant 拒绝、两新请求与根 state/audit 原摘要及控制路径缺席，全部通过。

当前工程范围无未解决的重要问题；两项真实业务还没有 verified，因此本复审不放行 P1-10 或宣称完整 P1 已验收。新的 orders-r7 / publish-r11 已完成真实模型 H4 兜底计划、最终来源下的接收生产者复验与所有授权前检查，尚无 H5 和实施代码。原实际设计批准按逐字节审阅快照正常记录，没有重问或复制批准行；P2、其他宿主、真实多单元交付与生产部署均无新增完成声明。

## 首次启动前的显式操作重试复审

用户在第二份请求空按 Enter 后明确要求重试。实际记录显示订单授权已经签发、发布页拒绝，父进程正常释放领取并关闭服务，未派发 Native 运行。本次仅调整评估入口：原授权仍有效且没有 attempt、派发标记、实施文件和现存领取时，明确 retry-unstarted 才允许原会话通过正常 Core bind 新建领取，随后 grant bind 验证同一个签名 ref。原 generation 没有重建，原期限、宿主、范围、操作、预算和来源均不能变化；已有 Native attempt 或任何派发记录仍拒绝。原签发日志保留原时间和摘要，不在新控制器中伪造再次批准。

Spec 与 Standards 分别复核通过：这是原会话尚未开始的首次实施，不是恢复已结束运行或后继。Core/CLI/宿主 297 工具文件未修改；27 项原工程轮与分发结论保持来源一致，新增十二项正反场景、类型检查和实际只读核验见 operator-retry-readiness-1794220551368。首次测试的输入路径误取 fixture helper 函数属性，修正为实际 grant 输入路径后全部通过，未把原失败记为成功。未来归档同时保存原操作端日志，最终验证按实际签发链计数，不将保留授权计为新批准。

发布页随后于 2026-11-09 18:40:29（Asia/Shanghai）真实签发，订单同刻首次派发并通过准入进入 TDD。此时两个业务结果仍未 verified；运行期间工具来源继续冻结，本复审不构成业务放行。

## orders-r7 实际拒绝后的新增问题（OPEN）

订单连续完成 RED、GREEN、代码生成和 C7，实际 C8 构建/三项测试也通过，但 C8 完成要求已登记委托决策具备实现和验证引用。模型首次以正确的 design-write 写 delivery/decision.json 时，Core 返回 `DEPENDENCY_NOT_READY: business writes require an exact implement unit`：此时宿主领取的是项目级 C8。后续换成 decision-record 或省略 operation 都被网关 schema 拒绝，未发生写入，最终 no-progress/incomplete。根因是宿主只在 C8 完成后进入精确单元的元数据补录，而合法委托缺项在首次 C8 门禁前就必须处理；不能通过放松全局写入权限解决。应补充带真实 H4 未完成决策的公开 Core CLI 集成回归，覆盖 C8 前按精确单元补录、重新准备候选/观察，再进入 C8。

操作端另出现 Windows 控制台选中文字暂停，标题经实际进程核对为“选择 …”。订单已发布完整退出且运行进程退出，父控制器在同步终端输出处暂停；仅对该操作窗口发送 Escape 解除选择后，父控制器正常记录原 incomplete 并首次派发发布页，私有上下文仍由原父进程持有，没有恢复 binding 或重启订单。无关 WeChat 进程经只读识别后未操作。后续应让运行日志落文件，避免终端选择阻断两个独立试点之间的调度。

截至 2026-11-09 19:10（Asia/Shanghai），发布页仍按原工具来源运行，Core/CLI/宿主代码不修改。以上宿主衔接问题尚未修复，原 27 项工程通过不足以放行该路径，P1-10 仍未退出。

## 本轮结束后的修复复审（工程验证进行中）

两项真实运行及父服务均已结束，先完成 [实际退出核验](ended-attempt-audit-1794224298126/result.json)，确认 542 个公开档案摘要、两个实际 grant 签名、RED 输入和根工作流原摘要，297 工具来源在结束时仍与原工程轮一致，之后才修改宿主。发布页的真实 GREEN 12/12 和 C7 取证未构成阶段/批次完成；实际退出为原截止时的 HOST_TURN_TIMEOUT，旧结果保持 incomplete。

Spec：补录从唯一的 C8 后入口前移到首次 C8 完成之前，要求所有 implement 单元已完成 C7 且实际完整矩阵观察通过。由 Core decisions 指定合法缺项和受影响单元，正常 select 获取精确单元 binding；只开放授权文档、决策 API 与验证，补录后重新准备候选和观察。观察返回协调实例产生的局部空预览也重新选择 C8。既有 Native、冻结验收分母和最终 current_validation 不降低，人类 rework/block 与实际观察失败继续阻断。

Standards：按单元计等价重试，始终受原 wall time/授权截止约束；finalizing 在 finally 复位，不留源码/测试或阶段报告许可。声明的 runtime-observation 文件摘要复用原 raw-file 契约，历史声明与当前候选验证分开。公开 CLI 工程回归在 fixture grant 之前登记真实结构的 H4 待实施决策，通过实际受检写入、handoff CAS、Native 命令、受控观察和 Core 签名汇合验证；其中模型/审查与前置阶段均明确安排为工程夹具，不计为真实 Codex 业务通过。

操作端改为独立进程/环境/根目录/会话/grant 并行派发，每个批次仍一个活动单元，Promise.allSettled 等两项结束后才清理服务。相同 root/thread/run/workflow 在签发前拒绝。运行流直接保存在文件，最终终端输出放在清理之后，避免控制台选择阻断运行对账。该代码未在旧运行中热更，也不证明真实多单元并发、跨会话恢复或 P2。

新增七项调度正反例和真实单元写入边界检查已通过；36 项既有路由夹具补齐新 decisions 读取响应后通过。新增完整 CLI 回归首轮另暴露夹具问题：准入应明确预期 ready-with-delegated-decisions；正常续期后只能使用宿主持有的新协调 binding；模块 src/tests 归属须在采用前声明。修正限测试夹具，未把旧 binding 拒绝或测试目录越权改为生产许可。首次 CLI 回归正确重现“补录前就进入 C8”的失败，原始输出保存在 delegated-before-fix-1794223681694；首轮夹具与回归失败不计为通过。

当前 30 项工程轮和定向复验仍在进行，尚未宣布当前来源完整通过。两项真实业务均无最终 verified，P1-10 与整个 P1 不放行。

## 本轮最终工程复审结论

状态：上述宿主衔接修复在工程范围 DONE；真实 P1-10 退出仍 OPEN。模式仍为 INDEPENDENT_DUAL_AXIS，同一主 Agent 分别复核 Spec 与 Standards，不声明另一位审查者或子 Agent。

证据见 [post-run-validation-1794225940122](post-run-validation-1794225940122/result.json)：整轮 30 项中 28 项通过，路由缺失 decisions 响应、预先决策夹具未声明 tests 归属两项失败保留，经 [定向复验](delegated-supplement-1794224965074/result.json)全部通过；full_round_all_passed=false，30 项有效结论通过。完整公开 CLI 实际通过 C8 前补录、重新候选观察、C8 和 Core 签名汇合，RED 与测试字节不变，human_review=pending。七项调度正反例、真实 Core 写入拒绝/允许、36 项原路由、授权/准入/依赖、真实浏览器与 Native/矩阵等检查通过。FD-only 的边界保留，不声称旧完整两单元流程通过。

297 文件来源整轮与复验一致，摘要 a712110d3cfd85d9cb30cb4c41c088634b8a77db21ce0769ca97d4e2c4b444ac；[分发验证](distribution-1794225842814/results.json)的十种 Harness、2948 文件一致性和三个选定检查通过。CRLF 感知 diff --check 通过。汇总再次核对两个实际档案全部摘要与本轮原工具 297 文件的逐字节归档；根无关工作流保持原 state/audit，未创建根自主授权或 attempt。原空 Enter 的实际拒绝另有独立摘要指针。

本次工程范围没有遗留的重要修复项，两个真实试点仍均 incomplete，不能把上述工程回调的签名通过代替真实 Codex 的最终验收。旧授权到期、attempt 已结束，P1 不支持重启或后继；后续新工作流与真实 H5 必须重新验证修复来源，P1-10 与整个 P1 不放行。

## orders-r8 实际运行新增发现（OPEN）

实际 C7 和候选提交/服务重启均已完成，随后完整观察被 ADMISSION_INPUT_CHANGED: receipt expired/clock invalid 拒绝，宿主未更新准入而直接 incomplete。Core 的到期拒绝正确；宿主只依赖普通 next 路由中的 autonomous_admission 字段，遗漏完成单元后的局部空预览和直接 observe/finalize 路径。当前完整 30 项通过不能覆盖这个时间边界。

admission-expiry-reproduction.ts 以候选成功后到期为固定条件，实际重现从 driveBatch 的直接 observe run 调用退出，原失败见 admission-expiry-before-fix-1794230712023。需要在非实施路由的观察/汇合检查点明确检查准入，必要时用原会话、原 grant 与原 wall budget 重新执行真实预检；已完成的提交和未知操作不能因准入刷新被重放。还需覆盖元数据补录后的凭据变化、到期竞态、真正准入失败与原授权/预算到期拒绝。发布页尚在运行期间，工具来源不修改，当前此重要问题未修复，P1-10 不放行。
