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

当 directive 的 `gate` 为 `true` 时，必须完成用户确认后使用 `--result approved`；不得用 `completed` 绕过审批。不得跳过 `ALWAYS` stage。状态保存在业务项目的 `docs/aidlc/aidlc-state.json`，暂停使用 `loeyae-aidlc orchestrate park`，恢复使用 `next --resume`。

平台适配只负责入口和工具调用；阶段顺序、准入准出门禁和产物要求以 `tools/aidlc-orchestrate.ts` 与 `stages/*` 为准。
