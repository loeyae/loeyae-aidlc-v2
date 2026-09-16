---
name: aidlc-handoff
description: "兼容旧交接入口；把继续、接手和交接请求路由到 aidlc-continuity，显式 handoff 不再是日常恢复前提。"
triggers: 暂停并交接, 交接当前工作, 生成交接, handoff, aidlc handoff
---

# AI-DLC 交接兼容入口

开始时宣布：“使用 aidlc-handoff 兼容入口，并转入 aidlc-continuity”。

立即加载同一发布包中的 `skills/aidlc-continuity/SKILL.md` 并按其完整流程执行。

## 语义

- 用户只想换会话、换角色或稍后继续时，不执行 `park`；成功状态变化已经形成签名 checkpoint。
- 用户明确要求冻结整个 workflow 时，说明影响后才可运行 `loeyae-aidlc orchestrate park`。
- 成功 `orchestrate report` 的下一步交接由 v3 引擎自动生成 `handoff_prompt` 并更新 `docs/aidlc/handoff.md`；用户要求额外人类摘要时可以追加协作说明，但不能替换生成行或改变机器路由。
- 新 workflow 默认 schema v3；继续/接手由 `aidlc-continuity` 从 ready/claimed instance 和签名 lease 恢复。schema v2 仅为单游标兼容路径。
- `park` 冻结整个 workflow，不释放单个 lease；单实例交接必须使用 Provider release/transfer/expiry。
- 跨 trust-domain re-enroll 继续遵循 parked state、旧 key/source enrollment 证明和真人 TTY 要求。

本 Skill 不复制 `aidlc-continuity` 的恢复规则，避免两个入口随版本演化产生分叉。
