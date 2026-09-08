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
  createInMemoryRateLimiter,
  systemClock,
} from "@bandplate/core";
import { createDb } from "@bandplate/db";
import { createDevMailer } from "@bandplate/mail";
import { createS3Storage } from "@bandplate/storage";
import { createClient } from "@libsql/client";
import { type RuntimeConfig, loadConfig } from "./config.js";

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
    },
  };
  const authDeps: AuthDeps = {
    db,
    mailer,
    clock,
    bootstrapToken: config.bootstrapToken,
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

/** Memoized: the environment is read and the app is built once per process. */
function getRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = buildRuntime();
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
