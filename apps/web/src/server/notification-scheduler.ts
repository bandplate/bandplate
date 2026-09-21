// The Node profile's own notification scheduler — the Workers profile gets
// its tick from a Cloudflare Cron Trigger instead (`server/scheduled.ts`),
// but Node has no platform equivalent, so `app.ts`'s composition root runs
// its own `setInterval` once the runtime is built. See `app.ts`'s call site
// for why "once the runtime is built" (not "at process start") matters.
//
// `shouldStartNotificationScheduler` is split out as a pure function — the
// one piece of this file's logic that's actually decidable — so it has a
// plain node test; everything else here is timers and a `globalThis`
// singleton, which a unit test can't meaningfully exercise without either
// waiting 10 minutes or reimplementing fake timers around global mutable
// state.
import {
  describeError,
  logError,
  type NotificationTickDeps,
  runNotificationTick,
} from "@bandplate/core";

/** The tick runs every 10 minutes. */
export const NOTIFICATION_TICK_INTERVAL_MS = 600_000;

/**
 * The first tick fires ~30s after the runtime is built, not immediately —
 * enough slack that the process finishes settling (DB connection, etc.)
 * before the scheduler's first real query, without meaningfully delaying
 * the 10-minute cadence this joins afterward.
 */
export const NOTIFICATION_TICK_FIRST_DELAY_MS = 30_000;

/**
 * Whether the Node scheduler should run at all, given
 * `process.env.BANDPLATE_SCHEDULER`. The caller separately checks whether
 * push is configured at all (that requires the built `RuntimeConfig`, which
 * this function has no business knowing about) — this only isolates the
 * env-var parsing.
 *
 * `BANDPLATE_SCHEDULER=off` is for running more than one Node replica
 * against the same database: exactly one of them should tick, so every
 * replica but one sets this. Any other value (including unset) means "run
 * it here".
 */
export function shouldStartNotificationScheduler(schedulerEnv: string | undefined): boolean {
  return schedulerEnv !== "off";
}

interface SchedulerState {
  inFlight: boolean;
}

declare global {
  // A hot reload under `astro dev` re-executes this module on every file
  // change, which would otherwise stack a fresh `setInterval` on top of
  // every previous one still running in the same process. `globalThis`
  // survives a module re-evaluation (unlike this module's own top-level
  // state), so it's the one place a singleton guard actually works here.
  // `var` (not `let`/`const`) is required here — it's the only declaration
  // form TypeScript accepts inside `declare global`.
  var __bandplateNotificationScheduler: SchedulerState | undefined;
}

/**
 * Runs exactly one tick, guarded by `state.inFlight` so a tick that's still
 * running (a slow push service, a big batch) is never joined by the next
 * timer firing on top of it — `runNotificationTick` claims work before
 * sending, so two overlapping runs would mean split, not duplicated, work,
 * but there's no reason to allow it either.
 *
 * `runNotificationTick` itself never throws (see its own doc comment); the
 * `try`/`catch` here is a second line of defense, since an unhandled
 * rejection inside a bare timer callback has no `.catch` to reach and would
 * otherwise crash the process.
 */
async function tick(deps: NotificationTickDeps, state: SchedulerState): Promise<void> {
  if (state.inFlight) {
    return;
  }
  state.inFlight = true;
  try {
    const result = await runNotificationTick(deps);
    console.log(
      `[scheduler] notification tick: sent=${result.sent} gone=${result.gone} ` +
        `failed=${result.failed} skippedStale=${result.skippedStale}`,
    );
  } catch (err) {
    const { message, stack } = describeError(err);
    logError({
      kind: "scheduled-tick",
      message: `[scheduler] notification tick threw: ${message}`,
      stack,
    });
  } finally {
    state.inFlight = false;
  }
}

/**
 * Starts the scheduler. Idempotent for the life of the process (see the
 * `globalThis` comment above) — a second call, from a hot reload or from
 * `getRuntime()` somehow being asked to build twice, is a no-op.
 *
 * `.unref()` on both timers: a scheduler tick must never be the reason the
 * Node process stays alive (a graceful shutdown, or a script that just
 * wants the runtime built — see `notify:tick` — should still be able to
 * exit on its own).
 */
export function startNotificationScheduler(deps: NotificationTickDeps): void {
  if (globalThis.__bandplateNotificationScheduler) {
    return;
  }
  const state: SchedulerState = { inFlight: false };
  globalThis.__bandplateNotificationScheduler = state;

  const runTick = () => void tick(deps, state);

  const firstTimer = setTimeout(() => {
    runTick();
    const interval = setInterval(runTick, NOTIFICATION_TICK_INTERVAL_MS);
    interval.unref();
  }, NOTIFICATION_TICK_FIRST_DELAY_MS);
  firstTimer.unref();
}
