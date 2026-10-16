/** Adversarial locked host fixtures; never counted as production beautification evidence. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	rmSync,
	existsSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { dispatchDocx } from "../core/tools/aidlc-docx-provider.js";
import { addProjectProvider } from "../core/tools/aidlc-provider-cli.js";
import { sha256FileDigest } from "../core/tools/aidlc-project-provider.js";
const root = mkdtempSync(join(tmpdir(), "docx-adversarial-")),
	repo = join(root, "repo"),
	project = join(root, "project");
const input = join(project, "source.docx"),
	spec = join(project, "style.json"),
	output = join(project, "output.docx");
const lock = join(project, ".aidlc/providers.lock.yaml");
const git = (args: string[]) => {
	const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
	assert.equal(r.status, 0, r.stderr);
	return r.stdout.trim();
};
try {
	mkdirSync(join(repo, "bin"), { recursive: true });
	mkdirSync(join(repo, "rules"));
	mkdirSync(join(project, ".aidlc"), { recursive: true });
	const py = spawnSync(
		process.env.AIDLC_TEST_PYTHON || "python3",
		[
			"-c",
			"import sys; from pathlib import Path; sys.path.insert(0,'tests'); from test_docx_inspect import write_docx; write_docx(Path(sys.argv[1]))",
			input,
		],
		{ encoding: "utf8" },
	);
	assert.equal(py.status, 0, py.stderr);
	writeFileSync(spec, "{}");
	const host = `import * as fs from 'node:fs'; import {createHash} from 'node:crypto';
const hash=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
let text='';for await(const b of process.stdin)text+=b;const r=JSON.parse(text),mode=r.recipe.preset || (r.recipe.styleSpec?'style':'ok');
const data=Buffer.from(r.files['input.docx'],'base64');
if(mode==='input')fs.appendFileSync(${JSON.stringify(input)},'changed');
if(mode==='style')fs.appendFileSync(${JSON.stringify(spec)},'changed');
if(mode==='lock')fs.appendFileSync(${JSON.stringify(lock)},' ');
if(mode==='output')fs.writeFileSync(${JSON.stringify(output)},'concurrent output');
if(mode==='output-link'){const path=await import('node:path'); const parent=path.dirname(r.recipe.output);fs.renameSync(parent,parent+'.saved');fs.mkdirSync(parent+'.redirect');fs.symlinkSync(parent+'.redirect',parent,process.platform==='win32'?'junction':'dir');}
if(mode==='crash')process.exit(9);
if(mode==='timeout'){process.on('message',()=>process.exit(1));setInterval(()=>{},1000);await new Promise(()=>{});}
if(mode==='undeclared')fs.writeFileSync('extra.tmp','extra');
const c={schema:'aidlc.docx-candidate/v1',binding:r.binding,request_digest:hash(JSON.stringify(r)),report:{schema_version:'1',input:{sha256:hash(data).slice(7)},status:'CANDIDATE',invariants:{non_style_parts:'byte-identical'}},artifact:{path:'output.docx',size:data.length,digest:hash(data),data:data.toString('base64')}};
if(mode==='wrong')c.binding={...r.binding,invocation:'wrong'};
if(mode==='tamper')c.artifact.digest='sha256:'+'0'.repeat(64);
process.stdout.write(JSON.stringify(c));if(process.connected)process.disconnect();`;
	writeFileSync(join(repo, "bin/host.mjs"), host);
	const manifest = {
		schema: "aidlc.provider/v1.1",
		provider_id: "test.docx-fixture",
		name: "DOCX hostile test fixture",
		version: "0.1.0",
		kind: "command",
		capabilities: ["document.docx-style"],
		entrypoint: { path: "bin/host.mjs" },
		ruleset: { id: "fixture", version: "0.1.0", catalog: "rules/catalog.json" },
		artifacts: { lock: "provider.lock", sbom: "sbom.spdx.json" },
		policies: { network: "none", writes: [] },
		extensions: {
			"aidlc.docx-style": {
				schema: "aidlc.docx-host/v1",
				version: "0.1.0",
				execution: "explicit-trusted-host",
				platforms: [`${process.platform}-${process.arch}`],
				files: { "bin/host.mjs": sha256FileDigest(host) },
			},
		},
	};
	for (const [name, data] of Object.entries({
		"provider.yaml": manifest,
		"provider.lock": { lockfileVersion: 1, packages: {} },
		"sbom.spdx.json": { spdxVersion: "SPDX-2.3" },
		"rules/catalog.json": { rules: [] },
	}))
		writeFileSync(join(repo, name), JSON.stringify(data));
	git(["init"]);
	git(["add", "."]);
	git([
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"-m",
		"fixture",
	]);
	const ref = git(["rev-parse", "HEAD"]);
	writeFileSync(
		join(project, ".aidlc/provider-git-policy.json"),
		JSON.stringify({
			version: 1,
			allowed_hosts: [],
			allowed_commits: [ref],
			allow_file_fixtures: true,
		}),
	);
	addProjectProvider(project, {
		source: pathToFileURL(repo).href,
		ref,
		instance: "fixture",
		allowFile: true,
		trust: "allowlisted-commit",
	});
	const original = readFileSync(input),
		originalLock = readFileSync(lock),
		old = Buffer.from("previous valid output");
	for (const mode of [
		"input",
		"style",
		"lock",
		"wrong",
		"tamper",
		"crash",
		"undeclared",
		"timeout",
	]) {
		writeFileSync(input, original);
		writeFileSync(lock, originalLock);
		writeFileSync(spec, "{}");
		writeFileSync(output, old);
		const o = {
			command: "beautify" as const,
			input,
			output,
			dryRun: false,
			force: true,
			...(mode === "style" ? { styleSpecPath: spec } : { preset: mode }),
		};
		const expected = (
			{
				input: /DOCX_INPUT_STALE/,
				style: /DOCX_INPUT_STALE/,
				lock: /DOCX_PROVIDER_DRIFT/,
				wrong: /binding or invocation/,
				tamper: /artifact digest/,
				crash: /PROVIDER_FAILED/,
				undeclared: /DOCX_UNDECLARED_OUTPUT/,
				timeout: /TIMEOUT/,
			} as Record<string, RegExp>
		)[mode];
		await assert.rejects(
			() =>
				dispatchDocx(o, {
					project,
					instance: "fixture",
					timeout: mode === "timeout" ? 1000 : 15000,
				}),
			expected,
		);
		assert.deepEqual(
			readFileSync(output),
			old,
			mode + " must preserve previous output",
		);
		assert(!existsSync(join(project, "output.docx.tmp")));
	}
	writeFileSync(input, original);
	writeFileSync(lock, originalLock);
	writeFileSync(output, old);
	await assert.rejects(
		() =>
			dispatchDocx(
				{
					command: "beautify",
					input,
					output,
					dryRun: false,
					force: true,
					preset: "output",
				},
				{ project, instance: "fixture" },
			),
		/OUTPUT_STALE/,
	);
	assert.equal(readFileSync(output, "utf8"), "concurrent output");
	const subdirectory = join(project, "outputs"),
		suboutput = join(subdirectory, "result.docx");
	mkdirSync(subdirectory);
	writeFileSync(suboutput, old);
	await assert.rejects(
		() =>
			dispatchDocx(
				{
					command: "beautify",
					input,
					output: suboutput,
					dryRun: false,
					force: true,
					preset: "output-link",
				},
				{ project, instance: "fixture" },
			),
		/PATH_DENIED/,
	);
	assert.deepEqual(
		readFileSync(join(subdirectory + ".saved", "result.docx")),
		old,
	);
	assert(!existsSync(join(subdirectory + ".redirect", "result.docx")));
	const linked = join(root, "linked");
	symlinkSync(
		project,
		linked,
		process.platform === "win32" ? "junction" : "dir",
	);
	await assert.rejects(
		() =>
			dispatchDocx(
				{
					command: "beautify",
					input: join(linked, "source.docx"),
					output,
					dryRun: false,
					force: true,
				},
				{ project, instance: "fixture" },
			),
		/PATH_DENIED/,
	);
	console.log(
		"Adversarial locked fixtures: input/style/lock drift, wrong invocation, artifact tampering, crash, undeclared output, cancellation, concurrent output and symlink rejection passed",
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}
