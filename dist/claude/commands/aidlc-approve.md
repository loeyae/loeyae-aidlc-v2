---
description: 安全审阅并审批当前 AI-DLC 架构或部署门禁
---

使用随插件发布的 `skills/aidlc-approval/SKILL.md` 处理当前审批请求。

**Slash Command 本身不是安全凭据。**

必须执行以下边界：

1. 先用 `loeyae-aidlc orchestrate next --status` 验证签名状态。
2. 用 `loeyae-aidlc approve --stage <当前 slug> --request` 获取只读、challenge-bound request。
3. 展示当前实例产物与 Evidence 摘要，但不要把本 Slash Command 或聊天文本当作审批凭据。
4. 只有 Claude 宿主明确提供受信 Approval Provider 时，才将 request 交给其独立安全界面；Provider response 必须直接通过标准输入提交给：

   ```bash
   loeyae-aidlc orchestrate report --stage <slug> --result approved --approval-response-stdin
   ```

5. 不得读取、复制或回显 Provider response 中的 token。
6. 没有受信 Provider 时，停止自动流程并提示用户在业务项目的真人交互终端执行：

   ```bash
   loeyae-aidlc approve --stage <slug>
   loeyae-aidlc orchestrate report --stage <slug> --result approved --approval-token <token>
   ```

7. 用户要求修改或驳回时，使用 `report --result rejected --user-input "<原因>"`，不要请求 token。

普通聊天中的“同意”、复制确认语或 Slash Command 被调用这一事实都不能生成 `approved`。
