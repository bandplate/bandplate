// Composition root — builds the one `Db`/`Mailer`/`Clock`/`RateLimiter`/
// `AppDeps`/`AuthDeps` set this process uses, memoized so both the JSON API
// mount (`pages/api/[...path].ts`) and the Astro pages (`server/pages/*`)
// share the same database connection and rate-limiter state rather than
// each building their own.
//
// The SMTP mailer (`@bandlib/mail/smtp`, the only Node-dependent module
// outside this composition root) is loaded via a dynamic `import()` inside
// `buildMailer`, not a static top-level import — so a bundler targeting a
// runtime without SMTP configured (or a future Workers build) never has to
// include nodemailer just because this module was imported. See the
// task-4-report.md verification of this.
import { type AppDeps, createApp } from "@bandlib/api";
import { type AuthDeps, type Mailer, createInMemoryRateLimiter, systemClock } from "@bandlib/core";
import { createDb } from "@bandlib/db";
import { createDevMailer } from "@bandlib/mail";
import { createClient } from "@libsql/client";
import { type RuntimeConfig, loadConfig } from "./config.js";

// `ReturnType<typeof createApp>` rather than importing Hono's own `Hono`
// type directly — `hono` is only a transitive dependency here (declared by
// `@bandlib/api`), and apps/web doesn't otherwise need to know its types.
type ApiApp = ReturnType<typeof createApp>;

async function buildMailer(config: RuntimeConfig): Promise<Mailer> {
  if (config.smtp) {
    // Dynamic import: only reached when SMTP is actually configured, and
    // only evaluated the first time this branch runs.
    const { createSmtpMailer } = await import("@bandlib/mail/smtp");
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

  const deps: AppDeps = {
    db,
    mailer,
    clock,
    rateLimiter,
    config: {
      appOrigin: config.appOrigin,
      bootstrapToken: config.bootstrapToken,
      cookieSecure: config.cookieSecure,
      trustedProxyDepth: config.trustedProxyDepth,
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

/** Memoized: the environment is read and the app is built once per process. */
function getRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = buildRuntime();
  }
  return runtimePromise;
}

/** The shared Hono app — used by the `/api/*` catch-all route. */
export async function getApiApp(): Promise<ApiApp> {
  return (await getRuntime()).app;
}

/** The shared `AppDeps` — `db`, `mailer`, `clock`, `rateLimiter`, `config`. */
export async function getAppDeps(): Promise<AppDeps> {
  return (await getRuntime()).deps;
}

/**
 * The shared `AuthDeps` — used by Astro page handlers that call
 * `@bandlib/core`'s auth services directly (the same functions the JSON API
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
