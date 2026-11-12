# P1-10 阻塞修复复核

后续整体复审已补充[新的路径缺口和效率审计](../../../aidlc-autonomous-p1-10-integration-review.md)。本页 DONE 仅保留当时局部修复的验证事实；“没有遗留已知工程修复项”不再作为当前结论。当前整体集成 HOLD，整改未完成，不进入真实试跑。

范围：决策引用与真实输入重试、长命令剩余窗口、宿主生命周期与首次启动所有权；不包含真实双试点验收或 P2 接管恢复。同一主 Agent 分别复核 Spec 与 Standards，没有声明另一位审查者或子 Agent。

## Spec

| 要求 | 实现与证据 | 结论边界 |
| --- | --- | --- |
| 模型能读取实际决策引用契约 | Core 单一字段列表生成 write_contract；真实 CLI 以该契约补录后完成 C8 汇合 | 工程机制已通过，不替代真实 Codex 业务试跑 |
| 等价请求不能绕过重试，内容变化可重试 | Canonical JSON、参数/实例归一化、实际 Core 输入摘要；独立 filename/format/CAS 正反例 | 总授权期限和 wall budget 未增加 |
| 长命令结束前仍有有效准入及发布余量 | 真实 probe ≤900 秒且原 deadline 封顶；派发前窗口检查、原计划续验及精确正式入口恢复；Core 和冻结命令执行期限缩短 | 新窗口不足或真实拒绝均停止，不事后伪造通过 |
| 中断可观察且不被当作业务完成 | 同步 journal、OS 出生标识、真实 turn 和子进程关闭；只读 inspect-run；实际 RPC 失联与 SIGKILL 测试 | 历史 OS 触发原因未知，旧领取保持未对账 |
| 授权窗口可正常退出而执行继续 | 新业务首次派发前的私有 IPC 及 detached worker；实际父退出/确认前失联测试 | 无自动 restart、successor 或失联接管；外部整树终止不承诺存活 |
| 完整功能与 UI 分母不下降 | 未修改产品 AC/UC-D/矩阵阈值；Core 原 I13/RED/GREEN/C7/C8 与候选绑定保持 | 新批次真实功能/UI 最终验收仍待 H5 后执行 |

## Standards

只复用现有 session binding、grant、Supervisor 和 handoff CAS。模型不获得私有 binding/环境/私钥，公共日志只保存摘要；IPC 参数不写磁盘或命令行。worker 不从 state 重建 generation，已有 attempt 明确拒绝。父进程一旦确认交接，不在失败路径中猜测回收凭据。终端始终由实际操作人输入精确挑战。

取消路径区分发送信号与实际关闭；未观察到子进程关闭或 turn 终态不作为 verified，未知操作保留领取。退出观测不写伪 exit。只有本次拥有的隔离测试进程被强制结束，历史运行只读。根无关 workflow 不参与测试 fixture，FD-only 边界继续标注。

## 当前检查状态

修复前原始失败与定向通过已保留。第一完整轮 engineering-1794241285856 共 39/40 通过，真实 CLI 汇合通过；唯一失败是旧 admission-barriers 夹具遗漏新增受检 read。夹具适配后 12 项场景通过。离线检查补充不依赖模型配置、未关闭 Native 子进程和身份不完整日志行的覆盖，定向测试通过。最终冻结轮 [engineering-1794242556345](engineering-1794242556345/results.json) 40/40 全通过，297 工具及 326 测试/控制器输入前后不变。独立 [分发](distribution-1794243641819/results.json) 三项通过，覆盖十种 Harness 和 2948 文件。两个新批次 H5 前检查及 [待审阅核对](operator-readiness-1794244236646/result.json)通过。

Spec/Standards 在本次工程范围 DONE；[最终只读审计](blocker-exit-audit-1794244294631/result.json)重新核对来源、297 归档工具、578 历史文件、旧发布页两项领取和根无关工作流。没有遗留的已知工程修复项。历史 OS 终止触发者 NEEDS_CONTEXT，真实 P1-10 双试点结果仍 OPEN，不用工程汇合或静态预检代替真实授权和业务验收。
