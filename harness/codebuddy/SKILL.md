---
name: loeyae-aidlc
description: Use when the user asks to use AI-DLC, aidlc, requirements, design, implementation, review, debugging, or deployment through the deterministic Loeyae AI-DLC workflow in CodeBuddy.
---

# Loeyae AI-DLC v2 for CodeBuddy

CodeBuddy 是 AI-DLC 的平台入口，不自行决定阶段顺序。在业务项目目录调用：

```bash
loeyae-aidlc orchestrate next --scope <scope>
```

严格执行返回的 directive。完成当前阶段后调用：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
```

`gate: true` 阶段只能使用受信任的人类审批 token；Skill、Agent 和 Stop Hook 不得自行签发。`instruction_only` 阶段必须在执行正文后传入 `--instruction-ack <slug>`。公开 report 不支持手动 `skipped`，只有图谱条件为 false 时引擎才能记录内部 `condition_skipped`。

插件 Stop Hook 只触发统一引擎检查，不直接修改 `docs/aidlc/aidlc-state.json` 或 `.aidlc/evidence/`。状态、Evidence、审批、前置依赖、产物和 sensors 均以随插件发布的 `tools/`、`stages/`、`knowledge/` 和 `sensors/` 为准。需要 Evidence 时，必须在第一次 `next` 前向 CodeBuddy、CLI、Producer 和 Hook 注入同一份至少 32 字节的 `AIDLC_TRUST_SECRET`。

暂停使用 `loeyae-aidlc orchestrate park`，恢复使用 `loeyae-aidlc orchestrate next --resume`。不得把聊天确认、插件输出或 Agent 自述伪造成审批或 Evidence。
