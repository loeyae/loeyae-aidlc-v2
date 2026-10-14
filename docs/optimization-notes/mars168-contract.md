# MARS-168 quality gate contract

Baseline: 4.15.0 / 39a0399. The two M02 input attachments are the acceptance specification. Existing dirty user files remain outside this change.

## Adoption and authority

Quality v1 is enabled per workflow/module/delivery scope. A new workflow records its quality version; legacy workflows require an audited adoption record with migration differences and an evidence plan. Lightweight scopes retain their existing selection. No UI selection, skip and Figma never require HTML. Stage I6 and I8 are semantics of requirements-analysis and user-stories, not new stage identifiers.

The authoritative structured data lives in an `aidlc-quality` fenced JSON section of each existing requirements, user-stories, page-plan and cross-validation document. A section owns only its stage's facts. Machine outputs are deterministic projections; no parallel JSON business register. Semantic review records bind actual source bytes, reviewed IDs, examples and findings. Deterministic coverage checks cannot prove arbitrary natural-language equivalence.

## Execution and evidence

All new sensors use the existing controlled semantic producer. Payloads bind workflow, module, delivery scope, stage, signed UI choice, checker version, configuration and all consumed inputs by SHA-256. Missing, stale, cross-scope and unsupported exemption evidence fails closed. Legacy projects without adoption retain their original gates and receive an explicit legacy diagnostic. Unknown sensors remain failures.

Changed source bytes invalidate conclusions immediately. Changes record old/new IDs, before/after snapshots, affected consumers, synchronization, revalidation and CR routing when there is a code baseline. Deletion uses the union of old and new dependencies. Formatting-only changes still update controlled hashes. The existing one full UI acceptance and targeted checkpoint chain stays in force.

## Gate locations

Requirements exit and story entry: dependency-readiness, field-capability. Story exit and UI entry: story-rule-consistency. Page planning and generation: ui-behavior-consistency; HTML generation uses local html-validate plus parse5 DOM traversal through ui-artifact-consistency. I10: all applicable specialized conclusions, current delivery package and artifact-consistency. Development admission: delivery readiness plus the existing applicable stage dependencies, PRD selection and I13/TDD gates. Product/UI readiness does not imply development admission.

## Frozen boundaries

Scope inventories come from approved source contracts, not only successful mappings. References are distinct from definitions. Removed regions remain in the difference contract and must be absent in the final DOM. AC ownership is explicit. UI reachability and API defensive scenarios are separate. Existing capability and a validated planned capability are different. Hidden/disabled behavior follows approved rules. History and explicit migration references can retain superseded IDs. Metrics are read-only, unknown on missing data, and zero denominators are not applicable.

Implementation and validation are recorded phase by phase in mars168-validation.md. M02 business pilot remains unverified until original business artifacts are supplied.
