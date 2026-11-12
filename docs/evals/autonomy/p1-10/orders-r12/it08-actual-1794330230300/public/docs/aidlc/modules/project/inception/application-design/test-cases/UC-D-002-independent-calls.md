---
id: UC-D-002
title: Retrieve upstream once per independent export call
source_ref: [REQ-001, AC-001, GAP-001, US-001]
type: integration
priority: P1
status: ready
service_ids: [not-applicable]
tdd_mode: new
change_ref: REQ-001
---

# UC-D-002 Independent calls and single retrieval

## Execution anchor
Existing exportOrders(upstream) interface; real local /upstream endpoint from frozen pilot/server.cjs. One cohesive project/default unit; no new service, public API, module, or data model.

## Steps and assertions
| Step | Action | Assertion |
|---|---|---|
| 1 | Pass a counting callback that obtains the complete real /upstream?count=120 response, retaining its rows for comparison. | One export invokes this callback exactly once and returns all rows in order as 50/50/20. |
| 2 | Call the same exported function again with a separate counting callback fetching /upstream?count=1. | The second callback is invoked exactly once and output contains only its own single row. The first result remains unchanged. |
| 3 | Make a third call with a callback fetching /upstream?count=0. | Callback count is exactly one; output is []; no previous rows or page state leak into this call. |

## Evidence requirements
Future controlled execution must map UC-D-002 to actual test names, record callback counts per invocation, real upstream identity, candidate revision, and full result comparisons. Instrumentation wraps real network retrieval and must not replace it. This is an executable test specification, not an assertion that tests have run.

## Sources
REQ-001 requires exactly one complete ordered retrieval. AC-001 requires repeated calls to be independent. GAP-001 preserves the exported interface while allowing private decomposition.

## Story provenance
US-001 is defined in docs/aidlc/modules/project/inception/user-stories.md and explicitly delegates boundary behavior to REQ-001 and AC-001. It contains prose, with no source Gherkin to copy.
