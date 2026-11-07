/**
 * 4.11.0: one wrapper for every buffered child process of the engine.
 *
 * A buffered spawnSync whose stdout/stderr exceeds `maxBuffer` fails with ENOBUFS; with
 * Node's default (1 MB) a nested repository's `git ls-files` or a long gate report was
 * enough. Every buffered child now gets one generous limit, and an overflow is never
 * folded into another failure: runSync throws SubprocessOverflowError naming the child
 * (argv[0..1], plus the script for `node tsx <script>`) and the limit, and records it so
 * a caller that swallows errors cannot hide it. A child of the engine that overflowed
 * exits non-zero with the marker in its output; runSync re-raises it in the parent, so
 * the overflow surfaces as its own `kind: "error"` at the top of the process tree.
 */
import { spawnSync, type SpawnSyncOptions, type SpawnSyncOptionsWithBufferEncoding, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "child_process";

/** Default output limit of a buffered child process (stdout and stderr each). */
export const DEFAULT_SUBPROCESS_MAX_BUFFER = 64 * 1024 * 1024;
/** Positive integer (bytes) overriding every limit; for diagnosis and tests. */
export const SUBPROCESS_MAX_BUFFER_ENV = "AIDLC_SUBPROCESS_MAX_BUFFER";
/** Marker of an overflow message; also how a parent recognizes an overflowed child. */
export const SUBPROCESS_OVERFLOW_MARKER = "AIDLC_SUBPROCESS_ENOBUFS";

const PROPAGATED = new RegExp(`${SUBPROCESS_OVERFLOW_MARKER}: [^\\n]*?argv=(\\[[^\\n]*?\\]) maxBuffer=(\\d+)`);

/** The child named by an overflow: argv[0..1], and the script of a `node <tsx> <script>` child. */
export function subprocessHead(argv: readonly string[]): string[] {
  const tsx = /[\\/]tsx[\\/]/.test(argv[1] || "");
  return argv.slice(0, tsx ? 3 : 2).map(String);
}

export function subprocessMaxBuffer(): number {
  const raw = process.env[SUBPROCESS_MAX_BUFFER_ENV]?.trim();
  if (raw) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${SUBPROCESS_MAX_BUFFER_ENV} must be a positive integer number of bytes, got ${JSON.stringify(raw)}`);
    return value;
  }
  return DEFAULT_SUBPROCESS_MAX_BUFFER;
}

export class SubprocessOverflowError extends Error {
  readonly argv: string[];
  readonly maxBuffer: number;
  constructor(argv: string[], maxBuffer: number, message?: string) {
    super(message || `${SUBPROCESS_OVERFLOW_MARKER}: subprocess output exceeded its buffer (ENOBUFS) argv=${JSON.stringify(argv)} maxBuffer=${maxBuffer}`);
    this.name = "SubprocessOverflowError";
    this.argv = argv;
    this.maxBuffer = maxBuffer;
  }
}

let recorded: SubprocessOverflowError | null = null;

/** The first overflow of this process, if any (also when a caller swallowed the error). */
export function recordedSubprocessOverflow(): SubprocessOverflowError | null {
  return recorded;
}

/** An overflow message of an engine child found in its output, re-raised in this process. */
export function propagatedOverflow(output: string): SubprocessOverflowError | null {
  // A JSON-printed message escapes the quotes of the argv list.
  const match = PROPAGATED.exec(output.replace(/\\"/g, "\""));
  if (!match) return null;
  let argv: string[];
  try {
    argv = JSON.parse(match[1]) as string[];
  } catch {
    argv = [match[1]];
  }
  return new SubprocessOverflowError(argv, Number(match[2]), match[0]);
}

function raise(error: SubprocessOverflowError): never {
  recorded ??= error;
  throw error;
}

/**
 * spawnSync with string output, the shared output limit and fail-loud ENOBUFS. Other
 * spawn errors and exit codes are returned to the caller unchanged. `propagate: false`
 * leaves an overflow reported by the child in its output to the caller (a pass-through).
 */
export function runSync(command: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding, behaviour?: { propagate?: boolean }): SpawnSyncReturns<string>;
export function runSync(command: string, args: readonly string[], options: SpawnSyncOptionsWithBufferEncoding | SpawnSyncOptions, behaviour?: { propagate?: boolean }): SpawnSyncReturns<Buffer>;
export function runSync(command: string, args: readonly string[], options: SpawnSyncOptions, behaviour: { propagate?: boolean } = {}): SpawnSyncReturns<string | Buffer> {
  const maxBuffer = subprocessMaxBuffer();
  const result = spawnSync(command, args, { ...options, maxBuffer });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOBUFS") {
    raise(new SubprocessOverflowError(subprocessHead([command, ...args]), maxBuffer));
  }
  if (behaviour.propagate !== false && result.status !== 0) {
    const nested = propagatedOverflow(`${String(result.stderr ?? "")}\n${String(result.stdout ?? "")}`);
    if (nested) raise(nested);
  }
  return result;
}

/** The `kind: "error"` directive of an overflow (printed instead of any gate result). */
export function overflowDirective(error: SubprocessOverflowError): { kind: "error"; message: string; subprocess: { argv: string[]; max_buffer: number } } {
  return {
    kind: "error",
    message: `🚫 Subprocess output overflow (ENOBUFS): ${error.argv.join(" ")} exceeded maxBuffer ${error.maxBuffer} bytes. This is an engine failure, not a gate result; raise ${SUBPROCESS_MAX_BUFFER_ENV} or reduce the output, then run the command again.\n${error.message}`,
    subprocess: { argv: error.argv, max_buffer: error.maxBuffer },
  };
}
