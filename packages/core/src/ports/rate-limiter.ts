// RateLimiter port. Narrow on purpose: `packages/core/src/rate-limiter.ts`
// implements this in-memory (correct for the single-process container
// profile). The Cloudflare Workers profile will need a Durable
// Object-backed implementation later — swapping it in means writing a new
// implementation of this same interface, not redesigning callers.

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until a call with the same key would be allowed again. 0 when `allowed`. */
  retryAfterMs: number;
}

export interface RateLimiter {
  /**
   * Consume one unit of `key`'s budget of `limit` per `windowMs`.
   * Callers compose the key (e.g. `login:email:<addr>`, `login:ip:<ip>`) so
   * one limiter instance can back multiple independent rate limits.
   */
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}
