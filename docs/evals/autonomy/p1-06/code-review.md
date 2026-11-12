
# P1-06 工程双轴审查

状态：DONE。两轴工程审查通过；不代表业务批次 verified 或完整 P1 已验收。

模式：INDEPENDENT_DUAL_AXIS，同一宿主分别形成 Spec / Standards 结论，不声称独立人类或另一 Agent 审查。范围：Codex runtime、Core adapter/IPC、准入接入、工具/预算/取消、路由与规则。依据：用户 P1-06 请求、总体方案 P1-06、contracts-v1 第 14 节、既有 grant/session/native gates。工程维护不推进当前业务 workflow，本记录不是正式 C7 或受控 review-evidence。

## Spec Axis

结论：P1-06 一个实际 Codex 宿主的工程范围与设计一致，38 个专项场景和相关 Core 回归通过；实际六项原生能力及同 thread 复用已观察到。

核对一个实际宿主、原生 Supervisor 复用、同 thread 精确 binding、正式 next 在代码工具前执行、持续路由不依赖逐阶段继续、分阶段依赖和跨单元选择、准入刷新不延长 grant、有限预算及诚实退出。Core 不持有模型循环，其他 Harness 无 runtime 时仍未知；UI 基础能力不冒充 UI 还原。业务结果与批次终点仍待 P1-07/08，试点实跑待 P1-09。

## Standards Axis

结论：重要问题已修复并通过复验；类型检查与原生探针通过，十种 Harness 构建成功，2868 文件分发一致性通过。

| 问题 | 级别 | 修复与复验 |
| --- | --- | --- |
| 原生配置对象键顺序跨进程变化造成误失效 | 重要 | 使用递归规范 JSON 摘要，真实 adapter 复验；内容变化仍拒绝 |
| 空 thread 没有 rollout，prepare 输出无法用于 run | 重要 | 无业务副作用初始化 turn 固化会话；实际同 thread 复用和工具调用成功 |
| 仅 preview/持有 grant 可能绕过首次 Native 前置 | 重要 | 正式 next 成功进入精确实例才解锁 code/test；新增 NOT_ENTERED 负例 |
| 无进展判断若绑定 revision 会被领取/heartbeat 记账干扰 | 重要 | 绑定原生阶段进展与源码摘要，不以领取代次/日志推进重置 |
| 全部目录中的 aidlc 子串会误封合法 docs/aidlc 设计写入 | 重要 | 只封活动根控制面并拒绝 .git/.aidlc/链接，合法设计产物有正例 |
| 取消后 turn 可先结束，命令退出观察尚未到达 | 重要 | 明确等待所属操作 close；未确认退出记 unknown/PID，不把 interrupted 等同对账完成 |
| 原生结果和操作输出可能泄露 binding generation | 重要 | 私有 host IPC 不注入模型，路由与 Core 工具结果过滤；操作日志只保存摘要 |
| 重启后进程内计数会清零、重复未知操作 | 重要 | 一个 grant 一个 P1 attempt，已有记录 fail-closed，不自动接管；P2 再恢复 |

实际探针最终日志 native-adapter-final.log 与 native-session-reverified.log、38 项专项日志和其余回归均保留；此前原生配置、空会话和取消事件竞态失败不计为通过。受信任命令的已声明 footprint 仍需在交接时审阅；Hook 不承诺覆盖任意宿主工具/插件或抵抗拥有 OS 控制权的程序。取消不回滚已执行的外部副作用，未知结果不能盲重放。

补充核对：宿主可以只读获取安装包中的阶段/知识/技能 Markdown，不能通过该入口读取授权实现、密钥或扩大业务写范围。P1 同一 grant 的重复 attempt 拒绝重放；探针本身受原授权绝对 deadline 约束，取消先等实际命令 close，再封存成功观察。

最终保全：当前 DeepSeek state/audit 与既有哈希一致；当前仓库没有新增 grant、issuer、准入/原生探针凭据或 host attempt。实际原生探针只在临时项目执行，原始观察保存在本工程记录目录。构建使用已有构建器，生成目录的 Windows 占用按有界原生清理恢复。
