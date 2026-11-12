# 默认：宿主直接实施

使用宿主原生工具按用户已明确的设计和验收标准实施、测试、审查及返修。可选 `loeyae-aidlc work` 只读获取 Git/所选输入；无需 H5、claim、专用 worker 或逐阶段 report。真实验收失败继续修复，不得宣称完成；流程记录缺失不阻止独立工作。

## 兼容参考

以下旧 orchestrate、会话及专用 runtime 说明仅在用户明确选择维护旧受管流程时适用，不是默认实施前置条件。

# Loeyae AI-DLC for Codex

使用明确工作描述启动当前 Markdown workflow：

```bash
loeyae-aidlc orchestrate next --scope feature --work "实现订单导出重试"
```

状态与审计位于 `aidlc/active/aidlc-state.md` 和 `aidlc/active/audit.md`。Agent 调用 `orchestrate next` 获取 directive 并展示 `handoff_prompt`；成员通过 `unit select` 记录分工。

阶段交付以产物、review、构建、测试和 merge plan 为准。应用设计和部署决策在用户明确批准后以 `--user-input Approve` 报告。
## P1-06 单会话自主运行时

IT-03 在原客户端、Gateway 与 Supervisor 内加入回合内预算，配置可选 supervision_limits 只允许收紧 tools/data/native-host-action-policy.json 的上限，并纳入 HostRef。默认总步骤 512、回合 64、每回合步骤 64、同动作/结果 6 次、无进展步骤 32；空闲 120 秒、回合模型/控制时间 600 秒、普通步骤控制时间 30 秒。实际已派发的有界命令使用原受检上界，在其等待期间暂停空闲/模型控制计时；原 grant/wall、自身截止和等价失败重试不变。Native interrupt 最多等待 5 秒实际 turn/completed，ACK 不能证明完成，未确认仍为 unknown。

读取/消息/心跳不刷新进度；新的真实输入不按旧结果重复，源码/测试/设计的新字节与 Core 检查点分别留痕，不能代替质量通过。元数据、诊断和实施共用计数；提前 turn/completed 也须等待工具队列/操作对账。超限沿用原取消链，不创建新会话或恢复旧 attempt。

同一 host-runs 增加 execution-trace.jsonl 与 exit.execution_timing，记录安全动作族、父子 span、单调耗时/UTC、输入摘要及停止原因。queue、host-control、model-rpc、producer、browser-visual、evidence-publication、admission-refresh、cleanup 按区间归属，重叠不重复计量；不输出 argv、正文、环境值或 binding。Core 仅提供签名观察的单项 timing。model-rpc 不是模型思考时间，监督启动前及外层 worker/服务时间不冒充已归因。整体性能和完整资源生命周期仍须后续验收。

P1-10 补充：Core decisions 的 `write_contract` 提供真实字段、批次检查项和 handoff CAS；宿主只把真实观察文件的原始 SHA-256 与 producer 填入提示，模型仍按正常 record 完成补录。等价重试使用规范化命令与实际输入内容，换提案文件名或参数顺序不能重置失败计数。

长命令派发前核对足够的准入窗口及发布余量；必要时在原授权和期限内重新预检并恢复精确正式入口。宿主将进程出生标识、Native turn、Core/tool 操作、心跳、取消和实际退出同步落盘。`inspect-run` 是不启动模型的只读失联检查，不签授权、不写退出、不释放领取、不恢复旧 attempt。详细契约见第 19 节；P2 自动恢复仍未实现。

runtime/aidlc-codex-host.mjs 复用 Codex app-server 原生 Supervisor，不改用户 Codex 配置或安装全局 PreToolUse。配置、预算、实际工具前校验与取消契约见仓库 docs/aidlc-autonomous-contracts-v1.md 第 14 节。

~~~text
node <installed-skill>/runtime/aidlc-codex-host.mjs prepare <seed-host.json> <new-frozen-host.json>
node <installed-skill>/runtime/aidlc-codex-host.mjs identity <frozen-host.json>
node <installed-skill>/runtime/aidlc-codex-host.mjs run <frozen-host.json> <prepared-thread-id>
node <installed-skill>/runtime/aidlc-codex-host.mjs inspect-run <run-id>
~~~

prepare 会执行一个无工具、无业务实施的初始化 turn，使原生 thread 可供运行入口复用；它不签 grant。先将该 thread_id 按既有协议绑定到协调实例、冻结配置/接收计划和批次、由实际操作端授权，再 run。运行时拒绝另一个 thread、HostRef 漂移、重复 attempt 与自动接管；同一会话阶段 final 后继续读取正式路由，不自动批准阶段。

配置示例：

~~~json
{
  "schema": "aidlc.codex-host/v1",
  "codex_entrypoint": "/absolute/path/to/codex",
  "core_cli": "/absolute/path/to/loeyae-aidlc/bin/cli.js",
  "admission_plan": "docs/aidlc/host/admission-plan.json",
  "observation_plan": "docs/aidlc/host/observation-plan.json",
  "commands": [
    {
      "id": "unit-tests",
      "argv": ["/absolute/path/to/node", "tests/run.cjs"],
      "operation": "validation-execute",
      "timeout_ms": 60000,
      "input_paths": ["tests/run.cjs"],
      "write_paths": []
    }
  ]
}
~~~

浏览器适用时显式配置 browser_entrypoint。prepare 生成 native_config_digest；AdmissionPlan.native_host_ref 引用生成配置的真实 raw-file 摘要。命令副作用与 write_paths 必须在交接前审阅；运行时不执行模型临时新增的 shell 字符串。预算或取消退出保留真实原因和操作观察，不代表业务 verified。重启恢复和后继授权留 P2。

可选 observation_plan 指向已纳入 batch.baseline_inputs 的冻结计划。全部 implement 单元 review 完成后，运行时在 C8 或 scope-exhausted 路径回原协调 binding 运行真实功能/HTTP/UI 观察。须先按独立授权准备 clean commit 并启动匹配版本的隔离服务，可使用冻结 candidate_command；完整矩阵和 Native 门禁仍决定结果。观察后执行 batch finalize，失败保留真实 batch-failed 等结论；观察成功本身不完成批次。契约与原始证据要求见 contracts-v1 第 15/16 节，模型不能手填 passed。

准入未就绪时，同一协调 binding 先执行 `observe run --dependency-preflight --input <plan>`，只运行明确 ExternalRef 的 HTTP 检查，再运行完整 admission。通过仍为 partial；无外部检查则 not-applicable，不执行命令或 UI。它不扩大代码写权限，不清零预算，不把普通消费者编辑等同于外部契约版本变化；完整功能/UI 验收仍绑定当前 clean 候选。

P1-08 在 C8 完成后回原协调 binding 执行 `autonomy batch finalize`，只有 Core inspect 返回 current verified 且所有操作已对账，宿主退出才为 verified。Core 拒绝、矩阵失败、Native 缺项、候选或证据漂移都保留真实结果；宿主 final 不会完成批次，更不会自动设置项目 done。

可选 candidate_command 引用 commands 中 operation=candidate-commit 或 candidate-integrate 的已冻结命令 ID。全部 implement 单元审查完成后，宿主回原协调 binding 执行候选准备，再走正式 C8；相同源码摘要不重复准备。命令及 write_paths 仍受独立授权、预算和范围校验，应按交接约定准备实际 clean 候选以及对应版本的验证环境。没有配置时，Core 仍要求实际候选，缺少时诚实返回未完成。

采用批次的未来/consume/verify 单元不成为新增实施或聚合审查分母。Native 证据漂移仅按 Core 给出的无需人工审批 refresh/run-phase 诊断有界修复，readyInstance 保持空，不启用源码写入。Core 返回的四种工程结果与人类评审状态单独保留，完成语义以契约第 16 节为准。

P1-09 统一采用模式的入口规则：`next.autonomous_execution` 和 `rule_load_plan.supplemental_protocols` 指向共享自主批次实施协议，notify/none 展示后连续执行，合法委托先记录并验证。已冻结 implement 的模块选择在正式路由候选内由宿主调度，不重复向用户确认；真正 block/未决人类选择保留停止原因，模型网关继续禁止代填审批。

CLI next 正常退出 2 时保留其结构化修复诊断；进程异常、未知结果和其他命令失败继续拒绝。只有原 Core 诊断允许的无需人工批准刷新才进入有界修复，源码写入仍需正式阶段进入。其他 Harness 只共享 Core/协议分发；完整宿主适配与实际双试点不由分发检查推导。未采用模式继续原人工模块选择和阶段审批。

运行入口必须持有已完成的全局初始协调实例。切换工作实例时保留实际协调 claim；完成 report 仍按原规则释放工作 claim，网关随后清空源码写许可、切回持有的协调 binding 并通过原 bind 续期。协调 binding 只放在宿主内存与本进程 AIDLC_COORDINATOR_BINDING 中，Core 会核对实际 owner/session/generation；不从 state 猜凭据，不自动恢复过期或转交。续期不延长 grant/wall budget。此链路有真实 CLI report→context/select 回归，完整真实模型试点仍留 P1-10。

P1-10 的实际试跑补充三项宿主续作约束：同一原生会话并发发出的结构化工具请求进入最多 32 项的串行队列，每项执行时仍重新校验当前授权、领取和原期限，溢出在派发前拒绝。Core 明确给出的无需人工批准 refresh/run-phase 诊断由宿主通过同一受检网关执行精确生产者命令，单独标记为宿主证据刷新，不增加模型修复轮次或开启源码写入。仅宿主原生探测超时可在原等价重试预算内重新进行真实 admission；不支持的能力或其他准入失败立即保留拒绝，不延长授权或以旧 passed 代替新观察。

最后单元完成后的实际公开空预览不会带 scope-exhausted。宿主同时识别精确空预览格式，在冻结 implement 全部审查完成后、候选处理返回协调实例之后重新选择项目 C8，仍通过正式 next 门禁。已完成代码生成的派生证据因来源失效时，Core 可指定该阶段 all-sensors refresh，使真实 GREEN 先于其依赖映射；宿主只执行原诊断命令。每次模型 turn 在当前阶段报告完成后返回宿主；RED 测试输入变化仍拒绝，不能用新 GREEN 代替原 RED。

最终汇合的实际 Native 失效也由 Core 在 directive 中给出修复建议；宿主复用原有预算和网关，只在其他检查通过或仅剩合法元数据缺项时进行有界刷新。旧签名结果保留，再由 Core 发布新结果。真实功能失败、准入或人类审批阻断不能走此路径。

宿主在准备候选、完整观察和最终批次汇合之前通过真实 admission inspect 检查准入新鲜度；凭据过期时只能用冻结计划、原协调 binding、原授权和剩余预算重新执行必要依赖预检及 admission。刚通过当前准入检查的依赖不重复观察；Core 发现依赖竞态时最多补一次观察。刷新直接消费 admission run 的受控返回，不紧接着重复 inspect，也不重复选择当前协调实例。已完成候选保留来源摘要，续验不重放提交。仅确认已对账的 Core ADMISSION_INPUT_CHANGED 竞态可在原等价重试预算内续验，未知操作、授权到期或撤销、缺少计划、能力不支持和其他真实拒绝保持停止；不能恢复已结束的 Native attempt。

Codex adapter 使用 run-config 能力证明：首次完整真实探针仍验证模型、工具、预算和取消；在同一原授权与配置下，后续准入校验原签名/原始来源及实际 config/read 轻检，不因观察年龄反复启动三个模型回合。旧观察日期不变，当前检查的 freshness 独立进入准入收据并受原预算约束。配置漂移、未知资源、篡改和授权失效拒绝；原能力增加或证明依赖变化才需要新的完整探针。工具实时权限、Native 质量门禁和业务/UI 完整验收保持。

现有单个 RED/GREEN/baseline 生产者成功时可写证据文件而不输出 stdout。宿主只将已对账的 exit 0、空输出、精确 phase sensor 识别为 command-completed，evidence_verified=false；其余空输出仍拒绝。实际阶段和批次有效性继续由原 Native 门禁与 Core 决定，不能从命令完成推断业务通过。

H4 已登记而尚缺实现/验证引用的委托决策须在首次 C8 完成门禁之前补录。全部 implement 单元完成 C7、当前候选完整矩阵观察通过后，宿主读取 Core decisions，正常选择受影响的精确单元 C7 binding，进入只允许读取、受检 design-write、decision-record 及有限只读 Core inspect/policy/decisions/dependencies 的补录 turn（observe/batch 只允许 inspect）；代码、测试与阶段报告仍关闭。原预算内按单元有界重试，显式人类 rework 或审批 block 继续停止。补录后返回实际持有的协调 binding，重新准备候选、观察和 Native，再取得正式 C8。观察返回协调实例后的局部空预览也必须重新选择 C8，不能作为可实施 directive 交给模型。决策 validation_refs 依既有契约使用观察文件原始 SHA-256，最终 current_validation 重新绑定最新候选观察；人类复核保持 pending，不修改 Core 权限或数据结构。


IT-00/IT-01 收口规则：metadata 拒绝所有冻结命令、evidence run、report、next/preview、observe run（包括 dependency-preflight）、batch finalize 和 code/test-write；不能把 validation-execute 类别当作任意验证许可。模型与宿主直接长动作使用共享动作分类和派发前检查；宿主身份/metadata 模式不可由模型字段覆盖。Core 授权、撤销、领取、路径与发布检查继续独立执行。

时间策略来自随 Core 分发的 tools/data/native-host-action-policy.json，参与 HostRef 摘要。冻结 timeout + 10000ms 发布余量必须严格小于 900000ms 能力上限，配置不满足则在设计准备/请求 H5 前拒绝；普通 Core/阶段生产者上界分别 180000/600000ms。静态可行后仍检查实际准入/原授权剩余期限；Core 授权检查消耗窗口时，子进程启动前再次拒绝。准入刷新和持有绑定的正常取消/释放不受过期旧 receipt 阻挡，禁止恢复旧 attempt。

内部 P1-10 的 operator-pilots.ts/ps1 另消费固定来源绑定的 HOLD/Go 工程闸；--check 在 HOLD 下只输出暂停且不读取试点。Go 不替代 Core 或真实 H5，不扩展到普通未采用 workflow。当前 IT-00/01 完成仍为 HOLD，未运行真实试点、未创建新试点。


IT-01B 的同 attempt 返修由 Core 决定合法性：宿主在新 attempt 首次业务 turn 前用原协调 binding 注册活跃 OS 身份；原 grant、wall deadline 与 max_active_units=1 不变，周期最多原重试额度且封顶两轮。Core 接收签名的实际 GREEN 失败观察或完整矩阵失败，Agent 诊断回合只读并提交分类，宿主按 Core 精确 steps 正常 select/apply，再取得正式 next。普通实施回合已经请求的计划也由宿主消费；没有受控失败时不额外发起诊断。

code-defect 保留原 RED/测试，test-correction 先归档原 RED/失败，修改列出的测试输入并受控刷新原 I13 后取得新 TDD，再实施与重验；独立验收/视觉输入不允许改写，UC-D 与测试分母不能减少。失败 GREEN 单独签名留证，不能充当成功 GREEN。必须重新完成受影响 Native/C7/C8 与当前最终候选完整矩阵；范围、权限、环境、外部依赖与未知失败继续停止。部分回退未对账时保留 unknown 和领取，禁止接管、重放或恢复。Core 只负责接收、合法回退和门禁；宿主继续使用原 Supervisor，没有增加 P2 能力。当前整体仍 HOLD。


IT-04 对 Native、Core 子命令、browser/socket、service、reload 与 worker 使用共享资源事实和有界关闭。默认启动 5s、正常关闭 1s、终止 2s、强制关闭 5s、IPC 30s、reload 15s；resource_limits 仅可收紧并计入 HostRef。发信号和实际 exit/close 分开；unknown 保留证据与领取，退出时脱离本进程持有句柄，不自动恢复或接管。Core 子进程 exit 0 也不能覆盖其报告的未知资源。

原 worker 拥有外层服务时，Native 仅通过原私有 IPC 委托最终清理；worker 确认全部资源关闭并读取 Core 当前批次结果后，才释放实际持有领取。私有绑定不持久化，不进入模型或业务环境，不从 state 重建，不延长原授权。candidate_business_verified 不是外层完成；缺绑定、ACK 或资源关闭事实均保持未验证。P1-10 当前仍 HOLD，最终来源 wire/main/worker 整链留待 IT-07。


IT-05 的 check-config <frozen-host.json> 是原生配置轻检：只执行 initialize/config-read 并确认关闭，不创建 thread 或执行模型/工具/browser。Core 只在独立受控能力证据仍满足原期限、原 grant 全约束、HostRef/checker/文件输入和完整必需能力集合时调用它；当前配置须与冻结配置及原能力配置摘要一致。漂移/撤销/unknown 不触发完整探针兜底重试，不延长原授权。未命中且允许执行时才进行新的完整探针。

admission run 自动选择合法复用并输出 host_capability_reuse；原 host_observation 不重新计时，业务预检、依赖与最终验收照常。采用前使用 Core admission draft 的只读入口；静态通过不能签发、领取或授权。当前 P1-10 仍 HOLD，IT-05 局部证据不是最终整链或真实试跑通过。


IT-06：当前 Core host context 公布 control_prepare 时，Gateway 使用 host prepare 合并单动作输入/权限检查；逐项 Core 校验与命令后的独立实时复核仍保留。返回值仅供当次动作，无缓存授权或新期限。模型不获此控制族，旧适配器继续兼容路径。

UI 在一次 Core 观察/Native phase 内共享浏览器，每用例独立 context/target；禁用缓存和 service worker，声明 case_service 时还隔离真实服务。版本/API/结果导航、两尺寸十组合、完整 PNG 与原像素阈值保持；关闭逐项确认，unknown 不重启或恢复。生成的 Native phase 在证据输出前调用 closeUi，显式 origin 的生命周期仍由调用者负责。本项仅局部测量，P1-10 继续 HOLD。

## 宿主原生工具接入边界

普通 `orchestrate next`（含 preview）的 error/ask/approval-block 响应写入既有 `formal-route-diagnostic` 事件，保留经过私有字段过滤的完整 directive、修复指引与诊断，不只记录退出类别。此记录不改变 Core 的继续、修复或停止判定。

`aidlc_action` 的模型工具 schema 按 action 明确必需字段；write 必须显式传入 `operation: code-write | test-write | design-write`，宿主不按文件路径猜测权限。缺参返回字段级纠正提示且不派发动作；格式错误也消耗既有步骤和等价重试预算。原生替换通道使用同一 Gateway 参数校验，修正后的动作重新走正常路径、授权和准入检查。

首次成功取得文件或规则章节的实际内容可更新空闲计时，记录为 `input-acquired`，不视为实施完成，不重置无进展步数、重复动作计数或等价失败预算。相同来源与视图只记一次，身份随已有进度快照保存；失败读取、目录列表、缓存引用、心跳和错误调用不更新计时。连续新读取仍受原无进展步数、回合、步骤和授权总期限限制；不提高任何上限，不自动恢复停止的试点。

阶段模型输入使用任务视图，Core 内部保留完整路由、授权、准入和候选校验。`read`/`rule`/`core` 可传 `detail: "full"` 读取原始公开内容；`rule` 可传 `section: "<目录 id>"` 读取详细章节。有源文件执行摘要的长规则默认返回摘要与目录；未标注规则保持全文。公开 evidence 默认保留状态、测试映射、失败和原始输出引用，其他字段按需全文读取。相同 Gateway 会话内相同 SHA 的重复读取只返回引用；源文件变化或全文请求重新返回内容。缓存不复用授权、不跨进程/后继会话继承。`host-model-input.mjs` 纳入 HostRef 摘要。

准入刷新后重新进入原阶段时，Core 的可执行证据返修通过现有有界 driver 处理，原工具动作不派发；返回 `return_control_to_host` 时模型须立即结束当前回合。原始公开 directive 记录在 `admission-reentry` 事件；审批、权限、未知诊断、其他阶段或 diagnose 仍停止，原期限和预算不变。

`runtime/native-tool-channel.mjs` 提供给可信宿主安装代码的替换式工具通道。安装者必须拦截全部工具、拒绝未知工具，并提供 Core `nativeToolChannelContext` 及真实配置读取函数。不能把回调存在、产品名称或 JSON 自述当作资格。该 Core 入口要求签名能力记录中的 mandatory-tool-replacement、unknown-tool-denial、resource-reconciliation 及原 HostRef/配置/授权仍有效。

宿主拥有对话、模型选择和回合通知；通道复用同一个 Gateway/ProgressBudget、原期限和预算，不创建 worker、模型循环或重启器。工具采用替换语义，返回 handled 之后原工具不得再执行；当前支持 read_file、write_file、冻结命令 id、aidlc_core，任意 shell/patch/MCP 不自动放行。每次执行前后检查资格，关闭调用既有取消和资源对账。

本次没有真实原生宿主资格证据，默认入口保持受限 gateway。Core 已提供 captureNativeOperatorApproval 给经过审查的宿主安装代码，复用原有一次性 OperatorApproval 和签发逻辑：传输适配器必须验证原生用户事件通道，携带随机挑战、精确请求摘要、用户事件 ID 和 actor，捕获前后核验 HostRef/配置，受原截止限制。这个接口不暴露给 CLI/模型工具，不接受 authoring JSON 自述。原生 UI 的具体宿主连接和实际能力认证尚未完成，默认 H5 仍使用可信操作终端；工程夹具不能认证真实宿主。
