# P1-10 新操作请求：orders-r9 + publish-r13

状态：本页保留已签发的历史 H5 审阅范围，当前没有待签发请求。两项真实授权后于 22:19:08 并行首次试跑；订单 22:38:10 正常 incomplete 退出，发布页 22:54:24 最后事件后发生未知原因宿主失联，无正常退出记录，两个领取保留、原生 turn 状态 unknown。最终 [578 文件核验](interrupted-attempt-audit-1794236912565/result.json) 已完成，P1-10 未通过；不得将以下原输入说明当作再次批准或恢复旧授权的请求。

原 Core 签发命令于 2026-11-09 22:18:50.602 / 22:19:08.012（Asia/Shanghai）分别 exit 0；两项于 22:19:08.064 / .069 并行首次派发。授权前核对见 [operator-readiness-1794233768446](operator-readiness-1794233768446/result.json)，完整 32 项工程和三个分发检查均通过。

工程原始记录见 [engineering-1794232442296](engineering-1794232442296/results.json)，297 工具文件整轮保持一致，摘要 63488681fff2a56f672440bbc38301e98b5943230e8464a8516cb16e8dec29d1；原文见 [H5 来源归档](h5-tool-source-1794232442296/manifest.json)。[distribution-1794233729366](distribution-1794233729366/results.json) 的十种 Harness 构建、逐文件一致性和选定烟雾检查均通过。单元 UC-D 检查是 FD-only 子集，旧完整两单元 timeout 不声明通过。

真实操作窗口已于 2026-11-09 22:17:18（Asia/Shanghai）打开，标题 orders-r9 + publish-r13，PID 39968；首次观察到订单自有服务于 22:17:20 启动，等待第一份精确请求的真实终端确认。两份签发后自动并行开始实施；此窗口状态不等于 H5 已签发。

| 试点 | 新 Workflow ID | 新 Native thread | 新 run_id |
| --- | --- | --- | --- |
| orders-r9 | 1e18639d-d49e-4b31-9dcf-afa6ba6de08e | 01a1c097-6481-73f1-bee3-3988c66ba9a1 | bfa59bc3-e344-4775-b6a6-c4dd7403fe6d |
| publish-r13 | da3b7b9d-b06e-4a0d-8469-6f7e1d8abfba | 01a1c098-457a-77b1-bce1-0265975b15ac | e4992ddb-db87-4840-a0d1-59c76966bdb2 |

两个独立隔离 Git 仓库分别采用真实 Codex 0.164.0 / gpt-6.1-sol，会话原生配置摘要仍为 86d159ab4ca8f0525245eab10fb8bc4330a756df7072c71cac8eb1ddbcbf3a5b。每个批次只有 project/default 一个活动交付单元，初始实现仍是未验收的缺陷脚手架，不提供实施测试或旧解法。未复制完成行、控制证据、旧 grant 或 attempt。发布页逐字节接收原获批设计和原 Git 基线，正常记录 H3，来源格式校正单独留痕；单模块与 HTML Mock 使用原真实答复。

订单保留 0/1/49/50/51/100/101/120 边界、每页 50、完整顺序与原值、一次获取、独立调用、真实 HTTP/超时和原错误身份。发布页保留 aggregate AC 加十二个故事 AC、十二个 UC-D、ready/draft/published/error/retry 乘两种尺寸的十个组合；验证真实 API、草稿防绕过、结果持久性、失败/重试和 View result 实际导航。完整 346x240 产品区域差异像素必须为零，全图差异上限 0.001。独立 HTML/PNG 在实施之前冻结，不从候选生成设计标准。

两项真实 H4 决策仅选择已允许的兜底策略，实现/验证引用仍为空、human_review=pending。宿主在首次 C8 前按精确单元补录合法引用，之后重新候选、观察和 Native。最终必须由 Core 将同一当前候选的完整矩阵、Native 门禁与决策 current_validation 汇合为签名 verified。

每份请求最长 3600 秒，等价重试 2、活动单元 1；允许现有正常工作流/阶段报告、决策、受控证据、验证、设计/代码/测试/环境写入及本地候选提交。写入限 src、tests、docs/aidlc/modules/project/construction、delivery、.runtime；冻结设计、政策、矩阵和 UC-D 继续保护。push、部署、受保护分支、候选整合与 successor 未授权。

本轮修复在候选、完整观察与最终汇合前重新检查准入新鲜度，必要时用原冻结计划和正常协调 binding 在原期限内重新预检；已完成候选不因续验重放。单个 Native phase 生产者的成功空输出只表示 command-completed、evidence_verified=false，不能绕过正式门禁。真实失败、人类 rework/block、历史 RED 输入变化和未知操作继续阻断，不增加权限、预算或期限。

两份真实 H5 均签发后，两个独立进程并行首次运行，各自持有独立环境、root、thread 和 grant；两项结束后统一关闭服务。日志直接落盘，对账和清理先于终端总结。旧 orders-r8 / publish-r12 已 incomplete 结束并对账，412 个原始公开档案见 [退出核验](ended-attempt-audit-1794231674913/result.json)，旧授权不可复用或恢复。

H5 前必须完成当前完整工程轮、分发一致性、Native 接收/范围/所有权、冻结命令与入口语法、完整功能/UI 计划、真实服务可用性、实际缺陷基线拒绝、未签名 preview 和真实无 grant 启动拒绝。无 grant 时 admission 仍 not-ready；这些准备检查不代表业务通过。

操作窗口入口为 operator-pilots.ps1，父进程不打开或代写 stdin。依据 [Core 交接协议](../../../../core/knowledge/protocols/common-session-handoff.md)，H5 必须由真实操作人在新窗口逐份核对精确请求，并亲自输入显示的 Approve <digest>。聊天回答、模拟 TTY 或 Agent 输入不签发授权；两份新请求各自具有不同摘要。
