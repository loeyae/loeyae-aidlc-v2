Adopted full workflows now block requirements, stories, UI delivery and actual
development admission when current product evidence is missing, stale, conflicting
or incomplete. Legacy workflows retain their existing gates until explicit adoption.

Implements the 13 MARS-168 items: controlled scope/hash evidence, dependencies,
field capability, rule/reachability review, local HTML validation, region/AC trace,
UI behavior, change invalidation and CR/revalidation, delivery reception, Story/AC
copies, artifact facts, omitted consumers, and read-only quality metrics. Preserves
existing UI acceptance, module isolation, downstream stages and execution profiles.
All nine harness distributions are generated from core.

Validation: typecheck, nine dedicated quality suites, 17/19 targeted old regression
suites, platform hooks and structural invariants pass. Two old TypeScript suites
and the Python semantic UI-lock assertion fail identically on original 39a0399;
see `docs/optimization-notes/mars168-validation.md` and recorded command logs.
Full npm test was not run. Separate distribution parity is recorded in the report.

Independent read-only Spec/Standards review findings were corrected, including
historical before-text freshness and split reception identity. M02 original business
artifacts are absent: fixtures verify framework gates; actual business pilot,
remote Figma/browser actions and observed defect reduction remain unverified.
No version bump, publishing or merge is requested by this PR.
