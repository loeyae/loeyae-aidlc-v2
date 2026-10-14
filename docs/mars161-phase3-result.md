Phase 3 is complete and independently verified.

- Lightweight execution is enabled only for persisted `lightweight` profiles.
- A shared graph-derived selector is used by execution expansion, reconciliation, document-cascade checks, StagePlan, and counts.
- A stage may be omitted only when it is `ALWAYS`, automatic, `instruction_only`, non-blocking approval, has no sensors or products, and is not required by a selected stage.
- In the current graph, only `state-template` qualifies. All gate, evidence, sensor, producer, dependency-root, and `approval: block` stages remain selected.
- Legacy, standard, and complex profiles preserve historical selection. All eight scopes are covered by the regression matrix.
- Added global-only `orchestrate profile escalate --signal <ProfileSignal> [--detail <text>]`; it records user-triggered escalation as `profile_escalation`, retains historic `engine_escalation` parsing, and rejects module targets or legacy implicit migration.
- An end-to-end CLI test proves a lightweight bugfix skips only `state-template`, then a complex escalation restores it.

Passed: `npm run typecheck` and focused Phase 0–3 tests. Git-fixture tests require an environment that permits Node to spawn Git; those tests passed in the permitted execution environment.
