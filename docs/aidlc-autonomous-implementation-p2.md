# P2 可靠中断恢复实施记录

## 1. 范围与进入条件（2026-11-11）

用户明确要求开始 P2，授权开展工程实现。P1-10 的真实交付仍 HOLD；该事实不因 P2 开工改写。设计中 P2 依赖 P1，现阶段允许基于已实现的授权、session binding、Supervisor 和资源对账接口开展隔离工程验证，整体恢复能力上线仍须满足 P1 交付及 P2 故障验收。旧 grant 的 `successor_policy=disabled` 不迁移，不恢复任何历史失联 attempt，不创建业务试点。

Core 维护授权、run/attempt 身份、领取代次、受管提交和验收事实；宿主承担持久运行、进程/工作树隔离、实际资源与外部操作对账、受信凭据保存及重新拉起。检查点是可校验的恢复输入，不能代替最新 Core 状态、授权或真实进程终态。沿用现有 Supervisor，不建立第二套阶段状态机。

## 2. 实施顺序与验收

| 任务 | 交付 | 依赖与验收 |
| --- | --- | --- |
| P2-01 运行记录与检查点基础 | 版本化 run/attempt/checkpoint；可信存储中的追加式签名链；精确会话下的显式 checkpoint 和只读 inspect | 复用 P1 grant/session；CAS 竞争、损坏/断链、范围变化、撤销/过期、预算观察倒退被拒绝；没有恢复权限副作用 |
| P2-02 操作与预算持久化 | 宿主派发前预留操作/预算，提交对账；report 提交与响应丢失的幂等识别 | P2-01；崩溃不能清零计数、盲重放或重复推进；旧 journal 语义保持，必要变化独立版本化 |
| P2-03 后继授权与 fencing | 新签 grant 显式 successor policy、受信后继注册、expected token CAS、run/attempt/session 绑定与新 generation | P2-01/02；原期限/范围/预算保持，双后继竞争仅一方获权，disabled/撤销/过期不能接管 |
| P2-04 宿主恢复与现场隔离 | 受信凭据入口、旧执行者确认、资源对账、恢复检查点接线、实际重新拉起 | P2-02/03；未知旧进程不共享可写现场；权限代次不能冒充进程已退出；不依赖模型“已恢复”宣告 |
| P2-05 环境重建与选择性续验 | 外部操作查询、服务/浏览器/数据重建、候选与当前证据复核、正式 directive 重入 | P2-04；未知副作用不重放，失效检查不跳过，正常证据可复用，保持功能/UI 分母与像素标准 |
| P2-06 故障矩阵与能力声明 | 各提交/派发/退出窗口故障注入、竞争与预算测试、真实宿主自动拉起探针、分发同步 | P2-01～05；无双写/重复推进/假通过；区分工程恢复与实际业务交付，只对实际验证路径声明 restart-recoverable |

先完成每项相关实现，再集中短边界验证；故障集成从已捕获或精确构造的边界开始，不反复跑业务长前缀。相同来源的通过证据保留，只有相关变更或失败才补验。

## 3. P2-01 契约

命令为 `orchestrate autonomy run inspect` 和 `orchestrate autonomy run checkpoint --input <file> --expect <head-digest|absent>`。P2-01 是显式检查点基础，不自动接入原 P1 循环；后续在 P2-02/04 接入宿主的派发前预算及恢复协议。

输入 `aidlc.host-checkpoint-input/v1` 仅含 reason 枚举、单调累计的 steps/turns/active_elapsed_ms、未决 operation 的 ID/状态/绑定摘要及可选候选 commit。禁止传入 binding/generation、环境变量、凭据、自由文本和结果通过标志。预算字段明确为宿主观察，不是可恢复消费余额；在 P2-02 的派发前预留完成前，禁止据此启动后继。

Core 从当前 grant、batch、精确绑定、实际 workflow revisions 和实际源码读取权威字段；首次检查点生成稳定 attempt_id，之后保持相同 session/HostRef，允许该会话沿正式流程切换精确阶段，但不能根据检查点重建绑定。原授权截止作为硬上限，累计观察不得倒退或超过原 wall 上限。pending/unknown 保留并投影为需要对账，不允许使用“干净检查点”覆盖未知项；结果对账入口在 P2-02 实施前不清除未决项。

检查点存于现有 Core 受信 Git common 控制存储的独立 runs 域，复用签名和发布锁，追加 fsync、连续 sequence、previous digest 和 CAS。检查点与阶段进度分别存储，检查点失败不修改 state/audit。截断/破损记录、非法链接和并发冲突拒绝；整个受信控制存储的外部备份回滚及 Windows 断电目录项丢失不能由单机签名证明解决，仍须对账，不宣称端到端 exactly-once。

所有 P2-01 返回均声明 `recovery_allowed=false`、`execution_authorized=false`。只读 inspect 不需要重新签发 grant，也不把已过期的历史记录变为当前授权。未采用流程 inspect 保持可读、checkpoint 拒绝。真实工具与发布仍使用原授权/绑定校验。

## 4. P2-01 阶段结果（历史快照）

**P2-01 已完成工程实现和定向验收。P2-02～06 尚未完成，尚不具备自动重启或后继恢复能力。** 当前来源为 `2a6fca7f50f10b338ad246905d6a6bbd69f30397b9876da1173dbaf74327f5b7`，747 个来源文件；[验收记录](evals/autonomy/p2-01/acceptance.json)保留源码、原始日志、失败与复用说明。

实际落点：

- `core/tools/aidlc-autonomy-run.ts`：严格输入契约、当前授权检查、scope 内 state/source 快照、单调预算观察、未决操作保护及 CLI 投影。
- `core/tools/aidlc-grant-store.ts`：复用 issuer/发布锁，新增独立 run 检查点签名链；读链校验、连续序号、previous digest、CAS 和追加 fsync。
- `core/tools/aidlc-orchestrate.ts` / `bin/cli.ts`：接入 `autonomy run inspect/checkpoint` 路由和说明；本入口自行检查精确授权，不从外围路由豁免中取得权限。
- Codex `host-kernel.cjs`：仅 trusted host origin 可调用该入口，checkpoint 按 workflow-write 分类；模型 resume/checkpoint 拒绝。没有自动插入 P1 执行循环或新增 Supervisor。
- 源协议、契约和十 Harness 分发同步；检查点不作为语义进展、阶段完成或恢复许可。

验证覆盖 13 个 P2 边界，包括真实 CLI 查询、两个独立 CLI 进程的 CAS 竞争、签名篡改、撕裂追加、旧会话/代次、撤销/过期、预算倒退和 unknown 操作不可清除。Core state/audit 不因检查点而推进。原授权兼容共 49 项通过，宿主调度 37 场景、动作策略及进展检查点回归通过。类型检查、构建、10 Harness / 3049 文件分发一致性及实际 shipped Codex 的 3 个兼容场景通过。

原授权回归初次在第 42 项旧夹具失败：使用 `decision.json` 且未持有精确实施单元，不符合已有提案隔离规则。仅修正夹具：保留全局协调领取签发、预先持有同会话精确单元领取，将提案放入现有 workflow/record_id 路径；decision-only 授权仍不能执行一般 workflow-write。前 41 项保留，使用显式、必须命中案例的测试后缀入口仅补验剩余 8 项，没有重跑此前通过前缀。修正时误用单元领取签发的失败也保留，生产门禁未放宽。P2 竞争夹具的 Windows tsx 入口路径修正属于测试启动问题，未影响生产流程。

最终复审将 state_refs 限定于 grant.workflow_refs，避免记录未授权模块的状态；仅补验 P2 直接边界和类型，未改变的 grant/宿主回归保留。最终类型/构建/分发结果见[最终检查](evals/autonomy/p2-01/validation-1794355029734/final/result.json)，首次集中检查和原失败见[原始结果](evals/autonomy/p2-01/validation-1794355029734/result.json)。

根无关 workflow 的 state/audit、7 个不存在的授权路径、590 个历史输入哈希和 orders-r12 的 82 个公开证据均保全。真实模型运行、业务试点、新实际 H5、旧 attempt 恢复均为 0。P1 的原通过证据仍保留其历史来源；本轮运行源码改变后，不再声称其字节与当前来源一致，P1 真实交付入口保持 HOLD。

## 5. P2-02 启动时目标（历史）

P2-02 的关键是将“观察记录”变成不会因进程丢失而重置的操作和预算事实，不能直接把 P2-01 的预算观察当恢复余额：

1. 为允许派发的操作建立稳定 operation identity、输入/实例/原授权绑定、派发前持久预留和终态对账；新进程不得绕过未决操作。
2. 将 Supervisor 总步骤、回合和可测预算累计接入持久预留；保留原墙钟截止，检查点不清零已消费额度。
3. 单独处理受控 report 已提交而响应丢失：读取 operation 与 Core state/audit，返回既有结果，不重复阶段推进；同 ID 不同输入拒绝。
4. 用提交前/提交后响应丢失、并发、未知外部结果和预算耗尽的短故障注入验证，再接入必要的实际宿主工具传输。P2-03 后继授权尚未启用前，不恢复旧进程，也不声称新会话已能续跑。


## 6. P2-02～06 首轮集中实施（历史快照，2026-11-11）

本轮贯通实现操作/预算持久化、后继 fencing、选定 Codex 独立宿主的有界自动拉起、环境重入及故障验证，不逐项等待人工确认。工程验收与生产能力声明分开：P1 真实交付仍 HOLD，历史授权及失联现场未被修改。最终来源、分层证据与实际能力范围见 [验收索引](evals/autonomy/p2-remaining/acceptance.json)。

| 项目 | 实际实现 | 验收边界 |
| --- | --- | --- |
| P2-02 | Core 签名增量操作账本，派发前预留与资源 spawn intent；Supervisor 的 steps/turns、重复动作、等价失败、无进展及路由返修计数持久化；report operation_ref 与历史同次原子写入/fsync | 丢失 report 响应读取原提交，CLI 相同输入确认不再次推进；不同输入/无提交/未知副作用拒绝；新进程不重置消费 |
| P2-03 | 新签 grant 可显式允许 same-host-session、最多 1～3 次重启；Core expected revision CAS、attempt/token/claim generation 更换 | 原生 session、owner、HostRef、输入/范围和期限不变；旧 token fencing；双真实进程竞争最多一个成功；disabled/取消/撤销/到期拒绝 |
| P2-04 | 复用 Gateway、ProgressBudget、driveBatch，新增 supervise 外层有界拉起；attempt 分目录、私有凭据不传 Native/业务子进程 | 旧宿主及登记的 Native/Core/command 进程实际消失才能续跑；PID 重用核对出生标识；活跃、未知、spawn 窗口不接管；实际 main/Core/脚本 Native 的强制退出重启探针 |
| P2-05 | 精确文件摘要/报告历史/只读观察对账；冻结命令可使用稳定操作 key 与只读 recovery_query，保存原始查询输出；恢复后重走环境/依赖预检与正式 directive | 未知命令不重放；原查询 ID、输入、原始输出摘要必须一致；服务/浏览器重新建立，旧句柄不复用，当前候选/Native/完整 UI 门禁仍由原生产者判定 |
| P2-06 | 短故障矩阵、真实 OS 竞争、重复 report CLI、实际 supervise/main 重启探针、定向兼容与分发检查 | 工程证明不等于真实模型/业务交付；P1 HOLD 和旧 UNKNOWN 保留；只能按已验证宿主形式声明恢复能力 |

新增生产边界集中在 core/tools/aidlc-run-recovery.ts、aidlc-grant-store.ts 和 harness/codex/runtime/host-recovery.mjs。既有 report、session generation、同回合返修、资源关闭和准入路径复用；没有新建阶段状态机或提高步数/回合/重试上限。只读 run inspect 补充 durable_execution 观察，继续返回 execution_authorized=false。

### 存储与效率

持久记录使用连续 revision 和 previous_digest。每 32 条完整快照，其余保存签名字段增量；冷读取最多 32 条，恢复前完整校验历史。热路径只验证当前 head/记录及当前原授权，不为每次记账重复全量冻结输入核验；实际 Gateway/Core 派发和发布门禁仍核验冻结输入。预算持久化和操作预留在同一宿主进程调用受信 Core API，不额外启动 CLI。

首次集中检查发现：100 个短操作的逐次全量冻结输入核验花费约 36.2 秒，增量文件约 460 KB，对照全快照约 6.70 MB。已针对纯记账去重，最终实测保留在验收日志；不得以增大步数或授权期限掩盖成本。此前通过的独立宿主路由/进度证据只在相关代码变化时补验，不重复业务长前缀。

### 能力声明和停止边界

- 自动后继目前限定独立 Codex runtime、同机器同 HostRef 同 native session，使用新 H5 明确批准的策略；不同会话、机器、宿主和并行调度不被此策略授权。
- 带 AIDLC_RESOURCE_OWNER 的外层 worker/服务模式尚无完整后继生命周期证据，入口明确拒绝自动接管。该模式不能被本轮独立宿主探针宣称为 restart-recoverable；其真实外层资源资格仍是整体上线阻塞。
- 活跃或未知旧执行者、无 PID 的派发窗口、无已提交报告/精确文件内容/可信只读查询的未知操作、部分返修转换、撕裂账本、未知锁所有者、撤销/过期/预算耗尽均停止并保留证据，不盲重放、不延长期限。
- 新的真实模型 + 功能/UI 批次尚未验收；脚本 Native RPC 用于确定性故障注入。P1 真实交付未通过前不提升生产能力声明，不恢复 orders-r12 或其他历史 UNKNOWN。

因此，“P2 主链有界恢复工程实现完成”和“所有宿主/外层 worker/真实业务场景均可自动恢复”是两个不同结论；后者不能由局部工程测试代替。P2 的最终上线验收仍须关闭这些范围内的真实证据缺口。


## 7. 首轮验收结论（历史快照）

最终来源为 71a6a7af9d365cf16f25ec7038ac6f3b434284f09d982eee5fdc3a7ba0c89401。30 项 P2 定向检查、49 项原授权兼容（33 项通过前缀 + 16 项补验后缀）、37 项宿主路由及原进度/返修检查通过。类型检查、构建、10 Harness / 3060 文件分发一致性和实际 shipped Codex 的 3 个兼容场景通过。Native 启动后持久登记失败的真实子进程检查确认关闭已执行、未知 intent 保留；父 Supervisor 的持久取消也由真实父子进程检查确认。

100 操作样本中，增量账本 459522 字节，对照逐次全快照 6700886 字节，写入量下降约 93.1%；记账耗时由 36.2 秒降到 32.6 秒，只作为本机单次实测，不宣称端到端稳定加速。最终真实 OS 自动重启探针约 17.1 秒，第二代次在缺少环境预检计划时正确停止，未报告业务通过。原始失败、修正原因、源码差异和证据复用边界全部进入验收索引。

工程范围判定为通过；P2 整体状态仍为未完成最终验收。独立 Codex 宿主的实现不能代替外层 worker/服务模式的恢复接入与资格验证，也不能代替真实 Codex 模型、功能和 UI 的交付验收。P1 入口保持 HOLD。无真实业务试点、无真实模型运行、无新实际 H5、无历史 attempt 恢复；根工作流 state/audit、7 个原不存在的授权路径、590 个历史输入和 orders-r12 的 82 个公开证据保全。


## 8. 剩余优化集中收口：外层 worker / 服务恢复

本节更新第 6～7 节的外层 worker 未接入结论，旧验收文件保持不变。按用户“先全部实施优化调整”的指令，补齐最后明确留下的工程缺口；不创建业务试点、不签发实际 H5、不恢复历史 UNKNOWN。最终证据归档到 [本轮验收索引](evals/autonomy/p2-worker/acceptance.json)。

### 实际关闭的生产缺口

1. **外层 worker 只能首次启动**：Core 新增受信 worker 登记与资源账本；旧 worker 和全部登记资源确认退出后，新 worker 可在原 same-host-session 策略、期限及重启额度内接续。既有父 Supervisor 存活时有界重新派发；父进程也已结束时，宿主仍须提供原私有上下文，不能从日志恢复凭据。
2. **内外层 attempt/服务身份未绑定**：冻结 worker_entrypoint 的路径和字节参与 HostRef；通过当前私有 IPC 发放绑定父子真实身份、run/grant、nonce、CAS revision 和短截止的一次性 permit。新的 attempt token/协调 binding 仅回传原 worker；业务环境剥离 token/operation ID。
3. **内层结束过早导致外层无法投影和清理**：外层模式中，Native 结束后由 worker 先关闭 reload/service，核验当前 Core 结果并精确释放领取，最后终止 durable run。当前 attempt 分目录读取退出记录；旧退出文件不替代新代次。
4. **环境重建和资源对账没有贯通**：服务在创建前登记 intent，创建后登记真实 PID/出生标识；实际退出才写 closed。reload 本身也有受管记录；成功恢复重建服务，保留原服务候选校验和 main 的正式环境重检。旧 permit 的子进程即使尚未形成 attempt 也必须对账。
5. **重新派发可能形成重复尝试**：后继预检没有形成新 generation 时停止；取消/结束/撤销/到期、未知资源/副作用不再启动。步骤、回合、重复动作、等价重试和预算原值沿用，不提高上限。

### Core 与宿主职责

Core 的 aidlc-worker-recovery.ts 只负责授权、签名 CAS、原策略/额度、worker/资源事实和一次性准入凭据。aidlc-run-recovery.ts 消费 worker permit 并复用原后继 fencing/session renewal；普通 run inspect 仅增加脱敏 worker 状态投影。没有第二套阶段推进器。

Codex 的 host-worker-recovery.mjs 负责私有 IPC、实际进程身份、配置绑定与凭据交接；实际 pilot-worker.ts 复用原 Supervisor，执行服务重建、attempt 循环、最终投影及清理。prepare-pilots.ts 在已有资源关闭保护内调用登记钩子；owned-reload.ts 记录替换完成，当前候选匹配时避免重复消费旧 reload ACK。Worker 模块导入不再误触发 CLI；直接真实入口仍先执行 HOLD/Go。

### 验证与证据边界

先完成 Core 短边界，再检查实际子进程：同 worker 的宿主中断、服务 reload、整个 worker 退出后新 worker 接续、实际 main/脚本 Native 强制退出、既有父 Supervisor 自动重新派发。每条路径独立保留原始输出；脚本 Native 不提供模型能力或业务通过证明。类型、原 disabled worker/领取/取消语义、普通检查点和分发集中回归。

初次工程夹具的失败包括临时目录无法解析裸 tsx、生成脚本换行转义、Native 脚本使用了不受入口支持的 .cjs 后缀；均没有触及业务验收或放宽生产门禁。后续父 Supervisor 检查发现模块导入也触发 --worker CLI，已将 CLI 自动执行限定到实际入口文件，保留直接真实入口 HOLD 断言。首轮原始失败及修正说明在新验收索引中保留。

此前签名增量账本、49 项 grant 兼容及独立故障矩阵的通过证据保留在原冻结来源；没有相关实现变更的路径不重复运行长前缀。当前变更涉及 worker、main 和 recovery 的路径重新验证。性能结论沿用原有实测边界，本轮只记录工程场景及分段耗时，不宣称真实业务/UI 耗时目标已经通过。

### 本轮最终结果

工程实现收口，当前已确认范围内无剩余待实现项。冻结来源为 f8544fca20acbd70ce793cb8db2c044bde4c1981a5a9481affe90bd2a511608e，17 组集中检查全部通过且来源未变化：16 项 worker 边界、16 项原后继边界、5 条实际进程恢复路径、10 个原 worker 场景、37 个宿主调度场景、13 个检查点边界和 13 个真实入口 HOLD/拒绝检查。类型检查、构建、10 Harness / 3071 文件分发一致性及 shipped Codex 的 3 个兼容场景通过。

5 条独立进程路径合计约 103.0 秒，包含临时工程准备、签发夹具、冷启动及关闭；它不是业务交付时间。原 49 项 grant 兼容和未改变存储故障路径保留其原冻结证据，不以旧通过冒充本次整体验收。

P2-01～06 的工程实现与隔离验证已完成，外层 worker/服务恢复的已知代码缺口已关闭。真实 Codex 模型的恢复资格，以及当前来源下的完整业务/UI/效率最终交付仍未验收；因此 P2 release qualified 和 P1 real delivery 仍为 false。剩余的是这些实际验收门，不是继续扩建流程。P1 保持 HOLD，未自动打开 H5 或开始新试跑。

根无关 state/audit、7 个原不存在的授权路径、590 个历史输入和 orders-r12 的 82 个公开证据均保全。本轮真实业务试点、真实模型运行、新实际 H5、旧 attempt 恢复均为 0。
