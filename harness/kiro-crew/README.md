# Loeyae AI-DLC — Kiro Crew Installation

## Install

Use the CLI installer so the skill and the V1 MCP capability set are installed together:

```bash
loeyae-aidlc install
```

The installer copies the skill to `~/.kiro/crew/skills/loeyae-aidlc/` and merges missing `loeyae-skills`, `awesome-design`, `figma`, `ssot`, and `chrome-devtools` entries into `~/.kiro/settings/mcp.json`. Existing same-name entries are preserved, and project-level `--target` installs do not modify global MCP settings. `ssot` reads `SSOT_API_KEY` from the environment.


## Usage

In any Kiro Crew session, say:

```
使用 AI-DLC 开发用户认证模块
```

The skill triggers on keywords: `aidlc`, `AI-DLC`, `使用 AI-DLC`, etc.

## How it works

The engine (`tools/aidlc-orchestrate.ts`) drives the workflow:

1. Agent calls `next` → engine returns a `run-stage` directive
2. Agent reads the stage file, executes it, presents the gate
3. Agent calls `report --stage <slug> --result completed`
4. Repeat until `done`

The agent cannot skip steps — the engine validates every transition.
