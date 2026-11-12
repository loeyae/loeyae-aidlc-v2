# P1-10 两个独立试点的操作端运行请求

本页请求现为历史记录：orders-r7 与 publish-r11 均已由真实用户签发并实际执行，分别于 18:59:06、19:36:56（Asia/Shanghai）incomplete 退出，父服务与领取已对账关闭。两份授权都已到期，没有待输入的批准，不应继续操作旧窗口或复用旧 attempt。实际签名、原始档案和退出核验见 [ended-attempt-audit-1794224298126](ended-attempt-audit-1794224298126/result.json)。后续修复没有改写这些请求或授予新的运行权限。

2026-11-09 操作端重试说明：订单原 H5 已于 10:27:16 UTC 实际签发；发布页空输入被拒绝，两项尚未派发 Native 运行，原父进程正常关闭服务并释放领取。用户明确要求重新操作后，按 operator-retry-readiness-1794220551368 核验：订单原授权有效、原会话/宿主/范围/操作/预算与输入均未变化，无 attempt、无实施、无现存领取。只允许通过既有 Core API 创建正常的新领取并 bind 原 grant 后首次启动，不读取或重建旧 generation，不签发替代授权、不延长原 11:17:42.295 UTC 截止，也不恢复任何已有 attempt。新窗口只展示发布页待签发请求；原实际订单签发记录按原摘要和原时间保留，不能改写成再次批准。十二项边界回归、类型检查与实际只读检查通过，27 项工程轮的 297 工具来源未改变。

以下是当时授权前的 orders-r7 / publish-r11 说明。此前 orders-r6 / publish-r10 均已 incomplete 结束并对账，原始档案与请求保留，旧 grant 和 attempt 不复用。这里不是运行授权；当时精确 payload 与 digest 由真实操作终端显示并确认。

当前工程回归 engineering-1794218305792 的 27 项全部通过，297 工具文件来源稳定；distribution-1794219164259 的十种 Harness、2948 文件及三个分发场景通过，最终操作端复核 operator-readiness-1794219368613 通过。新操作窗口只在上述检查之后打开。FD-only 检查范围单独标注，旧完整两单元 timeout 未被改记为通过。

| 请求 | 工作流 / Native 会话 | run_id |
| --- | --- | --- |
| orders-r7 | e465954e-403a-49f3-b605-3e5b45c5545e / 01a1bfb1-23a3-7272-8793-723fa5c45cff | 51c23a76-3fb9-40ae-8e83-208acb5edebd |
| publish-r11 | 069c54da-2a42-43d3-9bf5-42aa33dcb882 / 01a1bfb1-f6bf-7b03-aab8-6ab1071ed65a | d52638ce-f569-43e8-a36a-3f4660f15c0e |

两个项目各自拥有独立隔离 Git 仓库、project/default 交付单元、实际 Codex 0.164.0 / gpt-6.1-sol 准备会话和服务。每项最长 3600 秒、等价重试 2、同时实施单元 1；两份独立请求均在实施之前收集。允许现有工作流、阶段报告、受控决策/证据、验证、设计/源码/测试/环境写入及本地候选提交。业务写入仅限 src、tests、docs/aidlc/modules/project/construction、delivery、.runtime；原设计、政策、完整矩阵、UC-D 和其他冻结输入受 Core 保护。push、生产部署、受保护分支写入、候选整合和 successor 均未授权。

修复限实际发现的宿主衔接与验证问题：识别真实公开空预览，候选处理返回协调实例后再精确选择 C8；已完成代码生成派生失效由 Core 指定有序 all-sensors refresh，GREEN 先于其依赖；最终 Native 拒绝同样由 Core 产生精确建议，宿主在原预算与网关下有界执行，原签名失败保留。只有其他检查通过或仅剩合法元数据缺项才自动刷新，实际功能、准入、权限、人类审批和历史 RED 输入变化继续阻断。模型每个 turn 完成当前阶段报告后返回宿主；测试应在 RED 前做正控，accepted RED 的命名输入不能在 GREEN 静默替换。

没有供应业务解法或实施测试。订单保留 0/1/49/50/51/100/101/120、完整顺序和原值、一次获取、独立调用、真实 upstream/超时及原错误身份。发布页保留聚合 AC 与十二个故事 AC、十二个 UC-D，五种状态/旅程乘两个尺寸的十项严格 UI 组合，以及 API、防草稿绕过、实际结果、失败/重试与 View result 导航。两者都必须通过 Native I13/TDD/C7/C8 和最终 Core 汇合。

此前已明确批准的发布页应用设计按原审阅快照逐字节接收并正常记录，没有重问同一设计批准，没有复制批准行或旧控制证据。两项目的真实模型各登记一项合法兜底计划，实施/验证引用仍为空、human_review=pending；这些记录不是交付通过。计划登记后重新执行当前接收生产者；真实服务预检、冻结命令解析、完整观察计划静态校验及实际 Codex 无 grant 启动拒绝已完成，缺少真实授权时 admission 整体仍为 not-ready。

入口 operator-pilots.ps1 仅让 Core 子进程读取输入，父进程不打开或代写 stdin。实际操作人必须逐份核对终端显示的精确请求，并亲自输入各自的 Approve <digest>。依据 core/knowledge/protocols/common-session-handoff.md：Agent 不得代输终端确认，不能把模拟 TTY、测试 fixture 或模型生成的 Approve 当作用户输入。设计批准、聊天回答和窗口可输入反馈均不签发新运行授权。
