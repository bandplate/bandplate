#!/usr/bin/env -S node
// One-shot notification tick — `pnpm --filter web run notify:tick`, run via
// `tsx` (a devDependency, same pattern as `packages/db`'s `migrate`/`seed`
// scripts, run straight from TypeScript source rather than bundled — this
// is a dev/ops tool, never part of the deployed `dist/` the way
// `scripts/start.ts` is).
//
// Builds the SAME runtime the app itself would (`../src/server/app.js`'s
// `getNotificationDeps`, memoized composition root and all), so it reads
// exactly the env this process was invoked with — the same
// `BANDPLATE_DATABASE_URL`, `BANDPLATE_VAPID_*`, etc. an operator already
// has set for the real deployment — and runs one
// `@bandplate/core#runNotificationTick` against it. Useful to fire a tick
// on demand (right after configuring push, to confirm it works, without
// waiting up to 10 minutes for the scheduler) or from an external cron if
// an operator would rather not run the in-process scheduler at all (see
// `BANDPLATE_SCHEDULER=off` in `docs/self-hosting.md`).
import { runNotificationTick } from "@bandplate/core";
import { getNotificationDeps } from "../src/server/app.js";

async function main(): Promise<void> {
  const deps = await getNotificationDeps();
  if (!deps) {
    console.log(
      "Push notifications are not configured (no BANDPLATE_VAPID_* set) — nothing to do.",
    );
    return;
  }
  const result = await runNotificationTick(deps);
  console.log(
    `notification tick: sent=${result.sent} gone=${result.gone} ` +
      `failed=${result.failed} skippedStale=${result.skippedStale}`,
  );
}

main()
  .then(() => {
    // Explicit exit rather than letting the process fall idle: the libSQL
    // client this pulls in (via `getNotificationDeps` -> the composition
    // root's `createClient`) has no handle exposed here to `.close()`
    // (`Db` is drizzle's wrapper, not the raw client — see
    // `packages/db/src/client.ts`), and a remote libsql: connection can
    // keep sockets open that would otherwise leave this script hanging
    // after its one tick is done. The scheduler `getNotificationDeps`
    // may also have started (same composition root, same
    // `maybeStartNotificationScheduler` as a real request) is harmless
    // here — its timers are `.unref()`'d, so they never delay this exit.
    process.exit(0);
  })
  .catch((err) => {
    console.error("notify:tick failed:", err);
    process.exit(1);
  });
