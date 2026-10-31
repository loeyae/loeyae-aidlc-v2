import { spawn, spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const source = fileURLToPath(new URL("..", import.meta.url));
const output = process.env.AIDLC_TEST_OUTPUT
	? resolve(process.env.AIDLC_TEST_OUTPUT)
	: mkdtempSync(join(tmpdir(), "aidlc-core-tests-"));
mkdirSync(output, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "aidlc-test-checkout-"));
// Preserve historical compatibility inputs without sharing writable objects or
// source refs. A fresh git init silently made historical comparisons skip even
// when their commits were available in the source checkout.
const sourceGit = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: source, encoding: "utf8" });
const historyCopied = sourceGit.status === 0;
if (historyCopied) {
	const clone = spawnSync("git", ["clone", "--no-hardlinks", "--no-checkout", source, root], { encoding: "utf8" });
	if (clone.status !== 0) throw new Error(`isolated history clone failed: ${clone.stderr}`);
}
for (const name of [
	"bin",
	"core",
	"harness",
	"scripts",
	"tests",
	"docs",
	"dist",
	"package.json",
	"package-lock.json",
	"tsconfig.json",
	"README.md",
	"CHANGELOG.md",
	".gitignore",
	".gitattributes",
]) {
	if (existsSync(join(source, name)))
		cpSync(join(source, name), join(root, name), { recursive: true });
}
// npm pack deliberately excludes linked dependencies. A material copy both
// isolates package mutations and exercises the actual bundled runtime.
cpSync(join(source, "node_modules"), join(root, "node_modules"), { recursive: true });
const git = (...args) => {
	const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	if (r.status !== 0) throw new Error(r.stderr);
};
if (historyCopied) {
	// Change only refs: checking out HEAD here could overwrite the dirty source
	// files just copied above or resurrect files deleted in the source workspace.
	git("update-ref", "refs/heads/codex/test-snapshot", sourceGit.stdout.trim());
	git("symbolic-ref", "HEAD", "refs/heads/codex/test-snapshot");
} else git("init", "-q", "-b", "codex/test-snapshot");
git("add", ".");
git(
	"-c",
	"user.name=AI-DLC tests",
	"-c",
	"user.email=tests@example.invalid",
	"commit",
	"-qm",
	"isolated current source snapshot",
);
const commands = JSON.parse(
	readFileSync(join(root, "scripts/core-test-suites.json"), "utf8"),
);
const results = Array(commands.length).fill(null);
let distributionBuild;
const env = {
	...process.env,
	AIDLC_TEST_OUTPUT: output,
	AIDLC_ONLY: "",
	AIDLC_MARS168_BASELINE_ROOT: "",
	AIDLC_TSX: join(root, "node_modules/tsx/dist/cli.mjs"),
	AIDLC_EXPORT_PROJECT: "",
	AIDLC_EXPORT_HOST_PROVIDER: "",
	AIDLC_DOCX_PROJECT: "",
	AIDLC_DOCX_HOST_PROVIDER: "",
};
// Remove inherited ownership entirely. An empty inherited key would overwrite
// the explicit fixture binding in legacy environment-composition helpers.
delete env.AIDLC_SESSION_BINDING;
function save() {
	writeFileSync(
		join(output, "results.json"),
		JSON.stringify(
			{
				source,
				isolated_checkout: root,
				history_mode: historyCopied ? "isolated_material_clone" : "snapshot_only_no_source_history",
				distribution_build: distributionBuild,
				results,
			},
			null,
			2,
		),
	);
}
async function execute(command, index, label) {
	const [tool, ...parameters] = command;
	const args =
		tool === "tsx"
			? [join(root, "node_modules/tsx/dist/cli.mjs"), ...parameters]
			: tool === "tsc"
				? [join(root, "node_modules/typescript/bin/tsc"), ...parameters]
				: [...parameters];
	if (parameters[0] === "scripts/test-providers.mjs")
		args.push("--output", join(output, "provider-local"));
	const name =
		label ||
		parameters
			.find((arg) => /\.(?:ts|py|mjs)$/.test(arg))
			?.split("/")
			.at(-1) ||
		tool;
	const log = `${index}-${name}.log`;
	writeFileSync(join(output, log), "");
	console.log(`RUN ${name}`);
	const started = Date.now();
	return await new Promise((done) => {
		let content = "";
		let timedOut = false;
		const child = spawn(process.execPath, args, {
			cwd: root,
			env,
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const terminate = () => {
			if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
			if (process.platform === "win32") {
				const stopped = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { encoding: "utf8" });
				if (stopped.status !== 0) child.kill("SIGKILL");
			} else {
				try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") child.kill("SIGKILL"); }
			}
		};
		const deadline = setTimeout(() => { timedOut = true; content += "\nTest command exceeded the 30 minute limit; terminating its process tree.\n"; terminate(); }, 30 * 60 * 1000);
		const collect = (b) => {
			content += b;
			if (content.length > 64 * 1024 * 1024) terminate();
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		child.on("error", (e) => {
			content += String(e);
		});
		child.on("close", (code, signal) => {
			clearTimeout(deadline);
			writeFileSync(join(output, log), content);
			const result = {
				command: [process.execPath, ...args],
				exit_code: timedOut ? 1 : code,
				raw_exit_code: code,
				timed_out: timedOut,
				signal,
				duration_ms: Date.now() - started,
				log,
			};
			console.log(`${code === 0 && !timedOut ? "PASS" : "FAIL"} ${name}`);
			if (code !== 0 || timedOut) process.stdout.write(content.slice(-3000));
			done(result);
		});
	});
}
// Mutating graph/build/install tasks and package readers have explicit barriers.
const bootstrap = commands
	.map((c, i) => ({ c, i }))
	.filter(({ c }) => c.includes("compile"));
for (const { c, i } of bootstrap) {
	results[i] = await execute(c, i);
	save();
}
distributionBuild = await execute(
	["tsx", "scripts/build.ts", "--all"],
	"initial-build",
	"build-all",
);
save();
const serial = commands
	.map((c, i) => ({ c, i }))
	.filter(({ c }) =>
		c.some((a) =>
			/test_installer_lifecycle\.py$|test_distribution_parity\.ts$|test-package\.mjs$/.test(
				a,
			),
		),
	);
const blocked = new Set([...bootstrap, ...serial].map((e) => e.i));
const independent = commands
	.map((c, i) => ({ c, i }))
	.filter((e) => !blocked.has(e.i));
let cursor = 0;
await Promise.all(
	Array.from({ length: 4 }, async () => {
		while (cursor < independent.length) {
			const { c, i } = independent[cursor++];
			results[i] = await execute(c, i);
			save();
		}
	}),
);
for (const { c, i } of serial) {
	if (c.some((a) => /test_distribution_parity\.ts$/.test(a))) {
		distributionBuild = await execute(
			["tsx", "scripts/build.ts", "--all"],
			"build",
			"build-all",
		);
		save();
	}
	results[i] = await execute(c, i);
	save();
}
console.log(
	`${results.filter((r) => r?.exit_code === 0).length}/${results.length} commands passed; isolated checkout ${root}; logs ${output}`,
);
if (
	results.some((r) => r?.exit_code !== 0) ||
	distributionBuild?.exit_code !== 0
)
	process.exitCode = 1;
