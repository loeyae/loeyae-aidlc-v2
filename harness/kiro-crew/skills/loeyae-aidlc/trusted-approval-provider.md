# KiroCrew 可选受信审批 Provider 契约

默认 AI-DLC 审批不依赖 KiroCrew 专用安全卡。Agent 读取 request 中的随机 `confirmation_phrase`，展示产物和 Evidence 后结束回合；用户在下一条真实消息中完整输入该短语，再通过 `--approval-confirmation-stdin` 完成审批。

本文只描述 KiroCrew Dashboard 如需提供一键审批、额外身份权限或集中审计时可实现的增强 Provider。该文件不实现 Dashboard 后端，也不改变默认对话确认流程。

## 默认对话确认

Skill 通过只读命令取得 `aidlc.approval.request`：

```bash
loeyae-aidlc approve --stage <slug> --instance <stage-instance> --request
```

request 包含：

- `request_id`
- `workflow_id`
- `stage_instance`
- `challenge`
- `confirmation_phrase`
- `issued_at` / `expires_at`
- `artifact_root` / `evidence_root`

Agent 必须展示精确 `confirmation_phrase` 并停止当前回合。只有下一条真实用户消息完整匹配时，才将确认对象与当前 claim receipt 组成严格 envelope：

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

该 envelope 直接写入：

```bash
loeyae-aidlc orchestrate report --stage <slug> --instance <stage-instance> \
  --result approved --claim-receipt-stdin --approval-confirmation-stdin
```

KiroCrew 无需为此实现专用审批卡。普通“同意”消息、预填按钮、Agent 复制文本、旧用户消息或同一 Agent 回合自动提交均不符合默认确认协议。

## 可选 Provider 响应

如果 KiroCrew 需要一键批准或更强的宿主审计，可由宿主生成严格 `aidlc.approval.response`：

```json
{
  "schema_version": 1,
  "kind": "aidlc.approval.response",
  "request_id": "<active-request-id>",
  "provider_id": "<trusted-host-provider>",
  "human_event_id": "<non-replayable-event-id>",
  "approved_at": "<ISO timestamp>",
  "approval_token": "<challenge-bound token>"
}
```

schema v3 中，宿主将其与 owning client receipt 组成 `claim_receipt + approval_response` envelope，并通过 `--approval-response-stdin` 提交。Provider token、receipt 和完整 envelope 不进入聊天、Agent 上下文、项目文件、argv 或持久化日志。

## 可选 Provider 后端责任

实现增强 Provider 时，KiroCrew 宿主负责：

- 已登录用户身份和权限；
- request/Stage 产物摘要绑定；
- challenge TTL；
- 单次人类事件与 replay 防护；
- token 与 claim receipt 的安全生成/取得和零暴露传输；
- 审批审计记录；
- 取消、超时和请求失效。

Provider 不可用时继续使用默认对话随机确认语，不得要求用户另开终端。真人 TTY 仅作为可选备用通道。
