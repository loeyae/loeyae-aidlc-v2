---
name: loeyae-aidlc
description: Use when the user asks to use AI-DLC, aidlc, or the Loeyae AI-DLC workflow; orchestrate work through the deterministic stage engine and its gates.
---

# Loeyae AI-DLC v2 — Claude Code 入口

当用户消息包含 `AI-DLC` 或 `aidlc` 时进入 v2 引擎流程。先读取当前发布包中的 `stages/` 与 `knowledge/`，再在业务项目目录执行：

```bash
loeyae-aidlc orchestrate next --scope <scope>
```

严格按引擎返回的 stage directive 执行，完成后使用：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
```

当 directive 的 `gate` 为 `true` 时，聊天确认本身不是审批凭据。人类须在交互式终端执行 `loeyae-aidlc approve --stage <slug>`，或由受信 Claude 宿主 provider 签发绑定 workflow/stage/challenge 的 token，再以 `--result approved --approval-token <token>` 报告；token 最长 15 分钟且不可重放。插件、Agent 与 Stop Hook 不得自行签发；无 provider/TTY 时 fail-closed。`instruction_only` stage 必须在执行正文后显式追加 `--instruction-ack <slug>`。公开 report 不支持手动 `skipped`，仅 condition=false 可产生内部 `condition_skipped`。

`docs/aidlc/aidlc-state.json` 是 HMAC、workflow ID、revision/CAS 保护的唯一机器状态，外部 enrollment 绑定项目；`docs/aidlc/handoff.md` 只是派生人类视图。Evidence 只接受受控 Producer 的精确 provenance、当前 `commit + dirty + worktree_digest` 与 HMAC；命令只记录 `argv_digest`，semantic 固定执行发行包内置 checker。需要 Evidence 时必须在第一次 `next` 前向 orchestrator、Producer 和 Hook 注入同一份至少 32 字节的 `AIDLC_TRUST_SECRET`。暂停使用 `loeyae-aidlc orchestrate park`，恢复使用 `next --resume`。

平台适配只负责入口和工具调用；阶段顺序、准入准出门禁和产物要求以 `tools/aidlc-orchestrate.ts` 与 `stages/*` 为准。
