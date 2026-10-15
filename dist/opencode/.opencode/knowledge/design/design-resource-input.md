# Design resource input

Design Providers supply data, never generation code. The first production path
is an explicit offline Git package. Install a reviewed immutable revision with
`provider add <git-url> --ref <commit> --subdir providers/design-resource --instance visual`.
Inspect its `aidlc.design-resource` extension and approve its digest before use.
No package is installed or contacted by default.

The local operator owns `.aidlc/ui-design-policy.json`, on the same trusted local
boundary as Provider Git/transport policy. Do not copy this file from remote
content or accept a `required` override in a generation request:

```json
{
  "schema": "aidlc.ui-design-policy/v1",
  "project_id": "project-a",
  "modules": {
    "module-a": {
      "required": false,
      "style": "linear.app",
      "platform": "web",
      "team": null,
      "approval_ref": "design-approval-1",
      "instance_id": "visual",
      "contract_digest": "sha256:<digest of the approved contract>",
      "resource": "approved-style",
      "arguments": {}
    }
  }
}
```

Use `readDesignResourceContract` and `sha256ProviderDigest` to inspect the exact
locked contract. `required: true` blocks missing/disabled/unavailable resources
and missing required tokens. Optional unavailable resources use the explicit
Core offline-default/v1 subset. Each lock records the fallback reason and the
keys using default values; these values never certify brand compliance.

Token schema v1 is closed: background/foreground/primary/on_primary are six-digit
hex colors; font_family is one local ASCII family name (1–64 characters), with
system fallback and no font download; font_size is 10–64 integer px; spacing and
radius are 0–128 integer px. All except radius are mandatory for required brand
resources. Optional fields missing from a response use offline-default/v1.
Invalid supplied values always fail, including in optional resources. There is
no remote CSS/HTML, expression evaluation, script, URL loading or extra grant.

Run the existing `ui lock --module module-a --route html-mock` before generating.
It embeds resource schema, selection/approval digest, Provider commit/version,
contract digest (including provenance), tokens, defaults and token digest.
Then generate the existing page-plan's HTML and apply the locked stylesheet:

```text
loeyae-aidlc ui resource-css --module module-a --html docs/aidlc/modules/module-a/inception/ui-mock/web.html
```

This writes one deterministic style block consuming colors, font, size, spacing
and radius. It changes no page markup, fields, permissions or actions. The
existing artifact checker requires the exact block in every manifest HTML.
Visual calibration and full/targeted review remain required; stylesheet presence
does not prove computed appearance or accessibility.

`acquireDesignResource(project, module, operatorMcpOptions)` additionally supports
an explicitly approved declarative HTTP mapping. The operator grants the exact
connection/tool/resource/arguments through the existing trusted transport.
`stageDesignResource` stores the resulting delivery once before `ui lock`.
Timeout/authentication/unavailability can fall back only for optional selection.
Malformed data, wrong identity/style/platform/team, grant failures and lock drift
fail closed. Snapshots retain existing integrity and expiry checks; no network
refresh runs during generation or review. The HTTP test package is a local
fixture, not a production service integration. Read-only stdio/SSE services
must use an explicit offline package until a trusted transport supports them.

A changed policy/package/snapshot invalidates resource freshness even after UI
acceptance. Update the trusted policy with a new approval_ref, then use
`ui resource-rebaseline --module module-a`. This requires unchanged business
inputs, archives the exact previous lock/acceptance/checkpoint bytes and creates
a new generation baseline requiring new visual review. It does not replace
old resources inside an existing lock. Regenerate affected HTML and repeat the
normal UI gates. Online staging is immutable; a fresh acquisition should be
staged in a new generation workspace, retaining the previous workspace.

Legacy locks without a design_resource field retain their old offline behavior
only when no explicit resource policy/staging exists. To adopt resources use
the explicit rebaseline operation. Figma write/adapter support is a later step;
this increment proves HTML consumption, and makes no Figma consumption claim.
