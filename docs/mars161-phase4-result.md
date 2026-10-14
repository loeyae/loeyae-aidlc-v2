## MARS-161 Phase 4 acceptance

Phase 4 adds a deterministic, typed progressive rule-load plan. It is derived
from the existing Phase-3 `selectExecutableStages` result and is exposed only
as read-only hand-off metadata; it does not change workflow selection, state,
gates, sensors, evidence, or reporting.

`orchestrate next` now includes `rule_load_plan`. `load_now` contains the
current stage rule file and its transitive selected dependencies; all other
selected stage rules are explicitly `deferred`. `orchestrate state rules`
provides the same workflow-wide selected set without loading a target.

Safety invariants:

- `advance()` performs resume, condition evaluation, rule planning and every
  admission/provider check on a cloned state. It copies and commits only after
  all pass. A selected stage with an absent declared dependency, or any later
  admission failure, leaves parked status, current context and speculative
  condition skips unchanged.
- A selected dependency absent from the selector output fails closed.
- Gated, blocking, sensor/produce-bearing, and dependency-root rules are
  marked mandatory and remain in the selected plan.
- Standard, complex, and profile-less legacy workflows retain complete
  historical rule selection.
- Lightweight only omits rules whose corresponding stage Phase 3 safely
  omitted; currently this is `state-template`. A profile escalation restores
  that stage rule on the following plan.

Validation: `npm run typecheck`; `test_mars161_execution_profile_phase0.ts`
through `test_mars161_execution_profile_phase4.ts` all pass. Phase 4 is also
included in the default `npm test` command.
