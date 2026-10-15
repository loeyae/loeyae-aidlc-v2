import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { addProjectProvider } from "../core/tools/aidlc-provider-cli.js";
import { canonicalProviderJson, readProjectProviders, sha256FileDigest, sha256ProviderDigest as digest } from "../core/tools/aidlc-project-provider.js";
import { resolveProviderMcpRequirements } from "../core/tools/aidlc-provider-mcp.js";
import type { McpReadOptions } from "../core/tools/aidlc-mcp-readonly.js";
import { decodeMcpPng } from "../core/tools/aidlc-mcp-image.js";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state.js";
import { createUiGenerationAcceptance, createUiGenerationLock, readUiGenerationLock, verifyUiGenerationAcceptance } from "../core/tools/aidlc-ui-governance.js";
import { uiReadManifestPath } from "../core/tools/aidlc-ui-readonly.js";
import { createUiDesign, recoverUiDesign, planUiCreate, readUiCreateContract, UI_WRITE_POLICY, uiCreateTargets, verifyCreatedUiManifest, type UiCreateInput, type UiWritePayload } from "../core/tools/aidlc-ui-create.js";
import type { McpWriteOptions } from "../core/tools/aidlc-mcp-write.js";

const [sourceArg, commit] = process.argv.slice(2);
assert(sourceArg && /^[a-f0-9]{40}$/.test(commit ?? ""), "requires actual external repository and immutable commit");
const source = sourceArg.includes("://") ? sourceArg : pathToFileURL(resolve(sourceArg)).href;
const fileFixture = source.startsWith("file:");
const repository = resolve(import.meta.dirname, ".."), root = mkdtempSync(join(tmpdir(), "aidlc-figma-create-")), project = join(root, "project");
const mod = "module-a", base = `docs/aidlc/modules/${mod}/inception`, manifestPath = uiReadManifestPath(mod);
const write = (path: string, value: unknown) => { const p = join(project, path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof value === "string" ? value : JSON.stringify(value, null, 2), "utf8"); };
const read = (path: string) => readFileSync(join(project, path), "utf8");
function git(...args: string[]) {
  const p = spawnSync("git", args, { cwd: project, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
  assert.equal(p.status, 0, p.stderr); return p.stdout.trim();
}
function check(sensor: string) {
  const p = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "bin/cli.ts"), "check", "--sensor", sensor, "--module", mod], { cwd: project, encoding: "utf8" });
  return { status: p.status, output: p.stdout + p.stderr };
}
// Actual valid, decoded PNG fixture, independent of any remote URL.
function chunk(type: string, body: Buffer) {
  const b = Buffer.alloc(12 + body.length); b.writeUInt32BE(body.length); b.write(type, 4); body.copy(b, 8);
  let crc = 0xffffffff; for (const v of b.subarray(4, -4)) { crc ^= v; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, b.length - 4); return b;
}
const header = Buffer.alloc(13); header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255]))), chunk("IEND", Buffer.alloc(0))]);
const image = { type: "image" as const, mimeType: "image/png", data: png.toString("base64") };
assert.deepEqual(decodeMcpPng(image), png);

let network = 0, credentials = 0, creates = 0, mode = "ok";
const secret = "isolated-create-fixture-secret";
const owned = new Map<string, any[]>(), transports = new Map<string, StreamableHTTPServerTransport>(), servers: Server[] = [];
const http = createServer(async (req, res) => {
  try {
    network++;
    if (mode === "before-send" || req.headers.authorization !== `Bearer ${secret}`) { res.writeHead(401).end(); return; }
    if (req.method === "GET") { res.writeHead(405).end(); return; }
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    let transport = transports.get(String(req.headers["mcp-session-id"]));
    if (!transport && isInitializeRequest(body)) {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableJsonResponse: true });
      const server = new Server({ name: "isolated-write-fixture-not-production", version: "1.0.0" }, { capabilities: { tools: {} } }); servers.push(server);
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
      server.setRequestHandler(CallToolRequestSchema, async request => {
        const tool = request.params.name, args: any = request.params.arguments!;
        if (tool === "fixture_create_frames") {
          creates++; assert.equal(args.file_key, "FileABC");
          const pages = args.frames.map((f: any, i: number) => ({ ...f, node_id: `${creates}:${i + 2}` }));
          owned.set(args.operation_id, [...(owned.get(args.operation_id) ?? []), { operation_id: args.operation_id, input_digest: args.input_digest, file_key: args.file_key, pages }]);
          if (mode === "response-lost") req.socket.destroy();
          return { content: [{ type: "text", text: JSON.stringify({ created: pages.map((p: any) => p.node_id) }) }] };
        }
        if (tool === "fixture_find_owned_frames") {
          const matches = owned.get(args.operation_id) ?? [];
          const value = structuredClone(matches[0] ?? { operation_id: args.operation_id, input_digest: args.input_digest, file_key: args.file_key, pages: [] });
          if (matches.length > 1) value.pages = matches.flatMap(m => m.pages);
          if (mode === "ambiguous") value.pages = [...value.pages, ...value.pages];
          if (mode === "wrong-file") value.file_key = "OtherFile";
          if (mode === "wrong-node") value.pages[0].page_node_id = "99:99";
          if (mode === "wrong-content") value.pages[0].texts = ["Not approved"];
          if (mode === "wrong-owner") value.operation_id = "unrelated-operation-with-same-frame-name";
          if (mode === "empty") value.pages = [];
          return { content: [{ type: "text", text: JSON.stringify(value) }] };
        }
        assert.equal(tool, "get_screenshot"); assert.equal(args.fileKey, "FileABC");
        assert([...owned.values()].flat().some(o => o.pages.some((p: any) => p.node_id === args.nodeId)));
        return mode === "bad-screenshot" ? { content: [{ type: "text", text: "https://untrusted.invalid/image" }] } : { content: [image] };
      });
      await server.connect(transport);
    }
    if (!transport) { res.writeHead(400).end(); return; }
    await transport.handleRequest(req, res, body); if (transport.sessionId) transports.set(transport.sessionId, transport);
  } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
});
http.keepAliveTimeout = 120_000; http.headersTimeout = 130_000;
const choiceKeys = generateKeyPairSync("ed25519"), journalKeys = generateKeyPairSync("ed25519");
const pem = (key: any, type: "spki" | "pkcs8") => key.export({ type, format: "pem" }).toString();
function signChoice(payload: UiWritePayload): UiCreateInput["choice"] {
  return { payload, signature: { algorithm: "Ed25519", value: sign(null, Buffer.from(canonicalProviderJson(payload)), choiceKeys.privateKey).toString("base64") } };
}
function setState(selected = "figma-create", approved = true) {
  const state = loadWorkflowState(project) ?? createInitialState("feature", "4.18.0", "workflow-ui-fixture", [], "Validate finite structured writes");
  state.current_phase = "inception"; state.current_stage = "ui-figma-generation"; state.current_module = mod;
  state.current_stage_instance = `ui-figma-generation@module:${mod}`;
  state.history = [{ timestamp: new Date().toISOString(), stage: "ui-mock", module_id: mod, instance_id: `ui-mock@module:${mod}`, result: "completed", user_input: selected },
    ...(approved ? [{ timestamp: new Date().toISOString(), stage: "ui-page-planning", module_id: mod, instance_id: `ui-page-planning@module:${mod}`, result: "approved" as const }] : [])];
  saveWorkflowState(project, state);
}
async function zero(action: () => Promise<any>) { const before = [network, credentials, creates]; const result = await action(); assert.deepEqual([network, credentials, creates], before); return result; }
try {
  mkdirSync(project); http.listen(18769, "127.0.0.1"); await once(http, "listening");
  assert.equal((await zero(() => createUiDesign({ project } as any, { module_id: mod } as any))).status, "not-applicable");
  write(".aidlc/provider-git-policy.json", { version: 1, allowed_hosts: fileFixture ? [] : [new URL(source).hostname], allowed_commits: [commit], allow_file_fixtures: fileFixture });
  for (const [subdir, instance] of [["figma-create-fixture", "figma"], ["figma-create", "production"]]) addProjectProvider(project, { source, ref: commit, subdir: `providers/${subdir}`, instance, allowFile: fileFixture, trust: "allowlisted-commit" });
  write(`${base}/requirements.md`, "# REQ-001 FR-001\nShow the title.\n");
  write(`${base}/user-stories.md`, "# US-001\nSource FR-001\n## AC-001\nTitle visible.\n");
  const plan = "# Pages\n## 页面清单\n| ID | Source |\n| --- | --- |\n| PAGE-001 | REQ-001 FR-001 US-001 AC-001 |\n## 页面内容契约\nPAGE-001 title required\n## 操作闭环\nPAGE-001 view\n## 未决项\n无\n";
  write(`${base}/ui-design/page-plan.md`, plan);
  write("docs/aidlc/ideation/module-manifest.json", { schema_version: 1, modules: [{ module_id: mod, name: "Fixture", service_id: "fixture" }] });
  git("init", "-q"); git("add", "."); git("commit", "-qm", "approved fixture inputs"); git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
  createUiGenerationLock(project, { moduleId: mod, route: "figma-create" }); setState();
  const loaded = readUiGenerationLock(project, mod), c = readUiCreateContract(project, "figma");
  const candidate = { file_key: "FileABC", frames: [{ page_id: "PAGE-001", page_node_id: "0:1", name: "Explicit Frame", width: 1280, height: 800, texts: ["Approved title"] }] };
  const selection = { instance_id: "figma", contract_digest: digest(c), target_digest: digest(uiCreateTargets(candidate)), choice_public_key_pem: pem(choiceKeys.publicKey, "spki"),
    journal_public_key_pem: pem(journalKeys.publicKey, "spki"), shared_file_key: "FileABC", verified_operations: c.operations };
  const savePolicy = () => write(UI_WRITE_POLICY, { schema: "aidlc.ui-write-policy/v1", project_id: "project-a", modules: { [mod]: selection } }); savePolicy();
  function input(change: Partial<UiWritePayload> = {}): UiCreateInput {
    return { module_id: mod, candidate: structuredClone(candidate), choice: signChoice({ schema: "aidlc.ui-write-authorization/v1", project_id: "project-a", module_id: mod,
      route: "figma-create", ui_applicable: true, approval_ref: "approved-page-plan-1", page_plan_digest: loaded.lock.sources.find(s => s.kind === "page-plan")!.sha256,
      generation_lock_digest: loaded.digest, project_lock_digest: readProjectProviders(project).lock.lock_digest, stage: "ui-figma-generation", scope: `module:${mod}`,
      operation_id: randomUUID(), operation: "create-frames", input_digest: digest(candidate), target_digest: digest(uiCreateTargets(candidate)), expires_at: new Date(Date.now() + 12 * 3600_000).toISOString(), ...change }) };
  }
  let context = { project_id: "project-a", stage: "ui-figma-generation", scope: `module:${mod}`, plan_digest: null, node_id: null };
  const requirement = resolveProviderMcpRequirements(project).requirements.find(r => r.source.instance_id === "figma")!;
  write("fixture-host.json", { mcpServers: { [c.connection]: requirement.connection.config } });
  const readOptions: Omit<McpReadOptions, "policy"> & { policy: Omit<McpReadOptions["policy"], "grants">; journalPrivateKeyPem: string } = {
    project, hostConfig: "fixture-host.json", currentContext: () => context, journalPrivateKeyPem: pem(journalKeys.privateKey, "pkcs8"), resolveCredential: async () => { credentials++; return secret; },
    policy: { schema: "aidlc.mcp-read-policy/v2", result_content: "text-or-png", ...context, operator: "isolated-operator", instance_id: "figma", project_lock_digest: readProjectProviders(project).lock.lock_digest,
      connection: c.connection, connection_digest: digest(requirement.connection), endpoint: String(requirement.connection.config.url), credential_domain: "figma-fixture", credential_ref: "secret:fixture/figma",
      timeout_ms: 60_000, max_request_bytes: 16384, max_response_bytes: 16384, ttl_ms: 3600_000, fixture: true } };
  function writeOptions(value: UiCreateInput): McpWriteOptions {
    const { result_content, ...policy } = readOptions.policy;
    return { ...readOptions, policy: { ...policy, schema: "aidlc.mcp-write-policy/v1", authentication: "fixture-bearer", grants: [planUiCreate(project, value)] } };
  }
  for (const selected of ["html-mock", "skip", "figma-existing", "not-selected"]) { setState(selected); assert.equal((await zero(() => createUiDesign({ project } as any, input()))).status, "not-applicable"); }
  setState("figma-create", false); assert.equal((await zero(() => createUiDesign({ project } as any, input()))).reason, "UI_WRITE_PAGE_PLAN_NOT_APPROVED"); setState();
  for (const change of [{ project_id: "other" }, { scope: "module:other" }, { generation_lock_digest: "bad" }, { page_plan_digest: "bad" }, { target_digest: "bad" }, { project_lock_digest: "bad" }, { input_digest: "bad" }, { expires_at: "2020-01-01T00:00:00Z" }]) {
    assert.notEqual((await zero(() => createUiDesign({ project } as any, input(change)))).status, "unknown");
  }
  const badInput = input(); badInput.candidate.frames[0].texts = ["tampered"];
  assert.equal((await zero(() => createUiDesign({ project } as any, badInput))).reason, "UI_WRITE_TARGET_OR_INPUT_DENIED");
  const forged = input(); forged.choice.payload.approval_ref = "tampered";
  assert.equal((await zero(() => createUiDesign({ project } as any, forged))).reason, "UI_WRITE_SIGNATURE_DENIED");
  const first = input(), options = writeOptions(first);
  assert.equal((await zero(() => createUiDesign({ ...options, policy: { ...options.policy, grants: [...options.policy.grants, { tool: "use_figma", resource: "all", arguments: { code: "delete everything" } }] } }, first))).reason, "MCP_WRITE_TOOL_DENIED");
  console.log("Signed authorization, route, exact input/target and policy zero-network denials passed");
  mode = "response-lost";
  assert.equal((await createUiDesign(options, first)).status, "unknown"); assert.equal(creates, 1);
  assert.equal((await zero(() => createUiDesign(options, first))).reason, "OPERATION_REPLAY_REQUIRES_RECOVERY");
  for (const scenario of ["ambiguous", "empty", "wrong-owner", "wrong-file", "wrong-node", "wrong-content", "bad-screenshot"]) {
    console.log(`Creation recovery negative fixture: ${scenario}`);
    mode = scenario; const result = await recoverUiDesign(readOptions, first);
    assert.equal(result.status, "blocked", JSON.stringify(result)); assert.equal(creates, 1); assert(!existsSync(join(project, manifestPath)));
  }
  mode = "ok";
  const recovered = await recoverUiDesign(readOptions, first); assert.equal(recovered.status, "registered", JSON.stringify(recovered)); assert.equal(creates, 1);
  if (recovered.status !== "registered") throw new Error("recovery failed");
  assert.equal(recovered.manifest.source, "created"); assert.equal(recovered.manifest.validation.behavior, "unverified"); verifyCreatedUiManifest(project, mod);
  const original = read(manifestPath), node = recovered.manifest.pages[0]; assert.deepEqual(readFileSync(join(project, node.screenshot)), png);
  assert.equal(read(`${base}/ui-design/page-plan.md`), plan);
  const artifact = check("ui-artifact-consistency"); assert.equal(artifact.status, 0, artifact.output);
  const behavior = check("ui-behavior-consistency"); assert(behavior.status !== 0 || JSON.parse(behavior.output).applicable === false, behavior.output);
  rmSync(join(project, manifestPath)); assert.equal((await zero(() => recoverUiDesign(readOptions, first))).status, "registered"); assert.equal(read(manifestPath), original);
  const changed = JSON.parse(original); changed.pages[0].node_id = "9:9"; assert.throws(() => verifyCreatedUiManifest(project, mod, changed), /UI_WRITE_MANIFEST_TAMPERED/);
  write(node.screenshot, "tampered"); assert.throws(() => verifyCreatedUiManifest(project, mod), /UI_WRITE_SCREENSHOT_TAMPERED/); writeFileSync(join(project, node.screenshot), png);
  const refs = recovered.manifest.create_registration.snapshots, snapshot = read(refs[0].path); write(refs[0].path, "{}");
  assert.throws(() => verifyCreatedUiManifest(project, mod), /MCP_SNAPSHOT/); write(refs[0].path, snapshot);
  const eventPath = `.aidlc/operations/${first.choice.payload.operation_id}/000001.json`, event = read(eventPath), tampered = JSON.parse(event); tampered.status = "failed"; write(eventPath, tampered);
  assert.equal((await zero(() => createUiDesign(options, first))).reason, "OPERATION_JOURNAL_TAMPERED"); write(eventPath, event);
  const report = (hash: string) => `## UI requirement freshness\n- checked_at: ${new Date().toISOString()}\n- synchronized_pages: none\n\n## UI full acceptance\n- run_id: visual-1\n- completed_at: ${new Date().toISOString()}\n- result: passed\n- reviewed_pages: PAGE-001\n- issue_pages: none\n- figma_manifest_sha256: ${hash}\n`;
  write(`${base}/cross-validation-report.md`, report("old")); assert.throws(() => createUiGenerationAcceptance(project, { moduleId: mod, route: "figma-create" }), /UI_WRITE_NEW_VISUAL_REVIEW_REQUIRED/);
  write(`${base}/cross-validation-report.md`, report(sha256FileDigest(original).slice(7))); createUiGenerationAcceptance(project, { moduleId: mod, route: "figma-create" }); verifyUiGenerationAcceptance(project, mod, "figma-create", ["PAGE-001"]);
  const now = Date.now; try { Date.now = () => now() + 3600_001; assert.throws(() => verifyCreatedUiManifest(project, mod), /MCP_SNAPSHOT/); } finally { Date.now = now; }
  const refreshed = await recoverUiDesign({ ...readOptions, refresh: true }, first); assert.equal(refreshed.status, "registered"); assert.equal(creates, 1);
  verifyCreatedUiManifest(project, mod); assert.notEqual(read(manifestPath), original);
  assert.throws(() => verifyUiGenerationAcceptance(project, mod, "figma-create", ["PAGE-001"]), /UI_WRITE_NEW_VISUAL_REVIEW_REQUIRED|acceptance/);
  console.log("Response loss -> ownership readback -> screenshot -> created manifest -> artifact/freshness and independent review passed, no duplicate creation");
  mode = "before-send"; const failed = input(); assert.equal((await createUiDesign(writeOptions(failed), failed)).status, "failed"); assert.equal(creates, 1);
  assert.equal((await zero(() => recoverUiDesign(readOptions, failed))).reason, "UI_WRITE_MANUAL_RECONCILIATION_REQUIRED"); mode = "ok";
  const concurrent = input(), before = creates, results = await Promise.all([createUiDesign(writeOptions(concurrent), concurrent), createUiDesign(writeOptions(concurrent), concurrent)]);
  assert.equal(creates, before + 1); assert.equal(results.filter(r => r.status === "unknown").length, 1); assert.equal(results.filter(r => r.status === "blocked").length, 1);
  const interrupted = input(), interruptedOptions = writeOptions(interrupted); await createUiDesign(interruptedOptions, interrupted);
  // Dispatch persisted but result transition lost, as on process termination.
  rmSync(join(project, `.aidlc/operations/${interrupted.choice.payload.operation_id}/000002.json`));
  const dispatchedCount = creates;
  assert.equal((await recoverUiDesign(readOptions, interrupted)).status, "registered"); assert.equal(creates, dispatchedCount);
  write(`.aidlc/operations/${interrupted.choice.payload.operation_id}/000001.json`, "{");
  assert.equal((await zero(() => createUiDesign(interruptedOptions, interrupted))).reason, "OPERATION_JOURNAL_INCOMPLETE");
  const priorSelection = structuredClone(selection), prod = readUiCreateContract(project, "production");
  Object.assign(selection, { instance_id: "production", contract_digest: digest(prod), verified_operations: prod.operations }); savePolicy();
  assert.equal((await zero(() => createUiDesign({ ...options, policy: { ...options.policy, fixture: false, authentication: "oauth-required", instance_id: "production" } }, input()))).reason, "UI_WRITE_NEEDS_OAUTH_CAPABILITY");
  Object.assign(selection, priorSelection); savePolicy();
  const previousContext = context; context = { ...context, scope: "module:other" }; const crossScope = input();
  assert.equal((await zero(() => createUiDesign(writeOptions(crossScope), crossScope))).reason, "UI_WRITE_CONTEXT_DENIED"); context = previousContext;
  const lockPath = `${base}/ui-design/ui-generation-lock.json`, lockBytes = read(lockPath), lock = JSON.parse(lockBytes); lock.locked_at = new Date(Date.now() - 1).toISOString(); write(lockPath, lock);
  assert.equal((await zero(() => createUiDesign({ project } as any, input()))).reason, "UI_WRITE_GENERATION_STALE"); write(lockPath, lockBytes);
  for (const dir of [".aidlc/mcp-readonly", ".aidlc/operations"]) {
    function scan(path: string) { for (const entry of readdirSync(join(project, path), { withFileTypes: true })) { const next = `${path}/${entry.name}`; if (entry.isDirectory()) scan(next); else assert(!read(next).includes(secret)); } } scan(dir);
  }
  console.log(`Locked external package=${commit}; real MCP writes=${creates}; concurrency, interrupted/tampered journal, pre-send failure and OAuth zero effects passed; production account untested`);
} finally {
  for (const server of servers) await server.close().catch(() => {});
  http.closeAllConnections(); await new Promise<void>(r => http.close(() => r())); rmSync(root, { recursive: true, force: true });
}
