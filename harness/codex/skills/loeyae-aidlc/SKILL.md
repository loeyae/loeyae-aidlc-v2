---
name: loeyae-aidlc
description: "Loeyae AI-DLC v2 engine-driven lifecycle. Use for requirements, design, implementation, review, debugging, and deployment preparation when the user asks for AI-DLC or aidlc."
---

# Loeyae AI-DLC v2 for Codex

Codex 是 V2 的平台入口，不自行决定阶段顺序。使用已安装 Skill 目录中的确定性引擎获取 directive：

```bash
loeyae-aidlc orchestrate next --scope <scope>
```

严格按 directive 执行：

- `run-stage`：读取同一 Skill 目录下的 `stages/` 和 `knowledge/`，执行当前阶段；
- `ask`：用普通文本向用户展示问题和选项，等待用户回答；
- `print`：执行 directive 指定的命令或输出；
- `error`：输出阻断原因并停止；
- `parked`：保留状态并等待后续恢复；
- `done`：工作流完成。

阶段完成后必须报告：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
```

`gate: true` 时，用户聊天确认本身不是审批凭据。人类须在交互式终端执行 `loeyae-aidlc approve --stage <slug>`，或由受信宿主 provider 签发 token，再以 `--result approved --approval-token <token>` 报告；token 绑定 workflow/stage/challenge、最长 15 分钟且不可重放。Skill、Agent 和 Stop Hook 不得自行签发，无 provider/TTY 时 fail-closed。`instruction_only` stage 必须在执行正文后显式传 `--instruction-ack <slug>`，Stop Hook 不得代确认。公开 report 不接受手动 `skipped`；仅 condition=false 可记录内部 `condition_skipped`。

## Codex 适配

- `docs/aidlc/aidlc-state.json` 是 HMAC、workflow ID、revision/CAS 保护的唯一机器状态；外部 enrollment 绑定项目，`docs/aidlc/handoff.md` 仅为派生人类视图；
- evidence 位于业务项目的 `.aidlc/evidence/<stage-slug>/`，只接受受控 Producer 的精确 producer、当前 `commit + dirty + worktree_digest` 和 HMAC；命令只记录 `argv_digest`；
- 需要 Evidence 时，必须在第一次 `next` 前向 orchestrator、Producer 和 Hook 注入同一份至少 32 字节的 `AIDLC_TRUST_SECRET`；semantic 只执行发行包内置 checker；
- 需要子 Agent 时，只使用当前 Codex 会话实际提供的子 Agent 能力；不可用时按阶段规则串行执行；
- MCP、Skill 和项目规则按 Codex 当前会话的可用能力加载；不可用时返回 `NEEDS_CONTEXT` 或 `NEEDS_CAPABILITY`；
- 不把 Skill 入口、阶段执行结果或用户回答伪造成 evidence。

## 边界

本 Skill 不替代引擎的 `requires`、`condition`、`produces`、`sensors`、审批和当前阶段校验。不得更新审计以绕过门禁，不得宣布未通过门禁的阶段完成。
