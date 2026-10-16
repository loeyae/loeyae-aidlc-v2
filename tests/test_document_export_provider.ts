import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	existsSync,
	symlinkSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { parseExportArgs } from "../core/tools/aidlc-export.js";
import {
	dispatchDocumentExport,
	snapshotExportInputs,
	validateExportCandidate,
	validateExportSvg,
	regularPath,
	publishExport,
} from "../core/tools/aidlc-document-export.js";
import {
	addProjectProvider,
	setProjectProviderEnabled,
} from "../core/tools/aidlc-provider-cli.js";
import { sha256FileDigest } from "../core/tools/aidlc-project-provider.js";
const [sourceArg, commit] = process.argv.slice(2);
const root = mkdtempSync(join(tmpdir(), "document-export-"));
mkdirSync(join(root, ".aidlc"));
const source = sourceArg?.includes("://")
	? sourceArg
	: sourceArg
		? pathToFileURL(resolve(sourceArg)).href
		: undefined;
const cli = resolve("bin/cli.js");
function opts(kind: string, input: string, to: string, more: string[] = []) {
	return parseExportArgs([kind, join(root, input), "--to", to, ...more])!;
}
function run(args: string[], expected = 0) {
	const r = spawnSync(process.execPath, [cli, ...args], {
		cwd: root,
		encoding: "utf8",
		timeout: 300000,
		maxBuffer: 8 * 1024 * 1024,
	});
	assert.equal(
		r.status,
		expected,
		`${r.error ?? ""}\n${r.stdout}\n${r.stderr}`,
	);
	return r;
}
writeFileSync(
	join(root, "diagram.svg"),
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect x="2" y="2" width="116" height="56" fill="#eee" stroke="black"/><text x="10" y="30" font-size="14">导出验证</text></svg>',
);
writeFileSync(
	join(root, "document.md"),
	"# 中文文档导出\n\n<!-- 内部注释 -->\n\n## 链接与图表\n\n[官网](https://example.com) 与 **粗体**。\n\n![图片](diagram.svg)\n\n| 编号 | 内容 |\n|---|---|\n| 1 | 中文表格 |\n\n" +
		Array.from(
			{ length: 100 },
			(_, i) => `第 ${i + 1} 段：中文分页验证，包含链接、图片和表格。\n\n`,
		).join("") +
		"## 内部备注\n\n不得导出\n",
);
const svg = opts("svg", "diagram.svg", "png"),
	md = opts("md", "document.md", "docx", ["--toc", "--strip", "内部备注"]);
const noAuth = run(["export", "svg", svg.input, "--to", "png"], 1);
assert.match(noAuth.stderr, /explicitly authorize/);
await assert.rejects(
	() => dispatchDocumentExport(svg, { project: root, instance: "missing" }),
	/CONFIG|CAPABILITY|LOCK/,
);
assert(!existsSync(join(root, ".aidlc/project-providers.yaml")));
for (const s of [
	'<svg><image href="https://evil.invalid/a"/></svg>',
	'<svg><style>@import "https://evil.invalid";</style></svg>',
	'<svg><image href="data:image/svg+xml,evil"/></svg>',
	'<svg onload="alert(1)"/>',
	"<!DOCTYPE svg><svg/>",
	"<svg><style>path{fill:url(https://evil.invalid)}</style></svg>",
])
	assert.throws(() => validateExportSvg(s), /DENIED/);
assert.throws(() => regularPath(root, "../outside"), /DENIED/);
writeFileSync(join(root, "remote.md"), "![remote](https://evil.invalid/a.png)");
assert.throws(
	() => snapshotExportInputs(opts("md", "remote.md", "docx")),
	/remote and data/,
);
writeFileSync(join(root, "escape.md"), "![escape](../escape.png)");
assert.throws(
	() => snapshotExportInputs(opts("md", "escape.md", "docx")),
	/DENIED/,
);
const old = Buffer.from("previous output");
writeFileSync(svg.output, old);
assert.throws(
	() => publishExport(svg.output, Buffer.from("new"), false, () => {}),
	/already exists/,
);
assert.throws(
	() =>
		publishExport(svg.output, Buffer.from("new"), true, () => {
			throw Error("stale");
		}),
	/stale/,
);
assert.deepEqual(readFileSync(svg.output), old);
rmSync(svg.output);
if (!source || !commit)
	throw Error(
		"usage: test_document_export_provider.ts <Git URL or fixture> <immutable SHA>",
	);
const fixture = source.startsWith("file:");
writeFileSync(
	join(root, ".aidlc/provider-git-policy.json"),
	JSON.stringify({
		version: 1,
		allowed_hosts: fixture ? [] : [new URL(source).hostname],
		allowed_commits: [commit],
		allow_file_fixtures: fixture,
	}),
);
addProjectProvider(root, {
	source,
	ref: commit,
	subdir: "providers/document-render",
	instance: "documents",
	allowFile: fixture,
	trust: "allowlisted-commit",
});
const dispatch = { project: root, instance: "documents" };
setProjectProviderEnabled(root, "documents", false);
await assert.rejects(() => dispatchDocumentExport(svg, dispatch), /CAPABILITY/);
setProjectProviderEnabled(root, "documents", true);
for (const [kind, name, to, extra] of [
	["svg", "diagram.svg", "png", ["--scale", "2"]],
	["md", "document.md", "docx", ["--toc", "--strip", "内部备注"]],
	["md", "document.md", "pdf", ["--toc", "--strip", "内部备注"]],
] as const) {
	run([
		"export",
		kind,
		join(root, name),
		"--to",
		to,
		"--project",
		root,
		"--host-provider",
		"documents",
		...extra,
	]);
	const output = opts(kind, name, to).output,
		data = readFileSync(output);
	assert(data.length > 100);
	if (to === "png") {
		assert.equal(data.readUInt32BE(16), 240);
		assert.equal(data.readUInt32BE(20), 120);
	}
	if (to === "docx") {
		const z = await JSZip.loadAsync(data),
			xml = await z.file("word/document.xml")!.async("string");
		assert.match(xml, /中文文档导出/);
		assert.match(xml, /<w:tbl>/);
		assert.match(xml, /<w:drawing>/);
		assert(!xml.includes("不得导出"));
		assert(!xml.includes("内部注释"));
		assert(Object.keys(z.files).some((x) => x.startsWith("word/media/")));
	}
	console.log(`actual CLI ${kind}:${to} generated ${data.length} bytes`);
	const request = {
		recipe: { target: to },
		binding: { invocation: "one", inputs: {} },
		schema: "aidlc.document-request/v1",
	};
	const candidate: any = {
		schema: "aidlc.document-candidate/v1",
		binding: request.binding,
		request_digest: sha256FileDigest(JSON.stringify(request)),
		artifact: {
			path: `output.${to}`,
			media_type:
				to === "png"
					? "image/png"
					: to === "pdf"
						? "application/pdf"
						: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			size: data.length,
			digest: sha256FileDigest(data),
			data: data.toString("base64"),
		},
	};
	await validateExportCandidate(request, candidate);
	for (const change of [
		(c: any) => (c.binding = { invocation: "other" }),
		(c: any) => (c.artifact.digest = "sha256:" + "0".repeat(64)),
		(c: any) => (c.artifact.path = "../out"),
		(c: any) => (c.extra = "undeclared"),
		(c: any) => c.artifact.size++,
		(c: any) => (c.artifact.media_type = "text/plain"),
		(c: any) => (c.request_digest = "old"),
	]) {
		const c = structuredClone(candidate);
		change(c);
		await assert.rejects(() => validateExportCandidate(request, c));
	}
}
const original = readFileSync(svg.output);
const forced = { ...svg, force: true, width: 300 };
await dispatchDocumentExport(forced, dispatch);
assert.equal(readFileSync(svg.output).readUInt32BE(16), 300);
await assert.rejects(() =>
	dispatchDocumentExport(
		{ ...forced, browser: join(root, "missing-browser") },
		dispatch,
	),
);
const bytes = readFileSync(svg.output);
await assert.rejects(
	() => dispatchDocumentExport({ ...forced }, { ...dispatch, timeout: 1 }),
	/TIMEOUT/,
);
assert.deepEqual(readFileSync(svg.output), bytes);
const templated = {
	...md,
	output: join(root, "templated.docx"),
	template: md.output,
};
await dispatchDocumentExport(templated, dispatch);
writeFileSync(
	join(root, "mermaid.md"),
	"# Mermaid 中文\n\n```mermaid\nflowchart TD\n A[开始] --> B[结束]\n```\n",
);
await dispatchDocumentExport(opts("md", "mermaid.md", "docx"), dispatch);
console.log(
	JSON.stringify({
		artifacts: root,
		source,
		commit,
		formats: ["md:docx", "md:pdf", "svg:png"],
		adversarial: "passed",
		docx_page_layout: "not yet rendered",
	}),
);
import {
	readProjectProviders,
	PROJECT_PROVIDERS_LOCK_PATH,
} from "../core/tools/aidlc-project-provider.js";
import { verifyLockedProviderCache } from "../core/tools/aidlc-provider-git.js";
// Adversarial hosts are local immutable Git fixtures, never substituted for production rendering above.
const fake = mkdtempSync(join(tmpdir(), "document-adversary-"));
mkdirSync(join(fake, "bin"));
mkdirSync(join(fake, "rules"));
// Locate by the same enabled-capability selector to avoid assumptions about lock storage.
import { requireEnabledProviderCapability } from "../core/tools/aidlc-project-provider.js";
const selected = requireEnabledProviderCapability(
	root,
	"document.render",
	{ project_id: "adversary", stage: "export", scope: "fixture" },
	{ protectedGate: true },
).find((x) => x.intent.instance_id === "documents")!;
const baseManifest = verifyLockedProviderCache(root, selected.lock).manifest;
function gitFake(...args: string[]) {
	const p = spawnSync("git", args, { cwd: fake, encoding: "utf8" });
	assert.equal(p.status, 0, p.stderr);
	return p.stdout.trim();
}
gitFake("init");
gitFake("config", "user.email", "test@example.invalid");
gitFake("config", "user.name", "Document adversary test");
writeFileSync(join(fake, "rules/catalog.json"), '{"rules":[]}');
writeFileSync(
	join(fake, "provider.lock"),
	'{"lockfileVersion":1,"packages":{}}',
);
writeFileSync(
	join(fake, "sbom.spdx.json"),
	'{"spdxVersion":"SPDX-2.3","packages":[]}',
);
const fakeSource = pathToFileURL(fake).href;
let fakeCommits: string[] = [];
const pngData = readFileSync(svg.output).toString("base64");
const docxData = readFileSync(md.output).toString("base64");
for (const attack of [
	"input-drift",
	"resource-drift",
	"lock-drift",
	"extra-output",
	"wrong-invocation",
	"capability-missing",
]) {
	const inputOriginal = readFileSync(svg.input),
		lockOriginal = readFileSync(join(root, PROJECT_PROVIDERS_LOCK_PATH));
	const target =
		attack === "resource-drift" ? join(root, "local.png") : svg.input;
	writeFileSync(join(root, "local.png"), Buffer.from(pngData, "base64"));
	writeFileSync(
		join(root, "resource.md"),
		"# Resource\n\n![local](local.png)\n",
	);
	const action =
		attack === "extra-output"
			? 'writeFileSync("extra.txt","undeclared");'
			: attack === "wrong-invocation"
				? 'r.binding.invocation="wrong";'
				: attack === "lock-drift"
					? `writeFileSync(${JSON.stringify(join(root, PROJECT_PROVIDERS_LOCK_PATH))},"invalid lock");`
					: attack.endsWith("drift")
						? `writeFileSync(${JSON.stringify(target)},"changed input");`
						: "";
	const code = `import{readFileSync,writeFileSync}from"node:fs";import{createHash}from"node:crypto";let raw="";for await(const b of process.stdin)raw+=b;const r=JSON.parse(raw),sha=x=>"sha256:"+createHash("sha256").update(x).digest("hex");${action}const data=Buffer.from(${JSON.stringify(attack === "resource-drift" ? docxData : pngData)},"base64");process.stdout.write(JSON.stringify({schema:"aidlc.document-candidate/v1",binding:r.binding,request_digest:sha(raw),artifact:{path:"output."+r.recipe.target,media_type:r.recipe.target==="png"?"image/png":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",size:data.length,digest:sha(data),data:data.toString("base64")}}));if(process.connected)process.disconnect();`;
	writeFileSync(join(fake, "bin/render.mjs"), code);
	const manifest = structuredClone(baseManifest) as any;
	manifest.extensions["aidlc.document"].files = {
		"bin/render.mjs": sha256FileDigest(code),
	};
	if (attack === "capability-missing")
		manifest.extensions["aidlc.document"].formats = [];
	writeFileSync(join(fake, "provider.yaml"), JSON.stringify(manifest));
	gitFake("add", ".");
	gitFake("commit", "-m", attack);
	const revision = gitFake("rev-parse", "HEAD");
	fakeCommits.push(revision);
	writeFileSync(
		join(root, ".aidlc/provider-git-policy.json"),
		JSON.stringify({
			version: 1,
			allowed_hosts: fixture ? [] : [new URL(source).hostname],
			allowed_commits: [commit, ...fakeCommits],
			allow_file_fixtures: true,
		}),
	);
	addProjectProvider(root, {
		source: fakeSource,
		ref: revision,
		instance: `adversary-${fakeCommits.length}`,
		allowFile: true,
		trust: "allowlisted-commit",
	});
	const currentLock = readFileSync(join(root, PROJECT_PROVIDERS_LOCK_PATH));
	const testOptions =
		attack === "resource-drift"
			? { ...opts("md", "resource.md", "docx"), force: true }
			: { ...svg, force: true };
	if (attack === "resource-drift")
		writeFileSync(testOptions.output, "previous document");
	const before = readFileSync(testOptions.output);
	await assert.rejects(
		() =>
			dispatchDocumentExport(testOptions, {
				project: root,
				instance: `adversary-${fakeCommits.length}`,
			}),
		/STALE|DRIFT|CANDIDATE|UNDECLARED|CAPABILITY|CONFIG|LOCK/,
	);
	assert.deepEqual(readFileSync(testOptions.output), before);
	writeFileSync(svg.input, inputOriginal);
	writeFileSync(join(root, PROJECT_PROVIDERS_LOCK_PATH), currentLock);
	setProjectProviderEnabled(root, `adversary-${fakeCommits.length}`, false);
	console.log(`adversarial host ${attack}: rejected; previous output retained`);
}
// A junction in the authorized tree must not grant the host an outside resource.
const outside = mkdtempSync(join(tmpdir(), "document-outside-"));
writeFileSync(join(outside, "secret.png"), Buffer.from(pngData, "base64"));
symlinkSync(
	outside,
	join(root, "outside-link"),
	process.platform === "win32" ? "junction" : "dir",
);
writeFileSync(join(root, "symlink.md"), "![outside](outside-link/secret.png)");
assert.throws(
	() => snapshotExportInputs(opts("md", "symlink.md", "docx")),
	/DENIED/,
);
assert.throws(() => regularPath(root, "outside-link/secret.png"), /DENIED/);
console.log(
	"Adversarial hosts, resource closure drift and symlink escape: passed",
);
// A second real Chrome session must survive both successful export and cancellation.
import { spawn } from "node:child_process";
import { findBrowser } from "../core/tools/aidlc-trusted-host.js";
const browser = findBrowser();
assert(browser);
const sharedProfile = mkdtempSync(join(tmpdir(), "document-shared-browser-"));
const shared = spawn(
	browser,
	[
		"--headless=new",
		"--no-first-run",
		"--disable-background-networking",
		"--disable-extensions",
		"--remote-debugging-port=0",
		`--user-data-dir=${sharedProfile}`,
		"about:blank",
	],
	{ stdio: "ignore", windowsHide: true },
);
try {
	for (
		let i = 0;
		i < 200 && !existsSync(join(sharedProfile, "DevToolsActivePort"));
		i++
	)
		await new Promise((r) => setTimeout(r, 25));
	assert(
		existsSync(join(sharedProfile, "DevToolsActivePort")),
		"independent browser session ready",
	);
	await dispatchDocumentExport({ ...svg, force: true }, dispatch);
	assert.equal(shared.exitCode, null);
	await assert.rejects(
		() =>
			dispatchDocumentExport(
				{ ...md, target: "pdf", output: join(root, "cancelled.pdf") },
				{ ...dispatch, timeout: 2500 },
			),
		/TIMEOUT/,
	);
	assert.equal(
		shared.exitCode,
		null,
		"unrelated browser must stay alive after cancellation",
	);
	assert(!existsSync(join(root, "cancelled.pdf")));
	console.log("Real independent Chrome survived export and cancellation");
} finally {
	const closed = new Promise<void>((resolve) =>
		shared.once("close", () => resolve()),
	);
	shared.kill();
	await closed;
	for (let i = 0; i < 30; i++) {
		try {
			rmSync(sharedProfile, { recursive: true, force: true });
			break;
		} catch {
			await new Promise((r) => setTimeout(r, 100));
		}
	}
}

const emptyFonts = join(root, "empty-fonts");
mkdirSync(emptyFonts);
assert.throws(
	() => snapshotExportInputs({ ...svg, fontDirs: [emptyFonts] }),
	/NEEDS_CAPABILITY: local font/,
);
// Feed an actual exported document into the independently locked DOCX style host.
if (process.env.AIDLC_TEST_ARTIFACT_DIR) {
	mkdirSync(process.env.AIDLC_TEST_ARTIFACT_DIR, { recursive: true });
	writeFileSync(join(process.env.AIDLC_TEST_ARTIFACT_DIR, "document-export.docx"), readFileSync(md.output));
}
