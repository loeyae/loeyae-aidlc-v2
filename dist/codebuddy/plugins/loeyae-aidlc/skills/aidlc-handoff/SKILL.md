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
- 用户要求生成给人的摘要时，可以更新 `handoff.md`，但该摘要不得改变机器路由。
- schema v2 只支持串行续接；不得把本 Skill 描述为多人排他认领实现。
- 跨 trust-domain re-enroll 继续遵循 parked state、旧 key/source enrollment 证明和真人 TTY 要求。

本 Skill 不复制 `aidlc-continuity` 的恢复规则，避免两个入口随版本演化产生分叉。
