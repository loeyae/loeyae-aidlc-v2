# AI-DLC 协作状态 v3 契约

本文定义 Loeyae AI-DLC 从 schema v2 单游标执行模型迁移到多人、多设备协作模型时必须保持的机器契约。本文是实现约束，不代表 v2.4.0 已具备下述全部能力。

## 当前能力边界

v2.4.0 已具备：

- project/module/unit Stage 实例展开；
- 签名 state、workflow ID、单调 revision 与单工作树 CAS；
- 每次成功 `next`、`report`、条件跳过、park/resume 后的原子持久化；
- 绑定 workflow、Stage 实例和 challenge 的一次性人工审批 token。

v2.4.0 尚不具备：

- 多个全局活跃 Stage 实例；
- 受签名机器状态保护的 assignment、claim 或 execution lease；
- 跨设备、跨工作树或跨分支的远端原子认领；
- 对项目管理工具中的分配状态进行机器 CAS；
- 多写者 state 的自动合并。

因此，v2 文档中的 `handoff.md`、`unit-of-work.md` 和 Git 认领表仅为人类协调视图，不能证明机器级排他所有权。

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
3. 日常接手不依赖显式 `park`。`park` 在兼容期保留，v3 中只表示 workflow freeze 或管理员维护状态。
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

协调历史采用签名 append-only 事件，至少覆盖：

- `instance_ready`
- `instance_claimed`
- `claim_renewed`
- `instance_released`
- `claim_transferred`
- `instance_submitted`
- `instance_completed`
- `instance_blocked`
- `approval_requested`
- `approval_granted`

确定性 reducer 从有序事件生成 materialized snapshot。相同事件序列必须产生字节语义等价的状态投影；未知事件类型、非法转换、签名错误或序号断裂必须 fail-closed。

## v2 兼容与迁移

1. v3 正式启用前，新实现必须由显式能力开关隔离，v2 工作流行为保持不变。
2. v2 的 completed/skipped 实例、history、choice 和 approval challenge 必须无损迁移。
3. v2 存在 current 实例时，只能迁移为一个明确的兼容 active/claimed 实例，不能静默释放给其他 actor。
4. 迁移必须保持 workflow ID、enrollment 绑定和签名验证；失败时原 state 字节不变。
5. v2 recovery/re-enroll 的安全要求不会因协作 UX 简化而降低。
6. 每个迁移版本必须有 round-trip fixture、篡改测试和中断恢复测试。

## 分阶段启用条件

- 受信审批 UX 可在 schema v2 上独立启用。
- continuity Skill 可在 v2 上提供串行恢复，但必须明确不代表多人并行。
- 多实例调度只在 v3 reducer、迁移和定向 report 通过测试后启用。
- 远端认领只在 Provider CAS、lease 和并发竞态测试通过后启用。
- v3 成为默认模型前，所有 harness、文档、CLI、Hook、Evidence 和 recovery 必须完成分发一致性回归。
