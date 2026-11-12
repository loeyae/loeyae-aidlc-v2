# IT-07 工程夹具整体契约复审

2026-11-10，Asia/Shanghai。真实入口 HOLD；本文仅是工程验证方案复核，不产生 Go、H5 或旧 attempt 恢复权限。

本轮整链接线三次失败后按 RF-08 停止线统一复审，没有修改生产 Core/宿主代码。最初一次失败发生在 grant/Native 前；第二次完成上游 Native 前缀，但实际 worker 的正式入口正确拒绝 HOLD；第三次实际 main 已启动，候选命令的目录输入在计算身份时被拒绝，尚未执行业务命令/模型 turn。第三次 Native、操作、服务和领取已实际对账；前两次保留原夹具，不能从状态重建领取或恢复原 run。

| 问题 | 根因与真实边界 | 修正及短证据 |
| --- | --- | --- |
| UI 委托遗漏 PAGE-001 | 旧单订单夹具手写 source_refs，组合 UI 后没有消费新增硬约束 | plannedLayoutDecision 从真实 policy 的 hard_constraints/validation_requirements 派生完整来源；实际 Core 漏引用拒绝/完整引用接受，发生在授权前 |
| 工程 wrapper 提前触发正式 CLI | launcher 添加 --worker，静态 import 在 wrapper 的 library overrides 前执行默认入口 | 自启动标记只在工程 wrapper 的动态 import 前移除；子进程短检查确认进入库的 IPC 要求；正式文件/CLI 保持 HOLD，无绕过参数 |
| EISDIR 且断言遮盖原错误 | 新配置把 src/tests/docs/delivery 目录当作 command.input_paths 文件；缺失 stderr 文件被断言消息提前读取 | 整链和短检查共用 engineeringHostConfiguration；全部列举真实文件，实际 retryKey 随真实源字节变化，目录仍在派发前拒绝；stderr 缺席按空诊断处理 |
| 提前发现的两项准备问题 | TS 模板原文没有经过模板求值；临时服务未遵守原端口重载 | 同生成器模板求值后 Node --check 通过；真实服务关闭/替换短用例保持原端口与候选版本 |

复审同时逐项核对：HostRef 在授权前固定；初始工程 capability 明确为 seeded，原 600 秒 grant 与 deadline 不变；admission.native_host_ref 与真实配置一致；私有凭据只走原 IPC/环境；PILOT_ORIGIN 的冻结变量与服务端口一致；UI case_service 使用当前 src/server 的 InputRef；候选命令直接消费原生成器模板，真实 git/重载 ACK 与服务版本由生产代码处理；RPC 对端只读取公开 prompt/工具返回，通过 metadata 拒绝后按 write_contract 记录；原 RED/测试与委托来源固定；最终矩阵为十 UI、三 API、分页和结果导航共十五项；C8/Native/最终候选由 Core 决定；projectBatchResult 的只读投影不把领取释放视为业务变化；清理与未知沿原资源策略，失败保留原文，缺日志不能遮盖真实退出。

此前通过的 L0/L1 及分发不依赖本次修正的 L2 配置；只重验新增的 RPC/准备短边界和类型。短检查与整链使用相同的配置/服务/入口生成器，避免再有两套手写接线。停止猜测式补验后，仅安排一次完整复审后的冻结工程运行；任何新失败均保留并将 IT-07 标为未通过，不自动重复整链。实际次数、耗时、来源与结果以 it-07-acceptance.json 为准，不把旧失败删去或声称只有一次前缀构造。

旧工程 fixture 只读保留；没有恢复原 run、重新签发原授权或延长预算。最终上游前缀仍须真实产生当前 issuer 的 Native 证据，不能跨夹具复制签名收据充当当前门禁。409 个生产/分发来源和 11 组局部证据的严格复用另见 reuse.json；它们只减少独立测试前缀的重复，不授予当前运行完成资格。

## 复审后一次运行的实际结论

最终整链进程仍未通过，176.986 秒后在 C8 前以 admission-window-insufficient 正常结束。两次真实候选/服务重载、委托补录及两份完整十五项观察均已发生；业务质量阶段不能替代尚未完成的 Native/C8 汇合。Native、所有已派发操作、服务与领取已对账，没有 pending unknown。没有第五次整链，没有通过延长授权或跳过窗口把结果变绿。

只读重放精确原文得到：结束时原 grant 尚余 428168ms，阶段动作需要 418168ms；新刷新的 admission 只余 295414ms。生产默认 phase_timeout 为 600000ms，publication margin 为 10000ms；旧工程 plan lifetime 为 300 秒。原 grant 的 600 秒预算没有扩大，足够覆盖较小动作的 ready 收据并不承诺覆盖之后的最大 Native 动作。此次正确拒绝暴露的是交接准备未联合核对宿主动作用时、plan、capability 和原授权的组合，原局部 callback 替代窗口钩子隐藏了它。真实试点生成器为 plan=900秒、grant=3600秒；本轮没有改写已有试点，不能把工程夹具窗口问题等同于两个试点原配置已被证明不合法。

工程夹具已在采用前把准备 plan 设为 600 秒，并使用实际 requiredAdmissionWindow 断言其覆盖原 600 秒 grant 内的 590000ms 最大窗口；短用例同时保留 300 秒不足的负例。变更只发生于准备源码，未修改任何已签 grant、原 wall budget 或运行中 deadline。之后只运行此短检查及类型核验，不再启动 L2，因此新源码的完整正向链仍未验证。统一采用/交接入口的组合可行性拒绝仍是工程收口待办，IT-07、完整效率和 IT-08 准入均未通过。
