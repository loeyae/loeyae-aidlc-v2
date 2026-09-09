# AI-DLC 协作状态 v3 契约

本文定义 Loeyae AI-DLC 3.0.0 的多人、多设备协作机器契约。新 workflow 默认使用 schema v3；schema v2 仅作为单游标兼容路径保留，并且不会被隐式迁移。

## 当前能力边界

3.0.0 已具备：

- 签名 append-only event、确定性 reducer、instance map、workflow ID、单调 revision 与跨进程 CAS；
- 稳定排序的多实例 DAG ready set，以及 project/module/unit 定向 `next` / `report`；
- actor/device/client 身份、assignment 与短期 execution lease 分离、签名 claim receipt；
- Local Provider 的同工作树原子 claim/renew/release/transfer/complete；
- Git Provider 在专用 coordination ref 上的远端 CAS，并且只在远端接受后返回 receipt；
- External Work Management Provider 通用接口、严格 ETag/version CAS 与内存 reference implementation；
- workflow-wide freeze/resume/completion，以及 receipt-bound report 和 challenge-bound 人工审批。

仍需明确的边界：

- Local Provider 不提供跨工作树或跨设备互斥；这类协调使用 Git Provider 或后续具体 External Provider 连接器；
- 当前 External Provider 不是 Jira、TAPD、Linear 等厂商连接器；
- `handoff.md`、`unit-of-work.md`、普通业务分支和聊天文本都不能替代 Provider ACK、claim receipt 或审批凭据；
- schema v2 保持单全局游标，只能通过显式 `state migrate-v3` 受控迁移。

## 术语

| 术语 | 定义 |
|---|---|
| Stage instance | 由 Stage slug、axis、module ID 和 unit ID 确定的稳定执行实例 |
| Checkpoint | 一次通过签名与原子持久化的成功状态转换 |
| Assignment | 项目管理层面的长期负责人关系，不表示当前设备正在执行 |
| Claim | 协作者请求取得某个可执行实例的机器级所有权 |
| Execution lease | 绑定 actor、device、client 和有效期的短期排他执行权 |
| Claim receipt | 协调 Provider 对成功认领签发的不可伪造回执 |
| Actor | 一个自然人或受控服务身份 |
| Device | 同一 actor 使用的一台已认证执行设备 |
| Client | 设备上的一次宿主进程或会话 |
| Coordination Provider | 对 claim、lease、release、transfer 和 complete 提供原子排序的共享协调源 |
| Approval Provider | 将受信人类事件转换为 challenge-bound 一次性 token 的宿主能力 |

## 自动 Checkpoint 不变量

1. 每次成功状态事件都必须在命令返回成功前完成签名和原子持久化。
2. Stage instance 成功完成后立即成为稳定交接点，其满足依赖的后继实例自动进入 `ready`。
3. `park` 在 v3 中只表示冻结整个 workflow；它不是日常接手前提，也不是单实例 release。
4. 尚未完成的实例不能仅因存在部分产物而视为已交接；接手必须通过 lease release、transfer 或 expiry。
5. `handoff.md` 始终是派生的人类视图，不能改变 checkpoint、依赖、claim、approval 或 revision。

## Assignment、Claim 与 Lease

1. Assignment 与 execution lease 必须分离：项目管理工具可以长期把任务分配给某人，只有持有有效 lease 的设备可提交该实例结果。
2. Claim 必须先在共享协调源完成原子提交，随后引擎才返回可执行 directive。
3. 同一实例同一时刻最多存在一个有效 execution lease；不同实例可以并行持有 lease。
4. 同一 actor 可在另一 device 恢复自己的 assignment，但必须取得或转移 execution lease。
5. `report` 必须绑定 `stage_instance` 和有效 claim receipt；仅有 Stage slug、聊天声明或 handoff 表格不足以授权提交。
6. Provider 不可达且不存在有效 lease 时，新认领必须 fail-closed。

## 审批安全边界

1. Skill、关键词、Slash Command 和审批卡片只负责 UX 与路由。
2. 普通聊天文本不能作为审批凭据，Agent 不能代填确认短语或自行签发 token。
3. 受信宿主事件必须绑定 workflow ID、Stage instance、challenge、产物摘要、TTL 和 replay 状态。
4. 宿主 Provider 不可用时，只能回退到现有真人 TTY 命令；不得降级为聊天确认。
5. `application-design` 和 `operations` 继续是仅有的阻断审批 Stage。

## 协调 Provider 边界

### Local Provider

只保证同一工作树内的进程协调，用于单人模式和本地测试，不宣称跨机器排他。

### Git Provider

- 使用独立 coordination ref/branch，不写业务主分支作为锁；
- 通过 fetch、验证、追加签名事件和远端 ref CAS 完成认领；
- 远端接受事件前不得开始执行；
- Git 保存协调和审计事件，业务代码与正式产物继续遵循团队分支/PR 流程。

### External Provider

- 项目管理工具负责 assignment 和展示；
- AI-DLC 负责依赖、execution lease、门禁、Evidence 与审批；
- 适配器必须使用外部版本号、ETag 或等价 CAS，不能只读页面文本后假定认领成功。

当前仓库提供 `ExternalWorkManagementProviderV3` 契约、严格 Provider receipt 校验和基于内存的 reference contract implementation，用于验证 `listReady / claim / renew / release / transfer / complete` 语义。它不是 Jira、TAPD、Linear 或其他具体产品的连接器；在选择目标工具、认证方式和远端 API 前，不得宣称这些厂商集成已经完成。

## v3 状态投影

v3 的签名快照至少包含：

- workflow 元数据和事件 head；
- 以 `stage_instance` 为 key 的实例状态；
- 每实例 revision、依赖状态和更新时间；
- assignment、claim、lease 与 Provider receipt 摘要；
- per-instance approval challenge；
- completed/skipped 聚合结果。

允许的核心实例状态为：

```text
blocked -> ready -> claimed -> in_progress -> submitted -> completed
                                    |              |
                                    +-> blocked    +-> rejected
ready/claimed/in_progress -> skipped 仅允许由确定性 condition 或受控迁移产生
```

全局 `current_stage_instance` 在 v3 中仅可作为某个客户端的兼容 focus，不再是 workflow 的唯一执行游标。

## 事件与归约

协调与 workflow 历史采用签名 append-only 事件，至少覆盖：

- `workflow_initialized` / `workflow_migrated`
- `workflow_frozen` / `workflow_resumed` / `workflow_completed`
- `instance_registered` / `instance_ready` / `instance_skipped`
- `instance_claimed`
- `claim_renewed`
- `instance_released`
- `claim_transferred`
- `instance_started` / `instance_submitted`
- `instance_completed` / `instance_rejected` / `instance_blocked`
- `approval_requested`
- `approval_granted`

确定性 reducer 从有序事件生成 materialized snapshot。相同事件序列必须产生字节语义等价的状态投影；未知事件类型、非法转换、签名错误或序号断裂必须 fail-closed。

## v2 兼容与迁移

1. 新 workflow 默认创建 schema v3；仅显式设置 `AIDLC_COLLABORATION_V3=0` 时创建 schema v2 兼容 workflow。
2. 已存在的 schema v2 state 始终分流到旧单游标引擎，不因升级或环境默认值自动迁移。
3. `loeyae-aidlc state migrate-v3 --actor-id ... --device-id ... --client-id ...` 默认只输出计划；只有 `--apply` 才在锁内原子替换。
4. v2 的 completed/skipped 实例、history、choice 和 approval challenge 无损迁移；active current 实例成为绑定迁移身份的明确 compatibility lock，不能静默释放。
5. 迁移保持 workflow ID、enrollment 绑定和签名验证；失败、中断或 failpoint 触发时原 state 字节不变。
6. v2 recovery/re-enroll 的 parked、旧 key、source enrollment 与真人 TTY 证明要求不会因迁移降低。
7. 迁移 fixture 必须继续覆盖 round-trip、篡改、序号断裂和中断恢复。

## 3.0.0 启用状态

- 受信审批 UX、continuity Skill、v3 reducer、DAG scheduler、Local/Git/External Provider 契约均已进入 canonical source 和全 harness 分发。
- 顶层 CLI 依据落盘 `schema_version` 分流：不存在 state 时默认 v3，schema 3 走协作编排器，schema 2 走兼容编排器。
- `next` 的 directive 包含稳定 `stage_instance` 和 Provider ACK 后的 receipt；`report` 必须从安全 stdin 取得 receipt。
- 生命周期 Hook 在没有 holder identity/receipt 安全通道时 fail-closed，不代替另一协作者提交实例。
- 新 Provider 或厂商连接器仍必须先通过 CAS、receipt、lease 和并发竞态契约测试，不能只靠 UX 文案宣称可用。
