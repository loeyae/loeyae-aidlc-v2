# ui-behavior-consistency

Quality v1 checks the approved page-plan region directory, Story/AC ownership,
state branches, action targets, success/failure applicability, async result
entries and base structure evidence. Removed regions remain mapped and must be
absent. Display/hide/disable follows approved source rules.

HTML generation and I10 use local html-validate 10.4.0 with its recommended rules
and parse5 8 DOM traversal. No public upload; no inline validator suppression.
Every canonical final HTML is validated, not a sample. Duplicate IDs, page-root
traceability, dangling/wrong-owner ACs and unregistered interactive entries block.
Figma uses real node/component readback for the selected file and region mappings;
skip/no UI has explicit inapplicability and never requires HTML.

Semantic equivalence uses an input-bound UI review. Browser-executable interactions
need browser validation evidence; explanatory Mock interactions use the approved
operation table and design review. Existing full acceptance/checkpoints remain.
Errors: HTML_STATIC_ERROR, HTML_VALIDATOR_UNAVAILABLE, HTML_DOM_CONTRACT_ERROR,
UI_REGION_UNTRACED, UI_ROOT_ONLY_TRACE, UI_TRACE_TARGET_MISSING,
UI_AC_STORY_MISMATCH, UI_STATE_BRANCH_MISSING, UI_ACTION_TARGET_MISSING,
UI_FEEDBACK_MISSING, UI_RULE_MISMATCH, UI_BASE_STRUCTURE_DRIFT.
