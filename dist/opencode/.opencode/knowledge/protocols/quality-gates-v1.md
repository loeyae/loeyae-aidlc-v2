# Quality gates v1

New full product workflows declare `Quality Gates Version: 1`. Other scopes retain
their execution profile and existing gates. A legacy workflow does not silently
adopt new requirements: its module inception directory can contain
`quality-adoption.json` with `version: "1"`, current `workflow_id`, `module_id`,
`scope`, `status: "adopted"`, rationale, adopted_by, migration_differences array
and a nonempty evidence_plan array. Unsupported/incomplete records block. Capture
the adoption in the conductor's audit and review the migration boundary before
using the new gates. No new stage or parallel business approval system is added.

## Authority and input format

Existing Markdown documents own a single fenced `aidlc-quality` JSON section.
Each has version `"1"`, a stable delivery_scope, and project-relative inputs array.
The sections are the authoritative structured facts; checkers project evidence.
Do not maintain an independently edited JSON business copy.

requirements.md owns:

- inventory: dependencies, fields, rules ID arrays, derived from approved intake
  data/actions/consumers and reviewed as `inventory`, rather than only registered
  successful checks;
- dependencies: id, critical, in_scope, exclusion_reason when excluded,
  granularity, mode, deletion, default_value, source, source_version, owner,
  confirmed_by, status, consumers, baseline_source_sha256, product_source,
  technical_validation; product/technical paths are separate evidence roles;
- fields: id, applies (new/changed/high-risk/unchanged), granularity, plan,
  capability (existing/planned), required_capabilities, verified_capabilities,
  evidence paths, adaptation_plan for planned capability, performance_required,
  and applicable performance (path/command/exit_code/threshold/measured/unit);
- dependency_review and field_review paths;
- artifacts: id/path/sha256/ids/depends_on snapshots; changes: id/kind/before/after,
  affected/synchronized/reverified and route (in-flight/cr) plus cr_path.

Semantic changes also bind reverification_review (kind `change`, current affected
consumer inputs and supported items). A CR reference includes cr_id and points to
the existing handoff or L3+ transient record containing an `aidlc-cr` JSON section:
id/status=`approved`/approved_by/approved_at/risk/consumers/verification. L1/L2 keep
the record in handoff.md rather than adding an independent CR file. For an artifact
that describes its own inventory, use semantic_sha256: the deterministic semantic
projection excludes bookkeeping artifacts/changes and normalizes whitespace;
ordinary input bindings still retain the complete raw byte hash.

user-stories.md owns rules and rule_review. Every rule includes id, condition,
action, effect, channel (ui/api-defense), ui_reachable, visibility,
failure_required and applicable failure; examples contain id/input/expected/
boundary. Semantic conflict_with entries need effective decision references.
UI constraints that prohibit/disable/hide an action use ui_path_kind `constraint`;
normal actionable paths use `normal` (default). A prohibition is not misclassified
as an unreachable normal flow; conflicting UI constraints still share the UI rule
domain, while API defenses remain separate.
Story and AC definitions begin Markdown headings or list items with US-/AC- IDs;
ordinary prose references do not define IDs. Each AC belongs to its enclosing US.

ui-design/page-plan.md owns regions, actions and ui_review. Region entries have
id/page_id/change/stories/acs, required_states and states (condition/behavior/source).
Decorative exclusions need decorative_reason. Local changes include base_structure
path/sha256 and structure_changed/decision when appropriate. Actions have
id/region_id/page_id/target/success/failure_required/failure or failure_exemption,
asynchronous/result_entry and local when the approved action stays in place.
HTML uses data-region/data-change/data-us/data-ac; interactive entries use
data-action. Canonical manifests remain the existing UI authority.

interaction_mode is explanatory or executable. Scripted Mock interactions require
browser_evidence with actual command/exit_code, final HTML input hashes and passed
action observations; a missing or stale browser result blocks. The local HTML
validator runs the pinned recommended rules; suppressions in HTML are rejected.

Figma manifests add region_nodes with id/page_id/region_id/stories/acs/actions/
targets and node_snapshot, an actual node/component readback for the same file_url.
An external design remains read-only. Neither Figma nor skip requires HTML.

cross-validation-report.md owns package (kind/path entries), pending_items
(id/blocking/status/reason), decisions and optional development_acceptance path.
The handoff index includes canonical documents, selected UI sources and
development-handoff.md. The handoff describes migration, interface/defaults and
regression scope, rather than copying business conclusions.

## Review records and controlled evidence

Review inputs are ordinary source records, not hand-written controlled evidence.
Their JSON includes version/workflow_id/module_id/delivery_scope/reviewer/kind,
inputs with actual SHA-256, items with id/conclusion/rationale/references/examples,
and explicit open_findings. kind is dependency/field/rule/ui/artifact as applicable.
Concrete findings block; missing/unverified conclusions block. Bind all actual
source bytes and both sides of semantic comparisons. Arbitrary formula equivalence
requires a review of concrete boundary examples; ID presence is insufficient.
Automatically run appropriate technical/semantic review in the host agent; request
product adjudication only when a business decision/source precedence is unresolved.

Run `loeyae-aidlc evidence run --stage <actual-stage> --module <id>` to produce
registered evidence. Completed stages use --refresh and subsequent report for
re-attestation. Evidence binds checker version, workflow/module/scope/stage,
signed route, inputs, reviewed ID coverage and real execution. Never edit the
producer outputs. A failed checker writes a blocked report, not pass evidence.

## Change and admission

Input bytes change -> old conclusions cannot be consumed -> conductor records
impact and synchronizes consumers -> review/targeted revalidation -> new evidence.
Preserve existing UI lock, immutable single full acceptance and checkpoint chain.
Changes with a code/adoption baseline follow existing CR policy. Deletions retain
old mappings. Formatting updates hashes without inventing semantic conflicts.

I10 aggregates specialized controlled evidence, handoff files and blockers into
product-ui-ready. Actual development additionally needs package-bound developer
reception/technical review and existing I11/I12/I13/selected PRD/TDD gates. Quality
v1 freshness is the existing 24-hour evidence policy plus input content binding;
unrelated upstream commits alone never stale explicit product inputs. Implementation
code edits are tolerated when rechecking the old product readiness envelope.

Development acceptance source JSON includes workflow_id/module_id/accepted_by,
technical_review and inputs binding every canonical handoff package path. A later
package change requires renewed reception. The conductor alone records stage
progress; a checker result never advances workflow state.

Technical split preserves the project workflow lineage. Module-scoped adoption,
semantic reviews and development reception can name that stable project workflow
or their current module owner; all module IDs and actual package hashes still
must match. Controlled producer evidence is re-attested for its new owner.

The change producer retains actual before text in content-addressed files under
the quality lineage's snapshots directory. A change review must bind those files
and the current after/consumer inputs. The resulting controlled evidence also
binds historical files, so deleting or changing before text invalidates its gate.

technical_review is an actual scoped JSON source with reviewer/conclusion,
current package input hashes and explicit findings. Selected PRD additionally
requires a project-scoped `prd_review` (kind prd, supported conclusion, reviewer,
current PRD input hash, no unresolved findings) at actual development admission;
there is no invented I16 stage slug.

## Read-only quality metrics

`loeyae-aidlc quality metrics --module <id>` reads only current valid evidence.
Unknown measurements stay unknown; zero denominators are not applicable. Return
events live under the workflow-specific quality lineage directory (SHA-256 prefix
of workflow ID, then module ID), separate from future workflows reusing a module.
quality-events.json records deliveries (id/timestamp) and defects with stable id,
delivery_id, primary_cause, secondary_causes, first_detectable_stage and optional
external_fact confirmed_at/version. Categories are semantic-error,
synchronization-omission, technical-feasibility-omission and external-fact-change.
A defect spanning multiple pages is counted once. Metrics never add a sensor.
