import { describe, expect, it } from "vitest";
import {
  decideHomeVisit,
  FIRST_VISIT_WINDOW_MS,
  type HomeVisitState,
  VISIT_GAP_MS,
} from "./home-visit.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

/** Loads home at each of `times` in turn, carrying the columns forward. */
function loads(start: HomeVisitState, times: number[]) {
  let state = start;
  return times.map((now) => {
    const decision = decideHomeVisit(state, now);
    state = { ...state, lastSeenAt: decision.lastSeenAt, lastVisitAt: decision.lastVisitAt };
    return decision;
  });
}

describe("decideHomeVisit", () => {
  it("a first-ever load starts a visit and measures from the member's joining", () => {
    const joined = NOW - 3 * DAY;
    expect(
      decideHomeVisit({ lastSeenAt: null, lastVisitAt: null, memberCreatedAt: joined }, NOW),
    ).toEqual({ startsNewVisit: true, lastSeenAt: NOW, lastVisitAt: joined, since: joined });
  });

  it("a first-ever load by a long-standing member looks back 14 days, not to their joining", () => {
    const decision = decideHomeVisit(
      { lastSeenAt: null, lastVisitAt: null, memberCreatedAt: NOW - 400 * DAY },
      NOW,
    );
    expect(decision.since).toBe(NOW - FIRST_VISIT_WINDOW_MS);
  });

  it("every load records itself as the last seen, new visit or not", () => {
    const decision = decideHomeVisit(
      { lastSeenAt: NOW - 5 * MINUTE, lastVisitAt: NOW - DAY, memberCreatedAt: 0 },
      NOW,
    );
    expect(decision).toEqual({
      startsNewVisit: false,
      lastSeenAt: NOW,
      lastVisitAt: NOW - DAY,
      since: NOW - DAY,
    });
  });

  it("a member reloading every 20 minutes for two hours keeps the same baseline", () => {
    const lastVisit = NOW - 2 * DAY;
    const times = Array.from({ length: 7 }, (_, i) => NOW + i * 20 * MINUTE);
    const decisions = loads(
      { lastSeenAt: NOW - 3 * 60 * MINUTE, lastVisitAt: lastVisit, memberCreatedAt: 0 },
      times,
    );
    // The first load, three hours after the last one, starts the visit...
    expect(decisions[0]?.startsNewVisit).toBe(true);
    const baseline = decisions[0]?.since;
    expect(baseline).toBe(NOW - 3 * 60 * MINUTE);
    // ...and two hours of loads 20 minutes apart never end it.
    for (const decision of decisions.slice(1)) {
      expect(decision.startsNewVisit).toBe(false);
      expect(decision.since).toBe(baseline);
    }
  });

  it("a first visit freezes its 14-day baseline, so reloads do not slide it forward", () => {
    // A long-standing member: the baseline is "14 days before the first load",
    // not "14 days before whichever load this is".
    const decisions = loads(
      { lastSeenAt: null, lastVisitAt: null, memberCreatedAt: NOW - 400 * DAY },
      [NOW, NOW + 25 * MINUTE, NOW + 50 * MINUTE, NOW + 75 * MINUTE],
    );
    const frozen = NOW - FIRST_VISIT_WINDOW_MS;
    expect(decisions.map((d) => d.since)).toEqual([frozen, frozen, frozen, frozen]);
    // Stored, not recomputed: it is what the first load writes back.
    expect(decisions[0]?.lastVisitAt).toBe(frozen);
  });

  it("a first visit by a new member freezes their joining as the baseline", () => {
    const joined = NOW - 3 * DAY;
    const decisions = loads({ lastSeenAt: null, lastVisitAt: null, memberCreatedAt: joined }, [
      NOW,
      NOW + 25 * MINUTE,
    ]);
    expect(decisions.map((d) => d.since)).toEqual([joined, joined]);
  });

  it("the visit after the first measures from the first one's last load", () => {
    const decisions = loads(
      { lastSeenAt: null, lastVisitAt: null, memberCreatedAt: NOW - 400 * DAY },
      [NOW, NOW + 10 * MINUTE, NOW + 3 * 60 * MINUTE],
    );
    expect(decisions[2]).toMatchObject({ startsNewVisit: true, since: NOW + 10 * MINUTE });
  });

  it("exactly 30 minutes of quiet is still the same visit", () => {
    const state = { lastSeenAt: NOW - VISIT_GAP_MS, lastVisitAt: NOW - DAY, memberCreatedAt: 0 };
    expect(decideHomeVisit(state, NOW).startsNewVisit).toBe(false);
    expect(decideHomeVisit(state, NOW + 1).startsNewVisit).toBe(true);
  });

  it("a 31-minute gap rolls over: the previous visit's last load becomes the baseline", () => {
    const lastLoad = NOW - 31 * MINUTE;
    const decision = decideHomeVisit(
      { lastSeenAt: lastLoad, lastVisitAt: NOW - 3 * DAY, memberCreatedAt: 0 },
      NOW,
    );
    expect(decision).toEqual({
      startsNewVisit: true,
      lastSeenAt: NOW,
      lastVisitAt: lastLoad,
      since: lastLoad,
    });
  });
});
