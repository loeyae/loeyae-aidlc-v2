# Context-source consumption

The Core API is `consumeContextSource` in `core/tools/aidlc-context-source.ts`.
It consumes a locked declarative extension and calls the existing MARS-195 reader.
It never imports Provider code. The external package's declarations are not authorization.

Keep the non-secret binding in explicit project configuration, for example
`.aidlc/context-source-binding.json`, and pass its parsed value to the API:

```json
{
  "schema": "aidlc.context-source-binding/v1",
  "project_id": "local-project-A",
  "instance_id": "documents",
  "connection": "context-documents",
  "resource": "operator-approved-resource-A",
  "arguments": {"project_id": 101}
}
```

The caller supplies trusted `currentContext`, `McpReadPolicy` and a secret resolver,
plus a trusted `sourcePolicy` with `required`, the reviewed `binding_digest` and
`contract_digest`, `max_chars` and `max_items`. Read the contract with
`readContextSourceContract(project, instance)`, inspect it and separately authorize its
exact tool/resource/arguments. Do not automatically manufacture policy from this read.
The policy's project, instance, connection, endpoint and lock/digests must match;
its exact grant includes both the binding's fixed scope and mapped query/budget arguments.

```ts
const delivery = await consumeContextSource(operatorOptions, projectBinding, {
  instance_id: "documents",
  resource: "operator-approved-resource-A",
  query: "requirements",
  limit: 2,
  max_chars: 4000,
});
```

`local` means an optional source was unbound, absent or disabled, with no network,
credential read or placeholder. `unavailable` identifies optional failure;
`blocked` identifies required failure (including empty/blank results). A request
cannot override trusted required policy. `available` includes bounded fragments,
document/revision/version/fragment references, source lock provenance, input and
snapshot digests, expiry, and accurate truncated/degraded flags; omitted remote flags
are `unknown`. No pagination is performed, and conflicting revisions of one document
are rejected. A fragment's source version may explicitly be `unknown`.

Delivery remains external data with `gate_eligible: false` and
`consumption: not_confirmed`. Preserve the references and resolve contradictions with
the user. Retrieval is neither approval nor proof of model consumption. To reuse saved
snapshots, call `readMcpSnapshot` with the trusted expected digest/project/lock and
recheck the current binding, contract and context; paths alone grant no authority.

The actual receiving package is in the separate Provider repository under
`providers/ssot-readonly`; its README owns endpoint, confirmed tool contract,
credential and legacy handoff migration details. The isolated sibling package uses
the same mapping with a fixed loopback endpoint. Production service content is not
part of these tests.

Reproduce the cross-repository Git installation and isolated SDK service test:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run test:context-source -- ssh://git@git.dev.loeyae.com:31022/libraries/loeyae-aidlc-provider.git c7f248cd4b9f0e3cd68f148d708bad6775bb1a31
npm run test:context-source-boundary
```

The integration test installs both real external package subdirectories at that
immutable revision, inspects the production declaration offline, disables it and
only contacts the isolated fixture on `127.0.0.1:18766`. It requires that port to be
free and fails if occupied; it never falls back to the production endpoint. A local
clone path may replace the URL for offline runs (explicit file-fixture policy).
