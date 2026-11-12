# P1-08 Spec / Standards 审查

模式：`INDEPENDENT_DUAL_AXIS`。本次由同一 Codex 宿主分别完成两轴检查，没有启动独立 Agent；不将此维护记录视为业务项目的 Native C7、reviewer approval 或受控 review-evidence。

输入：总体设计 P1-08 任务、contracts-v1 第 7/15/16 节、P1-01～07 已实现契约；本轮三个 batch 工具、状态/签发/编排/语义门禁、Codex runtime、相关测试和规则差异。适用标准为仓库既有 session/publication/证据和安全路径约束，以及 code-review skill 的两轴要求。最终测试、构建、源码摘要由同目录 verification.json 逐项引用。

## Spec Axis

| 检查 | 结论 |
| --- | --- |
| 同一实际最终候选、完整矩阵与 AC/UI/consumer closure | 完整矩阵不可用时保持 incomplete；真实当前断言失败发布 failed；partial 不进入完整验收 |
| Native 门禁与 UI | 实际加载原 Native 检查器，保留历史 TDD 规则；C8/条件全局审查/原 UI full acceptance/当前页面还原独立核验，功能和截图 passed 不替代它们 |
| 交付范围 | 聚合 requires、UC-D 所有权与审查输入只覆盖本批次 implement；原 I13 不裁剪；未来单元不阻塞，consume/verify 仍经过消费与 UI 边界 |
| 委托决策 | 实施引用属于对应单元且已跟踪；普通 passed JSON 拒绝；历史签名声明依据与当前候选验证投影分开，pending 人类评审不阻塞真实工程通过 |
| 结果与完成 | verified/failed/blocked/incomplete、current/stale/unknown、human review 分开；批次完成不直接设置项目 done |
| Core / 宿主边界 | Core 只核验和发布；宿主沿用原 Supervisor、候选准备、工具前校验、预算和取消对账 |

Spec 结论：实现符合本阶段契约。完整 Native 模型无人值守业务试点和 UI Native 正向批次尚未由本记录验收，按 P1-10 执行。

## Standards Axis

| 检查 | 结论 |
| --- | --- |
| 授权与可信来源 | 原 grant/binding 和 session publication；固定真实 Native 子进程，模型不能提交完成布尔值或新增命令 argv |
| 持久化与幂等 | 不可变签名 receipt 先写、state 严格引用后发布；失败留下未引用 receipt；同 convergence_digest 不追加 state/audit |
| 源码与证据漂移 | 绑定候选、工作区、原始文件、Native 上下文/状态事实、决策及 checker；只读失效保留历史结果，不复用过期当前资格 |
| 发布窗口 | 锁内复核输入和真实依赖；在最后依赖探针后再次核对观察期限 |
| 宿主执行 | 冻结 candidate command 类型校验；正式 C8 交接；未知操作阻断终结；有界证据刷新不启用源码写入；取消前读取当前 Core 结果 |
| 验证诚实性 | 真正命令/函数/HTTP/Chrome 原始证据与模拟 H3/审查/阶段行明确分开，归档不携带 issuer 私钥 |

Standards 结论：未发现未解决的关键或重要问题。结果处理复用仓库现有读写和签发组件；未另建 Supervisor、进度库或授权体系。

## 修复与复核

- 聚合 Native 依赖/UC-D/审查文件此前会纳入未来单元：改为已采用批次的 implement 范围；真实 Native 订单夹具包含 future 单元而无需其 GREEN/review 即可完成当前批次。
- 委托验证仅靠有 passed 字段的文件不可信：改为 Native 已复核引用或签名历史观察，并要求当前候选真实检查；正反用例分别验证拒绝与 pending-review verified。
- 候选不可确定时，修复输入可能让旧 blocked 结果仍看起来 current：绑定 working_revision；制品损坏/恢复用例验证失效。
- 最后的依赖活性探针可能跨过观察有效期：发布前额外复核 valid_until，避免把过期观察签为可完成结果。
- 宿主在 cancel 后再读取 Core 会使用已中止网关：改为取消前取得当前结果，取消后仅做操作对账；路由和预算/取消回归覆盖相关分支。

开发期夹具失败还包括刷新时错误设置当前活动阶段、project refresh 未指定精确实例、互斥 CLI 参数，以及候选命令配置夹具缺少既有必填 input_paths；均修正夹具协议，未削弱 Core 门禁。失败日志保留；最终通过状态以 verification.json 中选中的日志、实际退出码和哈希为准。
