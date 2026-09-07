// Shared quantisation policy for `signedDownloadUrl` — every `Storage`
// implementation uses the exact same bucket width, so the observable
// caching behavior (byte-identical URL within a window, different across
// one) is identical across implementations, not just individually
// plausible. See the `Storage` port's doc comment on `signedDownloadUrl`.
//
// Fixed at one hour, not a constructor option: the brief's own numbers (a
// 1-hour bucket backing a 6-hour TTL, guaranteeing >=5 real hours of
// remaining validity from any point in the bucket) are the policy, not an
// example of one — a caller-configurable bucket width would let some
// future call site accidentally defeat the cache-hit property this exists
// for.
export const QUANTISE_BUCKET_MS = 60 * 60 * 1000;

/** Rounds `nowMs` down to the start of its 1-hour bucket. */
export function quantiseToHourBucket(nowMs: number): number {
  return Math.floor(nowMs / QUANTISE_BUCKET_MS) * QUANTISE_BUCKET_MS;
}
