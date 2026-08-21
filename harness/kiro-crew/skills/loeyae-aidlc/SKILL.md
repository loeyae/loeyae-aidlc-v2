---
name: loeyae-aidlc
description: >
  Loeyae AI-DLC v2 workflow orchestrator. Engine-driven development lifecycle
  covering Inception, Construction, and Operations phases. Activate with
  "使用 AI-DLC" or "aidlc" keywords.
triggers: aidlc, AI-DLC, 使用 AI-DLC, 继续上次的工作, 认领单元, 功能设计, 用户故事, 架构设计, 单元生成, 代码审查, 逆向工程, 根因分析, 修改功能, 变更需求
---

# Loeyae AI-DLC v2 Orchestrator (Kiro Crew Harness)

## Architecture

This is the **engine-driven** v2 architecture. Unlike v1 (agent reads steering
rules and self-routes), v2 uses a deterministic TypeScript tool chain that
computes the next directive and the agent only executes what the engine says.

```
Agent ←→ aidlc-orchestrate.ts next   → returns JSON directive
Agent ←→ aidlc-orchestrate.ts report → records outcome, advances state
Agent ←→ aidlc-orchestrate.ts park   → saves state for later resume
```

## The Forwarding Loop

```
Loop:
  1. directive = `bun tools/aidlc-orchestrate.ts next $ARGUMENTS`
  2. Act on directive.kind (see table below)
  3. After acting: `bun tools/aidlc-orchestrate.ts report --stage <slug> --result <outcome>`
  4. Repeat unless directive.kind == done
```

## Directive Kinds

| kind | Action |
|------|--------|
| `load-steering` | Apply `directive.rules_content`, then call `continue` |
| `run-stage` | Read stage file, run stage body, produce artifacts |
| `ask` | Render question to user, wait for answer |
| `print` | Execute `directive.message` |
| `error` | Print error and STOP |
| `done` | Workflow complete |
| `parked` | Workflow saved for later resume |

## Kiro Crew Specifics

- **Subagent dispatch**: Uses `spawn_run` MCP tool (not kiro-cli subagent)
- **No hooks**: Agent manually checks state on resume
- **State persistence**: `docs/aidlc/state.md` in the business project
- **Approval gates**: Rendered as numbered options via ask_question or [OPTIONS:]
- **MCP services**: loeyae-skills, awesome-design, figma, ssot (configured in ~/.kiro/settings/mcp.json)

## Scope-to-Stage Grid

Resolved by `bun tools/aidlc-orchestrate.ts next` from compiled scope data.
Available scopes (to be populated from core/scopes/):

| Scope | Depth | EXECUTE / Total |
|-------|-------|-----------------|
| (will be compiled) | | |

## Stage Graph

(Will be compiled from core/stages/ frontmatter)

## Session Resume

On activation, read the active project's `docs/aidlc/state.md`. If found,
offer to resume from last checkpoint. Otherwise start fresh.

## Phases

```
Inception（规划） → Construction（实现与验证） → Operations（部署准备，条件）
```

## Key Principles

- **Engine owns routing**: The orchestrate tool decides what runs next
- **Agent owns execution quality**: How well a stage runs is your craft
- **Approval gates**: Every non-bootstrap stage presents a gate
- **Atomic stage ritual**: questions → artifact → reviewer → learnings → gate
- **State machine**: Agent cannot skip steps — tool refuses invalid transitions
