// Clock port. Every expiry/staleness check in the auth services goes
// through this instead of calling `Date.now()` directly, so tests can
// advance time deterministically instead of sleeping.

export interface Clock {
  /** Current time, epoch milliseconds. */
  now(): number;
}

/** The real clock — used everywhere outside tests. */
export const systemClock: Clock = {
  now: () => Date.now(),
};
