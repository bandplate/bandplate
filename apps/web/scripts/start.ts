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
// Run this instead of `node dist/server/entry.mjs` directly — see
// README.md's deployment section and the `"start"` script in package.json.
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

await import("../dist/server/entry.mjs");
