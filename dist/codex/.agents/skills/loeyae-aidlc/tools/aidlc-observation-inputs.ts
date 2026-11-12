/** P1-07 shared candidate, assertion and evidence validation; no workflow mutation. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import {
  autonomyDigest as digest,
  canonicalAutonomyJson as json,
  safeFile,
  object,
  array,
  string,
  unique,
} from "./aidlc-autonomy-files";
import { readObservationReport, readIssuedGrant, admissionEnvironment, validateGrantInputs } from "./aidlc-grant-store";
import { semanticCheckerDigest } from "./aidlc-checker-identity";
import { decodeBoundedPng } from "./aidlc-mcp-image";
import { assertProposalIsolation } from './aidlc-execution-inputs';
type Row = Record<string, any>;
export const observationHash = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
export function observationCheckerDigest() {
  return digest({
    core: semanticCheckerDigest(true),
    producer: [
      "aidlc-observation-inputs.ts",
      "aidlc-observations.ts",
      "aidlc-observation-browser.ts",
      "aidlc-browser-session.ts",
      "aidlc-observation-service.ts",
      "aidlc-observation-live.ts",
      "aidlc-mcp-image.ts",
      "aidlc-owned-resource.cjs",
      "data/native-host-action-policy.json",
    ].map((p) => observationHash(readFileSync(new URL(p, import.meta.url)))),
  });
}
function git(root: string, args: string[], binary = false): any {
  const r = spawnSync("git", args, {
    cwd: root,
    encoding: binary ? undefined : "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10000,
    windowsHide: true,
  });
  if (r.status !== 0 || r.error) throw Error("OBSERVATION_GIT_FAILED");
  return binary ? r.stdout : String(r.stdout).trim();
}
export function candidateSnapshot(root: string, paths: string[], allowDirtyContext = false): Row {
  assertProposalIsolation(root);
  const status = String(git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], true));
  // Control/evidence files never become candidate source. All business dirt is rejected.
  const dirty = status
    .split("\0")
    .filter(Boolean)
    .some((s) => !/^((?:\.aidlc|aidlc)\/)/.test(s.slice(3)));
  if (dirty && !allowDirtyContext) throw Error("CANDIDATE_DIRTY: commit the isolated candidate before observation");
  const commit = git(root, ["rev-parse", "HEAD"]),
    tree = git(root, ["ls-tree", "-r", "-z", "HEAD"], true);
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw Error("CANDIDATE_COMMIT_INVALID");
  const artifacts = unique(paths, (p) => p, "candidate paths").map((p) => {
    safeFile(root, p);
    git(root, ["ls-files", "--error-unmatch", "--", p]);
    return {
      repository_id: "project",
      path: p,
      digest_mode: "raw-file",
      digest: observationHash(readFileSync(safeFile(root, p))),
    };
  });
  if (!artifacts.length) throw Error("CANDIDATE_ARTIFACTS_REQUIRED");
  const repositories = [
    { repository_id: "project", commit, tree_digest: observationHash(tree), dirty, relevant_inputs: artifacts },
  ];
  return { candidate_id: digest({ repositories, artifacts }), repositories, artifacts };
}
export function assertCandidate(root: string, candidate: Row, allowDirtyContext = false) {
  const now = candidateSnapshot(
    root,
    candidate.artifacts.map((a: Row) => a.path),
    allowDirtyContext,
  );
  if (json(now) !== json(candidate)) throw Error("CANDIDATE_CHANGED");
}
export function assertions(spec: unknown, data: unknown): Row[] {
  return unique(
    array(spec, "assertions", true).map((v) => {
      const a = object(v, "assertion", ["assertion_id", "pointer", "op", "expected"]);
      string(a.assertion_id, "assertion_id");
      const p = string(a.pointer, "JSON pointer");
      if (!p.startsWith("/") || p.split("/").some((x) => ["__proto__", "constructor", "prototype"].includes(x)))
        throw Error("ASSERTION_POINTER_INVALID");
      if (!["equal", "length", "includes", "ordered-by"].includes(String(a.op)) || a.expected === undefined)
        throw Error("ASSERTION_SCHEMA_INVALID");
      let actual: any = data;
      for (const token of p.slice(1).split("/")) {
        const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
        actual = actual && typeof actual === "object" && Object.hasOwn(actual, key) ? actual[key] : undefined;
      }
      let passed = false;
      if (a.op === "equal") passed = actual !== undefined && json(actual) === json(a.expected);
      if (a.op === "length") passed = Array.isArray(actual) && actual.length === a.expected;
      if (a.op === "includes")
        passed =
          (typeof actual === "string" && typeof a.expected === "string" && actual.includes(a.expected)) ||
          (Array.isArray(actual) && actual.some((x) => json(x) === json(a.expected)));
      if (a.op === "ordered-by") {
        const keys = array(a.expected, "order fields", true).map((k) => string(k, "order field"));
        passed =
          Array.isArray(actual) &&
          actual.every(
            (r) =>
              r &&
              keys.every(
                (k) =>
                  Object.hasOwn(r, k) &&
                  ["string", "number"].includes(typeof r[k]) &&
                  typeof r[k] === typeof actual[0][k],
              ),
          ) &&
          actual.every(
            (r, i) =>
              i === 0 ||
              keys.reduce((c, k) => c || (actual[i - 1][k] < r[k] ? -1 : actual[i - 1][k] > r[k] ? 1 : 0), 0) <= 0,
          );
      }
      return { ...a, actual: actual === undefined ? null : actual, missing: actual === undefined, passed };
    }),
    (r) => (r as Row).assertion_id,
    "assertions",
  );
}
function rgba(bytes: Buffer) {
  decodeBoundedPng(
    { type: "image", mimeType: "image/png", data: bytes.toString("base64") },
    8 * 1024 * 1024,
    4_000_000,
  );
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20),
    channels: number = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as any)[bytes[25]],
    chunks: Buffer[] = [];
  for (let p = 8; p < bytes.length; ) {
    const size = bytes.readUInt32BE(p);
    if (bytes.toString("ascii", p + 4, p + 8) === "IDAT") chunks.push(bytes.subarray(p + 8, p + 8 + size));
    p += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)),
    stride = width * channels,
    out = Buffer.alloc(stride * height);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      da = Math.abs(p - a),
      db = Math.abs(p - b),
      dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0,
        b = y ? out[(y - 1) * stride + x] : 0,
        c = y && x >= channels ? out[(y - 1) * stride + x - channels] : 0;
      out[y * stride + x] =
        (raw[y * (stride + 1) + 1 + x] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][f]) & 255;
    }
  }
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = i * channels;
    pixels[i * 4] = out[p];
    pixels[i * 4 + 1] = channels <= 2 ? out[p] : out[p + 1];
    pixels[i * 4 + 2] = channels <= 2 ? out[p] : out[p + 2];
    pixels[i * 4 + 3] = channels === 2 ? out[p + 1] : channels === 4 ? out[p + 3] : 255;
  }
  return { width, height, pixels };
}
export function compareScreenshots(baseline: Buffer, actual: Buffer, tolerance: Row) {
  object(tolerance, "visual tolerance", ["pixel_delta", "max_diff_ratio", "regions"]);
  const limits = (r: Row) => {
    if (
      !Number.isInteger(r.pixel_delta) ||
      r.pixel_delta < 0 ||
      r.pixel_delta > 32 ||
      typeof r.max_diff_ratio !== "number" ||
      !Number.isFinite(r.max_diff_ratio) ||
      r.max_diff_ratio < 0 ||
      r.max_diff_ratio > 0.1
    )
      throw Error("VISUAL_TOLERANCE_INVALID");
  };
  limits(tolerance);
  const a = rgba(baseline),
    b = rgba(actual);
  if (a.width !== b.width || a.height !== b.height) throw Error("SCREENSHOT_VIEWPORT_MISMATCH");
  const measure = (rect: Row, rule: Row) => {
    let changed = 0,
      minX = a.width,
      minY = a.height,
      maxX = -1,
      maxY = -1;
    for (let y = rect.y; y < rect.y + rect.height; y++)
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const p = (y * a.width + x) * 4;
        if ([0, 1, 2, 3].some((k) => Math.abs(a.pixels[p + k] - b.pixels[p + k]) > rule.pixel_delta)) {
          changed++;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    const ratio = changed / (rect.width * rect.height);
    return {
      rect,
      changed_pixels: changed,
      diff_ratio: ratio,
      diff_bounds: changed ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
      passed: ratio <= rule.max_diff_ratio,
    };
  };
  const regions = unique(
    array(tolerance.regions, "critical visual regions", true).map((v) => {
      const r = object(v, "visual region", ["region_id", "rect", "pixel_delta", "max_diff_ratio"]);
      string(r.region_id, "region_id");
      limits(r);
      const rect = object(r.rect, "region rect", ["x", "y", "width", "height"]);
      if (
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger) ||
        Number(rect.x) < 0 ||
        Number(rect.y) < 0 ||
        Number(rect.width) <= 0 ||
        Number(rect.height) <= 0 ||
        Number(rect.x) + Number(rect.width) > a.width ||
        Number(rect.y) + Number(rect.height) > a.height
      )
        throw Error("VISUAL_REGION_INVALID");
      return { region_id: r.region_id, ...measure(rect, r) };
    }),
    (r) => String(r.region_id),
    "critical regions",
  );
  const whole = measure({ x: 0, y: 0, width: a.width, height: a.height }, tolerance);
  return {
    width: a.width,
    height: a.height,
    ...whole,
    tolerance,
    regions,
    passed: whole.passed && regions.every((r) => r.passed),
  };
}
export function currentObservations(root: string, global: any): Row {
  const report = readObservationReport(root, global);
  if(report.resource_reconciliation?.reconciled===false)throw Error('OBSERVATION_RESOURCES_UNRECONCILED');
  const now = Date.now();
  if (
    report.checker_digest !== observationCheckerDigest() ||
    now < Date.parse(report.started_at) ||
    now >= Date.parse(report.valid_until)
  )
    throw Error("OBSERVATION_STALE");
  if (
    json(report.batch_ref) !== json(global.autonomy_batch) ||
    json(report.grant_ref) !== json(global.execution_grant_ref)
  )
    throw Error("OBSERVATION_SCOPE_CHANGED");
  const { grant, revoked } = readIssuedGrant(root, global.execution_grant_ref);
  if (revoked || now >= Date.parse(grant.expires_at)) throw Error("OBSERVATION_GRANT_EXPIRED_OR_REVOKED");
  validateGrantInputs(root, grant.inputs);
  if (
    report.workflow_id !== global.workflow_id ||
    report.producer?.name !== "loeyae-aidlc-observations" ||
    report.producer?.mode !== "controlled" ||
    !Array.isArray(report.observations) ||
    !report.observations.length ||
    !["matrix", "dependency-preflight"].includes(report.coverage) ||
    report.status !==
      (report.observations.every((o: Row) => o.status === "passed")
        ? report.coverage === "matrix"
          ? "passed"
          : "partial"
        : "failed") ||
    (report.coverage === "dependency-preflight" &&
      report.observations.some((o: Row) => o.kind !== "http" || !o.dependency_binding?.provider.external_id)) ||
    report.observations.some(
      (o: Row) =>
        json(o.candidate_ref) !== json(report.candidate_ref) ||
        json(o.environment_ref) !== json(report.environment_ref) ||
        !report.raw_refs.some((r: Row) => json(r) === json(o.raw_output_ref)),
    )
  )
    throw Error("OBSERVATION_PRODUCER_OR_RESULT_BINDING_INVALID");
  // External preflight binds immutable capability/source inputs and the external
  // serving version. Its project candidate is historical context, not a lease on
  // future consumer implementation or a full-matrix acceptance result.
  if (report.coverage === "matrix") assertCandidate(root, report.candidate_ref);
  for (const ref of [...report.source_refs, ...report.raw_refs])
    if (observationHash(readFileSync(safeFile(root, ref.path))) !== ref.digest)
      throw Error("OBSERVATION_INPUT_OR_ARTIFACT_CHANGED: " + ref.path);
  if (json(report.environment_binding) !== json(admissionEnvironment(report.environment_variables, report.executables)))
    throw Error("OBSERVATION_ENVIRONMENT_CHANGED");
  return report;
}
