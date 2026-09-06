import { type AppDeps, createApp } from "@bandlib/api";
import { createInMemoryRateLimiter, systemClock } from "@bandlib/core";
import { createDb } from "@bandlib/db";
import { createDevMailer } from "@bandlib/mail";
import { createClient } from "@libsql/client";
import type { APIRoute } from "astro";

export const prerender = false;

// Task 3 builds the headless auth API (`@bandlib/api`); wiring it up to a
// real login UI, `Astro.locals`, and env-driven ops config is Task 4's job.
// This is the minimal glue needed to keep the pre-existing catch-all mount
// working now that `createApp` takes a required `AppDeps` — env reads (and
// the mailer's dev-mailer refusal) are deliberately deferred into
// `getApp()` rather than run at module load, so `astro build`/`astro check`
// never execute them.
function buildAppDeps(): AppDeps {
  const databaseUrl = process.env.BANDLIB_DATABASE_URL ?? "file:./data/bandlib.db";
  const db = createDb(createClient({ url: databaseUrl }));

  const appOrigin = process.env.BANDLIB_APP_ORIGIN ?? "http://localhost:4321";
  const bootstrapToken = process.env.BANDLIB_BOOTSTRAP_TOKEN;
  if (!bootstrapToken) {
    throw new Error("BANDLIB_BOOTSTRAP_TOKEN must be set.");
  }
  const cookieSecure = process.env.BANDLIB_COOKIE_SECURE !== "false";

  const allowDevMailer = process.env.BANDLIB_ALLOW_DEV_MAILER === "true";
  if (!allowDevMailer) {
    throw new Error(
      "No mailer configured. Set BANDLIB_ALLOW_DEV_MAILER=true for local dev (console mailer), " +
        "or wire a real mailer (see @bandlib/mail/smtp) for anything else.",
    );
  }
  const mailer = createDevMailer("console", { allowDevMailer: true });

  return {
    db,
    mailer,
    clock: systemClock,
    rateLimiter: createInMemoryRateLimiter(systemClock),
    config: { appOrigin, bootstrapToken, cookieSecure },
  };
}

let app: ReturnType<typeof createApp> | undefined;
function getApp(): ReturnType<typeof createApp> {
  if (!app) {
    app = createApp(buildAppDeps());
  }
  return app;
}

// Hono routes inside @bandlib/api are declared relative (e.g. "/health"),
// but Astro mounts this catch-all under /api/*. Strip the /api prefix
// before delegating so Hono's router matches.
export const ALL: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api/, "") || "/";

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // Required by undici when forwarding a streaming body.
    (init as { duplex?: string }).duplex = "half";
  }

  return getApp().fetch(new Request(url, init));
};
