// Workers-profile composition root. Deliberately a SEPARATE file from
// `app.ts` (the Node/container composition root), not a branch inside it
// — `app.ts` reaches `@bandlib/mail/smtp` via a dynamic `import()` that
// Vite/Rollup still traces into the module graph for chunking purposes
// even though it's runtime-unreachable on Workers (the Workers profile
// always calls `initWorkersRuntime`, which never touches that branch),
// which put a whole extra chunk of nodemailer (and its `node:dns`,
// `node:net`, `node:tls`, ... imports) into the built `_worker.js` output.
// Physically separating the two composition roots is what keeps that
// entirely out of the Workers bundle: `astro.config.mjs` aliases
// `server/app.js` to THIS file only when `BANDLIB_ADAPTER=cloudflare`, so
// `app.ts` (and everything it reaches, including the SMTP branch) is never
// even parsed for that build. `pages/api/[...path].ts`, `middleware.ts`,
// and every Astro page still just import `../.../server/app.js` — the
// alias is what decides which physical file that resolves to; see
// `astro.config.mjs`'s comment on the alias for why a plain Vite config
// (as Vitest uses) never applies it, so the Node/`vitest run` path is
// completely unaffected by this file's existence.
import { type AppDeps, createApp } from "@bandlib/api";
import { type AuthDeps, createInMemoryRateLimiter, systemClock } from "@bandlib/core";
import { createD1Db } from "@bandlib/db";
import { createHttpMailer } from "@bandlib/mail";
import { createS3Storage } from "@bandlib/storage";
import {
  type CloudflareEnv,
  type WorkersRuntimeConfig,
  loadWorkersConfig,
} from "./config.worker.js";

type ApiApp = ReturnType<typeof createApp>;

interface Runtime {
  config: WorkersRuntimeConfig;
  deps: AppDeps;
  authDeps: AuthDeps;
  app: ApiApp;
}

let runtimePromise: Promise<Runtime> | undefined;

/**
 * D1 (via the `DB` binding, `@bandlib/db`'s `createD1Db` — the whole
 * point of the narrow `Db` seam, see `packages/db/src/client.ts`'s doc
 * comment) instead of libSQL, and `@bandlib/mail`'s `createHttpMailer`
 * (Resend/Postmark over `fetch`) instead of SMTP, which Workers cannot
 * speak at all (no TCP sockets). `S3Storage` needs zero changes — it was
 * already `fetch`-only.
 *
 * `enableDeferredMailSend: true` — see `AuthRouteDeps` in `@bandlib/api`'s
 * `routes/auth.ts` — is what lets `POST /auth/login` schedule the
 * login-link send via `c.executionCtx.waitUntil` instead of awaiting it
 * inline, closing the login-timing side channel properly rather than
 * relying solely on the (still-applied) floor. The Astro-native `/login`
 * page wires its own equivalent per-request in `login/index.astro`, since
 * Astro pages get `Astro.locals.runtime.ctx` directly rather than through
 * a Hono `Context`.
 */
async function buildWorkersRuntime(env: CloudflareEnv): Promise<Runtime> {
  const config = loadWorkersConfig(env);
  const db = createD1Db(env.DB);
  const clock = systemClock;
  const rateLimiter = createInMemoryRateLimiter(clock);
  const mailer = createHttpMailer(config.mail);
  const storage = createS3Storage({
    endpoint: config.s3.endpoint,
    publicEndpoint: config.s3.publicEndpoint,
    bucket: config.s3.bucket,
    region: config.s3.region,
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
    clock,
  });

  const deps: AppDeps = {
    db,
    mailer,
    clock,
    rateLimiter,
    storage,
    config: {
      appOrigin: config.appOrigin,
      bootstrapToken: config.bootstrapToken,
      cookieSecure: config.cookieSecure,
      trustedProxyDepth: config.trustedProxyDepth,
      enableDeferredMailSend: true,
    },
  };
  const authDeps: AuthDeps = {
    db,
    mailer,
    clock,
    bootstrapToken: config.bootstrapToken,
  };
  const app = createApp(deps);
  return { config, deps, authDeps, app };
}

/**
 * Memoized once per isolate. `initWorkersRuntime` (called from
 * `middleware.ts`, which runs before every route including the `/api/*`
 * mount) must win the race to populate this — it's a no-op once
 * `runtimePromise` is already set, so the first request into a fresh
 * isolate builds the runtime and every request after that (same isolate,
 * same binding set — bindings don't change request-to-request) reuses it.
 */
function getRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    throw new Error(
      "getRuntime() called before initWorkersRuntime() — middleware.ts must call " +
        "initWorkersRuntime(locals.runtime.env) before any getAppDeps/getAuthDeps/getApiApp call.",
    );
  }
  return runtimePromise;
}

/** Call once per request, before any `getAppDeps`/`getAuthDeps`/`getApiApp`. No-op after the first call. */
export function initWorkersRuntime(env: CloudflareEnv): void {
  if (!runtimePromise) {
    runtimePromise = buildWorkersRuntime(env);
  }
}

/** The shared Hono app — used by the `/api/*` catch-all route. */
export async function getApiApp(): Promise<ApiApp> {
  return (await getRuntime()).app;
}

/** The shared `AppDeps` — `db`, `mailer`, `clock`, `rateLimiter`, `storage`, `config`. */
export async function getAppDeps(): Promise<AppDeps> {
  return (await getRuntime()).deps;
}

/**
 * The shared `AuthDeps` — used by Astro page handlers that call
 * `@bandlib/core`'s auth services directly, rather than round-tripping
 * through HTTP for their own server-rendered, no-JS-friendly forms.
 */
export async function getAuthDeps(): Promise<AuthDeps> {
  return (await getRuntime()).authDeps;
}

/** Test-only: forget the memoized runtime so a test can rebuild it. */
export function resetRuntimeForTesting(): void {
  runtimePromise = undefined;
}
