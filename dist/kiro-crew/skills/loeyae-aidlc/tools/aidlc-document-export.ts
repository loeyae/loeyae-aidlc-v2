/** Core owns input closure, authorization, candidate acceptance and atomic publication. */
import { randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
	linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
	parse,
	basename,
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { createRequire } from "node:module";
import JSZip from "jszip";
import {
	readLockedProviderFile,
	verifyLockedProviderCache,
} from "./aidlc-provider-git.js";
import {
	canonicalProviderJson,
	readProjectProviders,
	requireEnabledProviderCapability,
	sha256FileDigest,
	sha256ProviderDigest,
} from "./aidlc-project-provider.js";
import { findBrowser, runTrustedHost } from "./aidlc-trusted-host.js";
import type { ExportOptions } from "./aidlc-export.js";
const MarkdownIt = createRequire(import.meta.url)("markdown-it");
function requirePathRoot(p: string) {
	return parse(resolve(p)).root;
}
const MAX = 64 * 1024 * 1024;
function fail(message: string): never {
	throw new Error(message);
}
function same(a: unknown, b: unknown) {
	return canonicalProviderJson(a) === canonicalProviderJson(b);
}
export function regularPath(
	root: string,
	value: string,
	mustExist = true,
): string {
	root = realpathSync(root);
	const p = resolve(root, value),
		rel = relative(root, p);
	if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
		fail("EXPORT_PATH_DENIED: path escapes authorized root");
	for (let q = p; ; q = dirname(q)) {
		if (existsSync(q)) {
			const s = lstatSync(q);
			if (s.isSymbolicLink()) fail("EXPORT_PATH_DENIED: symlink or hardlink");
		}
		if (q === root) break;
	}
	if (
		mustExist &&
		(!existsSync(p) ||
			!lstatSync(p).isFile() ||
			lstatSync(p).size === 0 ||
			lstatSync(p).size > MAX)
	)
		fail("EXPORT_INPUT_INVALID: missing, empty or oversized regular input");
	return p;
}
/** SVG is passive: fragments only, no nested data documents, CSS escapes, entities or events. */
export function validateExportSvg(source: string) {
	source = source.replace(/<!--[\s\S]*?-->/g, "");
	if (
		!/<svg\b/i.test(source) ||
		/<!|<\s*(?:script|foreignObject|iframe|object|embed)\b|\bon\w+\s*=|@import|\\/i.test(
			source,
		)
	)
		fail("EXPORT_RESOURCE_DENIED: unsafe SVG");
	for (const m of source.matchAll(
		/(?:href|xlink:href)\s*=\s*(["'])(.*?)\1|url\(\s*(["']?)(.*?)\3\s*\)/gis,
	)) {
		const ref = (m[2] ?? m[4]).trim();
		if (!/^#[a-zA-Z_][\w:.-]*$/.test(ref))
			fail("EXPORT_RESOURCE_DENIED: external resource reference");
	}
}
export interface ExportDispatchOptions {
	project: string;
	instance?: string;
	projectId?: string;
	stage?: string;
	scope?: string;
	timeout?: number;
}
export interface ExportSnapshot {
	files: Record<string, string>;
	sources: Record<string, string>;
	digests: Record<string, string>;
	input: string;
	template?: string;
	fontDirs: string[];
	browser?: string;
}
export function snapshotExportInputs(options: ExportOptions): ExportSnapshot {
	const root = realpathSync(dirname(options.input));
	const files: Record<string, string> = {},
		sources: Record<string, string> = {},
		digests: Record<string, string> = {};
	let bytes = 0;
	const add = (source: string, key: string, allowedRoot = root) => {
		const p = regularPath(allowedRoot, source);
		regularPath(requirePathRoot(p), p);
		const data = readFileSync(p);
		if (Object.hasOwn(files, key)) return;
		bytes += data.length;
		if (bytes > 128 * 1024 * 1024 || Object.keys(files).length >= 512)
			fail("EXPORT_INPUT_LIMIT");
		files[key] = data.toString("base64");
		sources[key] = p;
		digests[key] = sha256FileDigest(data);
		if (extname(p).toLowerCase() === ".svg")
			validateExportSvg(data.toString("utf8"));
	};
	const input = `document/${basename(options.input)}`;
	if (
		lstatSync(regularPath(root, options.input)).size >
		(options.sourceKind === "md" ? 5 : 10) * 1024 * 1024
	)
		fail("EXPORT_INPUT_LIMIT");
	add(options.input, input);
	if (options.sourceKind === "md") {
		const tokens = new MarkdownIt({ html: false }).parse(
			readFileSync(options.input, "utf8"),
			{},
		);
		const visit = (all: any[]) => {
			for (const t of all) {
				if (t.type === "image") {
					const raw = decodeURIComponent(
						String(t.attrGet("src") ?? "").split("#")[0],
					);
					if (!raw || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(raw) || isAbsolute(raw))
						fail(
							"EXPORT_RESOURCE_DENIED: remote and data image resources are not allowed",
						);
					const p = regularPath(root, raw);
					if (lstatSync(p).size > 25 * 1024 * 1024) fail("EXPORT_INPUT_LIMIT");
					const rel = relative(root, p).replace(/\\/g, "/");
					add(p, `document/${rel}`);
				}
				if (t.children) visit(t.children);
			}
		};
		visit(tokens);
	}
	let template: string | undefined;
	if (options.template) {
		template = "template/source.docx";
		add(options.template, template, dirname(options.template));
	}
	// Snapshot explicit font directories, or the known Chinese/default fonts used by the recipe.
	const fontRoots = options.fontDirs.length
		? options.fontDirs
		: process.platform === "win32"
			? [join(process.env.WINDIR || "C:/Windows", "Fonts")]
			: [];
	for (let i = 0; i < fontRoots.length; i++) {
		regularPath(requirePathRoot(fontRoots[i]), fontRoots[i], false);
		const directory = realpathSync(fontRoots[i]);
		if (lstatSync(fontRoots[i]).isSymbolicLink())
			fail("EXPORT_PATH_DENIED: font directory symlink");
		const names = options.fontDirs.length
			? readdirSync(directory)
			: ["msyh.ttc", "msyhbd.ttc", "consola.ttf"];
		for (const name of names)
			if (/\.(ttf|otf|ttc)$/i.test(name))
				add(join(directory, name), `fonts/${i}/${name}`, directory);
	}
	if (!Object.keys(files).some((k) => k.startsWith("fonts/")))
		fail(
			"NEEDS_CAPABILITY: local font snapshots required; pass --font-dir for SVG",
		);
	const browser = findBrowser(options.browser);
	if (browser) {
		const p = regularPath(dirname(resolve(browser)), resolve(browser));
		sources["@browser"] = p;
		digests["@browser"] = sha256FileDigest(readFileSync(p));
	}
	return {
		files,
		sources,
		digests,
		input,
		template,
		fontDirs: fontRoots.map((_, i) => `fonts/${i}`),
		...(browser ? { browser: resolve(browser) } : {}),
	};
}
function assertFresh(snapshot: ExportSnapshot) {
	for (const [key, source] of Object.entries(snapshot.sources)) {
		regularPath(requirePathRoot(source), source);
		if (sha256FileDigest(readFileSync(source)) !== snapshot.digests[key])
			fail("EXPORT_INPUT_STALE");
	}
}
export async function validateExportCandidate(
	request: any,
	candidate: any,
): Promise<Buffer> {
	if (
		!candidate ||
		Object.keys(candidate).sort().join() !==
			"artifact,binding,request_digest,schema" ||
		candidate.schema !== "aidlc.document-candidate/v1" ||
		!same(candidate.binding, request.binding) ||
		candidate.request_digest !== sha256FileDigest(JSON.stringify(request))
	)
		fail("EXPORT_CANDIDATE_INVALID: binding or invocation");
	const a = candidate.artifact;
	if (
		!a ||
		Object.keys(a).sort().join() !== "data,digest,media_type,path,size" ||
		a.path !== `output.${request.recipe.target}` ||
		typeof a.data !== "string" ||
		!Number.isSafeInteger(a.size) ||
		a.size < 1 ||
		a.size > MAX
	)
		fail("EXPORT_CANDIDATE_INVALID: file set or size");
	const data = Buffer.from(a.data, "base64");
	const media = {
		png: "image/png",
		pdf: "application/pdf",
		docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	};
	if (
		data.toString("base64") !== a.data ||
		data.length !== a.size ||
		sha256FileDigest(data) !== a.digest ||
		a.media_type !== media[request.recipe.target as keyof typeof media]
	)
		fail("EXPORT_CANDIDATE_INVALID: digest or type");
	if (request.recipe.target === "png") {
		const { decodeBoundedPng } = await import("./aidlc-mcp-image.js");
		decodeBoundedPng(
			{ type: "image", mimeType: "image/png", data: a.data },
			MAX,
			100_000_000,
		);
	} else if (request.recipe.target === "pdf") {
		if (
			data.subarray(0, 5).toString() !== "%PDF-" ||
			!data.subarray(-2048).includes(Buffer.from("%%EOF")) ||
			!data.includes(Buffer.from("/Page"))
		)
			fail("EXPORT_CONTENT_INVALID: incomplete PDF");
	} else {
		const zip = await JSZip.loadAsync(data, { checkCRC32: true });
		for (const name of [
			"[Content_Types].xml",
			"word/document.xml",
			"word/styles.xml",
		])
			if (!zip.file(name)) fail("EXPORT_CONTENT_INVALID: incomplete DOCX");
		const xml = await zip.file("word/document.xml")!.async("string");
		if (!xml.includes("<w:body>") || !/<w:(?:t|drawing)\b/.test(xml))
			fail("EXPORT_CONTENT_INVALID: empty DOCX");
	}
	return data;
}
/** Existing matrix has one final artifact. Stage beside it, then perform one atomic publish. */
export function publishExport(
	output: string,
	data: Buffer,
	force: boolean,
	fresh: () => void,
) {
	const parent = dirname(output);
	mkdirSync(parent, { recursive: true });
	regularPath(parent, output, false);
	if (existsSync(output) && !force)
		fail("output already exists; use --force to replace it");
	const temp = join(parent, `.${basename(output)}.${randomUUID()}.tmp`);
	try {
		writeFileSync(temp, data, { flag: "wx" });
		fresh();
		regularPath(parent, output, false);
		if (existsSync(output) && !lstatSync(output).isFile())
			fail("EXPORT_OUTPUT_INVALID");
		if (force) renameSync(temp, output);
		else {
			linkSync(temp, output);
			rmSync(temp);
		}
	} finally {
		if (existsSync(temp)) rmSync(temp);
	}
}
export async function dispatchDocumentExport(
	options: ExportOptions,
	dispatch: ExportDispatchOptions,
) {
	if (!dispatch.instance)
		fail(
			"NEEDS_CAPABILITY: export moved to document.render; explicitly authorize --host-provider <locked-instance> (no implicit installation)",
		);
	const project = realpathSync(dispatch.project),
		context = {
			project_id: dispatch.projectId || basename(project),
			stage: dispatch.stage || "export",
			scope:
				dispatch.scope || relative(project, options.input).replace(/\\/g, "/"),
		};
	const select = () =>
		requireEnabledProviderCapability(project, "document.render", context, {
			protectedGate: true,
		}).find((x) => x.intent.instance_id === dispatch.instance);
	const selected = select();
	if (!selected)
		fail("NEEDS_CAPABILITY: document.render package is absent or disabled");
	const { manifest } = verifyLockedProviderCache(project, selected.lock);
	const ext = manifest.extensions?.["aidlc.document"] as any;
	if (
		!ext ||
		ext.schema !== "aidlc.document-host/v1" ||
		ext.execution !== "explicit-trusted-host" ||
		ext.version !== manifest.version ||
		!Array.isArray(ext.formats) ||
		!ext.formats.includes(`${options.sourceKind}:${options.target}`) ||
		!ext.files ||
		typeof ext.files !== "object"
	)
		fail("NEEDS_CAPABILITY: unsupported document host or format");
	if (!ext.platforms?.includes(`${process.platform}-${process.arch}`))
		fail("NEEDS_CAPABILITY: document-render platform unavailable");
	// Check output without changing or deleting the previous version.
	let ancestor = dirname(options.output);
	while (!existsSync(ancestor)) ancestor = dirname(ancestor);
	regularPath(ancestor, options.output, false);
	if (existsSync(options.output) && !options.force)
		fail("output already exists; use --force to replace it");
	const snapshot = snapshotExportInputs(options),
		lockDigest = readProjectProviders(project).lock.lock_digest;
	const { input, output, template, fontDirs, browser, force, ...recipe } =
		options;
	const binding = {
		...context,
		invocation: randomUUID(),
		instance: dispatch.instance,
		provider: sha256ProviderDigest(selected.lock),
		lock_digest: lockDigest,
		inputs: snapshot.digests,
	};
	const request = {
		schema: "aidlc.document-request/v1",
		binding,
		recipe: {
			...recipe,
			input: snapshot.input,
			...(snapshot.template ? { template: snapshot.template } : {}),
			fontDirs: snapshot.fontDirs,
			...(snapshot.browser ? { browser: snapshot.browser } : {}),
		},
		files: snapshot.files,
	};
	const session = mkdtempSync(join(tmpdir(), "aidlc-document-host-"));
	try {
		const declared = Object.entries(ext.files) as [string, string][];
		if (
			declared.length > 16 ||
			!Object.hasOwn(ext.files, manifest.entrypoint.path)
		)
			fail("EXPORT_PACKAGE_INVALID");
		for (const [file, digest] of declared) {
			if (
				!/^bin\/[a-zA-Z0-9_.-]+$/.test(file) ||
				!/^sha256:[a-f0-9]{64}$/.test(digest)
			)
				fail("EXPORT_PACKAGE_INVALID");
			const bytes = readLockedProviderFile(project, selected.lock, file);
			if (sha256FileDigest(bytes) !== digest) fail("EXPORT_PACKAGE_DRIFT");
			mkdirSync(join(session, "bin"), { recursive: true });
			writeFileSync(join(session, file), bytes, { flag: "wx" });
		}
		const result = await runTrustedHost(
			join(session, manifest.entrypoint.path),
			session,
			JSON.stringify(request),
			dispatch.timeout ?? 240000,
		);
		const found: string[] = [];
		const inspect = (dir: string) => {
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const p = join(dir, e.name),
					key = relative(session, p).replace(/\\/g, "/");
				if (e.isSymbolicLink()) fail("EXPORT_UNDECLARED_OUTPUT");
				if (e.isDirectory()) {
					if (key !== "bin") fail("EXPORT_UNDECLARED_OUTPUT");
					inspect(p);
				} else if (
					!Object.hasOwn(ext.files, key) ||
					sha256FileDigest(readFileSync(p)) !== ext.files[key]
				)
					fail("EXPORT_UNDECLARED_OUTPUT");
				else found.push(key);
			}
		};
		inspect(session);
		if (found.length !== declared.length)
			fail("EXPORT_PACKAGE_DRIFT: missing runtime file");
		const data = await validateExportCandidate(
			request,
			JSON.parse(result.stdout),
		);
		const fresh = () => {
			assertFresh(snapshot);
			if (
				readProjectProviders(project).lock.lock_digest !== lockDigest ||
				!same(select()?.lock, selected.lock)
			)
				fail("EXPORT_PROVIDER_DRIFT");
			verifyLockedProviderCache(project, selected.lock);
		};
		publishExport(options.output, data, options.force, fresh);
		console.log(
			`✅ ${options.target.toUpperCase()} exported: ${options.output}\n   Size: ${(data.length / 1024).toFixed(1)} KB`,
		);
	} finally {
		rmSync(session, { recursive: true, force: true });
	}
}
