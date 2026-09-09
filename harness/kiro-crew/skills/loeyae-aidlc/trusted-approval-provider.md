# KiroCrew 受信审批 Provider 契约

本文描述 KiroCrew Dashboard 为 `aidlc-approval` 提供安全审批卡片时必须满足的宿主契约。该文件不实现 Dashboard 后端，也不把普通聊天卡片升级为安全凭据。

## 请求

Skill 通过以下只读命令取得 `aidlc.approval.request`：

```bash
loeyae-aidlc approve --stage <slug> --request
```

宿主必须原样绑定：

- `request_id`
- `workflow_id`
- `stage_instance`
- `challenge`
- `issued_at` / `expires_at`
- `artifact_root` / `evidence_root`

## 受信用户事件

安全卡片必须由 Dashboard 自身呈现，并由已认证用户在独立输入控件中完成 challenge 派生确认。Agent 不能访问该控件的原始输入，也不能代表用户触发确认。

`ask_question`、普通聊天消息、`[OPTIONS:]` 和 Agent 生成的按钮不符合此要求。

## 响应

宿主生成严格的 `aidlc.approval.response`：

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

响应必须直接写入 report 子进程标准输入，不进入聊天、Agent 上下文、项目文件、argv 或持久化日志：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result approved --approval-response-stdin
```

## 能力检测

- 宿主明确提供并认证该 Provider：Skill 可以请求安全卡片。
- 宿主没有该 Provider：返回 `NEEDS_HOST_CAPABILITY`，转真人 TTY fallback。
- 不允许把未知 MCP 工具、普通卡片或自然语言确认当作兼容实现。

## 后端责任

KiroCrew 宿主实现必须负责：

- 已登录用户身份和权限；
- request/Stage 产物摘要绑定；
- challenge TTL；
- 单次人类事件与 replay 防护；
- token 的安全生成和零暴露传输；
- 审批审计记录；
- 取消、超时和请求失效。

缺少任一责任时应保持 TTY fallback，不得报告审批完成。
