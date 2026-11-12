---
id: UC-D-003
title: Propagate original upstream failure without partial results
source_ref: [REQ-001, AC-001, US-001]
type: resilience
priority: P1
status: ready
service_ids: [not-applicable]
tdd_mode: new
change_ref: REQ-001
---

# UC-D-003 Failure identity and atomic export

## Execution anchor
Existing exportOrders(upstream) interface. Frozen pilot/server.cjs provides /slow, delaying its response for 200 ms. Use the real local HTTP endpoint and a client timeout shorter than 200 ms; no network stub replaces timeout acceptance.

## Steps and assertions
| Step | Action | Assertion |
|---|---|---|
| 1 | Supply a counting upstream callback that performs a real request to /slow with a shorter timeout and records the exact error object caught at the callback boundary before rethrowing it unchanged. | The callback is invoked exactly once. The observed timeout is from an actual network request. |
| 2 | Await the export promise and retain its rejection object. | Export rejects; rejection is strictly identical to the recorded upstream error object, with no wrapping, conversion, swallowed failure, or successful partial return. |
| 3 | Repeat the identity assertion with a distinct upstream error object thrown by the callback as a focused unit check. | Original object identity and fields are preserved; this focused check supplements the real network timeout and cannot replace it. |
| 4 | After the failed call, perform a fresh real /upstream?count=51 export. | It succeeds independently with 50/1 and the complete ordered rows; failure state or partial pages do not leak. |

## Evidence requirements
Future controlled RED/GREEN and acceptance evidence must map UC-D-003 to actual test names and capture the real request/timeout configuration, upstream version, candidate revision, callback invocation counts, strict identity assertion, rejected outcome, and recovery comparison. A fulfilled partial result fails the case. Runtime behavior remains unverified during design preparation.

## Sources and scope
REQ-001 specifies unchanged original timeout/error propagation. AC-001 specifies real upstream timeout without partial results and independent repeated calls. No retry, fallback, new timeout product policy, transport change, or additional public interface is introduced.

## Story provenance
US-001 is defined in docs/aidlc/modules/project/inception/user-stories.md and explicitly delegates boundary behavior to REQ-001 and AC-001. It contains prose, with no source Gherkin to copy.
