---
name: loeyae-aidlc
description: Use when the user asks to use AI-DLC, aidlc, requirements, design, implementation, review, debugging, or deployment through the deterministic Loeyae AI-DLC workflow in Qoder Desktop or CLI.
---

# Loeyae AI-DLC v2 for Qoder Desktop / CLI

Qoder Desktop 或 CLI 是 AI-DLC 的平台入口，不自行决定阶段顺序。在业务项目目录调用：

```bash
loeyae-aidlc orchestrate next --scope <scope>
```

严格执行返回的 directive。完成当前阶段后调用：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
```

`gate: true` 阶段只能使用受信任的人类审批 token；Skill、Agent 和 Stop Hook 不得自行签发。`instruction_only` 阶段必须在执行正文后传入 `--instruction-ack <slug>`。公开 report 不支持手动 `skipped`，只有图谱条件为 false 时引擎才能记录内部 `condition_skipped`。

插件 Stop Hook 通过退出码 2 向 Qoder 返回阻断反馈。重入的 Stop 回调按 Qoder 的 `stop_hook_active` 契约停止再次阻断，但签名工作流状态仍保持 running，后续会话必须继续完成当前阶段。Hook 不直接修改 `docs/aidlc/aidlc-state.json` 或 `.aidlc/evidence/`。

状态、Evidence、审批、前置依赖、产物和 sensors 均以随插件发布的 `tools/`、`stages/`、`knowledge/` 和 `sensors/` 为准。需要 Evidence 时，必须在第一次 `next` 前向 Qoder 宿主、CLI、Producer 和 Hook 注入同一份至少 32 字节的 `AIDLC_TRUST_SECRET`。
