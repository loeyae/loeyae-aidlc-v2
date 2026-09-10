---
name: aidlc-approval
description: "安全审阅并批准当前 AI-DLC 架构或部署门禁；默认要求用户在下一条对话消息中完整输入实例绑定的随机确认语。"
triggers: 审批当前阶段, 确认架构方案, 批准架构方案, 批准部署方案, 驳回当前方案, aidlc approve, AI-DLC 审批
---

# AI-DLC 人工审批能力

开始时宣布：“使用 aidlc-approval 审阅当前 AI-DLC 审批门禁”。

本 Skill 负责审批 UX 和确定性路由。默认审批凭据来自引擎生成、绑定当前 request 的随机确认语；“同意”“批准”、Agent 自述、预填按钮或 Slash Command 被调用本身都不能批准。

## 适用范围

仅处理引擎返回 `approval: block` 的两个 Stage：

- `application-design`
- `operations`

其他 Stage 请求审批时返回 `NOT_APPROVAL_GATE`，不得创造额外阻断点。

## 默认对话审批流程

1. 在业务项目根目录执行 `loeyae-aidlc orchestrate next --status`，验证签名 state、workflow 和当前实例。若目标实例出现在 `migration_locked_instances`，先加载 `aidlc-continuity`：新工具完成自己的 JOIN，再由同一 `actor_id` 通过独立 `TAKEOVER ...` 跨回合确认取得当前 device/client 的有限期 receipt；未取得新 receipt 前不得创建或提交审批。
2. 执行：

   ```bash
   loeyae-aidlc approve --stage <slug> --instance <stage-instance> --request
   ```

   读取 `aidlc.approval.request`，确认其中的 `request_id`、`workflow_id`、`stage_instance`、challenge TTL、`artifact_root`、`evidence_root` 和 `confirmation_phrase`。
3. 读取并摘要当前实例的 canonical 产物和 Evidence。只展示实际读取到的内容，不把 Agent 总结当作产物本身。
4. 向用户显示审批对象、关键决策、风险、有效期及 `confirmation_phrase`，明确要求用户在**下一条新的用户消息**中只输入完整确认语：
   - 不提供预填 Approve 按钮或可一键发送该文本的选项；
   - 不接受“同意”“继续”“批准”等近似表达；
   - 不把 Agent 自己复制、推测或生成的文本当作用户确认；
   - 显示确认语后立即结束当前 Agent 回合，不调用 report。
5. 下一条消息到达后，只有当去除消息外围换行后的完整正文与 `confirmation_phrase` 精确一致，才构造：

   ```json
   {
     "schema_version": 1,
     "kind": "aidlc.approval.confirmation",
     "request_id": "<active-request-id>",
     "confirmation_phrase": "<exact-user-message>"
   }
   ```

6. schema v3 中，将上述对象与 owning client 当前 claim receipt 组成严格 stdin envelope：

   ```json
   {
     "claim_receipt": { "...": "signed Provider receipt" },
     "approval_confirmation": {
       "schema_version": 1,
       "kind": "aidlc.approval.confirmation",
       "request_id": "<active-request-id>",
       "confirmation_phrase": "<exact-user-message>"
     }
   }
   ```

   直接交给：

   ```bash
   loeyae-aidlc orchestrate report --stage <slug> --instance <stage-instance> \
     --result approved --claim-receipt-stdin --approval-confirmation-stdin
   ```

   envelope 不进入 argv、聊天、项目文件或持久化日志。引擎负责精确匹配 request/phrase、校验 TTL/instance/receipt，并在内部生成和立即消费 token；Agent 不读取 token。
7. phrase 不匹配、request 已变化或过期时返回 `BLOCKED`，重新执行 `next`/`approve --request` 获取当前确认语，不得复用旧消息。
8. 驳回不需要确认语，但必须由 lease holder 以 `report --instance <id> --claim-receipt-stdin --result rejected --user-input "<原因>"` 记录审阅意见。

## 可选本机通道

- 同一设备的受信宿主 Approval Provider 可以提供额外的一键审批和宿主审计，但不是默认审批的前置依赖；其 response 通过 `--approval-response-stdin`。一次性 token 由本机 device credential 内部派生，用户与团队成员不得配置或共享 `AIDLC_TRUST_SECRET`。该 response 不是远程跨设备 Provider 协议。
- “禁止跨设备”是禁止复制 private key、共享 secret、转发旧 receipt/token。合法跨工具连续工作必须由同一 actor 在新工具完成 JOIN 和独立 TAKEOVER，取得属于新 device/client 的 receipt 后重新发起当前审批；不是把旧设备凭据搬到新设备。
- 真人交互式终端仍是备用路径：直接运行 `loeyae-aidlc approve --stage <slug> --instance <stage-instance>`，再使用本设备的一次性 token 报告。
- 任一操作只能选择对话确认、同设备 Provider response 或 TTY token 中一个通道，混用必须 fail-closed。

## KiroCrew 与其他宿主边界

- KiroCrew 不需要实现专用安全审批卡；Agent 在普通对话中展示随机确认语并等待下一条真实用户消息。
- `ask_question`、`[OPTIONS:]` 或聊天按钮不得预填/代发确认语；它们可用于请求修改、取消或继续审阅。
- Claude `/aidlc-approve` 等入口只负责加载本 Skill；Slash Command 本身不是批准，但其后新的精确用户消息可以完成默认确认流程。
- Stop Hook、后台任务和无新用户回合的自动化不得提交 `approval_confirmation`。

## 禁止事项

不得：

- 在展示确认语的同一 Agent 回合调用 approved report；
- 用 Agent 生成内容、旧用户消息、近似文本或按钮选择替代新的精确用户输入；
- 在聊天、日志、文件或命令参数中回显 token 或 claim receipt；
- 将本机 Provider token 或旧 claim receipt 转发到其他设备，要求成员共享 `AIDLC_TRUST_SECRET`，或把 JOIN/TAKEOVER 短语当作 APPROVE；
- 修改 `aidlc-state.json`、challenge、integrity 或 enrollment；
- 跳过 produces、sensors、实例匹配、TTL 或 replay 校验；
- 为非审批 Stage 创造确认门禁。

## 输出

返回以下之一：

- `NEEDS_CONFIRMATION`：已展示当前随机确认语，必须结束回合等待用户输入；
- `APPROVED`：引擎已验证精确确认并消费内部凭据；
- `REJECTED`：已记录驳回原因；
- `NOT_APPROVAL_GATE`：当前实例不是阻断审批 Stage；
- `BLOCKED`：签名、上下文、产物、Evidence、TTL、receipt 或确认语校验失败。
