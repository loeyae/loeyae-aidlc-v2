---
source_coverage:
  US-001: [UC-D-001, UC-D-002, UC-D-003]
  REQ-001: [UC-D-001, UC-D-002, UC-D-003]
  AC-001: [UC-D-001, UC-D-002, UC-D-003]
  GAP-001: [UC-D-001, UC-D-002]
---

# Ordered order export test design index

Story baseline: docs/aidlc/modules/project/inception/user-stories.md#US-001; all three cases cover this ordered export story.

Source baseline: docs/aidlc/modules/project/inception/requirements.md, matching pilot/spec.md. Authorization and architecture boundary: pilot/prework.md. Scope is express, one project/default unit in the existing single local Node service. No UI or cross-project dependency is introduced.

| ID | Source | Type | Service | Design status | File |
|---|---|---|---|---|---|
| UC-D-001 | REQ-001; AC-001; GAP-001 interface constraint | integration | not-applicable | ready | UC-D-001-pagination.md |
| UC-D-002 | REQ-001; AC-001; GAP-001 interface constraint | integration | not-applicable | ready | UC-D-002-independent-calls.md |
| UC-D-003 | REQ-001; AC-001 | resilience | not-applicable | ready | UC-D-003-failure-propagation.md |

## Reception and self-check
Prepared and technically checked by Codex, based on GPT-6, acting as the model agent; no human review or approval is asserted. All three cases were checked against the source: exact boundary cardinalities and order/value preservation, once-per-call retrieval, independent calls, original failure identity, and real timeout with no partial result. Internal decomposition remains an implementation choice within GAP-001 and requires later implementation/validation recording for human review. This document authorizes neither implementation nor autonomous execution.

## Evidence plan
Core's controlled I13 producer owns .aidlc/evidence/test-case-derivation/project/test-case-derivation.json and the no-todo sensor result. Later authorized RED/GREEN, code review, and build/test evidence must map each active UC-D to actual execution anchors and candidate-bound observations. No runtime pass, prior fixture row, or completed Native stage is claimed here. No test code has been generated.

## Scope boundaries
No source implementation was used to derive these designs. The existing exported interface is stated in pilot/spec.md; transport anchors were read from frozen pilot/server.cjs. Frozen design/ assets remain unchanged and are not needed for this no-UI function test derivation. UI lock, if subsequently required, must use actual local HEAD with --upstream-ref HEAD; no remote is assumed. No new test framework is selected.
