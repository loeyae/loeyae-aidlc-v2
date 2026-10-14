MARS-169: Preserve canonical documents and validate derived unit slices

Document slicing previously instructed users to rename requirements.md and
stories.md while gates continued reading stable canonical paths. Keep complete
requirements.md and user-stories.md and generate deterministic, lossless derived
unit/shared views from the approved story map instead.

Register document-slice-consistency at unit-generation exit and downstream unit
admission/report, bind controlled evidence to current sources/map/units/manifest
and object bytes, and carry a separate business-document load plan through
directives, delegated execution and handoffs. Add explicit legacy adoption,
conflict-safe recovery, change invalidation/affected consumers and honest byte
measurements. Rebuild all nine harness distributions from core.

Validation: typecheck, graph compile, new parser/generation/real producer/report/next
suite, all nine quality suites, 16/19 affected regressions, distribution byte parity
and nine installed tool smoke checks. The three affected-regression failures
reproduce on fee14ad. Full npm test exits 1 in the historical v4.6.0 tdd_mode route
expectations; no claim of a globally passing pipeline. See mars169-validation.md,
mars169-review.md and mars169-command-logs/ for commands, baseline comparisons,
review findings and their fixes, and limitations.

No merge, tag, release or publish is included. Existing user local configuration
changes are excluded.
