# Loeyae AI-DLC v2 — Codex

## 安装

全局安装后执行：

```bash
loeyae-aidlc install --harness codex
```

Skill 会安装到 `~/.agents/skills/loeyae-aidlc/`，并将 Codex 原生 Stop Hook 幂等合并到 `~/.codex/hooks.json`。首次启用或版本更新后，请在 Codex 中通过 `/hooks` 审查并信任该 Hook；未信任时 Codex 会跳过它。

## 使用

在 Codex 新对话中输入：

```
使用 AI-DLC 开发用户认证模块
```

引擎通过 `loeyae-aidlc orchestrate next/report/park` 命令驱动；阶段顺序、产物和门禁由 `tools/aidlc-orchestrate.ts`、`stages/` 和编译后的 `tools/data/stage-graph.json` 决定。

`docs/aidlc/aidlc-state.json` 是 HMAC、workflow ID、revision/CAS 保护的唯一机器状态，外部 enrollment 绑定项目；`docs/aidlc/handoff.md` 仅为派生人类视图。Codex Stop Hook 不签发审批 token、不携带 `--instruction-ack`、不生成或修改 Evidence，因此不能自动推进 `approval:block` 或 `instruction_only` stage。
