// Structured error logging, shared by every runtime this app ships on —
// Cloudflare Workers and Node. Lives here (not in `apps/web`) because
// `@bandplate/api`'s own `onError` needs it too, and `packages/api` cannot
// depend on `apps/web` (the dependency runs the other way — see
// `barrel-is-workers-safe.test.ts` for the same "no node:* import" rule
// this file follows for the same reason: it must bundle clean for Workers).
//
// One `console.error` call per failure event, one JSON string argument —
// that is the whole contract `logError` exists to make impossible to get
// wrong at each of the many call sites that used to hand-roll their own
// `console.error("some prefix", ...context)`.
//
// The record is built field-by-field from an explicit allow-list rather
// than spreading the input — that is what makes "never logs a cookie or an
// authorization header" true by construction. A caller cannot leak
// `req.headers` into the log by accident: there is no field for it to land
// in, however it's named, and whatever else the input object happens to
// carry is silently dropped rather than serialized.

/** Bytes, not characters — matches how a log collector bills/truncates. */
const STACK_MAX_BYTES = 2048;
const TRUNCATION_SUFFIX = "\n…[truncated]";

export interface LogErrorInput {
  /** What kind of failure this is, e.g. "page", "api", "scheduled-tick". */
  kind: string;
  /** Request path, for a page/API failure. */
  route?: string;
  /** Cron pattern, for a scheduled-tick failure (mirrors `wrangler.toml`'s `[triggers] crons`). */
  cron?: string;
  /**
   * Human-readable summary. Fold in any identifying context an operator
   * would need (an id, a storage key) — `message` is the only free-text
   * field, so that is where it belongs; there is no separate "extra"
   * field for it to spread into.
   */
  message: string;
  /** Stack trace, if there was an `Error` to take it from. Truncated to 2 KB. */
  stack?: string;
}

export interface ErrorLogRecord {
  level: "error";
  kind: string;
  route?: string;
  cron?: string;
  message: string;
  stack?: string;
}

function truncateStack(stack: string): string {
  const encoded = new TextEncoder().encode(stack);
  if (encoded.length <= STACK_MAX_BYTES) {
    return stack;
  }
  const suffixBytes = new TextEncoder().encode(TRUNCATION_SUFFIX).length;
  const budget = Math.max(0, STACK_MAX_BYTES - suffixBytes);
  // Slicing raw UTF-8 bytes can land mid-codepoint; TextDecoder's default
  // (non-fatal) mode just emits a replacement character there, which is
  // fine for a log line nobody parses back into a JS string.
  const truncated = new TextDecoder().decode(encoded.slice(0, budget));
  return `${truncated}${TRUNCATION_SUFFIX}`;
}

/**
 * Builds the JSON-serializable record for one failure event. Pure — no
 * `console` call here — so it's the thing under test; `logError` below is
 * the one-line side-effecting wrapper every call site actually uses.
 */
export function buildErrorLogRecord(input: LogErrorInput): ErrorLogRecord {
  const record: ErrorLogRecord = {
    level: "error",
    kind: input.kind,
    message: input.message,
  };
  if (typeof input.route === "string") {
    record.route = input.route;
  }
  if (typeof input.cron === "string") {
    record.cron = input.cron;
  }
  if (typeof input.stack === "string") {
    record.stack = truncateStack(input.stack);
  }
  return record;
}

/**
 * The one `console.error` call for a failure event — exactly one JSON
 * string argument, so Cloudflare Workers Logs (and any Node log collector
 * reading stdout) gets one structured line per event.
 */
export function logError(input: LogErrorInput): void {
  console.error(JSON.stringify(buildErrorLogRecord(input)));
}

/**
 * Pulls a message/stack pair out of an unknown `catch` value, the way
 * every call site used to do inline with `String(err)`. Never throws.
 */
export function describeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}
