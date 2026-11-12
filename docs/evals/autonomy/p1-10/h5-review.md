# P1-10 新操作请求：orders-r8 + publish-r12

状态：本页为 orders-r8 / publish-r12 历史请求。两份真实 H5 已签发并首次运行，当前均 incomplete 结束且已对账，旧授权不能复用。新轮见 [orders-r10 + publish-r14 当前待 H5 审阅页](h5-review-orders-r10-publish-r14.md)；r9/r13 已结束或失联，保留 [历史页](h5-review-orders-r9-publish-r13.md)；以下保留原审阅范围，历史输入说明不代表要求再次批准旧请求。

最终准备记录见 [operator-readiness-1794229484317](operator-readiness-1794229484317/result.json)。[完整 30 项工程检查](engineering-1794228204922/results.json)本轮全部通过，297 工具来源保持 a712110d3cfd85d9cb30cb4c41c088634b8a77db21ce0769ca97d4e2c4b444ac；[分发检查](distribution-1794229457122/results.json)的十种 Harness、2948 文件一致性和三个场景通过。第一次分发的目录占用 EPERM 原始失败保留，检查进程结束后单独重建通过。当前工具原文另存 [H5 来源快照](h5-tool-source-1794228204922/manifest.json)。

| 试点 | 新 Workflow ID | 新 Native thread | 新 run_id |
| --- | --- | --- | --- |
| orders-r8 | 9d775795-33c4-445e-9284-a67e1c30a17f | 01a1c056-cc14-7323-a714-2e7cd78d9a55 | 29a4112b-8765-41ab-9a58-ba202400c127 |
| publish-r12 | e91b29bc-a974-4ee8-bf11-68c0b4a253e5 | 01a1c057-5a1c-7970-b652-d3610496eecb | 5749eb49-195c-496b-b8eb-a61027d15aeb |

两个独立隔离 Git 仓库分别使用真实 Codex 0.164.0 / gpt-6.1-sol 新会话，一个 project/default 单元。初始实现仍为未验收的缺陷脚手架，实施测试未供应；没有接收旧完成行、控制证据、解法或授权。发布页逐字节接收原获批应用设计，正常登记新 H3，来源标题格式校正另有记录；原接口、状态、验收分母不变。单模块/HTML Mock 复用用户已有明确选择。

订单保留全部 0/1/49/50/51/100/101/120 边界、50 条分页、完整顺序/原值、一次获取、独立调用、真实 HTTP/超时与原错误身份。发布页保留 aggregate AC 加十二个故事 AC、十二个 UC-D 和十个 UI 组合，以及真实 API、防草稿绕过、结果持久性、失败/重试、View result 导航和严格像素检查。各有一项实际 H4 兜底计划，实现/验证引用为空、human_review=pending，不是验收成功。

每份请求最长 3600 秒、等价重试 2、活动单元 1。允许正常工作流/阶段报告、决策、受控证据、验证、设计/代码/测试/环境写入及本地候选提交；写入限 src、tests、docs/aidlc/modules/project/construction、delivery、.runtime。冻结设计、政策、矩阵与 UC-D 继续受保护。push、部署、受保护分支、候选整合和 successor 未授权。

宿主先在精确已审查单元补录合法委托引用，再重新准备候选和观察、必要 Native 与正式 C8；实际失败、人工 rework/block 和历史 TDD 输入变化继续阻断。两份 H5 均签发后两个独立进程并行试跑，每个批次仍一个活动单元；日志落文件，对账和服务清理先于终端总结。

H5 前核验真实 Native 接收/I13、完整范围与所有权、冻结命令/入口语法、完整功能/UI 计划、真实服务可用性、缺陷基线拒绝、未签名 preview、真实无 grant 启动拒绝、30 项工程检查与分发一致性。无实际 grant 时 admission 仍 not-ready。

入口 operator-pilots.ps1 仅由 Core 子进程读取终端输入，父进程不打开或代写 stdin。请本人在新窗口逐份核对并输入显示的 Approve <digest>。依据 core/knowledge/protocols/common-session-handoff.md，Agent 不得代输；聊天回复、模拟 TTY 或工程夹具不签发运行授权。

[上一轮历史请求](h5-review-orders-r7-publish-r11.md)对应的两个旧 attempt 已 incomplete 结束并对账，旧授权不复用。本轮成功仍须由 Core 将同一最终候选的 Native、完整功能/UI 矩阵和委托 current_validation 汇合为签名 verified。
