import { describe, expect, it } from "vitest";
import type { Clock } from "./ports/clock.js";
import { createInMemoryRateLimiter } from "./rate-limiter.js";

function fakeClock(startAt = 0): Clock & { advance(ms: number): void } {
  let now = startAt;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("createInMemoryRateLimiter", () => {
  it("allows up to the limit within the window", async () => {
    const clock = fakeClock();
    const limiter = createInMemoryRateLimiter(clock);

    for (let i = 0; i < 3; i++) {
      const result = await limiter.check("k", 3, 1_000);
      expect(result.allowed).toBe(true);
    }
  });

  it("rejects the call after the limit is exhausted", async () => {
    const clock = fakeClock();
    const limiter = createInMemoryRateLimiter(clock);

    for (let i = 0; i < 3; i++) {
      await limiter.check("k", 3, 1_000);
    }
    const fourth = await limiter.check("k", 3, 1_000);

    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills over time and allows again once enough has elapsed", async () => {
    const clock = fakeClock();
    const limiter = createInMemoryRateLimiter(clock);

    for (let i = 0; i < 2; i++) {
      await limiter.check("k", 2, 1_000);
    }
    expect((await limiter.check("k", 2, 1_000)).allowed).toBe(false);

    clock.advance(1_000); // a full window's worth of refill for a 2-token bucket
    const afterRefill = await limiter.check("k", 2, 1_000);

    expect(afterRefill.allowed).toBe(true);
  });

  it("tracks separate keys independently", async () => {
    const clock = fakeClock();
    const limiter = createInMemoryRateLimiter(clock);

    await limiter.check("a", 1, 1_000);
    const aSecond = await limiter.check("a", 1, 1_000);
    const bFirst = await limiter.check("b", 1, 1_000);

    expect(aSecond.allowed).toBe(false);
    expect(bFirst.allowed).toBe(true);
  });
});
