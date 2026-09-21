// Composition root (Node/container profile) — builds the one `Db`/
// `Mailer`/`Clock`/`RateLimiter`/`Storage`/`AppDeps`/`AuthDeps` set this
// process uses, memoized so both the JSON API mount
// (`pages/api/[...path].ts`) and the Astro pages (`server/pages/*`) share
// the same database connection and rate-limiter state rather than each
// building their own.
//
// The SMTP mailer (`@bandplate/mail/smtp`, the only Node-dependent module
// outside this composition root) is loaded via a dynamic `import()` inside
// `buildMailer`, not a static top-level import — so a bundler targeting a
// runtime without SMTP configured never has to include nodemailer just
// because this module was imported. See the task-4-report.md verification
// of this.
//
// The Workers profile's composition root is a SEPARATE file,
// `app.workers.ts` — not a branch in this one — specifically so its
// module graph never reaches this file's `import("@bandplate/mail/smtp")`
// at all; see that file's doc comment for why sharing this file would
// have put nodemailer (and its `node:*` imports) into the deployed
// Worker bundle even though the branch is runtime-unreachable there.
// `astro.config.mjs`'s Vite alias is what selects between the two files
// per build — every caller (`middleware.ts`, every Astro page,
// `pages/api/[...path].ts`) imports the same `../.../server/app.js`
// specifier unchanged.
import { type AppDeps, createApp } from "@bandplate/api";
import {
  type AuthDeps,
  type Mailer,
  type NotificationTickDeps,
  createInMemoryRateLimiter,
  describeError,
  logError,
  systemClock,
} from "@bandplate/core";
import { createDb } from "@bandplate/db";
import { createDevMailer } from "@bandplate/mail";
import { createWebPushSender, vapidKeyId } from "@bandplate/push";
import { createS3Storage } from "@bandplate/storage";
import { createClient } from "@libsql/client";
import { type RuntimeConfig, loadConfig } from "./config.js";
import {
  shouldStartNotificationScheduler,
  startNotificationScheduler,
} from "./notification-scheduler.js";

// `ReturnType<typeof createApp>` rather than importing Hono's own `Hono`
// type directly — `hono` is only a transitive dependency here (declared by
// `@bandplate/api`), and apps/web doesn't otherwise need to know its types.
type ApiApp = ReturnType<typeof createApp>;

async function buildMailer(config: RuntimeConfig): Promise<Mailer> {
  if (config.smtp) {
    // Dynamic import: only reached when SMTP is actually configured, and
    // only evaluated the first time this branch runs.
    const { createSmtpMailer } = await import("@bandplate/mail/smtp");
    return createSmtpMailer(config.smtp);
  }
  // `loadConfig` already refuses to produce a config with neither SMTP nor
  // `allowDevMailer` set, so reaching here means dev mode was explicitly
  // requested.
  return createDevMailer("console", { allowDevMailer: config.allowDevMailer });
}

interface Runtime {
  config: RuntimeConfig;
  deps: AppDeps;
  authDeps: AuthDeps;
  app: ApiApp;
}

let runtimePromise: Promise<Runtime> | undefined;

async function buildRuntime(): Promise<Runtime> {
  const config = loadConfig();
  const db = createDb(createClient({ url: config.databaseUrl }));
  const clock = systemClock;
  const rateLimiter = createInMemoryRateLimiter(clock);
  const mailer = await buildMailer(config);
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
    // Wired in every configuration, not just dev — see
    // `AuthDeps.onLoginRequest`. `/login` cannot tell the caller which of
    // these happened without becoming an enumeration oracle, so the operator's
    // log is the only place the difference can appear. Never includes the
    // token or the link.
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
 * Shared by `getNotificationDeps` and the scheduler start-up below — the
 * one place that turns `RuntimeConfig`'s `push` (or its absence) into a
 * `NotificationTickDeps` (or `undefined`).
 */
function toNotificationDeps(
  config: RuntimeConfig,
  deps: AppDeps,
): NotificationTickDeps | undefined {
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
 * Starts the Node scheduler (see `notification-scheduler.ts`) the first
 * time the runtime is built in this process — never at module load, since
 * `RuntimeConfig` (and therefore whether push is even configured) doesn't
 * exist until then. A no-op when push isn't configured, or when an
 * operator has set `BANDPLATE_SCHEDULER=off` — see that env var's own doc
 * in `docs/self-hosting.md`, for running more than one Node replica
 * against the same database without every replica ticking independently.
 *
 * Never throws: called from inside `getRuntime()`'s `.then()`, which
 * populates the MEMOIZED `runtimePromise` every future caller awaits. An
 * uncaught throw here would reject that promise instead of resolving it,
 * permanently wedging `getApiApp`/`getAppDeps`/`getAuthDeps` — i.e. every
 * request for the rest of the process's life — over a scheduler fault that
 * has nothing to do with whether the app itself can serve traffic. Caught
 * and logged instead; a scheduler that fails to start is a missed tick,
 * not a down app.
 */
function maybeStartNotificationScheduler(runtime: Runtime): void {
  try {
    const deps = toNotificationDeps(runtime.config, runtime.deps);
    if (!deps) {
      return;
    }
    if (!shouldStartNotificationScheduler(process.env.BANDPLATE_SCHEDULER)) {
      return;
    }
    startNotificationScheduler(deps);
  } catch (err) {
    const { message, stack } = describeError(err);
    logError({
      kind: "scheduler-start",
      message: `[scheduler] failed to start: ${message}`,
      stack,
    });
  }
}

/**
 * Memoized: the environment is read and the app is built once per process.
 * The notification scheduler (if configured) starts right after that first
 * build resolves — deliberately not from inside `buildRuntime` itself,
 * which would recurse back into this same pending promise via
 * `getNotificationDeps`/`toNotificationDeps` and deadlock.
 */
function getRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = buildRuntime().then((runtime) => {
      maybeStartNotificationScheduler(runtime);
      return runtime;
    });
  }
  return runtimePromise;
}

/**
 * No-op on the Node profile — present only so `middleware.ts` (which is
 * shared source between both profiles) has something to call
 * unconditionally without an adapter-specific branch of its own. Real
 * implementation lives in `app.workers.ts`; `middleware.ts` never reaches
 * this branch in practice, since `context.locals.runtime` is `undefined`
 * under the Node adapter.
 */
export function initWorkersRuntime(_env: unknown): void {}

/** The shared Hono app — used by the `/api/*` catch-all route. */
export async function getApiApp(): Promise<ApiApp> {
  return (await getRuntime()).app;
}

/** The shared `AppDeps` — `db`, `mailer`, `clock`, `rateLimiter`, `storage`, `config`. */
export async function getAppDeps(): Promise<AppDeps> {
  return (await getRuntime()).deps;
}

/**
 * The subset of `RuntimeConfig` safe to reach from a page — everything
 * except `push`, which is narrowed from the full `VapidConfig` (private key
 * included) down to just the `publicKey` a browser's `pushManager.subscribe`
 * needs. `getWebConfig()` is called from Astro pages (see `/me`'s
 * Notifications section), so the private key must never round-trip through
 * it even in memory — there is no route that needs it there at all.
 */
export interface WebConfig extends Omit<RuntimeConfig, "push"> {
  push?: { publicKey: string };
}

/**
 * The whole validated deployment config, for the handful of settings that are
 * not the API app's business. `AppDeps.config` is `packages/api`'s
 * `AppConfig` — origin, bootstrap token, cookie flags — and
 * `BANDPLATE_DEFAULT_LOCALE` does not belong in it: no route reads it, and
 * putting it there would make `packages/api` depend on `@bandplate/i18n` to
 * name its type.
 */
export async function getWebConfig(): Promise<WebConfig> {
  const { config } = await getRuntime();
  return {
    ...config,
    push: config.push ? { publicKey: config.push.publicKey } : undefined,
  };
}

/**
 * Dependencies for `@bandplate/core`'s `runNotificationTick` — the same `db`
 * and `clock` (`systemClock`) as the rest of this runtime, plus a
 * `createWebPushSender` built from the VAPID config. `undefined` when push
 * isn't configured, which every caller treats as "nothing to do" rather than
 * an error, since push is entirely opt-in.
 */
export async function getNotificationDeps(): Promise<NotificationTickDeps | undefined> {
  const { config, deps } = await getRuntime();
  return toNotificationDeps(config, deps);
}

/**
 * The shared `AuthDeps` — used by Astro page handlers that call
 * `@bandplate/core`'s auth services directly (the same functions the JSON API
 * calls), rather than round-tripping through HTTP for their own
 * server-rendered, no-JS-friendly forms.
 */
export async function getAuthDeps(): Promise<AuthDeps> {
  return (await getRuntime()).authDeps;
}

/** Test-only: forget the memoized runtime so a test can rebuild it. */
export function resetRuntimeForTesting(): void {
  runtimePromise = undefined;
}
