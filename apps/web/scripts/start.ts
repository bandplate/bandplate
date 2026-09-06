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
// `ConfigError: Invalid configuration: BANDLIB_DATABASE_URL Required`.
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
    console.error(`bandlib refused to start: ${err.message}`);
  } else {
    console.error("bandlib refused to start: unexpected error validating configuration.");
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
