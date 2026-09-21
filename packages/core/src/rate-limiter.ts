// In-memory token-bucket implementation of the `RateLimiter` port. Correct
// for the single-process container profile; the Workers profile will swap
// in a Durable Object-backed implementation of the same port later (see
// `ports/rate-limiter.ts`).
import type { Clock } from "./ports/clock.js";
import type { RateLimiter, RateLimitResult } from "./ports/rate-limiter.js";

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

/**
 * Create an in-memory token-bucket `RateLimiter`. Each distinct `key` passed
 * to `check` gets its own bucket, refilled continuously at `limit / windowMs`
 * tokens per millisecond and capped at `limit`. Buckets are never evicted —
 * fine for a single long-lived process, not for a Worker (increment 7's
 * problem, per the port's doc comment).
 */
export function createInMemoryRateLimiter(clock: Clock): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
      const now = clock.now();
      const refillPerMs = limit / windowMs;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: limit, lastRefillAt: now };
        buckets.set(key, bucket);
      } else {
        const elapsed = now - bucket.lastRefillAt;
        if (elapsed > 0) {
          bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillPerMs);
          bucket.lastRefillAt = now;
        }
      }

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { allowed: true, retryAfterMs: 0 };
      }

      const deficit = 1 - bucket.tokens;
      const retryAfterMs = Math.ceil(deficit / refillPerMs);
      return { allowed: false, retryAfterMs };
    },
  };
}
