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

/**
 * The only route in this app that carries a secret in its own path: the
 * single-use sign-in link, both as the Astro page (`/login/[token].astro`
 * → `/login/<token>`) and as the API route it POSTs to
 * (`/auth/login/:token` → `/auth/login/<token>`, forwarded without an
 * `/api` prefix — see `pages/api/[...path].ts`). Every other dynamic
 * segment in this app (`/songs/[slug]`, `/takes/[id]`, `/admin/tokens/:id`,
 * ...) names a resource by an opaque id or slug, not a bearer credential —
 * grepped for `token`/`invite`/`unsubscribe`-style route params across
 * `apps/web/src/pages` and `packages/api/src/routes` to confirm this is the
 * only one.
 */
const TOKEN_SEGMENT = "login";
const REDACTED_TOKEN = ":token";

export interface LogErrorInput {
  /** What kind of failure this is, e.g. "page", "api", "scheduled-tick". */
  kind: string;
  /**
   * Request path, for a page/API failure. Sanitized before it reaches the
   * output record — see `sanitizeRoute` — so pass the raw
   * `context.url.pathname`/`c.req.path` and don't pre-scrub it yourself.
   */
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

/**
 * Strips anything a `route` could leak a secret through before it's ever
 * allowed into `ErrorLogRecord`: the query string (dropped entirely — a
 * bootstrap token, a redirect target, anything) and, path-segment-wise,
 * whatever immediately follows a `login` segment (the sign-in token itself,
 * for both the Astro page and the API route — see `TOKEN_SEGMENT`'s doc
 * comment). Applied unconditionally inside `buildErrorLogRecord`, not
 * something a caller opts into, so no call site can get this wrong.
 */
function sanitizeRoute(route: string): string {
  const pathOnly = route.split("?")[0] ?? route;
  const segments = pathOnly.split("/");
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === TOKEN_SEGMENT) {
      segments[i + 1] = REDACTED_TOKEN;
    }
  }
  return segments.join("/");
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
    record.route = sanitizeRoute(input.route);
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
