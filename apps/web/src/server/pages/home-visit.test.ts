import { describe, expect, it } from "vitest";
import { FIRST_VISIT_WINDOW_MS, VISIT_GAP_MS, decideHomeVisit } from "./home-visit.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

describe("decideHomeVisit", () => {
  it("a first-ever load starts a visit and measures from the member's joining", () => {
    const joined = NOW - 3 * DAY;
    const decision = decideHomeVisit(
      { visitStartedAt: null, lastVisitAt: null, memberCreatedAt: joined },
      NOW,
    );
    expect(decision).toEqual({
      startsNewVisit: true,
      visitStartedAt: NOW,
      lastVisitAt: null,
      since: joined,
    });
  });

  it("a first-ever load by a long-standing member looks back 14 days, not to their joining", () => {
    const decision = decideHomeVisit(
      { visitStartedAt: null, lastVisitAt: null, memberCreatedAt: NOW - 400 * DAY },
      NOW,
    );
    expect(decision.since).toBe(NOW - FIRST_VISIT_WINDOW_MS);
  });

  it("a reload within the visit changes nothing, so the card stays up", () => {
    const started = NOW - 10 * 60 * 1000;
    const last = NOW - 2 * DAY;
    const decision = decideHomeVisit(
      { visitStartedAt: started, lastVisitAt: last, memberCreatedAt: 0 },
      NOW,
    );
    expect(decision).toEqual({
      startsNewVisit: false,
      visitStartedAt: started,
      lastVisitAt: last,
      since: last,
    });
  });

  it("a reload during a first visit keeps the first-visit floor", () => {
    const joined = NOW - 3 * DAY;
    const decision = decideHomeVisit(
      { visitStartedAt: NOW - 60_000, lastVisitAt: null, memberCreatedAt: joined },
      NOW,
    );
    expect(decision.startsNewVisit).toBe(false);
    expect(decision.since).toBe(joined);
  });

  it("exactly 30 minutes in is still the same visit; a moment later is a new one", () => {
    const started = NOW - VISIT_GAP_MS;
    const state = { visitStartedAt: started, lastVisitAt: NOW - DAY, memberCreatedAt: 0 };
    expect(decideHomeVisit(state, NOW).startsNewVisit).toBe(false);
    expect(decideHomeVisit(state, NOW + 1).startsNewVisit).toBe(true);
  });

  it("a new visit makes the old visit's start the baseline", () => {
    const started = NOW - 5 * 60 * 60 * 1000;
    const decision = decideHomeVisit(
      { visitStartedAt: started, lastVisitAt: NOW - 3 * DAY, memberCreatedAt: 0 },
      NOW,
    );
    expect(decision).toEqual({
      startsNewVisit: true,
      visitStartedAt: NOW,
      lastVisitAt: started,
      since: started,
    });
  });
});
