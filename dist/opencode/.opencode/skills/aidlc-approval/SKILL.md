---
name: aidlc-approval
description: "安全审阅并批准当前 AI-DLC 架构或部署门禁；只通过受信宿主 Provider 或真人 TTY 取得一次性 token。"
triggers: 审批当前阶段, 确认架构方案, 批准架构方案, 批准部署方案, 驳回当前方案, aidlc approve, AI-DLC 审批
---

# AI-DLC 人工审批能力

开始时宣布：“使用 aidlc-approval 审阅当前 AI-DLC 审批门禁”。

本 Skill 是审批 UX 和路由入口，不是 token 生成器。普通聊天、Agent 自述、选项按钮或复制确认短语都不能证明真实人类审批。

## 适用范围

仅处理引擎返回 `approval: block` 的两个 Stage：

- `application-design`
- `operations`

其他 Stage 请求审批时返回 `NOT_APPROVAL_GATE`，不得创造额外阻断点。

## 安全流程

1. 在业务项目根目录执行 `loeyae-aidlc orchestrate next --status`，验证签名 state、workflow 和当前实例。
2. 执行：

   ```bash
   loeyae-aidlc approve --stage <slug> --request
   ```

   读取 `aidlc.approval.request`，确认其中的 `workflow_id`、`stage_instance`、challenge TTL、`artifact_root` 和 `evidence_root`。
3. 读取并摘要当前实例的 canonical 产物和 Evidence。只展示实际读取到的内容，不把 Agent 总结当作产物本身。
4. 如果宿主明确提供受信 Approval Provider：
   - 把完整 request 交给宿主安全界面；
   - 由宿主验证真实用户事件并生成 `aidlc.approval.response`；
   - 响应直接通过标准输入交给 `orchestrate report --result approved --approval-response-stdin`；
   - Agent 不读取、复制、回显或持久化 response 中的 token。
5. 如果宿主没有受信 Provider，返回 `NEEDS_TRUSTED_APPROVAL` 并提示真人在独立交互终端执行：

   ```bash
   loeyae-aidlc approve --stage <slug>
   loeyae-aidlc orchestrate report --stage <slug> --result approved --approval-token <token>
   ```

6. 驳回时不需要审批 token，使用 `report --result rejected --user-input "<原因>"` 记录审阅意见。

## KiroCrew 边界

- 普通 `ask_question`、`[OPTIONS:]` 或聊天按钮只可收集“继续审阅/请求修改”等意图，不能生成 `approved`。
- 只有 KiroCrew 宿主实现并声明受信 Approval Provider 时，才可显示安全审批卡并提交 Provider response。
- 宿主能力不存在时必须显示 TTY fallback，不得模拟卡片成功。

## Claude Code 边界

`/aidlc-approve` 只是显式审批入口。Slash Command 本身不是安全凭据；仍必须由受信 Claude Provider 生成响应，或使用真人 TTY fallback。

## 禁止事项

不得：

- 调用普通问答卡后自行构造 Provider response；
- 在聊天、日志、文件或命令参数中回显宿主 token；
- 提供或执行非交互 token generator；
- 修改 `aidlc-state.json`、challenge、integrity 或 enrollment；
- 跳过 produces、sensors、实例匹配、TTL 或 replay 校验；
- 在 Provider 不可用时把“同意”解释为批准。

## 输出

返回以下之一：

- `APPROVED`：引擎已验证并消费受信响应；
- `REJECTED`：已记录驳回原因；
- `NEEDS_TRUSTED_APPROVAL`：需要宿主 Provider 或真人 TTY；
- `NOT_APPROVAL_GATE`：当前实例不是阻断审批 Stage；
- `BLOCKED`：签名、上下文、产物、Evidence、TTL 或 Provider 响应校验失败。
