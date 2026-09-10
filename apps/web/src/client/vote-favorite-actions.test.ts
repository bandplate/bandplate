import { describe, expect, it } from "vitest";
import { computeOptimisticTally, formatVoteTallyClient } from "./vote-favorite-actions.js";

describe("computeOptimisticTally", () => {
  it("a fresh keeper vote (no previous vote) increments both keeperVotes and totalVotes", () => {
    const result = computeOptimisticTally(
      { keeperVotes: 0, totalVotes: 0, ratingScore: 0 },
      undefined,
      true,
    );
    expect(result).toEqual({ keeperVotes: 1, totalVotes: 1, ratingScore: 1 });
  });

  it("a fresh not-keeper vote (no previous vote) increments only totalVotes", () => {
    const result = computeOptimisticTally(
      { keeperVotes: 0, totalVotes: 0, ratingScore: 0 },
      undefined,
      false,
    );
    expect(result).toEqual({ keeperVotes: 0, totalVotes: 1, ratingScore: 0 });
  });

  it("changing not-keeper -> keeper increments keeperVotes, leaves totalVotes alone", () => {
    const result = computeOptimisticTally(
      { keeperVotes: 2, totalVotes: 5, ratingScore: 0.4 },
      false,
      true,
    );
    expect(result).toEqual({ keeperVotes: 3, totalVotes: 5, ratingScore: 0.6 });
  });

  it("changing keeper -> not-keeper decrements keeperVotes, leaves totalVotes alone", () => {
    const result = computeOptimisticTally(
      { keeperVotes: 3, totalVotes: 5, ratingScore: 0.6 },
      true,
      false,
    );
    expect(result).toEqual({ keeperVotes: 2, totalVotes: 5, ratingScore: 0.4 });
  });

  it("resubmitting the SAME vote is a no-op (double-click/double-submit race)", () => {
    const current = { keeperVotes: 4, totalVotes: 7, ratingScore: 4 / 7 };
    expect(computeOptimisticTally(current, true, true)).toEqual(current);
    expect(computeOptimisticTally(current, false, false)).toEqual(current);
  });

  it("the zero-vote case never divides by zero — ratingScore is 0, not NaN", () => {
    // Only reachable in practice via a same-value resubmit on an
    // already-zero tally, but the formula itself must guard it directly
    // (totalVotes > 0 ? ... : 0), not rely on the caller never hitting it.
    const result = computeOptimisticTally(
      { keeperVotes: 0, totalVotes: 0, ratingScore: 0 },
      false,
      false,
    );
    expect(result.ratingScore).toBe(0);
    expect(Number.isNaN(result.ratingScore)).toBe(false);
  });
});

describe("formatVoteTallyClient", () => {
  // It used to be a hand-written copy of `server/format.ts#formatVoteTally`,
  // and this test asserted the two were byte-identical. Both sides now call
  // the same catalog entry, so there is no copy left to compare against — what
  // is worth pinning here is the wording the DOM depends on.
  it("renders the sentence the page renders", () => {
    expect(formatVoteTallyClient(1, 1, 1)).toBe("1 of 1 vote says keeper (100%).");
    expect(formatVoteTallyClient(3, 5, 0.6)).toBe("3 of 5 votes say keeper (60%).");
  });

  it("says nothing at all when nobody has voted", () => {
    // Empty rather than a sentence — `.bp-vote-tally:empty` is what hides the
    // element, so this must stay exactly "".
    expect(formatVoteTallyClient(0, 0, 0)).toBe("");
  });
});
