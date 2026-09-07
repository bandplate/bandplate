import { describe, expect, it } from "vitest";
import {
  UNVOTED_LIST_EMPTY_STATE_HTML,
  computeOptimisticTally,
  formatVoteTallyClient,
} from "./vote-favorite-actions.js";

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
  it("matches server/format.ts#formatVoteTally's wording exactly — see this module's own comment on why it's duplicated, not imported", () => {
    expect(formatVoteTallyClient(0, 0, 0)).toBe("No votes yet.");
    expect(formatVoteTallyClient(1, 1, 1)).toBe("1 of 1 vote says keeper (100%).");
    expect(formatVoteTallyClient(3, 5, 0.6)).toBe("3 of 5 votes say keeper (60%).");
  });
});

describe("UNVOTED_LIST_EMPTY_STATE_HTML", () => {
  it("matches index.astro's `unvotedTakes.length === 0` copy exactly — see this module's own comment on why it's duplicated, not imported", () => {
    expect(UNVOTED_LIST_EMPTY_STATE_HTML).toBe(
      "<p><strong>You're all caught up.</strong> Every published take has your vote — check back once the band records something new.</p>",
    );
  });

  it("is a single <p>, matching the shape `.bp-empty-state > p` styling in components.css expects", () => {
    expect(UNVOTED_LIST_EMPTY_STATE_HTML.match(/<p>/g)).toHaveLength(1);
    expect(UNVOTED_LIST_EMPTY_STATE_HTML.startsWith("<p>")).toBe(true);
    expect(UNVOTED_LIST_EMPTY_STATE_HTML.endsWith("</p>")).toBe(true);
  });
});
