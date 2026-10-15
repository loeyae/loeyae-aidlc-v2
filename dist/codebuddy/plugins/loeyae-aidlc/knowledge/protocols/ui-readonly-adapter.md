# External UI read adapter API

Trusted callers import `planExternalUiRead`, `consumeExternalUiDesign`, and `verifyExternalUiManifest` from `tools/aidlc-ui-readonly.ts`. This API is for `figma-existing/source=external` only. Provider processes never receive it or `McpReadOptions`. Creation remains on the existing creation workflow; no write capability is added here.

Install the external repository's `providers/figma-existing` subdirectory using `provider add` with an allowlisted immutable commit. It owns the connection URL and three documented reading operations. Core consumes the versioned `aidlc.ui-read-source/v1` data extension; it has no service address or full service tool inventory. The production package requires OAuth: the current bearer resolver does not implement OAuth login/refresh or Figma client registration, so production returns `UI_READ_NEEDS_OAUTH_CAPABILITY` before network access. Do not treat a fixture bearer as production authentication. Never modify real accounts/files or host configuration for a local fixture test.

The trusted operator supplies `.aidlc/ui-read-policy.json`:

```json
{
  "schema": "aidlc.ui-read-policy/v1",
  "project_id": "project-a",
  "modules": {
    "module-a": {
      "instance_id": "selected-provider",
      "contract_digest": "sha256:<digest-of-verified-adapter-contract>",
      "target_digest": "sha256:<digest-of-explicit-target-array>",
      "choice_public_key_pem": "<trusted Ed25519 public key in SPKI PEM>",
      "verified_read_tools": ["<independently reviewed read operation names>"]
    }
  }
}
```

Exactly three independently reviewed read tools must match the contract operations. A manifest declaration, request field or server `readOnlyHint` is not authorization. Policy is local operator configuration, never copied from Provider output. The extension version must match its Git-locked package version. Altering the operator key/contract/targets invalidates prior registrations.

`UiReadInput` contains `module_id`, a signed `choice`, and an untrusted `candidate`. The signed payload (`aidlc.ui-read-choice/v1`) binds `project_id`, `module_id`, `route`, `ui_applicable`, `approval_ref`, `page_plan_digest`, `generation_lock_digest`, `project_lock_digest`, `target_digest`, and `expires_at`. Sign UTF-8 `canonicalProviderJson(payload)` with Ed25519; signature is `{algorithm:"Ed25519",value:"<base64>"}`. This is a consumer input attestation by the trusted caller, not an approval issued by the adapter. The private key must remain outside project snapshots and Provider inputs. Core additionally checks persisted I9 history and completed/approved page planning, exact current source hashes and resource lock. The existing Markdown workflow history itself is not claimed to have a cryptographic signature.

The candidate is `{source:"external", external_read_only:true, file_key, pages, unresolved:[]}`. Each page is an explicit `{page_id,file_key,page_node_id,node_id}`; array order is digest-bound. Do not infer targets from page names. Node IDs use `1:2` rather than the URL's `1-2`. The selected file key must match every node mapping. Sparse metadata must contain exactly one specified canvas and its specified frame. Variables and screenshot reads target that frame in the same file. Core obtains display names from metadata and retains requirement/Story/AC IDs from the approved page plan.

Call `planExternalUiRead(project,input)` offline to review exact tool/resource/argument grants. Then explicitly supply those grants in `McpReadOptions.policy`, using `schema:"aidlc.mcp-read-policy/v2", result_content:"text-or-png"`, the current project/provider lock and connection digest, trusted `currentContext` (`stage:"ui-figma-generation",scope:"module:<id>"`), and an explicit credential resolver. Any extra grant, including an unused write grant, is rejected. Existing v1 callers continue to accept only text. The provider's isolated fixture subdirectory uses a local protocol service and explicit test credentials. Host configuration refers only to that fixture project's JSON snapshot, never actual host config.

`consumeExternalUiDesign(options,input)` returns `registered`, `not-applicable`, `NEEDS_CAPABILITY`, or `UNVERIFIED`. Nonselected/HTML/skip routes make zero calls and create no placeholders. Failures preserve the previous canonical manifest without making it valid for new inputs. A successful read stores content-addressed PNG bytes and generation-bound MCP snapshots, then publishes the canonical module manifest. No remote URLs/resources are fetched; no redirects/credential forwarding. Only bounded non-interlaced 8-bit PNG is supported; other formats return a capability/result diagnostic. `registered` means identity and observed assets, not quality approval (`gate_eligible:false`). Provider output and snapshot text remain inert external data.

Existing artifact checks revalidate exact PAGE sets, source/readonly flags, lock/resource provenance, target IDs, snapshots, PNG bytes and expiry. Behavior checks retain their region/action/permission/source requirements; absent semantic readback remains unverified. Metadata/variables presence does not certify token use, components or auto layout. The adapter never issues Evidence or advances state. Existing visual/freshness acceptance additionally requires `figma_manifest_sha256: <raw-file-sha256-without-prefix>` in the `## UI full acceptance` report section, binding the review to the actual registered generation. A changed snapshot or resource baseline cannot reuse an old review.

Local cross-repository test:

```text
node node_modules/tsx/dist/cli.mjs tests/test_figma_existing.ts <external-Git-URL-or-path> <immutable-commit>
```

This exercises actual Git installation/locking and local MCP initialization/session/read exchanges. It does not establish an authenticated production Figma connection or visual/behavior acceptance.
