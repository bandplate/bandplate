#!/usr/bin/env -S node
// Production start wrapper — validates configuration eagerly, BEFORE the
// Node adapter's built server starts listening.
//
// Without this wrapper, `node dist/server/entry.mjs` binds the port and
// prints "Server listening" successfully even against a completely empty
// environment: `server/config.ts`'s `loadConfig()` is only ever reached
// lazily, the first time a request hits the middleware
// (`onRequest` -> `getAuthDeps()` -> `buildRuntime()` -> `loadConfig()`).
// Astro's Node adapter loads the middleware chunk itself via a dynamic
// `import()` inside the request pipeline, not at process start, so there
// is no module in the built output whose *own* top-level code runs before
// the first request either — the only reliable place to validate eagerly
// is here, before the adapter's entry is even imported.
//
// A misconfigured deployment therefore looks like a healthy boot to any
// supervisor or `docker run` health check, and only starts 500ing once
// real traffic arrives — no crash-loop signal ever fires. Verified live
// (see task-4-report.md "Fix round 1"): booting the built server with an
// empty environment prints "Server listening" and stays up indefinitely;
// the first `GET /login` against it then 500s with
// `ConfigError: Invalid configuration: BANDPLATE_DATABASE_URL Required`.
//
// THIS FILE IS NOT THE PRODUCTION ENTRY POINT — `dist/start.mjs` is. Round
// 1 shipped this as `tsx scripts/start.ts`, run straight from TypeScript
// source. That cannot work in production: `tsx` is a devDependency (absent
// from `pnpm install --prod`) and this file imports `../src/server/config.js`
// — `src/` isn't shipped either in a `dist`-only deploy (a Docker stage
// that copies `dist/` plus production `node_modules`, say). Documenting
// `pnpm --filter web start` as the one true deploy command while it
// silently required a devDependency and the full source tree was round 2's
// finding — see task-4-report.md "Fix round 2".
//
// The fix: `scripts/build-start.mjs` (run as part of `pnpm build`, see
// `package.json`) bundles *this* file — config validation, zod, all of
// it — into a single dependency-free `dist/start.mjs`. `"start"` runs
// `node dist/start.mjs`, which needs nothing but the Node runtime plus
// whatever `dist/server/entry.mjs` itself needs (already required for
// `astro build`'s own output to run at all).
import { ConfigError, loadConfig } from "../src/server/config.js";

try {
  loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`bandplate refused to start: ${err.message}`);
  } else {
    console.error("bandplate refused to start: unexpected error validating configuration.");
    console.error(err);
  }
  process.exit(1);
}

// Resolved relative to *this file's location after bundling* (i.e.
// `dist/start.mjs`), not this source file's location — see
// `scripts/build-start.mjs`. The target is a computed URL, not a string
// literal, specifically so esbuild leaves this `import()` call alone
// rather than trying to bundle `dist/server/entry.mjs` — a huge,
// separately-built dependency graph — into this file too.
const entryUrl = new URL("./server/entry.mjs", import.meta.url);
await import(entryUrl.href);

// Warm-up request — the Node notification scheduler (`server/app.ts`'s
// `getRuntime()`, wired up alongside the rest of the composition root; see
// `notification-scheduler.ts`) only starts once the runtime has actually
// been built, and the runtime is only built lazily, the first time a
// request reaches `middleware.ts` — same "nothing runs at module top level
// in the built output" fact this file's header explains for config
// validation. Left alone, a freshly (re)started deployment that happens to
// sit quiet for a while — an overnight redeploy, a band on a break — would
// leave the scheduler unstarted for that whole stretch, silently missing
// ticks it should have been running.
//
// `/login` is the same target the route tests already poll for readiness
// (see e.g. `pages/login-token.route.test.ts`'s `waitForServer`): public,
// unauthenticated, and cheap to render. This keeps its own short internal
// retry loop — the adapter's `await import` above only guarantees the
// module has finished its own top-level setup, not that the HTTP listener
// has finished binding the port yet — capped at ~30s total. Deliberately
// NOT part of `try`/`catch`-and-`process.exit(1)` like the config
// validation above: a failed warm-up only means the scheduler waits for
// real traffic instead, same as before this existed, so it's logged and
// nothing more. Runs fire-and-forget (not awaited) — the server is already
// listening by the time this fires, and nothing here should delay the
// process being considered "started".
async function warmUp(): Promise<void> {
  const port = process.env.PORT ?? "4321";
  const url = `http://127.0.0.1:${port}/login`;
  const deadline = Date.now() + 30_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      // Any response at all — even a 4xx/5xx — proves the listener (and
      // therefore the runtime behind it) is up; that's all this needs.
      console.log(`[start] warm-up request to ${url}: ${res.status}`);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  console.error(`[start] warm-up request to ${url} did not succeed within 30s: ${String(lastErr)}`);
}

void warmUp();
