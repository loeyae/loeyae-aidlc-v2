---
name: loeyae-aidlc
description: Use when the user asks to use AI-DLC, aidlc, or the Loeyae AI-DLC workflow in Kiro CLI; drive the deterministic stage engine and its gates.
---

# Loeyae AI-DLC v2 — Kiro CLI 入口

当用户消息包含 `AI-DLC`、`aidlc` 或 `使用 AI-DLC` 时，执行 v2 引擎流程。先在业务项目目录调用：

```bash
loeyae-aidlc orchestrate next --scope <scope>
```

严格按引擎返回的 stage directive 执行，完成后使用：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
```

当 directive 的 `gate` 为 `true` 时，聊天中的用户确认本身不是审批凭据。人类审阅后须在交互式终端运行 `loeyae-aidlc approve --stage <slug>`，再以 `--result approved --approval-token <token>` 报告；token 绑定 workflow/stage/challenge、最长 15 分钟且不可重放。Skill、Agent 和 Stop Hook 不得自行签发；无受信 provider/TTY 时 fail-closed。`completion_contract: instruction_only` 必须在执行正文后追加 `--instruction-ack <slug>`，Stop Hook 不能代替确认。公开 report 不支持手动 `skipped`；仅图谱 condition=false 可写内部 `condition_skipped`。

阶段规则和知识文件位于本 Skill 随附的 `stages/`、`knowledge/` 和 `tools/`；阶段顺序、准入准出门禁和传感器以 `tools/aidlc-orchestrate.ts` 为准。`docs/aidlc/aidlc-state.json` 是 HMAC、workflow ID、revision/CAS 保护的唯一机器状态，外部 enrollment 绑定项目路径；`docs/aidlc/handoff.md` 只是派生人类视图。暂停使用 `loeyae-aidlc orchestrate park`，恢复使用 `loeyae-aidlc orchestrate next --resume`。

Evidence 必须由受控 Producer 生成并携带精确 producer、`commit + dirty + worktree_digest` 和 HMAC 完整性；命令只记录 `argv_digest`。需要 Evidence 时，宿主须在第一次 `next` 前向 orchestrator、Producer 和 Hook 注入同一份至少 32 字节的 `AIDLC_TRUST_SECRET`。semantic allowlist 只能声明内置 checker，不能执行项目 Node/Python/shell checker。
