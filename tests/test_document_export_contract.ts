/** Standalone export safety cases extracted from the retained production integration suite. */
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

console.log("PASS: export authorization, unsafe SVG and input traversal refusals, existing output protection and stale publication rejection; production renderer not exercised");
rmSync(root,{recursive:true,force:true});
