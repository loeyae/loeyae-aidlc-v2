Implement the AIDLC execution-profile optimization in ordered phases.

## Phase order

1. Baseline and compatibility contract
2. Persist `execution_profile` in the global WorkflowState lineage
3. Build a StagePlan from profile and stage graph
4. Enable a conservative lightweight workflow slice
5. Add progressive rule loading
6. Add evidence reuse and validation scheduling
7. Run regression, migration, and release measurements

## Invariants

- Existing WorkflowState files without `execution_profile` remain readable.
- Only the global lineage state owns the persisted profile.
- Profile level is monotonic (`lightweight < standard < complex`).
- `source` is immutable after initialization; upgrades are recorded in events.
- Evidence and mandatory safety gates are never silently bypassed.
- Each phase must pass focused tests and TypeScript type checking before the next starts.
