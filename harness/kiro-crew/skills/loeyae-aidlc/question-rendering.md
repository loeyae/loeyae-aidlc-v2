# Question Rendering (Kiro Crew)

## Format

All structured questions render as **numbered prose options** in Kiro Crew.
The agent presents them using the `[OPTIONS:]` line or `ask_question` MCP tool.

### Single-choice question

```
**Q: [question text]**

1. Option A — description
2. Option B — description
3. Option C — description

[OPTIONS: Option A | Option B | Option C]
```

### Confirmation gate (approval)

```
Stage "[stage name]" is ready for review.

1. ✅ Approve — proceed to next stage
2. 🔄 Request Changes — describe what needs revision

[OPTIONS: Approve | Request Changes]
```

### Free-text with options

When a question allows both options and free-text:

```
**Q: [question text]**

1. Option A
2. Option B
3. Other (describe below)

[OPTIONS: Option A | Option B | Other]
```

If the user picks "Other", prompt for their input in a follow-up turn.

## Rules

- Always number options starting from 1
- Keep option labels concise (≤ 50 chars)
- Include a brief description after the label when helpful
- Gate questions (approve/reject) always have exactly 2 options
- Never present more than 6 options in a single question
- The `[OPTIONS:]` line is the LAST line — nothing after it
