// When things happen, in the band's own time.
//
// A Worker runs in UTC — always, regardless of where the deployment is
// actually read from — so every date computation that decides "is it Sunday
// evening yet" or "which day does this event fall on" has to say explicitly
// which zone it means. `Date.getDay()` / `Date.getHours()` read the HOST
// clock, which is exactly the bug `packages/i18n/src/format.ts` flags and
// deliberately leaves alone for page rendering. Notifications don't get that
// pass: a push that says "Thursday" on a Wednesday, because the Worker read
// its own UTC day, would be a visible bug in every message this area sends.
//
// So everything here goes through `Intl.DateTimeFormat` with an explicit
// `timeZone`, never the implicit host zone.

/** The one zone the band's schedule is written in. */
export const BAND_TIME_ZONE = "Europe/Prague";

const WEEKDAY_INDEX: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(tz);
  if (cached) {
    return cached;
  }
  // `hourCycle: "h23"` pins midnight to "00" rather than the "24" some
  // engines print for `hour12: false` — see MDN's note on `hourCycle` vs
  // `hour12` disagreeing at midnight.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(tz, formatter);
  return formatter;
}

/** A moment, broken into the local calendar date, weekday, hour and minute of `tz` (default `BAND_TIME_ZONE`). */
export function zonedParts(
  ms: number,
  tz: string = BAND_TIME_ZONE,
): { date: string; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; hour: number; minute: number } {
  const raw: Record<string, string> = {};
  for (const part of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (part.type !== "literal") {
      raw[part.type] = part.value;
    }
  }
  return {
    date: `${raw.year}-${raw.month}-${raw.day}`,
    weekday: WEEKDAY_INDEX[raw.weekday ?? ""] ?? 0,
    hour: Number(raw.hour),
    minute: Number(raw.minute),
  };
}

/**
 * The weekly "takes waiting for your vote" reminder fires once, in the
 * window that opens Sunday at 19:00 `tz` time and stays open the rest of
 * Sunday — the tick (every 10 minutes) calls this each time and only acts
 * on a non-null result, so `dateKey` is the
 * natural idempotency key: "already sent for 2026-03-29" is a single map
 * lookup rather than a second clock read.
 */
export function weeklyReminderSlot(
  nowMs: number,
  tz: string = BAND_TIME_ZONE,
): { dateKey: string } | null {
  const parts = zonedParts(nowMs, tz);
  if (parts.weekday !== 0 || parts.hour < 19) {
    return null;
  }
  return { dateKey: parts.date };
}
