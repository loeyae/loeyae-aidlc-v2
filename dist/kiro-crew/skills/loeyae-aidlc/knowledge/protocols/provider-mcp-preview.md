# Provider MCP connection preview

`loeyae-aidlc provider mcp-preview --host-config <json-path> [--host-domains <json-path>] [--project <path>]`

This offline command resolves connection requirements for every enabled project Provider from its verified, locked Git Manifest. It never fetches, runs Provider entrypoints or package scripts, contacts an MCP endpoint, writes host configuration, or removes existing entries. No Profile selection or stage execution is needed: this is a project connection inventory, not a Provider execution Plan. Disabled instances are excluded.

The existing Provider v1.1 Manifest permits namespaced extensions. Core consumes this optional extension without changing that Manifest protocol:

```json
{
  "extensions": {
    "aidlc.mcp": {
      "schema": "aidlc.mcp-requirements/v1",
      "version": "0.1.0",
      "connections": [
        {
          "name": "example-service",
          "credential_domain": "none",
          "config": {
            "type": "stdio",
            "command": "npx",
            "args": ["-y", "example-service@1.0.0"]
          }
        }
      ]
    }
  }
}
```

`version` must equal the locked Manifest's Provider version. Unknown fields, incompatible schema/version, duplicate names, and unsupported transport fields are rejected. The minimal supported transport shapes are `stdio` (`command`, required `args`, optional string map `env`) and `http`/`sse` (`url`, optional string map `headers`). URLs must use HTTP(S) without embedded user/password or fragments. Data is compared literally; no environment or credential substitution occurs. Authors should use references rather than secrets in declarations. An empty `connections` array explicitly declares no connections. Missing `aidlc.mcp` produces `MCP_REQUIREMENTS_MISSING` and `ready: false`; existing configurations never substitute for missing metadata. Previously shipped offline knowledge/validation packages do not declare this extension and therefore diagnose missing metadata until their authors add it.

The host input is an explicit JSON file with a `mcpServers` object. A missing file represents an empty host snapshot and remains absent. Other host formats (including native TOML) require a separately supplied JSON snapshot; this command does not discover or convert them. Unknown existing host fields and user pins are retained and considered when comparing entries. Untyped stdio entries are compared as `type: stdio`; otherwise comparison is exact and does not silently upgrade package pins or discard approval fields.

`credential_domain` is an opaque attribution string. `none` explicitly means no credential realm. Any other realm requires matching user-supplied host attribution to reuse an entry: `--host-domains domains.json`, for example `{ "example-service": "tenant-a" }`. This file is only a map of connection names to realm identifiers, never credentials or proof of authentication. An unknown or different realm conflicts. Equal names with different Provider configurations or realms also conflict, even when no host entry exists.

Output includes deterministic `add`/`reuse`/`conflict` changes, reasons, changed field names, current host entry summaries, and each requirement's instance, Provider version, immutable commit, Manifest digest and project config digest. Values are omitted from summaries to avoid disclosing environment/header secrets; configuration digests and field names allow review against the referenced source. The host snapshot and optional domain snapshot have byte digests; the project lock and complete preview have canonical digests. Future apply/ledger work must re-read and validate these sources rather than treating the preview as permission to write or adopting unrelated entries.

`ready` means only that declarations are complete and compatible with these snapshots. `authentication: not_checked` and `authorization: not_granted` always apply. No change is applied, including `add`, and no entry gains managed ownership.
