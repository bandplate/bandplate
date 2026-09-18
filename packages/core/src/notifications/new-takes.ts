// When a fresh batch of takes is "done" landing, for notification purposes.
//
// Uploads for one event tend to arrive in a burst — several files over a few
// minutes rather than one at a time — so a notification sent on the FIRST
// upload would fire once per file rather than once per session. The caller
// (the tick) instead watches a quiet period: if nothing new has landed for
// `NEW_TAKES_QUIET_MS`, the batch is done and gets notified as one message
// naming the total count.

/** How long to wait, after the last new take, before the batch counts as settled. */
export const NEW_TAKES_QUIET_MS = 600_000; // 10 minutes

/**
 * How old a still-open batch can get before the quiet-period wait is
 * abandoned outright, rather than left to time out on its own — an upload
 * session that never goes quiet (a slow connection trickling files in one at
 * a time) would otherwise hold its notification forever.
 */
export const NEW_TAKES_MAX_AGE_MS = 86_400_000; // 24 hours

/**
 * `true` once a batch has been open for `NEW_TAKES_MAX_AGE_MS` or longer,
 * measured from its first upload (`lastPublishedAt` here despite the name —
 * see the caller, which passes the batch's oldest still-unsent take).
 *
 * A batch published in the future relative to `now` (clock skew, or a test
 * fixture) is never stale — `now - lastPublishedAt` is negative, which is
 * less than the threshold either way, so no special case is needed.
 */
export function isBatchStale(lastPublishedAt: number, now: number): boolean {
  return now - lastPublishedAt >= NEW_TAKES_MAX_AGE_MS;
}
