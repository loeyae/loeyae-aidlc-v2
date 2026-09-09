---
name: aidlc-continuity
description: "从已验证的签名 checkpoint 继续、接手或查看 AI-DLC 工作；日常交接不要求显式 park。"
triggers: 继续上次工作, 继续上次的工作, 接手当前项目, 查看当前进度, 查看可接手任务, 在这台设备继续, 恢复 AI-DLC, aidlc continue
---

# AI-DLC 连续工作能力

开始时宣布：“使用 aidlc-continuity 验证并恢复 AI-DLC 工作”。

本 Skill 只从签名 state 恢复机器路由。`handoff.md`、聊天摘要和项目管理页面只补充人类上下文，不能改变 Stage、实例、choice、approval 或 revision。

## 流程

1. 在业务项目根目录执行：

   ```bash
   loeyae-aidlc orchestrate next --status
   ```

2. 根据结果处理：
   - 无 workflow：返回 `NO_WORKFLOW`，提示用户明确启动范围；
   - `running`：直接执行 `loeyae-aidlc orchestrate next` 取得当前/下一 directive，不要求 park 或 resume；
   - `parked`：说明该 workflow 被主动冻结，只有用户明确继续时执行 `next --resume`；
   - `done`：返回 `WORKFLOW_DONE`，不得重新打开或手改 state；
   - 签名、key ID、enrollment 或 workflow mismatch：最多运行只读 `loeyae-aidlc recover inspect`，返回 `TRUST_BLOCKED`。
3. state 验证成功后，按需读取 `handoff.md`、decision summary 和当前实例 canonical 产物，只补充协作者、决策和未解决问题。
4. 宣布当前 workflow、Stage instance、module/unit、最近 checkpoint 和下一动作。
5. 执行引擎返回的 directive；不得从 handoff 或聊天猜测下一阶段。

## 自动 Checkpoint 语义

- 成功的 `next`、`report`、条件跳过和审批状态变化在返回前已经签名并原子保存。
- Stage instance 完成后自然成为稳定交接点，不需要用户说“暂停并交接”。
- 未完成实例只表示当前串行游标位置；schema v2 不提供多人排他 claim，也不能把 handoff 负责人当作锁。
- schema v3 启用后，本 Skill 将从 ready/claimed 实例集合恢复；用户入口保持不变。

## 多设备边界

- 同一 trust domain、同一有效 enrollment 的客户端可以按同一串行流程继续。
- trust key 或项目路径绑定变化时，不得复制 secret、删除 enrollment 或重签 state。
- 当前受控跨 trust-domain re-enroll 仍要求原主机先 park，并由真人 TTY 完成证明；连续工作 UX 不降低该安全边界。

## 禁止事项

不得：

- 为了让其他人接手而自动执行 `park`；
- 从 `handoff.md` 推断 completed/skipped/current；
- 把 running state 解释为某个聊天会话永久占有；
- 宣称 schema v2 已支持多人并行认领；
- 自动执行 `recover re-enroll --apply`；
- 读取、索要或输出 trust/recovery secret；
- 在状态校验失败后继续执行 Stage。

## 输出

返回以下之一：

- `READY_TO_CONTINUE`：已验证 running workflow 并取得 directive；
- `FROZEN`：workflow parked，等待用户明确恢复；
- `WORKFLOW_DONE`：workflow 已完成；
- `NO_WORKFLOW`：当前目录没有 workflow；
- `TRUST_BLOCKED`：信任链失败，只附 `recover inspect` 的脱敏诊断；
- `BLOCKED`：canonical 产物、依赖或门禁阻断。
