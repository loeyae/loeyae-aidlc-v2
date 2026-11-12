---
id: UC-D-001
title: Preserve complete ordered rows in pages of fifty
source_ref: [REQ-001, AC-001, GAP-001, US-001]
type: integration
priority: P1
status: ready
service_ids: [not-applicable]
tdd_mode: new
change_ref: REQ-001
---

# UC-D-001 Ordered pagination

## Execution anchor
Existing exported `exportOrders(upstream)` interface in the single local Node service; project/default owns the complete behavior. The frozen transport is `pilot/server.cjs`: start it locally using its existing Node entry point, obtain its reported port, verify `/version`, and fetch real `/upstream?count=N` through the supplied upstream callback. No network stub replaces acceptance upstream. No UI is in scope.

## Steps and assertions
| Step | Action | Assertion |
|---|---|---|
| 1 | For each N in 0, 1, 49, 50, 51, 100, 101, 120, use a fresh callback that records the real response rows before returning them to exportOrders. | Callback uses the actual local HTTP upstream; expected rows are captured from this same retrieval, without a second export retrieval. |
| 2 | Await exportOrders(upstream). | Page lengths are respectively [], [1], [49], [50], [50,1], [50,50], [50,50,1], [50,50,20]. Empty input returns []. |
| 3 | Flatten the returned pages and compare with the entire captured upstream list. | Deep equality holds for every row and field in original order; no omission, duplication, truncation, or value change. |
| 4 | Check page boundaries and exported interface. | Every nonfinal page has 50 rows; final page has at most 50. Existing exportOrders(upstream) interface is retained. |

## Evidence requirements
Future controlled RED/GREEN and build/test evidence must map UC-D-001 to actual test names and retain expected/actual page lengths, complete ordered comparison, candidate revision, and real upstream identity. No runtime results are asserted by this design document. No test code or acceptance evidence is authored during H1-H3.

## Source and design boundary
REQ-001 and AC-001 define the behavior; GAP-001 permits internal single-function or private-helper decomposition only. This case is independent of that internal layout. Existing service architecture and transport stay unchanged.

## Story provenance
US-001 is defined in docs/aidlc/modules/project/inception/user-stories.md and explicitly delegates boundary behavior to REQ-001 and AC-001. It contains prose, with no source Gherkin to copy.
