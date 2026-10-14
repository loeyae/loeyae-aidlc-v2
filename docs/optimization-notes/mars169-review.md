# MARS-169 independent review

Mode: INDEPENDENT_DUAL_AXIS. execution_context: isolated. review_only: true.
Two independent read-only reviewers received the issue, contract, changed source
and test evidence, without the implementation conversation. Root remained the
only framework writer. Neither reviewer wrote workflow state or controlled evidence.

| Axis | Finding | Resolution and re-review |
| --- | --- | --- |
| Spec | Nested list ACs omitted as indented code | Shared Markdown block maps distinguish valid lists from code; nested AC, duplicate and orphan tests pass. Closed. |
| Spec | Ordinary Requirements prose accepted as a source | Complete Source/来源/需求来源 label and separator required; prose negative and explicit-source tests pass. Closed. |
| Spec re-review | Rescanning a nested story lost its parent list context | Provenance now uses original document scan and original entry ranges; exact nested-story regression passes. Closed. |
| Standards | Concurrent recovery could unlink a replacement writer lock | Exclusive recovery mutex covers owner observation and removal; live-owner and competing-recovery tests pass. Closed. |
| Standards | Interrupted canonical recovery could leave partial authority | Complete temp write + fsync + exclusive hard-link publication; injected ENOSPC leaves canonical absent and retry succeeds. Closed. |
| Standards re-review | Interrupted recovery mutex had no recovery path | Owner metadata and explicit dry-run diagnostics/remediation; actual subprocess SIGKILL before publication leaves authority absent, reports dead lock, blocks automatic stealing, and permits retry after explicit cleanup. Closed. |

Final Spec re-review: DONE, no blocker introduced in the fixes. Independent probes
confirmed nested source/owner, verbatim ranges, prose exclusion and indented code
exclusion. Final Standards re-review: DONE, original findings closed, no remaining
critical/important finding in the reviewed fixes. Standards relied on root's test
evidence rather than independently rerunning the full test pipeline.

This is an engineering review record, not fabricated `review-evidence.json`, a
workflow approval, merge authorization, or a claim that the entire historical test
pipeline is green. Baseline failures and unverified customer/token behavior are
reported separately in mars169-validation.md.
