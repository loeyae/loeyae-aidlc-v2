Phase 0 is complete and independently verified.

- Added a fixed historical WorkflowState fixture proving parse/render/parse does not synthesize `execution_profile`.
- Added future-shaped sentinel coverage proving a profile belongs to global lineage state, is visible in the merged view, is retained by global extraction, and is omitted from module extraction and fresh module state.
- Added the characterization test to the default `npm test` chain.
- Passed: focused Phase 0 test and `npm run typecheck`.

No production WorkflowState, renderer, parser, or orchestrator behavior changed in this phase.
