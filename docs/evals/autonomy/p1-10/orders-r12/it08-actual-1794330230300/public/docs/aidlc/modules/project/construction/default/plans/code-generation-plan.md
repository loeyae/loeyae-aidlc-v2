# project/default code generation plan

## Success criteria

- [x] REQ-001 / AC-001: the export retrieves upstream exactly once and preserves every ordered row and value in pages of 50; empty input returns []. Frozen-oracle self-check passed for counts 0, 1, 49, 50, 51, 100, 101 and 120.
- [x] REQ-001 / AC-001: propagate the original timeout/error object without partial results. Frozen-oracle verified the focused original error and real HTTP timeout. Source self-check confirms that upstream is awaited before any pages are built, no catch wraps a rejection, and per-call local variables preserve independent calls.
- [x] GAP-001: retain exportOrders(upstream) as the single exported async function, following orders-gap-001-internal-layout and fallback:internal-layout. Source self-check found no additional exports or helper API.
- [x] Self-check the implementation with the frozen oracle against the actual HTTP upstream, then finish plan maintenance before final Native evidence. frozen-oracle exited 0 with runtime=actual-http, timeout=propagated-original and the 120-row page lengths 50/50/20.

Final stage acceptance additionally requires controlled GREEN, test-quality, traceability-matrix, structural-invariants and the formal report gates. Their outcomes belong to Core evidence and are not predicted by this plan. Spec/Standards review and full candidate acceptance belong to later host-selected stages.

## Context and authorized scope

Project/default implements US-001 from docs/aidlc/modules/project/inception/user-stories.md. REQ-001 and AC-001 are fixed by the canonical requirements and development handoff. I13 declares UC-D-001, UC-D-002 and UC-D-003 as new behavior. The accepted RED contains three behavior failures, with compilation/environment passed. BASELINE is not_required because there are no characterization cases.

Source target: src/orders.cjs in the project root. Existing interface: exportOrders(upstream). The callback supplies the complete ordered array or rejects. No additional public API, persistence, UI, cross-unit contract, dependency or deployment configuration is needed. Shared-contract and UI bridge conditions do not apply to this single-unit, no-UI function. No external knowledge/validation Provider action is declared by the current directive; no steering directory exists.

## Numbered implementation steps

1. [x] Read canonical guidance and review UC-D/RED behavior and the existing interface. Preserve tests/ucd.cjs exactly at SHA-256 de771b86838bf0074c6506fec72ff4007797f88e1055c8fde5f31248f42abd9a.
2. [x] Replace the existing src/orders.cjs placeholder in place. Await upstream once; use a local pages array and successive non-mutating slices of length 50. Allow the original rejection to propagate unchanged. Keep REQ-001 and UC-D traceability comments.
3. [x] Self-check source semantics and run frozen-oracle against the real upstream; maintain this plan using actual results before final evidence. The oracle command succeeded with exit 0 and reconciled resource closure. This plan is now ready for final controlled Native evidence without another input edit.

## TDD sequence and scope

| RED test | GREEN implementation | Controlled verification |
|---|---|---|
| tests/ucd.cjs#UC-D-001 | Complete ordered slicing, exact boundaries and empty result | evidence run --stage code-generation --sensor green-test-evidence |
| tests/ucd.cjs#UC-D-002 | Exactly one callback invocation and per-call local state | Same frozen GREEN command, all three UC-D keys |
| tests/ucd.cjs#UC-D-003 | Await upstream before building pages; preserve original rejection | Same command, actual HTTP timeout/error, focused identity and recovery |

The frozen GREEN command is node pilot/native-phase.cjs via .aidlc/commands/code-generation.json. Tests remain unchanged from accepted RED through GREEN. A genuine test defect requires a Core-controlled new TDD cycle. This local function change has no additional affected production modules; the full unit validation matrix is all three UC-D tests. Repository-wide testing is not triggered.

## Story implementation and self-check

- [x] US-001 implemented in src/orders.cjs under REQ-001 / AC-001: one complete retrieval, ordered pages and original failures. The frozen-oracle self-check exercises the approved boundaries and HTTP timeout; the unchanged Native tests additionally exercise HTTP error identity, repeated calls and recovery during final GREEN.

## Delegated decision and later review

orders-gap-001-internal-layout remains effective revision 1 under orders-policy revision 1. Its human review is pending. This stage implements its exact single-function default; the host will schedule later evidence-backed decision metadata updates and final candidate convergence. This plan asserts neither human approval nor batch delivery success.

recorded_by: agent/01a1c656-b73d-78f2-8420-8dbb883c9691
