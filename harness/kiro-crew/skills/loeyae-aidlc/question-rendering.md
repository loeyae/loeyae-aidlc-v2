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

### Confirmation gate (approval review)

Do not render approval as an options card. Load `aidlc-approval`, show the reviewed Stage instance, artifact/Evidence summary, expiry, and the exact engine-generated `confirmation_phrase`, then end the Agent turn. The user must manually type that full phrase in the next message; a button must not prefill or submit it.

```
Stage "[stage instance]" is ready for review.

[artifact and Evidence summary]

To approve, type exactly in your next message:
[confirmation_phrase]
```

A normal “Approve”, an old message, Agent-copied text, or same-turn submission is not valid. Request Changes may still be collected as ordinary free text and reported as `rejected` by the lease holder.

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
- Approval confirmation never uses `[OPTIONS:]`; display the exact random phrase and wait for manual free-text input in the next user turn
- Never present more than 6 options in a single question
- The `[OPTIONS:]` line is the LAST line — nothing after it
