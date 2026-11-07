import { existsSync, lstatSync } from "node:fs";
import path, { resolve } from "node:path";
/** Shared environment for explicitly authorized host code. No restricted-v1 changes. */
export function trustedHostEnvironment(temp: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { TEMP: temp, TMP: temp };
	for (const key of [
		"SystemRoot",
		"WINDIR",
		"SystemDrive",
		"ProgramFiles",
		"ProgramFiles(x86)",
		"LOCALAPPDATA",
		"APPDATA",
		"USERPROFILE",
	]) {
		if (process.env[key]) env[key] = process.env[key];
	}
	return env;
}

import { spawn } from "node:child_process";
/** IPC cancellation lets the reviewed adapter close only its owned browser before hard termination. */
export async function runTrustedHost(
	entrypoint: string,
	cwd: string,
	input: string,
	timeout: number,
) {
	return await new Promise<{ stdout: string; stderr: string }>(
		(resolve, reject) => {
			const child = spawn(process.execPath, [entrypoint], {
				cwd,
				env: trustedHostEnvironment(cwd),
				shell: false,
				windowsHide: true,
				stdio: ["pipe", "pipe", "pipe", "ipc"],
			});
			let stdout = "",
				stderr = "",
				size = 0,
				failure: Error | undefined,
				grace: ReturnType<typeof setTimeout> | undefined;
			const cancel = (error: Error) => {
				if (failure) return;
				failure = error;
				if (child.connected) child.send({ cancel: true }, () => {});
				grace = setTimeout(() => child.kill(), 5000);
			};
			const timer = setTimeout(
				() => cancel(new Error("EXPORT_TIMEOUT")),
				timeout,
			);
			const collect = (chunk: string, output: boolean) => {
				size += Buffer.byteLength(chunk);
				if (size > 192 * 1024 * 1024) {
					cancel(new Error("EXPORT_OUTPUT_LIMIT"));
					return;
				}
				if (output) stdout += chunk;
				else stderr += chunk;
			};
			child.stdout!.setEncoding("utf8").on("data", (b) => collect(b, true));
			child.stderr!.setEncoding("utf8").on("data", (b) => collect(b, false));
			child.stdin!.on("error", () => {});
			child.on("error", (e) => {
				failure = e;
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				if (grace) clearTimeout(grace);
				if (failure) reject(failure);
				else if (code !== 0)
					reject(
						new Error(
							`EXPORT_PROVIDER_FAILED: ${stderr.slice(0, 1000).trim() || "host execution failed"}`,
						),
					);
				else resolve({ stdout, stderr });
			});
			child.stdin!.end(input);
		},
	);
}

const BROWSER_CANDIDATES =
	process.platform === "darwin"
		? [
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
				"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
				"/Applications/Chromium.app/Contents/MacOS/Chromium",
			]
		: process.platform === "win32"
			? [
					"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
					"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
					"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
					"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
				]
			: [
					"/usr/bin/google-chrome",
					"/usr/bin/google-chrome-stable",
					"/usr/bin/chromium",
					"/usr/bin/chromium-browser",
					"/usr/bin/microsoft-edge",
				];

function commandOnPath(command: string): string | undefined {
	const extensions =
		process.platform === "win32"
			? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];
	for (const directory of (process.env.PATH || "")
		.split(path.delimiter)
		.filter(Boolean)) {
		for (const extension of extensions) {
			const candidate = resolve(directory, `${command}${extension}`);
			if (existsSync(candidate) && lstatSync(candidate).isFile())
				return candidate;
		}
	}
	return undefined;
}

export function findBrowser(configured?: string): string | undefined {
	const explicit =
		configured || process.env.AIDLC_CHROME_BIN || process.env.CHROME_BIN;
	if (explicit) {
		const resolved = existsSync(explicit)
			? resolve(explicit)
			: commandOnPath(explicit);
		if (!resolved)
			throw new Error(`configured browser executable not found: ${explicit}`);
		return resolved;
	}
	for (const name of [
		"google-chrome",
		"google-chrome-stable",
		"chromium",
		"chromium-browser",
		"microsoft-edge",
		"msedge",
	]) {
		const found = commandOnPath(name);
		if (found) return found;
	}
	return BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
}
