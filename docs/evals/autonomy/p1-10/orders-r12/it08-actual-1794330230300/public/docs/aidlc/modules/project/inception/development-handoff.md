# Design reception

One cohesive project/default unit owns the existing local service implementation, tests and delivery notes. The local HTTP provider is an actual running internal pilot service; acceptance must not replace it with a printed status or a stub. All product semantics are fixed; GAP-001 is a compatible implementation detail. No architecture or deployment approval is asserted. This intentionally defective scaffold has never been accepted as a product baseline: all UC-D new classifications represent unmet behavior, not waived characterization. Actual Native RED, GREEN and the independent frozen acceptance must prove delivery.

```aidlc-autonomy
{
  "schema": "aidlc.autonomy-source/v1",
  "records": [
    {
      "schema": "aidlc.autonomy/v1",
      "record_type": "policy",
      "record_id": "orders-policy",
      "workflow_id": "9145b784-bc71-4d7d-bf82-8d19f1f7b281",
      "revision": 1,
      "inputs": [
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/requirements.md",
          "digest_mode": "raw-file",
          "digest": "8854501939f7e3d56aa1050373c83dbb9ced6708019dce74e76caa66a3566a6c"
        }
      ],
      "policy_id": "orders-policy",
      "policy_revision": 1,
      "scope_refs": [
        {
          "batch_id": "orders",
          "scope_revision": 1
        }
      ],
      "hard_constraints": [
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/requirements.md",
          "digest_mode": "raw-file",
          "digest": "8854501939f7e3d56aa1050373c83dbb9ced6708019dce74e76caa66a3566a6c",
          "item_id": "REQ-001"
        }
      ],
      "validation_requirements": [
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/requirements.md",
          "digest_mode": "raw-file",
          "digest": "8854501939f7e3d56aa1050373c83dbb9ced6708019dce74e76caa66a3566a6c",
          "item_id": "AC-001"
        }
      ],
      "source_precedence": [],
      "delegated_categories": [],
      "fallback_rules": [
        {
          "rule_id": "internal-layout",
          "when": {
            "kind": "missing-detail",
            "refs": [
              {
                "repository_id": "project",
                "path": "docs/aidlc/modules/project/inception/requirements.md",
                "digest_mode": "raw-file",
                "digest": "8854501939f7e3d56aa1050373c83dbb9ced6708019dce74e76caa66a3566a6c",
                "item_id": "GAP-001"
              }
            ],
            "expected": "unspecified"
          },
          "default_behavior": "Keep the existing single exported async function without adding a public API",
          "constraints": [
            {
              "repository_id": "project",
              "path": "docs/aidlc/modules/project/inception/requirements.md",
              "digest_mode": "raw-file",
              "digest": "8854501939f7e3d56aa1050373c83dbb9ced6708019dce74e76caa66a3566a6c",
              "item_id": "REQ-001"
            }
          ],
          "required_checks": [
            "complete-acceptance"
          ]
        }
      ],
      "allowed_change_classes": [
        "implementation-refinement",
        "baseline-defect-fix",
        "behavior-preserving-refactor"
      ],
      "escalation_conditions": [],
      "authority_ref": {
        "source_kind": "host-user-message",
        "source_locator": "codex://current-conversation/P1-10-and-delegated-engineering-policy",
        "source_digest": "bb683d8d910a2bb29858e6e71838d8c938c3a023075d0a429f74f91136299395",
        "scope_summary": "orders/1",
        "actor_locator": "current-user"
      }
    },
    {
      "schema": "aidlc.autonomy/v1",
      "record_type": "validation-matrix",
      "record_id": "orders-matrix",
      "workflow_id": "9145b784-bc71-4d7d-bf82-8d19f1f7b281",
      "revision": 1,
      "inputs": [
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/requirements.md",
          "digest_mode": "raw-file",
          "digest": "8854501939f7e3d56aa1050373c83dbb9ced6708019dce74e76caa66a3566a6c"
        }
      ],
      "checks": [
        "complete-acceptance"
      ]
    }
  ]
}
```
