// Custom Workers entry point, wired in via `astro.config.mjs`'s
// `workerEntryPoint: { path: "./src/worker.ts" }` (cloudflare adapter
// option only — see that file's own comment). Replaces
// `@astrojs/cloudflare`'s stock entry (`dist/entrypoints/server.js`, which
// exports only `{ default: { fetch } }`) with one that keeps that same
// `fetch` handler and adds a `scheduled` handler, so `wrangler.toml`'s
// `[triggers] crons` has something to call.
//
// Verified against the installed `@astrojs/cloudflare@12.6.10`
// (`node_modules/.pnpm/@astrojs+cloudflare@.../dist/entrypoints/server.js`):
// the stock entry is exactly
//   `const app = new App(manifest); const fetch = (req, env, ctx) =>
//   handle(manifest, app, req, env, ctx); export function createExports
//   { return { default: { fetch } } }`
// — `handle` is re-exported from `@astrojs/cloudflare/handler`
// (`./dist/utils/handler.js`, listed in the package's `exports` map), with
// signature `handle(manifest, app, request, env, ctx)`. This file
// reproduces that `fetch` handler verbatim and adds `scheduled` alongside
// it, so ordinary requests are unaffected — see `worker.test.ts`... no
// test here (this file imports `cloudflare:workers`-adjacent types and
// isn't reachable from `vitest`'s `src/**/*.test.ts`; the Cloudflare build
// itself, plus a local `wrangler dev --test-scheduled` run, is the
// verification — see `docs/deploy-cloudflare.md`).
//
// `setAdapter`'s `serverEntrypoint` (this file, via `workerEntryPoint`)
// still goes through Astro's normal SSR build — the same Vite graph that
// applies `astro.config.mjs`'s `bandplate-workers-app-runtime` `resolveId`
// hook to any `.../server/app.js` specifier. `scheduled.ts` imports
// `./app.js` exactly like `middleware.ts` does, so that swap (to
// `app.workers.ts`, the D1/http-mailer composition root) applies here too.
import { handle } from "@astrojs/cloudflare/handler";
import type { ScheduledController } from "@cloudflare/workers-types";
import type { SSRManifest } from "astro";
import { App } from "astro/app";
import type { CloudflareEnv } from "./server/config.worker.js";
import { runScheduledTick } from "./server/scheduled.js";

// `handle`'s own parameter types (from `@astrojs/cloudflare/handler`) are
// pulled straight off its signature rather than reimported from
// `@cloudflare/workers-types` directly: `@astrojs/cloudflare` pins its own
// (older) `@cloudflare/workers-types` version as a dependency, distinct
// from `apps/web`'s own devDependency on a newer one (used everywhere else
// in this app, e.g. `env.d.ts`'s `CloudflareEnv`/`ExecutionContext`) — pnpm
// keeps both installed side by side, and the two packages' generated
// `Request`/`Env` types are structurally close but not the same nominal
// type, so mixing them at the `handle(...)` call site fails to typecheck.
// Deriving these from `typeof handle` guarantees the `fetch` handler below
// stays whatever version `handle` itself actually wants, with no manual
// version-matching to keep in sync.
type HandleParams = Parameters<typeof handle>;
type WorkerRequest = HandleParams[2];
type WorkerEnv = HandleParams[3];
type WorkerCtx = HandleParams[4];

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);
  return {
    default: {
      fetch: (request: WorkerRequest, env: WorkerEnv, ctx: WorkerCtx) =>
        handle(manifest, app, request, env, ctx),
      // `wrangler.toml`'s `[triggers] crons` (`*/10 * * * *`, every 10
      // minutes — matching the tick constant in `global-constraints.md`)
      // is what actually invokes this; Cron Triggers run in UTC
      // regardless of the band's `Europe/Prague` zone the reminder logic
      // itself reasons in (see `docs/deploy-cloudflare.md`) — the 10-minute
      // cadence makes that distinction immaterial here.
      //
      // `ctx.waitUntil`, not a bare `await`, because a `scheduled` handler
      // that returns before its work finishes gets the isolate torn down
      // early otherwise — same reason `middleware.ts`'s deferred mail send
      // uses it. `_controller` is unused: `runScheduledTick` doesn't need
      // the cron pattern or scheduled time, only `env`.
      //
      // `env` really is `CloudflareEnv`-shaped at runtime (the identical
      // bindings/vars object `fetch` above and `middleware.ts` both see,
      // just typed generically by `handle`'s own — differently-versioned
      // — `Env`) — the cast below is the one place that reconciles the two
      // static views of the same runtime value.
      scheduled: (_controller: ScheduledController, env: WorkerEnv, ctx: WorkerCtx) => {
        ctx.waitUntil(runScheduledTick(env as unknown as CloudflareEnv));
      },
    },
  };
}
