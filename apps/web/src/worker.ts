// Custom Workers entry point. `@astrojs/cloudflare` 13+ has no
// `workerEntryPoint` option any more: the Worker's entry is whatever the
// deployer's `wrangler.toml` names as `main`, and for this app that must be
// `main = "./src/worker.ts"` (see `wrangler.toml.example` and
// `docs/deploy-cloudflare.md`). Leave `main` out and the adapter falls back
// to its stock entry, which has no `scheduled` handler, so the cron below
// would fire into nothing — the build's `bandplate-cron-wiring` hook (see
// `scripts/cron-wiring.ts`) catches that and fails the build rather than
// letting it happen silently.
//
// The stock entry (`@astrojs/cloudflare/entrypoints/server`) is exactly
// `export default { fetch: handle }`, with `handle` from
// `@astrojs/cloudflare/handler` (signature `handle(request, env, ctx)`; the
// adapter builds its own `App` and manifest internally now). `fetch` below is
// that same function, unwrapped, so ordinary requests go through the stock
// path untouched. `scheduled` is the one addition.
//
// No test here: this file is only reachable from the Cloudflare build
// (`vitest` only walks `src/**/*.test.ts` and nothing imports this). The
// Cloudflare build itself, plus a local `wrangler dev --test-scheduled` run,
// is the verification; see `docs/deploy-cloudflare.md`.
//
// `scheduled.ts` imports `../server/app.js`, which the Cloudflare build's
// `bandplate-workers-app-runtime` `resolveId` hook (`astro.config.mjs`)
// swaps for `app.workers.ts` (the D1/http-mailer composition root). See
// `scheduled.ts`'s own header for why that specifier is spelled out long.
import { handle } from "@astrojs/cloudflare/handler";
import { runScheduledTick } from "./server/scheduled.js";

type WorkerCtx = Parameters<typeof handle>[2];

export default {
  fetch: handle,
  // `wrangler.toml`'s `[triggers] crons` (`*/10 * * * *`, every 10
  // minutes, matching `NOTIFICATION_TICK_INTERVAL_MS`) is what invokes this.
  // Cron Triggers run in UTC regardless of the band's `Europe/Prague` zone
  // the reminder logic itself reasons in (see `docs/deploy-cloudflare.md`);
  // the 10-minute cadence makes that distinction immaterial here.
  //
  // `ctx.waitUntil`, not a bare `await`, because a `scheduled` handler that
  // returns before its work finishes gets the isolate torn down early
  // otherwise. The controller and `env` are unused: `runScheduledTick`
  // doesn't need the cron pattern or the scheduled time, and it reads the
  // bindings the same way every request does (`cloudflare:workers`'s `env`,
  // inside `app.workers.ts`).
  scheduled: (_controller: unknown, _env: unknown, ctx: WorkerCtx) => {
    ctx.waitUntil(runScheduledTick());
  },
};
