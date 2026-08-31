# Loeyae AI-DLC — Kiro Crew Installation

## Install

Use the CLI installer so the skill and the V1 MCP capability set are installed together:

```bash
loeyae-aidlc install
```

The installer copies the skill to `~/.kiro/crew/skills/loeyae-aidlc/` and merges missing `loeyae-skills`, `awesome-design`, `figma`, `ssot`, and `chrome-devtools` entries into `~/.kiro/settings/mcp.json`. Existing same-name entries are preserved except for the uncustomized legacy versioned `chrome-devtools-mcp` default, which is safely normalized to the unversioned `chrome-devtools-mcp` package; entries with custom fields, environment variables, non-default arguments, or a disabled state remain untouched. `--target` is only for a dedicated install directory; never pass a non-empty project or source directory. The current installer refuses non-empty custom targets, and custom target installs do not modify global MCP settings. `ssot` reads `SSOT_API_KEY` from the environment.


## Usage

In any Kiro Crew session, say:

```
使用 AI-DLC 开发用户认证模块
```

The skill triggers on keywords: `aidlc`, `AI-DLC`, `使用 AI-DLC`, etc.

## How it works

The engine (`tools/aidlc-orchestrate.ts`) drives the workflow:

1. Agent 调用 `next` → 引擎返回 `run-stage` directive
2. Agent 读取并执行 stage 文件，生成受门禁约束的产物/Evidence
3. 普通 stage 使用 `report --result completed`；`instruction_only` 必须追加 `--instruction-ack <slug>`
4. `approval:block` 必须由人类 TTY 或受信 provider 筍发一次性 token，再使用 `report --result approved --approval-token <token>`
5. 重复直到 `done`

聊天确认、Skill 或生命周期适配器都不能自行签发审批 token。公开 report 不支持手动 skip，只有图谱 condition=false 可记录内部 `condition_skipped`。`docs/aidlc/aidlc-state.json` 是签名且 revision/CAS 保护的唯一机器状态，外部 enrollment 绑定项目；handoff 仅为派生人类视图。
