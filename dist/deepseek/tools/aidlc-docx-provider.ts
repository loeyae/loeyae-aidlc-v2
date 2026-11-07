/** Core authority: locked invocation, immutable inputs, independent OPC verification, publication. */
import { randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, parse, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
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
import { regularPath } from "./aidlc-document-export.js";
import { runTrustedHost } from "./aidlc-trusted-host.js";
import {
	assertDistinctOutput,
	loadEditableDocx,
	snapshotPackage,
	validateStyleOnlyBuffer,
	writeAtomicOutput,
} from "./docx/package.js";
import type { InspectionReport } from "./docx/types.js";
import type { BeautifyOptions, BeautifyReport } from "./docx/beautify.js";
type Options =
	| (BeautifyOptions & { command: "beautify" })
	| { command: "inspect"; input: string };
export interface DocxDispatch {
	project?: string;
	instance?: string;
	timeout?: number;
}
const same = (a: unknown, b: unknown) =>
	canonicalProviderJson(a) === canonicalProviderJson(b);
function fail(s: string): never {
	throw new Error(s);
}
function path(p: string, required = true) {
	p = resolve(p);
	for (let q = p; ; q = dirname(q)) {
		try {
			if (lstatSync(q).isSymbolicLink())
				fail("DOCX_PATH_DENIED: symbolic link");
		} catch (e: any) {
			if (e.code !== "ENOENT") throw e;
		}
		if (dirname(q) === q) break;
	}
	return regularPath(parse(p).root, p, required);
}
const hash = (p: string) => sha256FileDigest(readFileSync(path(p)));
/** Provider invariants/report fields are deliberately not evidence for content preservation. */
export async function validateDocxCandidate(
	request: any,
	candidate: any,
	baseline: Awaited<ReturnType<typeof loadEditableDocx>>,
) {
	if (
		!candidate ||
		Object.keys(candidate).sort().join() !==
			"artifact,binding,report,request_digest,schema" ||
		candidate.schema !== "aidlc.docx-candidate/v1" ||
		!same(candidate.binding, request.binding) ||
		candidate.request_digest !== sha256FileDigest(JSON.stringify(request))
	)
		fail("DOCX_CANDIDATE_INVALID: binding or invocation");
	const report = candidate.report;
	if (
		!report ||
		report.schema_version !== "1" ||
		report.input?.sha256 !== baseline.inputSha256
	)
		fail("DOCX_CANDIDATE_INVALID: report input");
	if (request.recipe.command === "inspect" || request.recipe.dryRun) {
		if (candidate.artifact !== null)
			fail("DOCX_CANDIDATE_INVALID: read-only operation produced an artifact");
		if (
			request.recipe.command === "inspect" &&
			(!report.document || !report.styles || !report.direct_formatting)
		)
			fail("DOCX_CANDIDATE_INVALID: inspection report");
		if (
			request.recipe.dryRun &&
			(report.status !== "DRY_RUN" || report.output !== null)
		)
			fail("DOCX_CANDIDATE_INVALID: dry-run report");
		return { report, data: null, validation: null };
	}
	const a = candidate.artifact;
	if (
		!a ||
		Object.keys(a).sort().join() !== "data,digest,path,size" ||
		a.path !== "output.docx" ||
		typeof a.data !== "string" ||
		!Number.isSafeInteger(a.size) ||
		a.size < 1 ||
		a.size > 50 * 1024 * 1024
	)
		fail("DOCX_CANDIDATE_INVALID: artifact set or size");
	const data = Buffer.from(a.data, "base64");
	if (
		data.toString("base64") !== a.data ||
		data.length !== a.size ||
		sha256FileDigest(data) !== a.digest
	)
		fail("DOCX_CANDIDATE_INVALID: artifact digest");
	const validation = await validateStyleOnlyBuffer(
		await snapshotPackage(baseline.zip),
		data,
		baseline.stylesPart,
		false,
	);
	return { report, data, validation };
}
export function dispatchDocx(
	options: { command: "inspect"; input: string },
	dispatch?: DocxDispatch,
): Promise<InspectionReport>;
export function dispatchDocx(
	options: BeautifyOptions & { command: "beautify" },
	dispatch?: DocxDispatch,
): Promise<BeautifyReport>;
export async function dispatchDocx(
	options: Options,
	dispatch: DocxDispatch = {},
): Promise<any> {
	const instance = dispatch.instance || process.env.AIDLC_DOCX_HOST_PROVIDER;
	if (!instance)
		fail(
			"NEEDS_CAPABILITY: DOCX inspect/beautify moved to document.docx-style; explicitly authorize --host-provider <locked-instance> (no implicit installation)",
		);
	const project = realpathSync(
		dispatch.project || process.env.AIDLC_DOCX_PROJECT || process.cwd(),
	);
	const context = {
		project_id: basename(project),
		stage: "docx",
		scope: relative(project, options.input).replace(/\\/g, "/"),
	};
	const select = () =>
		requireEnabledProviderCapability(project, "document.docx-style", context, {
			protectedGate: true,
		}).find((x) => x.intent.instance_id === instance);
	const selected = select();
	if (!selected)
		fail(
			"NEEDS_CAPABILITY: document.docx-style package absent or disabled; add/lock/enable providers/docx-style",
		);
	const { manifest } = verifyLockedProviderCache(project, selected.lock);
	const ext = manifest.extensions?.["aidlc.docx-style"] as any;
	if (
		!ext ||
		ext.schema !== "aidlc.docx-host/v1" ||
		ext.execution !== "explicit-trusted-host" ||
		ext.version !== manifest.version ||
		!ext.platforms?.includes(`${process.platform}-${process.arch}`) ||
		!ext.files ||
		!Object.hasOwn(ext.files, manifest.entrypoint.path)
	)
		fail("NEEDS_CAPABILITY: unsupported DOCX style host");
	const input = path(options.input),
		inputHash = hash(input);
	const baseline = await loadEditableDocx(
		input,
		inputHash.slice(7),
		options.command === "inspect",
	);
	const files: Record<string, string> = {
		"input.docx": baseline.inputData.toString("base64"),
	};
	const sources: Record<string, string> = { "input.docx": input },
		digests: Record<string, string> = { "input.docx": inputHash };
	let output: string | undefined, initialOutput: string | undefined;
	if (options.command === "beautify") {
		if (options.preset && options.styleSpecPath)
			fail("--preset and --style-spec are mutually exclusive");
		if (options.dryRun && options.force)
			fail("--force cannot be combined with --dry-run");
		if (!options.dryRun && !options.output)
			fail("docx beautify requires --output unless --dry-run is used");
		if (options.styleSpecPath) {
			const spec = path(options.styleSpecPath);
			if (
				lstatSync(spec).size > 256 * 1024 ||
				!spec.toLowerCase().endsWith(".json")
			)
				fail("invalid style spec path or size");
			const data = readFileSync(spec);
			files["style.json"] = data.toString("base64");
			sources["style.json"] = spec;
			digests["style.json"] = sha256FileDigest(data);
		}
		if (!options.dryRun) {
			output = path(options.output!, false);
			assertDistinctOutput(input, output);
			if (existsSync(output)) {
				if (!lstatSync(output).isFile()) fail("output is not a regular file");
				initialOutput = hash(output);
				if (!options.force)
					fail("output already exists; use --force to replace it");
			}
		}
	}
	const lockDigest = readProjectProviders(project).lock.lock_digest;
	const configFiles = [
		join(project, ".aidlc/providers.yaml"),
		join(project, ".aidlc/providers.lock.yaml"),
	];
	const configHashes = configFiles.map(hash);
	const recipe =
		options.command === "inspect"
			? { command: "inspect" }
			: {
					command: "beautify",
					preset: options.preset ?? null,
					styleSpec: options.styleSpecPath ? "style.json" : null,
					dryRun: options.dryRun,
					force: options.force,
					output: options.output ?? null,
				};
	const request = {
		schema: "aidlc.docx-request/v1",
		binding: {
			...context,
			invocation: randomUUID(),
			instance,
			provider: sha256ProviderDigest(selected.lock),
			lock_digest: lockDigest,
			inputs: digests,
		},
		recipe,
		files,
	};
	const fresh = () => {
		if (configFiles.some((file, i) => hash(file) !== configHashes[i]))
			fail("DOCX_PROVIDER_DRIFT");
		for (const [key, source] of Object.entries(sources))
			if (hash(source) !== digests[key]) fail("DOCX_INPUT_STALE");
		if (
			readProjectProviders(project).lock.lock_digest !== lockDigest ||
			!same(select()?.lock, selected.lock)
		)
			fail("DOCX_PROVIDER_DRIFT");
		verifyLockedProviderCache(project, selected.lock);
		if (output) {
			path(output, false);
			if ((existsSync(output) ? hash(output) : undefined) !== initialOutput)
				fail("DOCX_OUTPUT_STALE");
		}
	};
	const session = mkdtempSync(join(tmpdir(), "aidlc-docx-host-"));
	try {
		const declared = Object.entries(ext.files) as [string, string][];
		if (declared.length !== 1)
			fail("DOCX_PACKAGE_INVALID: expected one self-contained runtime");
		for (const [file, digest] of declared) {
			if (!/^bin\/[a-zA-Z0-9_.-]+$/.test(file)) fail("DOCX_PACKAGE_INVALID");
			const bytes = readLockedProviderFile(project, selected.lock, file);
			if (sha256FileDigest(bytes) !== digest) fail("DOCX_PACKAGE_DRIFT");
			mkdirSync(join(session, "bin"), { recursive: true });
			writeFileSync(join(session, file), bytes, { flag: "wx" });
		}
		const result = await runTrustedHost(
			join(session, manifest.entrypoint.path),
			session,
			JSON.stringify(request),
			dispatch.timeout ?? 120000,
		);
		if (
			readdirSync(session).join() !== "bin" ||
			readdirSync(join(session, "bin")).length !== declared.length
		)
			fail("DOCX_UNDECLARED_OUTPUT");
		for (const [file, digest] of declared)
			if (
				lstatSync(join(session, file)).isSymbolicLink() ||
				hash(join(session, file)) !== digest
			)
				fail("DOCX_PACKAGE_DRIFT");
		const { report, data, validation } = await validateDocxCandidate(
			request,
			JSON.parse(result.stdout),
			baseline,
		);
		fresh();
		report.input.path = input;
		if (!data) return report;
		// Parse candidate relationships and Content Types independently, before publication.
		const artifact = await writeAtomicOutput(
			input,
			output!,
			data,
			options.command === "beautify" && options.force,
			async (temporary) => {
				path(temporary);
				const candidate = await loadEditableDocx(
					temporary,
					sha256FileDigest(data).slice(7),
				);
				if (candidate.stylesPart !== baseline.stylesPart)
					fail("DOCX invariant failed: styles relationship target changed");
				fresh();
			},
		);
		return {
			...report,
			status: "STATIC_PASS",
			output: artifact,
			changed_parts: validation!.changedParts,
			invariants: validation!.invariants,
			visual_validation: "not_run",
		};
	} finally {
		rmSync(session, { recursive: true, force: true });
	}
}
