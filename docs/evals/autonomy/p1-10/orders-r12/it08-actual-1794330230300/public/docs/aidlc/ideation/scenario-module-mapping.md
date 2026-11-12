```aidlc-autonomy
{
  "schema": "aidlc.autonomy-source/v1",
  "records": [
    {
      "schema": "aidlc.autonomy/v1",
      "record_type": "batch",
      "record_id": "orders",
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
      "batch_id": "orders",
      "scope_revision": 1,
      "goal": "Correct complete ordered pagination with original upstream failures, in one real Codex session",
      "scenario_refs": [
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/requirements.md",
          "digest_mode": "raw-file",
          "digest": "8854501939f7e3d56aa1050373c83dbb9ced6708019dce74e76caa66a3566a6c",
          "item_id": "SCENARIO-001"
        }
      ],
      "acceptance_refs": [
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/requirements.md",
          "digest_mode": "raw-file",
          "digest": "8854501939f7e3d56aa1050373c83dbb9ced6708019dce74e76caa66a3566a6c",
          "item_id": "AC-001"
        }
      ],
      "ui_refs": [],
      "units": [
        {
          "unit_ref": {
            "workflow_ref": {
              "workflow_id": "9145b784-bc71-4d7d-bf82-8d19f1f7b281",
              "owner_kind": "global"
            },
            "module_id": "project",
            "unit_id": "default",
            "definition_digest": "453f5e5c3475c6f0e4285e6312418e1b1f01e26ace1b8c6c345b346b6b20a50a"
          },
          "role": "implement",
          "expected_capabilities": []
        }
      ],
      "dependency_refs": [],
      "consumer_closure": [],
      "baseline_inputs": [
        {
          "repository_id": "project",
          "path": ".aidlc/commands/build-and-test.json",
          "digest_mode": "raw-file",
          "digest": "e874ccdcda2338787d30bf5661fb0a426d3c7f12e7c0c164b000253082074053"
        },
        {
          "repository_id": "project",
          "path": ".aidlc/commands/code-generation.json",
          "digest_mode": "raw-file",
          "digest": "35d8a0290efce34c41178212527f979f27a318f154b22bb02914ecef363158ad"
        },
        {
          "repository_id": "project",
          "path": ".aidlc/commands/tdd.json",
          "digest_mode": "raw-file",
          "digest": "1f4eba729ef26526ff85999c2c70fe3a7855f8acb1cd702c5b1aa8065f27eae4"
        },
        {
          "repository_id": "project",
          "path": "README.md",
          "digest_mode": "raw-file",
          "digest": "1f319afab58fbbdbbeb0e3873fc5c5e4ef0963a8ece666173665f85eb496e64d"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/ideation/module-manifest.json",
          "digest_mode": "raw-file",
          "digest": "6f50a9014b601f8742a768d56c7bd26466ea58feb473fbc54cdb4f67bef2e474"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/acceptance-review.json",
          "digest_mode": "raw-file",
          "digest": "a4076218a72e5c1d0bdb65d047a0975a7b97de6d327a34e4cbd2d3685b30853e"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/application-design/test-cases/UC-D-001-pagination.md",
          "digest_mode": "raw-file",
          "digest": "9c40b7af1e43eefd03429cca1b2f6310ff47d25fbf2e451a4bb92c9443fbd9d4"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/application-design/test-cases/UC-D-002-independent-calls.md",
          "digest_mode": "raw-file",
          "digest": "dec32a0de6538a0b05e70977ba201fc1d49d0b0f9911e10cc95c78177b5e0214"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/application-design/test-cases/UC-D-003-failure-propagation.md",
          "digest_mode": "raw-file",
          "digest": "2cce4c5b3cfcdf190a89aac910672e17af9cf03253c7fe1be9df89af6389ea30"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/application-design/test-cases/_index.md",
          "digest_mode": "raw-file",
          "digest": "a5ad1e92101edfd80ec46dd7d1e1a54163e1d824a2dc967d5a533b6b28ee574c"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/application-design/unit-of-work.md",
          "digest_mode": "raw-file",
          "digest": "30acaf245571def09074b7535093b6e62570814e30b0277210a8207b24456774"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/cross-validation-report.md",
          "digest_mode": "raw-file",
          "digest": "00b37753af2e307685d95aa5cfc1c4f208e1b31592ea3672063122623e6e5c69"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/development-handoff.md",
          "digest_mode": "raw-file",
          "digest": "9f1539f11c244600dbb1c444ea357a7d839ed3e0458ad3f3992cb81881306386"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/requirements.md",
          "digest_mode": "raw-file",
          "digest": "8854501939f7e3d56aa1050373c83dbb9ced6708019dce74e76caa66a3566a6c"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/technical-review.json",
          "digest_mode": "raw-file",
          "digest": "bb9391b6b499e4706d57a1cf0d2317f8c3257b657422ad9b3bcd080168891a38"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/unit-manifest.json",
          "digest_mode": "raw-file",
          "digest": "5221a37ad05161603fa848a3525d664d49b98cbf8dc9c22fd6680c07bd7ba9d6"
        },
        {
          "repository_id": "project",
          "path": "docs/aidlc/modules/project/inception/user-stories.md",
          "digest_mode": "raw-file",
          "digest": "57da48014a14045bcd47d27d559cd35d305a9e43948943692e4473e836b079f4"
        },
        {
          "repository_id": "project",
          "path": "pilot/admission-plan.json",
          "digest_mode": "raw-file",
          "digest": "b5fbf117c2b598ee603455b20b0a5b9b3c7337a78d642742e826ecb0de0df5c2"
        },
        {
          "repository_id": "project",
          "path": "pilot/candidate.cjs",
          "digest_mode": "raw-file",
          "digest": "352e7d67376fd9898219292c4e219a5cc9c9f167d867b2685adc1cf5f86e26cd"
        },
        {
          "repository_id": "project",
          "path": "pilot/data.json",
          "digest_mode": "raw-file",
          "digest": "9358b5e2bcb9b35660fff90d158fba3f8b7fefe258d79066178ed1d7b10733d8"
        },
        {
          "repository_id": "project",
          "path": "pilot/design-provenance.json",
          "digest_mode": "raw-file",
          "digest": "212fb028755737ac197887a7987bf2833e12a7be38e1d8c595c6b28939d2f5e9"
        },
        {
          "repository_id": "project",
          "path": "pilot/environment.json",
          "digest_mode": "raw-file",
          "digest": "76fdf5b484232d547d89a44c603a67e7347b3fd56b3bc6f3724b1b7fbfff3812"
        },
        {
          "repository_id": "project",
          "path": "pilot/grant-request.json",
          "digest_mode": "raw-file",
          "digest": "7f0cd8dee510acf4244451d71f502f7decd3668214f4971c95328cb3c09be81f"
        },
        {
          "repository_id": "project",
          "path": "pilot/host-prepared-01a1c656-b73d-78f2-8420-8dbb883c9691.json",
          "digest_mode": "raw-file",
          "digest": "42ef54a6a33a648a2d9f00fe231adea00dd72f306ab0e83ec35a9c3d239d498b"
        },
        {
          "repository_id": "project",
          "path": "pilot/host-seed.json",
          "digest_mode": "raw-file",
          "digest": "b57b3869c113bce0765b1eb5e9d076f3f6de2912e0193dfaec39324770f56b49"
        },
        {
          "repository_id": "project",
          "path": "pilot/host.json",
          "digest_mode": "raw-file",
          "digest": "d25db3f34170337399c262ac7f0779805bfa8ed4a12f54576b75fcc5d7f3a692"
        },
        {
          "repository_id": "project",
          "path": "pilot/native-phase.cjs",
          "digest_mode": "raw-file",
          "digest": "8700ba9d3c3f04069d8a6960cfc3ec4bd1b9346363f40cf305900781682d9c75"
        },
        {
          "repository_id": "project",
          "path": "pilot/native-run-guide.md",
          "digest_mode": "raw-file",
          "digest": "b16921e256e53be6e9024113a2c1510aaeeab34a67d459a0ae1fb7df330ea026"
        },
        {
          "repository_id": "project",
          "path": "pilot/observation-environment.json",
          "digest_mode": "raw-file",
          "digest": "a89bafccbaf792ec0026a41db5b77c6813e37a4f19d4f26de0d730c83e64b644"
        },
        {
          "repository_id": "project",
          "path": "pilot/observation-plan.json",
          "digest_mode": "raw-file",
          "digest": "ada775c900d63fb5766056df813d1a947e759d546a6e44ec923472aa35bdba10"
        },
        {
          "repository_id": "project",
          "path": "pilot/oracle.cjs",
          "digest_mode": "raw-file",
          "digest": "1caeaa749a3ec27499f205157f7eca02f132e2cf0abd0ca0bd184a276e1d9dad"
        },
        {
          "repository_id": "project",
          "path": "pilot/preflight.cjs",
          "digest_mode": "raw-file",
          "digest": "267031f436d64142ff748d1e0da79c433d31df919c50025d9ed10ee3dd240c21"
        },
        {
          "repository_id": "project",
          "path": "pilot/prework.md",
          "digest_mode": "raw-file",
          "digest": "5437c6efa375a9bb538d6414b7da34ba93ad05fecdacc5392582d86d9111b2d9"
        },
        {
          "repository_id": "project",
          "path": "pilot/server.cjs",
          "digest_mode": "raw-file",
          "digest": "627d9214392f1b7cbf919bcabf0ed87a4c69a67fd512ca048d8b2b3a2a7aff8b"
        },
        {
          "repository_id": "project",
          "path": "pilot/source-refs.cjs",
          "digest_mode": "raw-file",
          "digest": "fa15b88827a6c938ac27e01747d07c99efb7a6fc9703f309bbe5de23e9ca3268"
        },
        {
          "repository_id": "project",
          "path": "pilot/spec.md",
          "digest_mode": "raw-file",
          "digest": "8854501939f7e3d56aa1050373c83dbb9ced6708019dce74e76caa66a3566a6c"
        },
        {
          "repository_id": "project",
          "path": "pilot/ucds.json",
          "digest_mode": "raw-file",
          "digest": "58caaeca712280a7eff37fb61848811c56ed382ba046273dbad21cdd10e3cd77"
        }
      ],
      "policy_ref": {
        "repository_id": "project",
        "path": "docs/aidlc/modules/project/inception/development-handoff.md",
        "digest_mode": "json-record-v1",
        "selector": {
          "record_type": "policy",
          "record_id": "orders-policy"
        },
        "digest": "9bbef7308f5b9a3e042ae141e2867a33f53d08d39d22991bbe1bd57529be2137",
        "policy_id": "orders-policy",
        "policy_revision": 1
      },
      "integration_owner": "coordinator",
      "validation_matrix_ref": {
        "repository_id": "project",
        "path": "docs/aidlc/modules/project/inception/development-handoff.md",
        "digest_mode": "json-record-v1",
        "selector": {
          "record_type": "validation-matrix",
          "record_id": "orders-matrix"
        },
        "digest": "87863c5ebd7030c9829b6de13abe32d2968b793d229fb5801ed6097c2f3348dd"
      },
      "delivery_artifacts": [
        {
          "artifact_id": "candidate",
          "kind": "candidate",
          "required": true,
          "target_path": "delivery/candidate.md"
        },
        {
          "artifact_id": "run-instructions",
          "kind": "run-instructions",
          "required": true,
          "target_path": "delivery/run.md"
        },
        {
          "artifact_id": "evidence-index",
          "kind": "evidence-index",
          "required": true,
          "target_path": "delivery/evidence.md"
        },
        {
          "artifact_id": "decision-index",
          "kind": "decision-index",
          "required": true,
          "target_path": "delivery/decisions.md"
        }
      ]
    }
  ]
}
```
