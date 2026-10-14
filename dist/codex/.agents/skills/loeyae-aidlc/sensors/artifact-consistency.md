# artifact-consistency

Adopted story/I10 scopes. Requirements owns field_contracts (stable ID, grain,
definition and aliases), decision_contracts (effective/superseded/source),
artifact_mappings (path, classified field/decision uses and dependencies), and
artifact_review. Actual generated module Markdown/HTML/JSON is inventoried,
including UC-D only when generated. Historical/audit and migration references
remain legal when explicitly classified and explained.

Compare structured grain/definitions, effective decision uses and graph edges.
Natural-language meaning needs the bound artifact review; term hits alone only
locate missing mappings, never prove a contradiction. Changes use both old/new
checkpoint snapshots and consumer edges, so deleting a reference cannot erase its
impact. Hash-linked producer checkpoints detect semantic edits omitted from change
registration. Errors: ARTIFACT_SUPERSEDED_RULE_USED, ARTIFACT_FIELD_CONFLICT,
ARTIFACT_MAPPING_MISSING, CHANGE_ARTIFACT_OMITTED, CHANGE_SYNC_INCOMPLETE,
CHANGE_DEPENDENCY_MISSING.
