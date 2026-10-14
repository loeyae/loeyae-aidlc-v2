# MARS-169 document slice contract v1

`requirements.md` and `user-stories.md` remain complete canonical documents. Gates,
UI source locks, traceability and product edits use these stable paths. No implicit
`.full.md` fallback exists. Derived views never become an authority.

The frozen sensor name is `document-slice-consistency`. New feature/enterprise/mvp/
classic workflows record `Document Slices Version: 1`. At units-generation exit,
two or more units require generation. Single units, scopes without unit generation,
and old workflows without adoption remain compatible. An adoption record or manifest
always requires validation, including when malformed or after a unit is removed.

The approved `application-design/unit-of-work-story-map.md` contains exactly one
`aidlc-story-map` fenced JSON block:

```json
{"schema_version":1,"status":"approved","approved_by":"owner","mappings":[{"story_id":"STORY-001","unit_ids":["api","web"]}],"shared_req_refs":["REQ-NFR"]}
```

This is the sole ownership authority. `unit-manifest.json` `req_refs` must equal
the union of each unit's mapped story sources and shared requirements. No manually
maintained `story_refs` field is added. Every canonical requirement must be covered
by a story source or explicitly shared. Every canonical story maps to known units;
AC ownership is its enclosing story. IDs in prose and fences are references, never
definitions. Definitions begin Markdown headings or list items. STORY and legacy US
are accepted. Definitions, source ranges, Gherkin, tables, fences and Chinese text
are retained verbatim. Ambiguities, duplicates and orphan ACs block generation.

`document-slices/adoption.json` binds workflow/module/scope/version. Generation
publishes `document-slices/manifest.json` last with an atomic rename under a writer
lock. Manifest schema/generator version 1 binds identity, canonical byte digests,
unit manifest and approved map digests, independent REQ/story/AC denominators and
AC owners, unit/shared membership and content digests. Content-addressed objects
are immutable files owned by the tool; no user directory is cleaned. Incomplete
generation cannot validate. Index is navigation only. Preambles are shared verbatim;
cross-unit entries appear in shared views and are inherited by mapped consumers.

Validation recomputes the entire expected projection and compares the manifest and
every object byte. Inputs and evidence bind current digests, not author assertions.
Formatting, source, map and unit changes invalidate evidence. Comparing old/new unit
views yields affected and removed consumers, including deleted entries. Unchanged
objects retain their paths and bytes. Read-only loading reports bytes and a labeled
estimate (ceil(bytes/4)); missing measurements are unknown, not claimed savings.

`generate`, `check`, `plan`, `recover` are explicit commands on
`core/tools/aidlc-document-slices.ts`; `recover` defaults to dry-run and requires
`--apply` to restore an unambiguous legacy full document. Conflicting files block.
Recovery never rewrites source locks or evidence; normal gates must be rerun.

The business load plan is separate from stage-rule loading. Adopted construction
loads current unit + shared views and existing module/product contracts; stale or
missing adopted views block. Legacy construction uses canonical documents. The
sensor is rechecked on unit handoff and report, retaining existing upstream and
quality admission checks.
