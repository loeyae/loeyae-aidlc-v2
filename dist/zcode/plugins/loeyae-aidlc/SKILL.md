---
name: loeyae-aidlc
description: Use when the user asks to use AI-DLC, aidlc, requirements, design, implementation, review, debugging, or deployment through the deterministic Loeyae AI-DLC workflow in ZCode.
---

# Loeyae AI-DLC v2 for ZCode

ZCode 是 AI-DLC 的平台入口，不自行决定阶段顺序。在业务项目目录调用：

```bash
loeyae-aidlc orchestrate next --scope <scope>
```

严格执行返回的 directive。完成当前阶段后调用：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
```

`gate: true` 阶段只能使用受信任的人类审批 token；Skill、Agent 和 Stop Hook 不得自行签发。`instruction_only` 阶段必须在执行正文后传入 `--instruction-ack <slug>`。公开 report 不支持手动 `skipped`，只有图谱条件为 false 时引擎才能记录内部 `condition_skipped`。

Stop Hook 返回 ZCode 原生 `decision: block` 反馈。ZCode 最多连续继续主模型三次，因此生命周期反馈有宿主上限；未完成阶段仍保留在签名工作流状态中，后续会话必须继续。Hook 不直接修改 `docs/aidlc/aidlc-state.json` 或 `.aidlc/evidence/`。

状态、Evidence、审批、前置依赖、产物和 sensors 均以随 Skill/插件发布的 `tools/`、`stages/`、`knowledge/` 和 `sensors/` 为准。需要 Evidence 时，必须在第一次 `next` 前向 ZCode、CLI、Producer 和 Hook 注入同一份至少 32 字节的 `AIDLC_TRUST_SECRET`。
