---
description: 安全审阅并审批当前 AI-DLC 架构或部署门禁
---

使用随插件发布的 `skills/aidlc-approval/SKILL.md` 处理当前审批请求。

**Slash Command 本身不是批准；用户随后输入的实例绑定随机确认语才是默认确认。**

必须执行以下流程：

1. 用 `loeyae-aidlc orchestrate next --status` 验证签名状态。
2. 用 `loeyae-aidlc approve --stage <当前 slug> --instance <当前 stage_instance> --request` 获取只读、challenge-bound request。
3. 展示当前实例产物与 Evidence 摘要，以及 request 中完整的 `confirmation_phrase`。
4. 要求用户在下一条新的用户消息中只输入该完整确认语，然后立即结束当前 Agent 回合；不得提供预填批准按钮，也不得在同一回合调用 report。
5. 下一条消息只有在完整正文精确匹配时，才构造 `aidlc.approval.confirmation`，与当前 claim receipt 组成严格标准输入 envelope，并执行：

   ```bash
   loeyae-aidlc orchestrate report --stage <slug> --instance <stage-instance> \
     --result approved --claim-receipt-stdin --approval-confirmation-stdin
   ```

6. 不得读取、复制或回显内部 token/claim receipt；短语错误、过期或 request 改变时重新请求当前确认语。
7. 受信 Claude Approval Provider 仅是可选的一键审批增强；真人 TTY 仅是备用路径，均不是默认流程的前置条件。
8. 用户要求修改或驳回时，由 lease holder 使用 `report --instance <id> --claim-receipt-stdin --result rejected --user-input "<原因>"`，不要请求确认语。

普通“同意”“批准”、Agent 复制确认语、旧用户消息或 Slash Command 被调用这一事实都不能生成 `approved`。
