# Current and historical test coverage

`npm test` runs `scripts/core-test-suites.json`, the current AIDLC 5 contract. The suite covers completion boundaries, read-only host context, explicit method selection, source pinning and knowledge integrity, module facts, hostile DOCX/export candidates, host detection, owned installation, and ten-host distribution consistency.

The former suite is preserved verbatim in `legacy-suite-4.x.json`. Its stage orchestration, session grants, signed receipts, sensor sequencing and wrapper tests remain as historical regression assets, but their implementation was removed in the 5.x rebuild; they are not current executable acceptance criteria. Their files and fixtures are retained. Do not report them as passing on 5.x.

Quality and permission invariants are carried forward through current behavior tests: incomplete/failed/stale acceptance never becomes complete, projections grant no permission, missing approval is not synthesized, retired commands never execute, package sources and actual document candidates remain validated, and installation cannot overwrite unowned/user-modified files. Real host model behavior and real external deployment require their own validation; local fixture success is not that evidence.
