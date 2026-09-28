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
| `required` | `ucd_total >= 1`, every UC-D is `ready`, `_index.md` and source references exist |
| `not_applicable` | reason code, reason, approval reference, alternative validation, validation command, and non-empty source references |
| `producer` | controlled evidence producer only |
| `checker` | `builtin:test-case-derivation` with exit code 0 |

The evidence is consumed by RED and GREEN. No fast path, Code-First instruction, plan text, or chat statement can replace it.
