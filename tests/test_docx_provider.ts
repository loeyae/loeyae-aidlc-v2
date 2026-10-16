/** Production Git package integration. Pass a real remote URL and exact revision. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	existsSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import JSZip from "jszip";
import {
	addProjectProvider,
	setProjectProviderEnabled,
} from "../core/tools/aidlc-provider-cli.js";
import {
	dispatchDocx,
	validateDocxCandidate,
} from "../core/tools/aidlc-docx-provider.js";
import { loadEditableDocx } from "../core/tools/docx/package.js";
import {
	beautifyDocx,
	validateDocxAgainst,
} from "../core/tools/docx/beautify.js";
import { sha256FileDigest } from "../core/tools/aidlc-project-provider.js";
const [source, ref, realSample] = process.argv.slice(2);
assert(
	source && ref,
	"Pass the remote Provider source and exact revision; fixtures have their own test.",
);
const python = process.env.AIDLC_TEST_PYTHON || "python3";
const root = mkdtempSync(join(tmpdir(), "docx-production-"));
mkdirSync(join(root, ".aidlc"));
writeFileSync(
	join(root, ".aidlc/provider-git-policy.json"),
	JSON.stringify({
		version: 1,
		allowed_hosts: [new URL(source!).hostname],
		allowed_commits: [ref],
		allow_file_fixtures: false,
	}),
);
const input = join(root, "source.docx"),
	output = join(root, "output.docx");
const runPython = (args: string[], env = process.env) => {
	const r = spawnSync(python, args, {
		encoding: "utf8",
		env: { ...env, PYTHONIOENCODING: "utf-8" },
		timeout: 300000,
	});
	assert.equal(r.status, 0, `${r.error ?? ""}\n${r.stdout}\n${r.stderr}`);
	console.log(r.stdout.trim());
};
try {
	runPython([
		"-c",
		"import sys; from pathlib import Path; sys.path.insert(0,'tests'); from test_docx_inspect import write_docx; write_docx(Path(sys.argv[1]))",
		input,
	]);
	await assert.rejects(
		() => dispatchDocx({ command: "inspect", input }, { project: root }),
		/explicitly authorize/,
	);
	addProjectProvider(root, {
		source,
		ref,
		subdir: "providers/docx-style",
		instance: "styles",
		trust: "allowlisted-commit",
	});
	const dispatch = { project: root, instance: "styles" };
	setProjectProviderEnabled(root, "styles", false);
	await assert.rejects(
		() => dispatchDocx({ command: "inspect", input }, dispatch),
		/CAPABILITY/,
	);
	setProjectProviderEnabled(root, "styles", true);
	const before = readFileSync(input),
		statReport = await dispatchDocx({ command: "inspect", input }, dispatch);
	assert.equal(statReport.document.paragraphs, 7);
	assert.equal(
		statReport.direct_formatting!.paragraphs_with_direct_visual_overrides,
		1,
	);
	assert.deepEqual(readFileSync(input), before);
	await assert.rejects(
		() =>
			beautifyDocx(
				{ input, dryRun: true, force: false },
				{
					...statReport,
					input: { ...statReport.input, sha256: "0".repeat(64) },
				},
			),
		/changed after inspection/,
	);
	const dry = await dispatchDocx(
		{ command: "beautify", input, dryRun: true, force: false },
		dispatch,
	);
	assert.equal(dry.status, "DRY_RUN");
	assert.equal(dry.coverage.estimated_effective_paragraphs, 6);
	assert(!existsSync(output));
	const report = await dispatchDocx(
		{ command: "beautify", input, output, dryRun: false, force: false },
		dispatch,
	);
	assert.equal(report.status, "STATIC_PASS");
	assert.deepEqual(report.changed_parts, ["word/styles.xml"]);
	await validateDocxAgainst(output, input);
	if (realSample) {
		const realInput = join(root, "real-before.docx"),
			realOutput = join(root, "real-after.docx");
		writeFileSync(realInput, readFileSync(realSample));
		const real = await dispatchDocx(
			{
				command: "beautify",
				input: realInput,
				output: realOutput,
				dryRun: false,
				force: false,
			},
			dispatch,
		);
		const verified = await validateDocxAgainst(realOutput, realInput);
		assert.equal(verified.invariants.non_style_parts, "byte-identical");
		console.log(
			`Real document-render DOCX beautified and independently validated: ${real.output!.size_bytes} bytes; visual_validation=${real.visual_validation}; direct overrides=${real.coverage.paragraphs_with_direct_visual_overrides}/${real.coverage.paragraphs_total}`,
		);
	}
	const baseline = await loadEditableDocx(
		input,
		sha256FileDigest(before).slice(7),
	);
	const request = {
		binding: { invocation: "correct" },
		recipe: { command: "beautify", dryRun: false },
	};
	const bytes = readFileSync(output);
	const candidate: any = {
		schema: "aidlc.docx-candidate/v1",
		binding: request.binding,
		request_digest: sha256FileDigest(JSON.stringify(request)),
		report: {
			schema_version: "1",
			input: { sha256: baseline.inputSha256 },
			invariants: { unchanged: true },
		},
		artifact: {
			path: "output.docx",
			size: bytes.length,
			digest: sha256FileDigest(bytes),
			data: bytes.toString("base64"),
		},
	};
	await validateDocxCandidate(request, candidate, baseline);
	for (const changed of [
		{ ...candidate, binding: { invocation: "wrong" } },
		{ ...candidate, request_digest: "sha256:" + "0".repeat(64) },
		{
			...candidate,
			artifact: { ...candidate.artifact, path: "../outside.docx" },
		},
	])
		await assert.rejects(
			() => validateDocxCandidate(request, changed, baseline),
			/INVALID/,
		);
	for (const mode of ["body", "unrelated", "add", "remove", "directory"]) {
		const zip = await JSZip.loadAsync(bytes);
		if (mode === "body")
			zip.file(
				"word/document.xml",
				(await zip.file("word/document.xml")!.async("string")).replace(
					"正文内容",
					"篡改内容",
				),
			);
		if (mode === "unrelated") zip.file("docProps/app.xml", "<changed/>");
		if (mode === "add") zip.file("extra.bin", "extra");
		if (mode === "remove") zip.remove("docProps/app.xml");
		if (mode === "directory") zip.folder("extra-empty");
		const tampered = await zip.generateAsync({ type: "nodebuffer" });
		await assert.rejects(
			() =>
				validateDocxCandidate(
					request,
					{
						...candidate,
						artifact: {
							...candidate.artifact,
							size: tampered.length,
							digest: sha256FileDigest(tampered),
							data: tampered.toString("base64"),
						},
					},
					baseline,
				),
			/invariant failed/,
		);
	}
	const env = {
		...process.env,
		AIDLC_DOCX_PROJECT: root,
		AIDLC_DOCX_HOST_PROVIDER: "styles",
	};
	runPython(["tests/test_docx_inspect.py"], env);
	runPython(["tests/test_docx_beautify.py"], env);
	console.log(
		"Production Git add/lock, inspect/dry-run/beautify/validate and forged-candidate tests passed",
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}
