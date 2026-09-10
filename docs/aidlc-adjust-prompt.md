# 提示词：修复 AI-DLC v3.1 迁移锁接管与跨工具连续工作

> 用途：交给 loeyae-aidlc 维护方实施。目标是让同一 actor 在 Kiro Crew、Claude Code、Kiro CLI 等不同工具或设备之间，能够在不复制私钥、不共享 `AIDLC_TRUST_SECRET` 的前提下接手 v2→v3 迁移留下的活动实例。本规格以当前 3.1.0 canonical source 为准。

---

## 已核验的问题

v2→v3 迁移会把任意活动 v2 instance（不只审批 Stage）投影为：

```text
compatibility_lock: true
lease_expires_at: null
provider_id: migration:v2
provider_receipt: absent
```

该 claim 不会过期、不能续租，且没有 `report` 所需的 Provider receipt。现有 `state migrate-v3 --repair` 只能重建尚无迁移后业务事件的 migration-only state，仍会生成相同 compatibility lock，不能完成 execution lease 接手。

`recover re-enroll` 仅用于 schema v2/HMAC legacy 信任链恢复，不得用于 v3 claim 转移。`park` 只冻结 workflow，也不释放 instance claim。

当前 `teamEnrollmentGate` 已先于 scope-selection 执行；存在合法 schema v3 state 但本机未 enrollment 时，应继续返回 `ask_type: team-enrollment-confirmation`。如果真实宿主返回 scope-selection，先核对 cwd、CLI 版本、state 路径和 schema，不先假定是 `AIDLC_TRUST_DIR` 缺失。

---

## 确定方案

采用专用的 **migration compatibility claim recovery**，不从既有三种错误路径中选择：

- 不因 team enrollment 自动夺取 claim；
- 不调用或扩展 legacy `recover re-enroll`；
- 不要求已失联的旧 client 先 release；
- 新工具必须使用与旧 migration claim 相同的 `actor_id`。允许 `device_id`、`client_id` 和设备 Ed25519 key 变化；不同 actor 的移交仍须先由项目协调 Provider 变更 assignment/授权，本次不虚构 owner PKI。

授权边界沿用当前 v3 契约：Provider/SCM 写权限决定谁可提交共享流；跨回合随机短语证明本次真人确认，但不宣称完整成员授权 PKI。

---

## 执行要求

### A. 新增跨回合迁移锁恢复门禁

1. 新工具没有 enrollment 时，先走现有 `team-enrollment-confirmation`：展示 `JOIN ...`，结束回合，用户下一条消息精确输入后通过 `--team-enrollment-confirmation-stdin` 登记本机 key。
2. enrollment 完成后，`orchestrate next` 检测目标 instance 的 migration compatibility lock。普通 `next` 应优先处理唯一的同 actor migration lock；也支持 `--instance <id>` 精确定向。
3. 引擎返回 `ask_type: migration-claim-recovery-confirmation`，请求至少绑定：canonical project root、workflow ID、state SHA、event head、stage instance、旧 claim digest、旧 actor、新 device/client identity、本机 device key、目标 Provider、随机 challenge 和 15 分钟 TTL。
4. Agent 展示完整 `TAKEOVER ...` 短语后结束回合。只有用户下一条真实消息全文精确匹配，才能通过 strict `--migration-claim-recovery-confirmation-stdin` 提交；拒绝未知字段、近似文本、尾随空格、过期、重放、错误 request、错误 instance、state/head 变化和 identity/provider 变化。
5. 成功后，通过 state lock/Provider CAS 原子地将 compatibility lock 转成正常有限期 lease：
   - Local Provider：在同一 state mutation 中签发 receipt；
   - Git Provider：先由远端 coordination ref CAS 接受 claim 并返回 receipt，再幂等镜像到本地 state；远端已有其他有效 claim 时拒绝；
   - append-only event chain 保留旧 migration claim，只追加带旧 claim ID、恢复 request ID 和原因的审计事件；不得重写旧事件。
6. 新 lease 必须包含 Ed25519 Provider receipt，随后同一 `next` 返回正常 `run-stage` directive；该 receipt 可用于普通或审批 Stage 的定向 `report`。

### B. 状态诊断

- `orchestrate next --status` 增加 `migration_locked_instances`，但不创建恢复请求、不要求 actor/device/client。
- 有 schema v3 state但未 enrollment 时继续使用现有 `kind: ask + ask_type: team-enrollment-confirmation`，不新增不兼容的 directive kind。
- 只有 state 不存在时才返回 scope-selection。增加 subprocess 回归：清空显式 `AIDLC_TRUST_DIR`、使用临时稳定 HOME、存在 v3 state且未登记时仍返回 enrollment ask。

### C. Trust root 文档

明确 v3 runtime 必须具有持久、设备私有的 trust root：通常自动使用 `~/.config/loeyae-aidlc/trust`；只有宿主没有稳定 HOME、使用临时沙箱或需要隔离时才显式配置 `AIDLC_TRUST_DIR`。不得把该环境变量写成所有成员的强制配置，也不得把 v2 `AIDLC_TRUST_SECRET` 当作 v3 团队身份。

### D. Canonical 文档与 Skill

更新实际 canonical 文件：

- `docs/aidlc-collaboration-v3-contract.md`
- `docs/loeyae-aidlc-cli-guide.md`
- `core/skills/aidlc-continuity/SKILL.md`
- `core/skills/aidlc-approval/SKILL.md`
- CLI help 与相关 harness source

文档必须说明：approval 的“禁止跨设备”是禁止复制 private key、共享 secret、转发 receipt/token；合法连续工作是新工具先登记自己的 key，再由引擎通过独立 migration recovery challenge 生成属于新 device/client 的新 receipt。

---

## 验收测试

- [ ] 任意 active v2 instance 迁移后被识别为 migration lock，而非只覆盖审批 Stage
- [ ] 原 actor 在另一 device/client 完成 enrollment → TAKEOVER 跨回合确认 → 获得有限期 Ed25519 receipt
- [ ] 转换后的普通 Stage 可正常 report；审批 Stage 可继续走独立 APPROVE 确认并完成
- [ ] 不同 actor、错误 instance、错误 device/client/provider、过期、重放、尾随空格、未知字段、state/head 变化均拒绝
- [ ] 两个恢复进程并发时只有一个 state/remote CAS 成功
- [ ] 普通非 migration claim、已完成实例和已存在正常 receipt 的实例不能使用恢复入口
- [ ] Git Provider 远端先确认后才返回可执行 directive；失败重试不会产生两个活动 claim
- [ ] 历史 event 字节不变，只追加合法签名事件；enrollment event head 自动前进
- [ ] 未显式设置 `AIDLC_TRUST_DIR` 的未登记 v3 runtime 返回 team enrollment ask，不返回 scope-selection
- [ ] `npm run typecheck`、迁移锁定向测试、state/scheduler/Local/Git/CLI/enrollment 回归、`npm run build:all` 和 distribution parity 全部通过

---

## 硬约束

- 不读取、复制或输出 device private key、`AIDLC_TRUST_SECRET`、recovery secret
- 不调用或修改 legacy `recover re-enroll` 来实现 claim 恢复
- 不把 claim receipt 放进 argv、聊天、日志或项目文件
- 不手工编辑 state/integrity/enrollment；只能通过引擎锁、Provider CAS 和签名 append-only event 修改
- enrollment 短语只授权 enrollment；TAKEOVER 短语只授权 migration lock 转换；APPROVE 短语只授权当前审批，三者不得互相替代
- 不允许不同 actor 仅凭 enrollment 接管 migration claim
- 不为普通 Stage 增加审批语义；TAKEOVER 是 execution lease 恢复门禁，不是业务审批
- 不新增第二份流程契约，不把 `docs/aidlc/v3-process-contract.md` 当作 canonical source
