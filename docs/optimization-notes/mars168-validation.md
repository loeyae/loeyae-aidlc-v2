# MARS-168 implementation evidence

## Phase 0

Actual baseline 4.15.0 / 39a0399; origin loeyae/loeyae-aidlc-v2. Downloaded both issue attachments through the authenticated CLI. No comment threads existed. Existing user changes recorded and preserved. Contracts frozen in mars168-contract.md. Isolated read-only review identified downstream freshness filtering and whole-module digest pitfalls.

## Phase 1

Implemented adopted quality identity, controlled producer registration, actual orchestrator sensor validation, source hashes, explicit legacy diagnostics and change snapshot validation. New full workflows declare quality v1; legacy projects use explicit migration/adoption records. P0-09 remains foundation only until aggregation.

Executed `npm run compile-graph` (39 stages), `npm run typecheck`, `npx --no-install tsx tests/test_mars168_phase1.ts`: all pass. Tests run the real producer and orchestrator gates, including missing evidence, stale bytes, cross-module payload and invalid applicability. Windows sandbox rejected esbuild subprocess and npm cache writes; privileged reruns succeeded. No test assertion was weakened.

M02 original business artifacts are absent; framework fixtures do not prove business defect closure.

## Phase 2

Implemented dependency-readiness, field-capability and story-rule-consistency through producer, graph, module scope and orchestrator validators. Authoritative inventories and review records bind real source bytes. Technical planned capability and API-defense exceptions pass.

Executed `npm run compile-graph`, `npm run typecheck`, `npx --no-install tsx tests/test_mars168_phase2.ts`: pass. Actual producer/gate negatives cover unconfirmed dependency, stale external baseline, bilingual capability gap, performance threshold violation, unreachable UI path, conflicting effects and reviewed formula boundary mismatch. Valid prototypes and UI/API distinction pass. Missing semantic evidence is not projected as success.

## Phase 3

Implemented local html-validate 10.4.0 and parse5 8.0.0 validation of the canonical
HTML set, approved region denominator, Story/AC ownership, states, actions and
feedback, plus scoped Figma readback checks. Executable mocks require browser
observations bound to final HTML; explanatory mocks declare that mode explicitly.
I10 aggregates specialized evidence and handoff hashes. Actual next/report before
development preserves I11/I12/I13, selected PRD and original inception evidence,
and additionally requires current developer reception/technical review.

Real controlled producer/gate fixtures cover HTML errors, duplicate IDs, root-only
trace, missing regions, dangling/wrong-owner AC, missing state/feedback/targets,
removed regions, Figma snapshots, skip/no UI, blockers, incomplete/stale packages
and transactional rejection of a development report. Valid cases pass.

## Phase 4

Implemented shared Story/AC definition indexing and existing-copy discovery,
field/grain/alias and effective/superseded decision reconciliation, and old/new
artifact dependency closure including actual generated downstream documents.
Producer checkpoints retain content-addressed before text; semantic revalidation
binds before and after consumer bytes. Deletion does not erase old consumers.
Tests cover duplicate definitions, divergent copies, harmless repeated references,
orphan AC, grain conflicts, legal aliases/historical citations, new dependencies,
omitted affected consumers, valid revalidation and post-production historical-text
tampering. Fixtures exercise the actual orchestrator gate, not only helper returns.

## Phase 5 and completion matrix

Implemented read-only `quality metrics --module <id>`: current valid coverage,
unknown/missing measurements, zero-denominator applicability and distinct return
defects with primary/secondary causes. Reads do not modify workflow files.

All 13 items are implemented and fixture-verified. This table distinguishes
framework acceptance from the unavailable M02 business pilot.

| Item | Implemented integration | Verified evidence | Not verified |
| --- | --- | --- | --- |
| P0-01 applicability/binding | shared identity, producer, graph, validator, adopted scopes | phase1; report; admission; legacy/split lifecycle | M02 real input envelopes |
| P0-02 dependencies | requirements report and downstream readiness | phase2 unconfirmed/stale/conflicting source and valid confirmation; report rejection | actual external API confirmation |
| P0-03 field capability | requirements report and delivery aggregation | phase2 i18n/performance/new capability, valid planned adaptation; report rejection | actual base code and production performance |
| P0-04 story rules | user-stories report, rule-specific semantic sources/examples | phase2 conflicts, stock equality boundary, unreachable normal UI, legal disabled constraint/API defense; report rejection | original business formulas/review |
| P0-05 HTML | actual local validator, ui-artifact-consistency and I10 | phase3_ui ERROR/duplicate ID/current file handling; legal HTML | original M02 Mock |
| P0-06 regions/AC | page-plan denominator and DOM/Figma mappings | phase3_ui missing/root/dangling/wrong AC/removal and valid mappings | remote Figma production readback |
| P0-07 state/actions | page-plan, generation and I10 UI sensor | phase3_ui state/target/feedback/async/structure checks and valid modes | real executable browser interactions |
| P0-08 change invalidation | source hashes, linked checkpoints, revalidation, baseline CR route | phase1/phase4 stale inputs, before text, old consumers; admission/lifecycle | M02 live CR operation |
| P0-09 delivery/admission | I10 aggregation, actual next/report and current reception | phase3_delivery/admission valid and blocked gates, original I10 preserved, sibling/code-only tolerance | business developer acceptance |
| P1-01 definitions/copies | shared definition parser, canonical/existing copies | phase4 duplicate/copy/orphan rejection; references/no-copy valid | M02 Epic corpus |
| P1-02 cross-artifact facts | artifact-consistency in user-stories/I10 | phase4 grain/active-superseded/new-dependency failures; alias/history valid | actual business artifact corpus |
| P1-03 omitted changes | current artifact inventory plus old/new dependency closure | phase4 omission/deleted-ID consumers and valid synchronized review | actual generated UC-D corpus |
| P2-01 metrics | CLI only; no added blocking sensor | phase5 unknown/zero/dedup/read-only | observed defect reduction or return rate |

## Actual commands and limits

- `npm run compile-graph`: passed, 39 stages. No invented I6/I8/I16 stage slug.
- `npm run typecheck`: passed after final review fixes.
- `npx --no-install tsx tests/run_mars168.ts quality`: 9/9 passed; complete recorded
  results and individual stdout/stderr logs in `mars168-command-logs/`.
- `npx --no-install tsx tests/run_mars168.ts regression`: 17/19 passed after relevant
  reruns; the two failures below reproduce on the unmodified baseline.
- `F:/ProgramData/miniconda3/python.exe tests/test_platform_hooks.py`: passed.
- `F:/ProgramData/miniconda3/python.exe tests/test_structural_invariants.py`: all 11 passed.
- `F:/ProgramData/miniconda3/python.exe tests/test_semantic_checkers.py`: stops at
  the existing UI-generation-lock assertion at line 1249; same baseline failure.
- `npm run build:all`: passed, all nine supported harnesses generated from core.
- `npx --no-install tsx tests/run_mars168.ts distribution`: 1/1 passed.

Baseline comparisons use detached original commit `39a0399`, not a patched old
implementation. `test_v4_3_module_workflows.ts` fails the same line-287
stage_instance expectation (undefined versus requirement-clarification@module:m03).
`test_v4_9_0_nested_repo.ts` has the same 3 passing/6 failing sections, involving
prior stage-template/test-case-derivation expectations. These remain existing
failures; neither is reported as passing. Full `npm test` was not run end-to-end.

The 4.10 adoption regression fixture now explicitly seeds a legacy state: creating
a new full workflow intentionally enables quality v1 and is covered elsewhere.
Its pre-candidate timing uses the actual commit timestamp minus one second rather
than assuming fixture setup finishes within a wall-clock allowance. Existing
acceptance assertions remain intact; this legacy regression passes.

Source changes are concentrated in `core/tools/aidlc-quality-*.ts`,
`aidlc-story-index.ts`, evidence/orchestrator/layout/graph integration, seven sensor
documents, six actual inception stage contracts, CLI, package dependencies and
targeted tests. Generated dist also refreshes files already present in baseline
core but missing from the previously committed distributions. No package version
bump, publish or automatic merge is performed. Preexisting user configuration
changes and attachment working copies are excluded from the delivery commit.

The semantic source records are auditable input-bound reviews; they are not an
automated proof of arbitrary natural-language equivalence. Fixture performance
logs and Figma node snapshots demonstrate framework enforcement, not real service
benchmarks or remote business design correctness. M02 pilot remains pending until
original requirements, stories, Mock and actual review records are provided.
