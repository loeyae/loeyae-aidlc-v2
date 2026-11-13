# Current test coverage

`npm test` builds all hosts and runs `scripts/core-test-suites.json`. It covers completion boundaries, read-only host context, explicit method selection, source pinning and knowledge integrity, module facts, hostile DOCX/export candidates, host detection, owned installation and ten-host distribution consistency. The project case executes real local consumers and an HTTP order flow: a passed cart check cannot hide a broken inventory consumer, missing integration, required CI, pending external acceptance or delivery. These fixture results do not measure model behavior or production CR duration.

Retired engine tests, their dedicated fixtures, old runners and one-time evaluations are removed from the current tree. They remain accessible at Git commit `cd703ab996b32b18b4ca533420226d21229830bf` and earlier (`git show <commit>:<path>`). The retained Provider lifecycle test exercises actual Git objects, pinned revisions, trust/configuration checks and hostile install hooks without the removed stage/session fixture. No old engine is loaded to run the current suite.

| Command | Additional coverage |
| --- | --- |
| `npm run test:install` | 18 installer lifecycle cases: ownership, user changes, upgrades, rollback, unknown files, host configuration and shared assets |
| `npm run test:package -- --previous-ref <commit>` | Clean source archive and actual release tarball; production dependencies, ignored install scripts, automatic build, ten-host parity, real HTTP global install, upgrade and rollback |
| `npm run test:providers -- --providers <registry.json>` | Explicit immutable `document-render` checkout: actual export and DOCX candidate checks; registry format is `aidlc.integration-providers/v1` with `source`, `revision` and `checkout` per Provider |

The Python DOCX/export cases in `npm test` run missing-provider diagnostics by default. Actual rendering needs the explicitly configured document Provider; a diagnostic pass does not claim production rendering or final page-layout acceptance. External rendering tests remain in the tree and are not silently reported as passing when the package is absent.

Test logs default to independent temporary directories; use `.artifacts/` for locally retained results. Do not commit run outputs or copy this coverage table into workflow evidence files. Only add regression cases for current behavior, a verified defect or a real quality/permission boundary.

Quality and permission invariants are carried forward through current behavior tests: incomplete/failed/stale acceptance never becomes complete, projections grant no permission, missing approval is not synthesized, retired commands never execute, package sources and actual document candidates remain validated, and installation cannot overwrite unowned/user-modified files. Real host model behavior and real external deployment require their own validation; local fixture success is not that evidence.
