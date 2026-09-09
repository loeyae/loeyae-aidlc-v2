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

The skill triggers on keywords: `aidlc`, `AI-DLC`, `使用 AI-DLC`, `继续上次工作`, `接手当前项目`, `查看可接手任务`, `在这台设备继续`, etc. Continue/takeover requests load `aidlc-continuity`; `aidlc-handoff` is a compatibility alias. A running workflow already has signed checkpoints and does not need to be parked before an ordinary session handoff.

## How it works

The engine (`tools/aidlc-orchestrate.ts`) drives the workflow:

1. Agent 调用 `next` → 引擎返回 `run-stage` directive
2. Agent 读取并执行 stage 文件，生成受门禁约束的产物/Evidence
3. 新 workflow 默认 schema v3：使用 actor/device/client identity 执行 `next`，Provider ACK 后才返回包含 `stage_instance` 与 `claim_receipt` 的 directive
4. 普通 stage 使用定向 `report --instance <id> --claim-receipt-stdin --result completed`；`instruction_only` 还必须追加 `--instruction-ack <slug>`
5. `approval:block` 先加载 `aidlc-approval`；只有受信 KiroCrew Provider 或人类 TTY 能签发一次性 token，随后与 receipt 一起定向报告
6. 重复直到 `done`

聊天确认、Skill 或生命周期适配器都不能自行签发审批 token 或 claim receipt。公开 report 不支持手动 skip，只有图谱 condition=false 可记录内部 `condition_skipped`。`docs/aidlc/aidlc-state.json` 的签名 event/instance map/lease 是唯一机器状态，外部 enrollment 绑定项目；handoff 仅为派生人类视图。Local Provider 只协调同一工作树，跨工作树/设备使用 Git Provider 专用 ref 或具体 External Provider；业务 main/master 不是锁。`park` 只冻结整个 workflow，日常交接不需要 park。
