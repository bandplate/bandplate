// Workers-profile composition root. Deliberately a SEPARATE file from
// `app.ts` (the Node/container composition root), not a branch inside it
// — `app.ts` reaches `@bandplate/mail/smtp` via a dynamic `import()` that
// Vite/Rollup still traces into the module graph for chunking purposes
// even though it's runtime-unreachable on Workers (this profile never
// takes that branch), which put a whole extra chunk of nodemailer (and its
// `node:dns`, `node:net`, `node:tls`, ... imports) into the built Worker.
// Physically separating the two composition roots is what keeps that
// entirely out of the Workers bundle: `astro.config.mjs` aliases
// `server/app.js` to THIS file only when `BANDPLATE_ADAPTER=cloudflare`, so
// `app.ts` (and everything it reaches, including the SMTP branch) is never
// even parsed for that build. `pages/api/[...path].ts`, `middleware.ts`,
// and every Astro page still just import `../.../server/app.js` — the
// alias is what decides which physical file that resolves to; see
// `astro.config.mjs`'s comment on the alias for why a plain Vite config
// (as Vitest uses) never applies it, so the Node/`vitest run` path is
// completely unaffected by this file's existence.

import { env } from "cloudflare:workers";
import { type AppDeps, createApp } from "@bandplate/api";
import {
  type AuthDeps,
  createInMemoryRateLimiter,
  type NotificationTickDeps,
  systemClock,
} from "@bandplate/core";
import { createD1Db } from "@bandplate/db";
import { createHttpMailer } from "@bandplate/mail";
import { createWebPushSender, vapidKeyId } from "@bandplate/push";
import { createS3Storage } from "@bandplate/storage";
import {
  type CloudflareEnv,
  loadWorkersConfig,
  type WorkersRuntimeConfig,
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
 * D1 (via the `DB` binding, `@bandplate/db`'s `createD1Db` — the whole
 * point of the narrow `Db` seam, see `packages/db/src/client.ts`'s doc
 * comment) instead of libSQL, and `@bandplate/mail`'s `createHttpMailer`
 * (Resend/Postmark over `fetch`) instead of SMTP, which Workers cannot
 * speak at all (no TCP sockets). `S3Storage` needs zero changes — it was
 * already `fetch`-only.
 *
 * `enableDeferredMailSend: true` — see `AuthRouteDeps` in `@bandplate/api`'s
 * `routes/auth.ts` — is what lets `POST /auth/login` schedule the
 * login-link send via `c.executionCtx.waitUntil` instead of awaiting it
 * inline, closing the login-timing side channel properly rather than
 * relying solely on the (still-applied) floor. The Astro-native `/login`
 * page wires its own equivalent per-request in `login/index.astro`, since
 * Astro pages get `Astro.locals.cfContext` directly rather than through
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
      push: config.push
        ? { publicKey: config.push.publicKey, keyId: vapidKeyId(config.push.publicKey) }
        : undefined,
    },
  };
  const authDeps: AuthDeps = {
    db,
    mailer,
    clock,
    bootstrapToken: config.bootstrapToken,
    // Only `bootstrapAdmin`'s confirmation email uses this — it is the one
    // message with no link of its own to take an origin from.
    appOrigin: config.appOrigin,
    // Same as the Node profile — see `AuthDeps.onLoginRequest`. On Workers
    // this reaches `wrangler tail` rather than a terminal, which is the only
    // place an operator can see which of the two outcomes happened.
    onLoginRequest: (email, outcome) => {
      console.log(
        outcome === "sent"
          ? `[login] link sent to ${email}`
          : `[login] no link sent — ${email} is not an active member (the page says the same either way)`,
      );
    },
  };
  const app = createApp(deps);
  return { config, deps, authDeps, app };
}

/**
 * Memoized once per isolate. `env` is `cloudflare:workers`'s module-level
 * binding object (the replacement, since `@astrojs/cloudflare` 13, for the
 * per-request `locals.runtime.env`): the same bindings for every request and
 * every cron trigger in the isolate, so whichever arrives first builds the
 * runtime and everything after reuses it. A `ConfigError` from invalid vars
 * rejects this promise and every caller sees it, same as before.
 */
function getRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = buildWorkersRuntime(env);
  }
  return runtimePromise;
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
 * The subset of `WorkersRuntimeConfig` safe to reach from a page — see
 * `app.ts`'s `WebConfig` for why `push` is narrowed down to just
 * `publicKey` (the private key must never round-trip through a page).
 */
export interface WebConfig extends Omit<WorkersRuntimeConfig, "push"> {
  push?: { publicKey: string };
}

/**
 * The whole validated deployment config, for settings that are not the API
 * app's business — `BANDPLATE_DEFAULT_LOCALE` today. Must stay in step with
 * `app.ts`'s export of the same name: `astro.config.mjs` aliases this file in
 * for the Workers build, so a name missing here typechecks fine and fails the
 * Cloudflare build instead.
 */
export async function getWebConfig(): Promise<WebConfig> {
  const { config } = await getRuntime();
  return {
    ...config,
    push: config.push ? { publicKey: config.push.publicKey } : undefined,
  };
}

/**
 * Dependencies for `@bandplate/core`'s `runNotificationTick` — same shape as
 * `app.ts`'s export of the same name (see its doc comment); this profile's
 * scheduled handler (`server/scheduled.ts`, a later increment) is what calls
 * it. `undefined` when push isn't configured.
 */
export async function getNotificationDeps(): Promise<NotificationTickDeps | undefined> {
  const { config, deps } = await getRuntime();
  if (!config.push) {
    return undefined;
  }
  return {
    db: deps.db,
    clock: deps.clock,
    push: createWebPushSender(config.push),
    vapidKeyId: vapidKeyId(config.push.publicKey),
  };
}

/**
 * The shared `AuthDeps` — used by Astro page handlers that call
 * `@bandplate/core`'s auth services directly, rather than round-tripping
 * through HTTP for their own server-rendered, no-JS-friendly forms.
 */
export async function getAuthDeps(): Promise<AuthDeps> {
  return (await getRuntime()).authDeps;
}

/** Test-only: forget the memoized runtime so a test can rebuild it. */
export function resetRuntimeForTesting(): void {
  runtimePromise = undefined;
}
