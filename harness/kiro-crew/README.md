# Loeyae AI-DLC — Kiro Crew Installation

## Install

Copy the `dist/kiro-crew/skills/loeyae-aidlc/` directory to `~/.kiro/crew/skills/loeyae-aidlc/`.

```bash
cp -r dist/kiro-crew/skills/loeyae-aidlc/ ~/.kiro/crew/skills/loeyae-aidlc/
```

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
