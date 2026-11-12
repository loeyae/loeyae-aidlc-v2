> 适用范围：以下强制路由、凭据和状态写入规则仅适用于显式选择的旧受管引擎。默认实施遵循 [宿主执行协议](host-execution.md)，不加载本协议作为开工或续作门禁。业务质量要求仍按任务需要使用。

# 步骤完成协议

显式采用自主批次时同时执行 [自主批次实施协议](common-autonomous-execution.md)：完成报告和 handoff 展示后继续执行已授权 notify/none，不生成逐阶段“是否继续”。已知来源直接复用，合法 policy/fallback 先记录、实施和验证；真实 block 审批、暂停、权限和全部质量门禁不降级。未采用模式保持原行为。

完成阶段前，Agent 必须：

1. 生成 directive 声明的产物；
2. 满足 consumes、requires、condition 和 sensor；
3. 仅运行当前 directive 声明或绑定、且未被当前有效受控 Evidence 覆盖的 review、构建和测试；修复后只重跑受影响、失效或尚未满足的检查，确定性 producer/sensor 继续由引擎负责；
4. 用 `orchestrate report` 记录结果；
5. 原样展示返回的 `handoff_prompt`。

当前 workflow 的状态和审计始终写入：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

state/audit/ledger 由引擎维护，Agent 只在已有业务产物或问题记录中补充真实决策、风险与例外，不抄写机器统计。需要简短摘要时读取 `orchestrate state summary`；仅在用户明确导出时保存到 `.aidlc/views/`，不作为阶段产物或门禁依据。

Agent 不能手工修改状态来跳过门禁，也不能把 Hook 输出或派生摘要当作质量证据。若 `handoff_prompt` 表示无法确认某项信息，必须如实保留该状态而不是宣称完成。

显式采用的自主批次在首次共享契约物化、TDD 或代码生成之前，必须具备当前 grant/binding 与有效 autonomous-admission receipt。读取 `autonomy admission inspect/check` 的三种结果；ready-with-delegated-decisions 不降低完成标准，pending 人类复核与缺少实施/验证分别处理。路由 preview 的 planned 提示不表示准入通过。Core 在正式 next、工具操作与受控发布时重验；缺少或过期凭据不能通过手写状态、报告 passed 或复用旧快照绕过。设计准备、接收预检和策略内决策可先完成，合法授权内修复后重验，不为常规兜底反复要求人类决定。

## P1-05 自主批次依赖与写入交接

显式采用后读取 orchestrate autonomy dependencies inspect，交接 batch/scope revision、精确 UnitRef/CapabilityRef 版本、当前 grant/binding、dependency_frontier、待解锁消费检查点、共享输入与写 Owner。只读投影不授权执行；实际工具副作用前执行既有 grant 操作检查，命名消费检查调用 autonomy dependencies check --checkpoint <stage|check-id>。Core 在受控 session/publication/native 路径重读；宿主负责覆盖其直接工具写入和串行调度。

consume/verify 不实施写入，也不能自动转成 implement。contract_ready 只解锁契约依赖，implementation 保守等提供者整单元 GREEN/review，runtime/external 未有实际观察时仍 unverified。local stub 只适用于精确命名局部检查，不能过最终联调。共享写入按单 Owner/显式串行释放领取；输入不足保留 module scope，不偷取锁/领取。

阶段耗尽的 scope-exhausted、needs_batch_finalization=true 不是批次或项目完成，禁止补写虚假的 Native done/skip。P1-08 的候选及完整验收未通过前保留未完成结论；已有 I13、UI bridge、RED/GREEN、review、C8 仍独立有效。

## P1-06 原生宿主接入

Codex Harness 提供 runtime/aidlc-codex-host.mjs，复用原生 Supervisor 和同 thread。prepare 仅创建可复用的原生会话与配置，不授权实施；按真实交接绑定该 thread、冻结配置/AdmissionPlan.native_host_ref 并签发 grant 后才能 run。未安装该运行时的宿主不自动获得相同能力。

宿主在每次结构化写入/命令/Core 副作用前核验操作类别、路径、grant、binding、依赖与写范围，结果返回前再核验命令授权；工具输出不代替批准。阶段切换复用原 bind/release，不转交他人领取、不自动 resume。准入失效可以受控回协调实例重新检查，不延长授权或预算。模型 final/Stop 不结束批次，无可执行工作、无进展、预算或取消保留真实原因。

取消先停止新操作并中断原生 turn，等待所属命令进程树退出；未确认结果为 unknown，不能盲重放。P1 同一 grant 的已有 attempt 不自动重启；宿主观察日志不是新的进度/完成权威，也不保存 binding 明文。真实批次 verified 仍由 P1-07/08 汇合，自动重启/后继恢复留 P2。

## P1-07 实际观察

显式自主批次按冻结 ObservationPlan 执行全部矩阵检查，Core 以真实命令 JSON、HTTP 和浏览器输入/DOM/PNG 核验；exit 0、源码标记或普通 passed 不能代替业务断言。UI 同时核验全部冻结组合、关键元素/动作和关键区域差异。runtime/external 只接受当前受控观察，在实际消费检查点重新确认版本/健康；缺失、过期、漂移或失败保持 unverified。

候选须实际 clean commit，服务版本须对应候选，receipt/raw refs 绑定相同 CandidateRef 与环境。修改源码、设计、环境、checker、授权或原始证据使相关结果失效。`autonomy observe inspect` 只读，passed 仍 business_verified=false；不得代替 RED/GREEN、review、C8、UI full acceptance 或 P1-08 最终批次判定。

外部依赖的受限 --dependency-preflight 仅产生 partial，项目版本为来源上下文；按不可变能力/设计/环境和真实外部版本复用，消费者普通实现编辑不反转未变契约。它不执行候选命令/UI，也不满足完整矩阵或替代其他准入硬条件；完整验收仍须当前精确 clean 候选。

## P1-08 批次完成判定

显式采用的批次在 Native 前沿耗尽后仍须由实际全局协调实例执行 `autonomy batch finalize`；仅 current verified 才可表述批次已完成。Core 同时核验实际最终候选、完整 matrix、选中 implement 单元原门禁、项目 C8/条件全局审查、适用 UI 设计 full acceptance/还原、依赖消费、必需制品与真实委托验证。不得通过修改完成行或缩小原 I13 来绕过。

failed/blocked/incomplete 保留真实原因，人类评审 pending 单独展示。结果写签名不可变 receipt，state 只保存引用，inspect/next/state summary 只读校验当前资格；代码/设计/环境/原始证据/决策/检查器/期限/依赖变化后重验。批次完成不等于项目 done，原 Native 生命周期和受保护操作授权继续独立执行。
