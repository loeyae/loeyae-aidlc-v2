# P1-10 待 H5 审阅：orders-r10 + publish-r14

**最新状态：HOLD，暂不请求真实 H5。** 整体复审发现未收口的同类路径和效率问题，详见[复审计划](../../../aidlc-autonomous-p1-10-integration-review.md)。下文保留先前准备与预检事实；只有整改完成、当前来源验证及用户确认后才可重新评估是否进入真实终验。

IT-00/01 已完成并通过[局部验收](it-00-01-acceptance.json)，当前入口 --check 实际返回 HOLD/ready=false；这不关闭其余集成/效率问题。当前工具来源与下文历史摘要已不同，旧 40/40、HostRef 和 H5 前检查不能当作当前准入。未修改两个试点、未重做准备、未打开授权窗口；后续按 IT-07/08 统一核验当前来源再评估。

IT-01B 的[局部收口](it-01b-acceptance.json)已完成；原 RED/失败归档、正式 Core 回退与受控重验有工程证据。IR-01/04/05/06、最终冻结 L2 与效率 Go 仍未完成，不使用本次局部结果请求 H5；本次没有刷新或修改两项准备。

状态：2026-11-10 已完成设计接收、当前 H4、真实兜底计划和 H5 前检查。两项均未签发 grant、未创建业务 attempt、未开始实施；本轮未打开授权窗口。本页供下一次真实终端审阅，不是批准或运行凭据。

[最终待审阅记录](operator-readiness-1794244236646/result.json)确认最终 [40 项工程回归](engineering-1794242556345/results.json)全部通过；[分发](distribution-1794243641819/results.json)的十种 Harness 构建、2948 文件一致性及选定烟雾共三项通过。297 工具来源摘要为 `675f6436b73eb757d0fe509aada6ca852c9ffc0b97e3155689bfa862c1742e5a`，逐字节原文见 [来源归档](h5-tool-source-1794242556345/manifest.json)。326 个测试/控制器输入整轮不变。

| 试点 | Workflow ID | 原生 thread | 新 run_id |
| --- | --- | --- | --- |
| orders-r10 | 82acdaff-8be0-4169-b97b-bf495ea62744 | 01a1c142-70fd-70e1-9a79-a6bd435a5c14 | d2559714-ae46-43fa-b632-55685f222b76 |
| publish-r14 | 57b9e8da-2858-4e99-89ce-ca05f90ea750 | 01a1c142-df17-7243-a773-8fb28b43e53f | 086b03b3-b326-4805-92b2-b3c4bd0c678b |

实际接收模型为 gpt-6.1-sol，Codex 0.164.0；原生配置摘要为 `86d159ab4ca8f0525245eab10fb8bc4330a756df7072c71cac8eb1ddbcbf3a5b`。订单 HostRef config_digest 为 `48d8bc69545f40a8fed0c0a2a4c3f1175a87cc9dbf5f8441a347c95984d99513`，发布页为 `49fe61326459dd7284e7af17d39b8c36609e27b95ae8c62569d1ce066a77e94e`。对应 scope_digest 为 `c298f394f467c45c22b5d2538c58d90a7ce27488945b50d535522e1cbbede905` 和 `e67810b595af90f77234dd04c2edc510820370329b1ea1502a41aeae0fca8601`。

两个项目均为独立隔离 Git 仓库、单个本地 Node 服务、一个 project/default 交付单元。新脚手架有意保留未验收缺陷，没有复制旧实现、测试实现、完成行、控制证据、grant 或 attempt。单模块及发布页 HTML Mock 沿用用户真实确认；发布页逐字节接收原批准设计和原 Git 基线，按实际答复正常登记 H3，不重复要求批准相同设计。

订单保留 0/1/49/50/51/100/101/120 边界、每页 50、完整顺序与原值、一次获取、独立调用、真实 HTTP/超时和原错误身份。发布页保留 aggregate AC 加十二个故事 AC、12 个 UC-D、ready/draft/published/error/retry × 两种尺寸的 10 个组合；真实 POST ready=200、draft=400/not-ready、瞬时故障=503/retryable，GET /result 读取实际状态，验证结果导航、错误和重试。独立设计 HTML/PNG 先于实施冻结，完整 346×240 产品区域差异像素必须为零，全图差异上限 0.001。

两项 H4 决策是实际模型在已允许政策内作出的计划，实施和验证引用为空，human_review=pending。订单选择内部实现组织兜底；发布页选择允许的控制台诊断兜底。实施完成后通过 Core write_contract 补齐真实引用，正常 record/CAS 后重新准备候选、观察和 Native。最终同一候选上的完整矩阵、Native 门禁、决策 current_validation 和实际对账均通过，才允许 Core 判定 verified。

每份新请求最长 3600 秒、等价重试 2、活动单元 1。允许正常 workflow/stage-report、decision-record、受控证据、验证、设计/代码/测试/环境写入及本地 candidate-commit；写入范围为 src、tests、docs/aidlc/modules/project/construction、delivery、.runtime。冻结设计、政策、矩阵和 UC-D 继续保护。push、deploy、受保护分支、candidate-integrate 和 successor 不在请求中。

长命令派发前检查剩余准入窗口和 10 秒发布余量，必要时在原 grant/wall budget 内重新预检，再恢复精确正式入口。换文件名、JSON 排版、参数顺序或猜测 CAS 不重置失败计数，真实内容变化可在原限额内重试。真实拒绝、未知操作、权限不足或原期限耗尽继续停止。

若下一步打开真实操作入口，必须由实际操作人在终端逐份核对精确请求并亲自输入显示的 `Approve <digest>`；聊天回答不签发授权，Agent 不代输。两份 H5 后、首次业务派发之前，活凭据只通过一次性私有 IPC 转交独立工作进程；工作进程拥有本地服务、Native 子进程和文件日志，父终端可正常退出。此交接不恢复旧 attempt、不增加期限；外部整棵进程树被结束时仍可能中断，需按真实日志保留未知状态。

[订单 H5 前检查](orders-r10/pre-h5-1794243943209/result.json)和[发布页 H5 前检查](publish-r14/pre-h5-1794244207890/result.json)均验证真实服务、Native 计划、冻结入口、静态接收/依赖/矩阵、缺陷基线拒绝、未签名 preview 和真实 Codex 无 grant 启动拒绝。尚无正式准入或业务通过。

[最终只读审计](blocker-exit-audit-1794244294631/result.json)再次核对当前来源、297 原文和 578 历史原始文件、根无关 workflow 的 state/audit 与自主控制路径缺席。旧 publish-r13 的两个领取及未知 turn 原样保留，具体 OS 终止触发者仍未确定；旧授权、完成片段和工程夹具签名结果都不用于放行新批次。P1-10 与完整 P1 仍未通过，业务 verification.json 不存在。
