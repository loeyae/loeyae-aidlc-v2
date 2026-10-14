# MARS-169 implementation and validation

Baseline: fee14ad / 4.16.0, local Loeyae repository. No version/tag/publish/merge.
Existing .gitattributes, .gitignore, .kiro/settings/cli.json, .multica and attachments
were excluded from the change. Canonical business documents are never renamed or
rewritten by generation. See mars169-contract.md and mars169-review.md.

| Issue task | Implemented | Verified | Remaining evidence limits |
| --- | --- | --- | --- |
| 1 canonical rules and applicability | Token strategy, units generation, directory contract and README corrected | Core search: no active full-document rename instruction; build propagates sources | No customer migration executed |
| 2 manifest/index contract | v1 schema/generator identity, raw source/map/unit digests, independent denominators, AC owners, unit/shared inheritance, navigation | Projection rebuild and tampering regressions | No external schema registry needed; contract is typed/documented locally |
| 3 approved ownership authority | Single approved story-map JSON block in unit-of-work-story-map.md; reverse story sources reconciled with req_refs | Unknown/duplicate map, missing source, req_refs mismatch fail | Legacy prose maps require explicit structured adoption |
| 4 lossless parsing | STORY/US/REQ/AC definitions, original ranges and Markdown-aware code exclusion | Gherkin, multiple AC, nested lists, mixed fences, tables, Chinese, CRLF authority, duplicates/orphans/prose | Arbitrary unsupported ID definition syntax fails coverage rather than inferred ownership |
| 5 shared index | Shared lexer/definition recognition; compact comparison index retains fence-free body role | Existing quality suites and new STORY/nested AC probes | Compact index remains a comparison API, not a slicing source |
| 6 deterministic generation | Explicit CLI, immutable objects, writer lock, manifest published last; no directory cleanup | Repeated bytes, untouched authorities, invalid input/object failure, stale writer handling | Interrupted temp/obsolete objects are retained; no garbage collection |
| 7 sensor registration | document-slice-consistency registered in semantic names/context/dispatch, producer, graph whitelist/frontmatter, gate validator and docs | Controlled producer, actual report and next, graph compilation | No author-written passing evidence |
| 8 complete current bindings | Recompute expected manifest/object bytes and evidence inputs/identity | Coverage/AC owner/path/module/manifest/object tampering and stale evidence fail | Semantic correctness of approved business text remains upstream responsibility |
| 9 adoption compatibility | New full workflow v1 ≥2 units; explicit legacy adoption; single/skipped/lightweight paths; existing artifacts always validated | Applicability cases, damaged adoption, missing adopted manifest, invalid scope/path | No global migration of existing workflows |
| 10 existing gates | Canonical paths retained; missing full-scope requirement root fails; no full.md fallback | Real UI source lock stays identical after slicing and rejects a later canonical edit; existing UI freshness/module/quality/development suites; strengthened MARS112 assertion | Historical baseline failures listed below |
| 11 business load plan | Separate from stage-rule plan; unit + consumer-specific shared text/contracts; directive, handoff and delegated execution carry plan | Actual next plan propagation, unit isolation, stale next rollback, stale report rejection | Host compliance after receiving a directive is not externally measured |
| 12 invalidation/regeneration | All source bytes bound; old/new consumer views compared; unchanged objects reused; unit descriptor digest included | Body changes, formatting freshness, mapping ambiguity, deleted unit/old consumer and unchanged unit | Rebuild computes whole projection; only changed immutable objects are written |
| 13 recovery | Dry-run/conflict report; explicit exclusive canonical publication; locks/evidence never rewritten | Full-only restore, both-file conflict, ENOSPC, actual killed recovery process, live/dead/unknown lock diagnostics | Dead recovery mutex requires documented manual cleanup after stopping all writers; no auto-stealing |
| 14 distribution | Existing all-harness builder; no manual dist edit | Nine harness build, byte parity and installed tools checked against core | Installation smoke uses package runtime dependencies in isolated temp directories, no user profiles |
| 15 measurements | Actual UTF-8 bytes and labeled ceil(bytes/4) estimate; affected units and invalidation paths | Structured plan/generation outputs | No measured model token reduction or customer pilot; missing telemetry is unknown |
| 16 evidence and review | This matrix, raw command logs, independent Spec/Standards review and revision closure | Typecheck, slice integration and affected regressions | Full pipeline result below; no claim of globally green npm test |

Reproduction commands (PowerShell uses the installed Node/tsx versions):

```text
npm run typecheck
npm run compile-graph
npm run build:all
npx --no-install tsx tests/run_mars169_validation.ts slices
npx --no-install tsx tests/run_mars169_validation.ts regression
npx --no-install tsx tests/run_mars169_validation.ts regression . test_mars112_lightweight_traceability
npx --no-install tsx tests/run_mars169_validation.ts distribution
npx --no-install tsx tests/run_mars169_validation.ts full
```

The regression runner initially recorded the historical MARS112 expectation that a
full-scope missing requirements.md was not_applicable. Its assertion was strengthened
to require CANONICAL_INPUT_MISSING, preserving all lightweight defect/change/baseline
anchor checks; the targeted rerun passes. The initial log summary and selected rerun
are both retained, with the latest individual test log reflecting the rerun.

Affected regression result after that targeted rerun: 16/19 pass. Three failures
reproduce with untouched fee14ad source and its original tests in a detached worktree:

| Suite | Current/baseline behavior |
| --- | --- |
| test_v4_3_module_workflows | line 287 expects requirement-clarification@module:m03-merchant, receives undefined |
| test_v4_9_0_nested_repo | RED→GREEN scenario receives test-case-derivation directive instead of the expected route |
| test_v4_10_1_adoption_exemption | requirements completion fails existing quality-change-impact gate because fixture lacks the authoritative aidlc-quality section |

The nearby test_v4_10_0_adoption_baseline passes in both revisions. Raw current and
baseline logs live under mars169-command-logs/ and baseline-fee14ad/. New tests were
not copied into the baseline; its original source and expectations were preserved.

Final distribution check passes, including all nine installed tool copies and the
real UI-lock-after-slicing scenario. Typecheck and graph compile pass.

`npm test` actually exited 1 after 1,024,309 ms. Before its first failure it passed
the new slice suite, all nine MARS168 quality suites, AWS lightweight workflow,
MARS160 execution policy, worktree, v4 Phase1/2, construction I13/RED/GREEN gates,
I13 case-root/executable behavior, v4.5.4 engine defects (10 sections) and v4.6.0 S1
baseline (13 sections). It stopped in `test_v4_6_0_tdd_mode` (four sections expecting
state-template receive test-case-derivation). Tests later in the npm pipeline were
not executed by that command; relevant later suites were run separately above.
The same four tdd_mode sections fail on the untouched fee14ad worktree with its
original test file; the baseline-extra JSON and raw log record that reproduction.

All nine quality suites passed in the full run. The final distribution pass covers
2,117 files across nine harnesses and separately executes each installed slice tool
against the same adopted fixture. Latest typecheck passes after the final test-only
UI source-lock additions. Independent review findings are closed.

Logs preserve process output, including CRLF and blank lines; source/docs whitespace
checks exclude these raw logs. No test assertion was weakened to hide a baseline
failure. The only existing-test behavior change strengthens the full-scope missing
canonical assertion explicitly required by this issue.
