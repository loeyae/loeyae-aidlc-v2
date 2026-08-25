---
id: doc-cascade
name: Document Cascade Completeness
description: >
  Verifies the AI-DLC document cascade is intact: each stage's produces
  must reference or be referenced by the prior stage's output.
  Chain: requirements → user-stories → application-design → functional-design → code
---

# doc-cascade Sensor

## Check Logic

For a stage being completed, verify:

1. If the stage produces a design doc (functional-design, application-design, nfr-design):
   - The doc must reference the requirements doc (by filename or section heading)
   
2. If the stage produces code (code-generation):
   - At least one source file must exist
   - The functional-design doc must exist

3. If the stage produces a test (tdd):
   - Test files must reference or correspond to source files

## Implementation

```typescript
// Built into checkSensors() in aidlc-orchestrate.ts
// Checks: 
//   - For design stages: prior stage's produces file must exist
//   - For code stages: functional-design.md must exist
//   - Returns failure message if cascade is broken
```
