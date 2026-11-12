# SCENARIO-001 Ordered order export

## REQ-001 Ordered pagination
Fetch the complete ordered upstream list exactly once and preserve every row and value in order. Return pages of 50; return [] for empty input. Propagate the original upstream timeout/error object unchanged. No UI is in scope. No network stub may replace the acceptance upstream.

## AC-001 Pagination and failure acceptance
120 rows produce 50/50/20. Also verify 0, 1, 49, 50, 51, 100 and 101 rows; flattening must equal the entire original ordered list. A real upstream timeout must reach the caller unchanged, without partial results. Repeated calls are independent.

## GAP-001 Compatible internal decomposition
The implementation's internal helper layout is unspecified. The Agent may use a single function or private helper while retaining the exported exportOrders(upstream) interface and all REQ-001 behavior. Record the choice, implementation and validation for later human review. This does not authorize changing pagination, ordering or failure propagation.
