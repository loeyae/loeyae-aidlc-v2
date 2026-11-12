# P1-07 工程双轴审查

模式：INDEPENDENT_DUAL_AXIS。同一宿主分别形成 Spec / Standards 结论，不声称另一 Agent 或人类独立审查。本轮使用 aidlc-code-review，按用户授权做仓库工程维护；不是当前 DeepSeek workflow 的正式 C7，不更新其 state/audit 或伪造 review-evidence。

输入：用户 P1-07 请求、总体方案第 13 节、contracts-v1 第 15 节、P1 实施记录第 16/17 节；四个新增观察模块、依赖/签发/路由与 Codex runtime 差异、测试和规则变更。影响域：真实验证、外部依赖、候选身份、签名证据、前置准入与宿主持续路由。真实 Node/HTTP/Chrome 数据与模拟授权分开核对；未启用框架 Provider，不生成框架专属 GateDecision。

## Spec Axis

结论：P1-07 工程范围符合设计。计划先冻结、矩阵 check ID 恰好一次且 AC 全覆盖，UI 必需组合、关键元素/动作、基准和容差不能在观察后缩减。无 UI 需实际技术接收来源。命令/HTTP 使用 Core 对真实操作数的封闭断言；分页/顺序/边界/超时、实际发布成功/非法状态/失败重试及后端结果都执行。十个 UI 组合实际坐标点击、DOM/网络/PNG 与冻结区域差异通过；静态 alignment 和 Native gates 保留。

runtime/external 绑定具体 edge/provider/CapabilityRef、版本/健康和外部 Owner，消费点重新查活性。前置外部观察不再被准入自锁：有限 ExternalRef HTTP 子集只产生 partial，普通消费者实现编辑不改未变外部契约；缺少其他准入条件继续阻塞。完整矩阵严格要求当前 clean commit/tree/artifact、实际服务 commit，内部 runtime 不使用外部预检豁免。

观察同时绑定环境、来源、原始输出、checker、grant/batch 和时效，原始截图/结果变化及不同候选不能复用完整通过。P1-08 终态、Native C8/审查、委托决策最终对账和完整试点仍独立；没有扩大到 push/deploy、跨仓、多宿主 Supervisor 或 P2 恢复。

## Standards Axis

结论：受控签发与既有权限/领取边界保持。复用 issuer、publication/grant 锁和实际 binding；不同签名 schema、不可变 receipt 及 current 指针，普通 JSON 无法签发。锁内再次核对 grant/来源/checker/环境/候选，签名不能代替实际操作检查。Core checker 身份覆盖复用的校验代码与运行依赖，冻结授权输入持续复核。

命令禁 shell 字符串、有限时间/输出；HTTP 限定明确 origin、版本端点、禁重定向；鉴权仅从声明变量读取，不记录头值。CDP 仅评估固定生成的 DOM 读取，不执行作者脚本；实际命中检查后发坐标输入，PNG 以受限解码分析。Chrome 新 profile、默认沙箱、自有进程树关闭。可信命令/隔离环境声明仍需交接审阅，不把协议说成任意 shell/OS/网络隔离。

observe/host 公共分派执行各自的实际授权校验，避免外层 workflow-write 误阻断。全局准备仅允许 validation/evidence 操作返回未就绪依赖投影；业务写入、消费者阶段、consume/verify、共享 Owner、撤销/期限与暂停规则保持原控制。not-applicable 不执行命令/UI、不签凭据；partial 不满足完整验收。

## 问题与复审

| 严重度 | 定位/问题 | 修复与证据 |
| --- | --- | --- |
| 重要 | aidlc-observation-inputs.ts：原 checker 摘要未完整覆盖复用的 Core 校验代码 | 纳入 semanticCheckerDigest，保留原始/最终类型检查与专项结果 |
| 重要 | aidlc-observation-inputs.ts / grant-store：复用结果应持续检查授权冻结来源 | currentObservations 调用 validateGrantInputs，增加真实冻结计划漂移反例 |
| 重要 | aidlc-observations.ts：仅整页差异可能稀释关键区域错误 | 强制冻结非空关键区域及独立阈值，保存差异边界；区域反例/真实 PNG 验证 |
| 重要 | admission/dependencies/observe：前置外部观察与实施准入互相等待 | 受限外部 HTTP 预检、partial、真实 CLI not-ready/准入重验；其他硬门禁不变 |
| 重要 | aidlc-orchestrate.ts：公共 observe/host 被外层 workflow-write 检查自锁，inspect 也误要求授权 | 由各入口自身校验；实际 CLI 预检与只读 inspect、宿主回归验证 |
| 重要 | 候选/外部预检：消费者修复时不能靠伪造 clean 或强迫最终候选验收解锁外部查询 | 预检单独记录真实 dirty 来源上下文，仍核对来源/能力/环境/外部版本；完整矩阵继续拒绝 dirty |
| 已纠正夹具 | UI 初始 policy / PAGE 覆盖 /视觉交互 kind 不完整，漏项反例仍保留后续断言；新漂移用例误用 helper；服务空闲连接重置 | 补齐真实准入要求，删除全部目标断言形成实际反例，改为正确冻结文件与隔离服务关闭连接；失败日志保留，没有放宽生产断言 |

最终复验以 [verification.json](verification.json) 的逐命令退出码、最终源码及证据摘要为准。没有遗留关键/重要实现问题；建议后续在 P1-08 增长时按 schema 域拆分较长计划解析函数，保留同一冻结/发布边界，避免同时扩展计划和终态逻辑。

## 证据边界

测试使用独立临时 Git 项目和模拟操作端/接收来源；真实服务/函数/浏览器及签名原始文件可以复核。五个快照目录只导出 fixture 公钥，签名/原始/候选制品摘要在封存时独立校验；它们是历史工程观察，不是当前现场仍有效的运行租约或业务批准。没有新增原生模型探针结论；P1-06 证据保留原范围。

没有完成整个 npm test、正式业务批次、两个完整无人值守试点或 P2 恢复。当前无关 workflow 保全、无当前项目 grant/key/正式观察目录和十种 Harness 构建/字节一致性另由封存脚本校验。
