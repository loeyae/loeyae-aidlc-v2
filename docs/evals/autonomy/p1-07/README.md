# P1-07 工程与实际功能/UI 观察

本目录验证观察机制和真实本地行为，不是当前活动业务 workflow 的运行授权、正式 C7、业务 verified 或完整无人值守试点。模拟操作端批准/技术接收的隔离夹具与实际 Node/HTTP/Chrome 行为分别标明。最终退出码、源文件/证据摘要及环境保全以 [verification.json](verification.json) 为准。

最终专项：功能/候选 17、runtime/external 11、UI 9，共 37 个场景通过；宿主控制 28、持续路由 13。相关验证共 21 项不同检查，通过的最新定向复验覆盖后续修复；其余保持原通过结果，不把失败/中止计作通过。类型检查通过。完整日志及最终覆盖关系在 verification.json 逐项给出。

十种 Harness 最终重建通过，[2908 文件分发一致性通过](distribution-parity.log)。公开只读 inspect 在当前未采用批次的仓库返回 unverified/business_verified=false，没有签发授权或观察凭据。五组归档快照的 Ed25519 签名、当前 checker 身份及 source/raw/artifact 摘要在封存时独立核验。

## 验证对象

| 对象 | 实际检查 |
| --- | --- |
| 功能与候选 | Core 读取真实 JSON 操作数；有序 120 行和 50/50/20，空集、1/50/51、真实上游超时；实际 clean HEAD/tree/artifact，脏文件、不同 commit、过期、原始输出/环境漂移、未签名指针和假断言反例 |
| runtime / external | 独立实际 HTTP 服务的功能/非法状态、版本、健康、Owner、鉴权；消费点 live probe，版本/凭据漂移和最新失败撤回就绪；合同/GREEN 不冒充 runtime |
| 外部前置预检 | 实际 CLI 从 not-ready 返回结构化依赖诊断；仅执行冻结 ExternalRef HTTP 检查，partial 解锁依赖准备后仍须完整准入。消费者普通编辑可复用未变外部契约；能力/服务版本漂移仍拒绝 |
| UI | 实际 Chrome/CDP，10 个 PAGE/state/role/viewport 组合，2 个视口（800×600、390×844）；真实坐标命中/点击、发布/失败/重试、草稿禁用、DOM/网络/PNG；3 项实际 API 规则/后端结果检查 |
| UI 反例 | 改截图、删除组合/关键元素/动作、改视口/容差、实际缺按钮/交互损坏均不能通过；关键区域差异不能由整页平均阈值掩盖 |
| 宿主 | 原协调 binding 执行冻结 observation_plan；passed 仍 scope-exhausted，failed 诚实退出；原预算/取消/session Native 回归 |

## 可复核材料

- [orders-actual](orders-actual/manifest.json)：实际订单候选、函数/上游、原始断言结果。
- [publish-actual](publish-actual/manifest.json)：实际页面候选、预先独立渲染的设计 HTML/PNG、10 张真实候选截图和 DOM/坐标步骤/区域差异，另 3 个 HTTP 结果。
- [runtime-actual](runtime-actual/manifest.json)、[external-actual](external-actual/manifest.json)：精确 edge/provider/CapabilityRef 的真实服务观察。
- [external-preflight-actual](external-preflight-actual/manifest.json)：前置外部契约的真实 partial 观察，证明准入自锁被解除，不是整体验收通过。
- 各目录 receipt.json 为该隔离现场生成的真实签名凭据；fixture-public-key.json 仅含公钥。source/ 保存候选源文件，observed/ 保存不可混淆的 raw ref 摘要映射。导出时不复制 issuer 私钥；服务鉴权使用隔离测试值，不读取用户业务凭据。
- [双轴审查](code-review.md)、[测试退出码](test-results.json)、[构建退出码](build-results-final.json) 与 [分发一致性](distribution-parity.log)。development 日志保留原失败；最终 verified / final 日志优先。

UI 设计 PNG 在候选服务构建/提交前从独立静态设计生成；实现页另含实际 fetch 和状态逻辑。观察中不更新基线。逐像素整页与 publish-panel 关键区域同时通过，DOM/交互/业务另设硬检查。人工目视抽查两种视口的成功/错误截图用于工程审查，不代替受控像素/行为结果。一个示例区域不推导为任意页面都已具备完整区域设计；正式业务计划必须按其设计冻结各关键区域和所需状态/角色。

## 复现与限制

`npm run test:observations` 运行三个专项；[run-verification.cjs](run-verification.cjs) 执行相关回归并保留各命令退出码。UI 测试需要实际 Chromium/Chrome，测试浏览器路径可由 AIDLC_TEST_BROWSER 指定。HTTP/浏览器均使用临时项目、自有服务/进程和隔离 profile，关闭后清理。该测试不是生产服务操作授权。

Core 提供受控观察、候选/环境/原始文件绑定与依赖消费校验；Codex Harness 复用原生 Supervisor 执行持续路由、预算和进程树取消。实际命令的副作用范围仍是交接时审阅的可信契约，不声称可解析/隔离任意 shell。该轮未新增模型探针结论；P1-06 的原生能力证据维持历史范围，其他宿主仍须自己的适配。

依赖预检没有完整实施准入前只允许明确绑定 ExternalRef 的 HTTP 观察，仍要求实际 grant 和全局准备领取。它保持 coverage=dependency-preflight/status=partial，项目 CandidateRef 为真实来源上下文而非最终候选；后续消费者编辑不改外部能力版本。完整矩阵必须是当前 clean 候选，部分观察不能作为验收通过。没有外部检查时不执行命令/UI，也不签发凭据。公开 CLI 的 inspect 与 observe/host 控制面分别执行自己的读取/授权校验，不能在分派前误套 workflow-write 导致预检自锁。

P1-08 尚需汇合最终整合候选、原 Native gates、全部验收与委托决策，发布真实批次终态；P1-09/10 尚需完整两个内部试点的无人值守链路实跑。P2 自动拉起/后继授权/跨进程恢复未验证。未运行完整 npm test；没有在当前项目创建 grant、issuer、admission/native/observation receipt 或 host attempt，没有改动无关 DeepSeek state/audit，没有提交或推送代码。
