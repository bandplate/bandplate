import { describe, expect, it } from "vitest";
import { isBatchStale, NEW_TAKES_MAX_AGE_MS, NEW_TAKES_QUIET_MS } from "./new-takes.js";

describe("constants", () => {
  it("quiet period is 10 minutes", () => {
    expect(NEW_TAKES_QUIET_MS).toBe(600_000);
  });

  it("max age is 24 hours", () => {
    expect(NEW_TAKES_MAX_AGE_MS).toBe(86_400_000);
  });
});

describe("isBatchStale", () => {
  const now = 1_000_000_000_000;

  it("is not stale just under the max age", () => {
    expect(isBatchStale(now - (NEW_TAKES_MAX_AGE_MS - 1), now)).toBe(false);
  });

  it("is stale at exactly the max age", () => {
    expect(isBatchStale(now - NEW_TAKES_MAX_AGE_MS, now)).toBe(true);
  });

  it("is stale well past the max age", () => {
    expect(isBatchStale(now - NEW_TAKES_MAX_AGE_MS * 3, now)).toBe(true);
  });

  it("is not stale for a batch published in the future (clock skew)", () => {
    expect(isBatchStale(now + 1000, now)).toBe(false);
  });
});
