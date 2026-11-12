/** Bounded read-only runtime identity check at an actual dependency consumption point. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export async function liveObservationVersions(checks: any[]) {
  if (!Array.isArray(checks) || checks.length > 32) throw Error("LIVE_PROBE_LIMIT");
  for (const c of checks) {
    const url = new URL(c.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error("LIVE_PROBE_URL");
    const headers: Record<string, string> = {};
    for (const [name, env] of Object.entries(c.header_variables || {})) {
      if (typeof env !== "string" || process.env[env] === undefined) throw Error("LIVE_PROBE_AUTH");
      headers[name] = process.env[env]!;
    }
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(3000), redirect: "error" });
    const text = await r.text();
    if (r.status !== 200 || Buffer.byteLength(text) > 65536) throw Error("LIVE_PROBE_RESPONSE");
    const body = JSON.parse(text);
    if (Object.entries(c.expected).some(([k, v]) => JSON.stringify(body[k]) !== JSON.stringify(v)))
      throw Error("LIVE_DEPENDENCY_VERSION_CHANGED");
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let text = "";
    for await (const b of process.stdin) {
      text += b;
      if (text.length > 65536) throw Error("LIVE_PROBE_INPUT_LIMIT");
    }
    await liveObservationVersions(JSON.parse(text));
    console.log('{"current":true}');
  } catch (e) {
    console.error(String(e));
    process.exitCode = 2;
  }
}
