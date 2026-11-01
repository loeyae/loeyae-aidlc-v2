---
id: test-case-derivation
name: I13 Test Case Derivation

description: Verifies that every code-generation scope has UC-D cases or a structured, auditable non-applicable exemption.
evidence_path: .aidlc/evidence/<stage-slug>/test-case-derivation.json
---

# test-case-derivation Sensor

## Purpose

I13 is a mandatory admission gate for every scope that can reach `code-generation`. It must produce either:

- `status: "required"` with ready UC-D cases, source references, an index, and executable anchors; or
- `status: "not_applicable"` only when the test-case directory contains a valid `non-applicable.json` with a reason code, approval reference, deterministic alternative validation, command, and source references.

An absent source document is not a silent skip. It is either an explicitly validated no-behavior exemption or a failed gate.

## Evidence Rules

| Field | Required rule |
|------|---------------|
| `status` | `required` or `not_applicable` |
| `required` | `ucd_total >= 1`, every active UC-D is `ready` in its own declaration (`_index.md` is not counted), `_index.md` and source references exist; `deprecated` declarations remain historical records and do not satisfy current coverage |
| `ucd_modes` | `required` only: one entry per UC-D, `new` (default) or `characterization`; evidence without it predates 4.6 and means all `new` |
| `characterization` | only when a UC-D uses characterization: `{ ucd, code_refs: [{ path, symbol?, baseline_blob }], reason, approval_ref }` per characterization UC-D; every path inside the source roots and a regular file of the baseline |
| `baseline_commit` | only together with `characterization`: must equal the current workflow baseline (the parent's for a module sub-workflow), which must still be HEAD or an ancestor |
| `baseline_repos` | 4.9.0, only when nested source repositories (`{ "path": "<dir>", "repo": "nested" }` in `.aidlc/source-roots.json`) are registered in the workflow baseline: `{ "<dir>": "<commit>" }`, the commit of each registered nested repository at its start epoch. With it every `code_refs[]` entry carries `repo` (`"."` for the workflow repository, otherwise the nested path) and a nested code ref's `baseline_blob` is resolved inside that repository at its start epoch; workflow-repository code refs keep epoch 0. Without it (and without `repo`) the 4.8.1 rules apply. A code ref in a declared but unregistered nested repository is rejected with the migration command |
| `ucd_units` | `required` only: one non-empty list of distinct unit ids of the module's `unit-manifest.json` per active UC-D. Explicit frontmatter `unit_refs` must cover every active UC-D; body declarations, unknown units, empty lists and duplicates are rejected. New multi-unit derivations without explicit ownership infer it only when approved `req_refs` identify exactly one unit for every case; ambiguous ownership fails before TDD |
| `unit_scope_source` | `manifest_req_refs` when unit ownership was inferred; later applicability checks reproduce that mapping. Existing published evidence without `ucd_units` retains its old all-unit interpretation until an explicit controlled I13 refresh |
| `not_applicable` | reason code, reason, approval reference, alternative validation, validation command, and non-empty source references |
| `producer` | controlled evidence producer only |
| `checker` | `builtin:test-case-derivation` with exit code 0 |

The evidence is consumed by RED and GREEN. No fast path, Code-First instruction, plan text, or chat statement can replace it.

Coverage obligations come from explicit source definitions, not incidental IDs mentioned in design prose. Each active case must reference its actual source; an aggregate index cannot substitute a false case-level reference. Read lifecycle status from the structured declaration: a ready case may legitimately assert that the business response is `blocked`.
