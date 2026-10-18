# MARS-245: controlled workflow split initialization

Baseline: main `d4695013deb00a63b70bfcaea8934c7fcfdcd641` (4.22.0).
Fix branch: `MARS-245-split-session`. No version or release change.

## Root cause and resulting behavior

The CLI required an exact live source session for writes, while each ordinary
child-state save rejected that same binding because the target did not yet exist.
The automatic `next --module` split also required the absence of a binding, making
it incompatible with the CLI's entry guard. A later manifest module used the same
ordinary initialization path and was unreachable from a bound global session.

Both initialization paths now use `withWorkflowInitialization`. It clones the
complete plan, locks the source and every new destination, and checks the source
workflow ID, revision, exact owner/session/generation and expiry inside the lock.
Another live session claim in the source requires a quiescent handoff first.
Existing destination states are rejected. Symlinked destination directories are
rejected. Initialization cannot change unrelated source fields, lose or invent
history, completion/skip records, claims or selections, or rewrite baseline fields.
The ordinary save guard still rejects initialization using an unrelated binding.

The source and destination locks remain held through registry publication, evidence
anchoring, audit writes, final source CAS and synchronous exception rollback.
Registry transactions use the same dead-owner-safe lock implementation as state
publication; lock age alone does not establish abandoned ownership. Rollback
restores prior state/audit/registry/evidence bytes, preserves an existing target
and its owner's notes, removes this transaction's temporary files, and permits a
clean retry. Valid evidence is inventoried again under the source lock; stale
evidence stays stale and quality evidence retains its existing refresh policy.

Automatic splitting returns `binding_required` and preview/inspect/bind guidance
instead of advancing a module with the source session. A later manifest module
is initialized from a valid global source session and returns the same guidance.
No sibling ownership is granted. An inherited module claim keeps its original
claim data but requires an explicit binding/handoff to its new workflow identity.

## Verification

Run from the isolated fix worktree:

```text
node node_modules/tsx/dist/cli.mjs tests/run_mars245.ts
```

The foreground runner owns an exclusive `.artifacts/mars245/run.lock`, records the
exact child commands, exit codes and durations in `results.json`, and keeps each
command's stdout/stderr in a separate log. The complete selected run passed all
18 commands (exit 0):

| Coverage | Commands/tests |
| --- | --- |
| Source typing | `node node_modules/typescript/bin/tsc --noEmit` |
| Real CLI single-layout split, inheritance, exact target binding | `test_mars245_split` |
| Binding refusal without writes | missing binding; wrong root/workflow/owner/session/generation; expired/transferred claims; competing live source claim |
| Failure and retry | child-state, registry, second evidence publication and final global commit faults; pre-existing audit/owner notes; later-module registry rollback |
| Concurrency | planning-time handoff and source revision change; competing target/registry; transfer blocked during publication and permitted after release |
| Existing phase6 assertions | `test_mars161_execution_profile_phase6` with a real source bind; all original measurement/profile-inheritance assertions retained |
| Session/Stop/layout/report | `test_mars243_sessions`, `test_mars243_stop`, `test_mars243_layout`, `test_mars243_report` |
| Legacy execution migration and publication authorization | `test_mars244_migration`, `test_mars244_writes`, `test_mars244_publication` |
| Upgrade/UI/slices/profile | `test_orchestrate_upgrade`, `test_ui_generation_governance`, `test_mars159_ui_freshness`, `test_mars169_document_slices`, profile phase4/phase5 |
| Generated distributions | existing `scripts/build.ts --all`, followed by `test_distribution_parity` (2,211 files, nine harnesses) |

The new split regression is registered in `scripts/core-test-suites.json`; phase6
remains registered. Fault hooks live only in a test child process running the real
orchestrator entry point. Successful splits and explicit binding use `bin/cli.ts`.
Each project starts in a genuine single layout; children and registry are created
by the split command, not pre-created as a substitute for that command.

After final plan-snapshot/directory validation changes, rerun the affected checks:

```text
node node_modules/tsx/dist/cli.mjs tests/run_mars245.ts typecheck test_mars245_split test_mars161_execution_profile_phase6 build-all test_distribution_parity
```

No full `npm test`, Maven regression, production workflow operation, process-crash
or power-loss recovery test was run. No main merge, package publication, user-host
upgrade, personal MCP edit or real m02/m06/m11 workflow mutation was performed.
