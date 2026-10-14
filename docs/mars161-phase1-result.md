Phase 1 is complete and independently verified.

- `execution_profile` is optional and persisted only in global WorkflowState lineage.
- Legacy states remain profile-free through parse/render/save until explicitly initialized.
- Module and integration states reject profile persistence; merged views inherit the global profile only.
- New global `orchestrate next --scope` initialization records an advisory scope-default profile.
- Persisted events use the same semantic validation as the event factory; profiles require non-empty event history and canonical risk ordering.
- Classifier and apply paths preserve initial `source`; apply validates its inputs before mutation.
- Added black-box CLI coverage for bugfix/lightweight, feature/standard, and legacy resume.

Passed: JSON validation, TypeScript check, Phase 0 and Phase 1 focused tests. The Phase 1 CLI fixture must run with permission to spawn `git`; it passed in that environment.
