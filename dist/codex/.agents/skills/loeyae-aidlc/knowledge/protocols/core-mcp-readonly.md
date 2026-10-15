# Core controlled read-only MCP, v1

`core/tools/aidlc-mcp-readonly.ts` exposes an operator/Core API, `createCoreMcpReadOnly(options).call(request)`.
It is not a Provider entrypoint, a generic broker endpoint, or an automatic tool registration.
The first supported transport is official `@modelcontextprotocol/sdk` **1.32.1** Streamable HTTP,
negotiating 2025-03-26, 2025-06-18 or 2025-11-25. JSON and POST SSE responses, initialization,
initialized notification and session headers are handled by the SDK. Optional GET SSE is bounded
by the same deadline. There is no reconnect/retry of a business request. Protocol initialization
is independent of business tool permission. Earlier SSE-only transport, stdio, the newer draft
protocol, OAuth discovery/refresh, cookies and arbitrary custom headers are unsupported.

Protocol/API sources checked for this increment:

- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.32.1
- Installed SDK `dist/esm/client/{index,streamableHttp}.{js,d.ts}` and server Streamable HTTP types.

## Trust and authorization

The trusted Core caller supplies `McpReadOptions`: canonical project directory, explicit JSON
host configuration, a reviewed `McpReadPolicy`, `currentContext`, and optionally a secret-store
resolver. Do not accept these options from a Provider, remote content, or an unreviewed request.
`currentContext` must return the actual Core project/stage/scope and current Plan digest/node;
both Plan fields are null only when Core has no Plan. The API does not discover or advance workflow
state. A host adapter must supply that trusted context; this increment does not install one for every host.

Policy schema is `aidlc.mcp-read-policy/v1`. See the exported type for all required fields.
The policy declares an operator and **exact** tool/resource/arguments tuples as trusted read-only
operations. Reviewing the actual tool semantics is the operator's responsibility; `readOnlyHint`,
tool descriptions and Provider claims never establish permission. No wildcard argument matching
or service-provided permission expansion is performed. Resources are opaque identifiers: the
approved full argument object must bind the intended resource, including any tenant/version/filter.
Changing any argument requires a new explicit grant.

Requests use `aidlc.mcp-read-request/v1` and bind project, instance, full project lock digest,
connection name and digest, current stage/scope, optional Plan/node, tool/resource and arguments.
The connection digest is `sha256ProviderDigest(requirement.connection)` from
`resolveProviderMcpRequirements(project)`. Connection needs are read from enabled Providers'
verified locked manifests; a missing/disabled instance, lock/config drift or conflicting same-name
requirements fails closed. The explicit host JSON must contain the exact corresponding `mcpServers`
entry. Installation does not prove authentication or authorization.

The policy endpoint must equal the locked requirement URL. HTTPS endpoints are explicitly allowlisted
by that exact URL, without query, userinfo or fragments. No redirects are followed. The HTTP requirement
must have no headers (or an empty header map). Credentials use only `secret:<store-key>` references,
resolved by the trusted callback, never environment interpolation or inherited host credentials.
The resolver receives an AbortSignal and must honor it when performing asynchronous secret-store IO.
The declared credential realm must match the lock. Authentication is either none or a validated
Bearer token; the token remains inside the transport closure. Credential-bearing host header
formats from managed apply are not implicitly adapted by this API.

Limits: request at most 1 MiB, each HTTP response and serialized tool result at most 4 MiB,
total transport/credential timeout 50–60000 ms, snapshot TTL 1 ms–24 h. A request must expire
within the next minute. A durable exclusive request-ID claim blocks replays across Core instances;
failed attempts also consume the ID. Use a new ID to retry explicitly. Keep claims for the lifetime
of the project policy; this increment does not garbage collect them. Preflight rejection makes no
network request and does not resolve credentials. Authorization and freshness are rechecked before
every protocol exchange and before snapshot creation.

`restricted-v1` remains network denied with an empty environment. Never inject this API, a token,
its policy/resolver, or host configuration into a Provider runner. Only the trusted Core process
owns transport. No runner permissions or v1.1 Provider/knowledge contracts are widened.

## Results and local storage

Successful `call` returns `snapshot_digest`, `snapshot_path`, and `record_path`. It accepts MCP text
content results (optional SDK-validated structured content remains data). Tool errors, malformed
results, unsupported non-text content, response limits, deadlines and authentication failures
produce an error record and no success snapshot. Errors exposed to callers are fixed codes,
not remote response/error text. Exact resolved token values echoed in results/ETags are rejected.
Remote arbitrary data is not a general-purpose secret detector; an operator must scope the
approved source and protect the local artifacts according to that data's sensitivity.

Private local artifacts live in `.aidlc/mcp-readonly/`, with exclusive writes and link checks:

- `*.claim`: durable replay prevention.
- `*.denied.json`: preflight rejection, hashed request/policy, authentication not checked,
  authorization denied, installation not confirmed; no remote or request argument text.
- `<request-id>.call.json`: installation, authentication, authorization and outcome separately;
  source instance/commit/manifest/version, project lock, connection/policy/input digests, context,
  tool/resource, negotiated protocol, snapshot digest and timestamp.
- `<request-id>.snapshot.json`: `aidlc.mcp-read-snapshot/v1`, source/connection/lock/context,
  resource/input/content digests, fetch time, TTL/expiry, result and complete snapshot digest.
  The business response's HTTP ETag is recorded when provided; otherwise remote version is
  explicitly unknown. Provider commit pinning never pins remote content.

`readMcpSnapshot(path, {project, project_id, project_lock_digest, snapshot_digest})` verifies the
digest, result digest, project, current persisted lock and expiry before returning external data.
Use this explicit reader at consumption time; do not treat a saved path as current content.
Snapshots are not signed attestations against a malicious local operator. As with managed apply,
local directory replacement races by hostile users are outside this local-user trust boundary.
The store belongs in project ignore rules when consuming this feature; it may contain sensitive
source content. No secret values, credentials, or generated local snapshots belong in commits.

This increment does not feed the snapshot into the existing knowledge Receipt protocol, claim
model understanding, create `passed` Gates, or modify workflow state. Future context-source and
SSOT adapters can consume the versioned snapshot explicitly without reinterpreting v1.1 Receipts.

## Executable local fixture

From the repository root after installing dependencies:

```sh
npm run test:mcp-readonly
```

This builds an isolated Git Provider and official SDK MCP server on `127.0.0.1`, exercises the
Core API, and removes the fixture. `fixture: true` is the only policy allowing plain HTTP, and
only for the literal `127.0.0.1`; every record and snapshot is marked as a fixture. Production
policies must use `fixture: false`. There is no added general-purpose CLI call command.
The test uses no real MCP configuration, account or credentials. It does not represent SSOT
or Figma service integration or real OS sandbox validation on unsupported platforms.
