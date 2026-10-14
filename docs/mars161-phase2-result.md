Phase 2 is complete and independently verified.

- Added a deterministic advisory `StagePlan` derived from the existing stage graph and execution-profile provenance.
- Missing/legacy profile projects conservatively as `standard` with `legacy_standard_default`; it does not persist a migration.
- Added read-only `orchestrate state plan [--module <id>]`.
- Module targeting rejects unsplit layouts and unknown module IDs rather than silently falling back to global state.
- The StagePlan selector is tested for exact slug parity with the existing `getExecutableStages()` behavior, including optional user selections.
- Phase 2 coverage runs from the default MARS-161 regression path without removing prior tests.

No runtime execution selection, stage skipping, gate, evidence, or state migration behavior changed. Passed: TypeScript check and focused Phase 1/2 tests in an environment permitted to create Git fixtures.
