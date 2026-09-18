// The Workers `scheduled` handler's actual body — split out of `worker.ts`
// so nothing under `src/server/` (the tree `vitest` walks via
// `src/**/*.test.ts`, see `apps/web/vitest.config.ts`) drags in
// `worker.ts`'s `cloudflare:workers`/`@astrojs/cloudflare/handler` imports.
// This file itself imports nothing Workers-specific — only `../server/app.js`
// (see below) — so it's safe for anything to import, but nothing under
// test currently does; it's wired up only from `worker.ts`'s `scheduled`
// export.
//
// Goes through the SAME `server/app.js → app.workers.ts` swap as every
// other importer (see `astro.config.mjs`'s `resolveId` hook and
// `app.workers.ts`'s own doc comment) — the hook's regex matches any
// specifier ENDING in `server/app.js`, so even though this file already
// lives inside `server/`, the import below deliberately spells out
// `../server/app.js` (equivalent to the plain sibling `./app.js`, but
// carrying the `server/` segment the regex looks for) rather than the
// shorter sibling form. A bare `./app.js` here resolves fine on its own
// but silently skips the swap and pulls the real Node composition root
// (`app.ts`, with nodemailer/SMTP) into the Workers bundle instead of
// `app.workers.ts` — caught by diffing the built `dist/_worker.js` output
// against the stock (pre-this-file) Cloudflare build, which has no
// `createSmtpMailer` chunk at all.
import { runNotificationTick } from "@bandplate/core";
import { getNotificationDeps, initWorkersRuntime } from "../server/app.js";
import type { CloudflareEnv } from "./config.worker.js";

/**
 * Called from `worker.ts`'s `scheduled` export, itself wrapped in
 * `ctx.waitUntil` there so the platform keeps the isolate alive until this
 * resolves. `initWorkersRuntime` is the same no-op-after-first-call as
 * `middleware.ts`'s use of it — Workers MAY reuse an isolate across a fetch
 * and a later cron trigger, so this could be a no-op finding the runtime
 * already built; that idempotency is exactly why it's safe to call here
 * unconditionally either way, fresh isolate or reused one.
 *
 * `getNotificationDeps()` returns `undefined` when push isn't configured
 * (no VAPID vars set — see `config.worker.ts`) — every cron trigger runs
 * regardless of whether push is on, so this is the "nothing to do" case,
 * not an error.
 *
 * `initWorkersRuntime`/`getNotificationDeps` live inside the `try` along
 * with the tick itself: `getRuntime()` can throw `ConfigError` (invalid
 * env), and letting that escape uncaught would reject the `waitUntil`
 * promise unhandled instead of logging a `[scheduled]` line like every
 * other failure here.
 *
 * `runNotificationTick` itself never throws (see its own doc comment), but
 * the `try`/`catch` stays a deliberate second line of defense around it too,
 * not dead code for a promise that can't reject.
 */
export async function runScheduledTick(env: CloudflareEnv): Promise<void> {
  try {
    initWorkersRuntime(env);
    const deps = await getNotificationDeps();
    if (!deps) {
      return;
    }
    const result = await runNotificationTick(deps);
    console.log(
      `[scheduled] notification tick: sent=${result.sent} gone=${result.gone} ` +
        `failed=${result.failed} skippedStale=${result.skippedStale}`,
    );
  } catch (err) {
    console.error(`[scheduled] notification tick threw: ${String(err)}`);
  }
}
