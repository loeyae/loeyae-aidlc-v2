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

当 directive 的 `gate` 为 `true` 时，必须完成用户确认后使用 `--result approved`；不得用 `completed` 绕过审批。不得跳过 `ALWAYS` stage。

阶段规则和知识文件位于本 Skill 随附的 `stages/`、`knowledge/` 和 `tools/`；阶段顺序、准入准出门禁和传感器以 `tools/aidlc-orchestrate.ts` 为准。状态保存在业务项目的 `docs/aidlc/aidlc-state.json`，暂停使用 `loeyae-aidlc orchestrate park`，恢复使用 `loeyae-aidlc orchestrate next --resume`。
