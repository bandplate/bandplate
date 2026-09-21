import { describe, expect, it } from "vitest";
import {
  canLoop,
  LOOP_NUDGE_S,
  loopEngagedFrom,
  loopFractions,
  loopWrapTarget,
  MIN_LOOP_S,
  makeLoop,
  nudgeLoopEdge,
  setLoopEdge,
} from "./mixer-loop.js";

const TAKE = 400;

describe("makeLoop", () => {
  it("keeps a drag's two times in order, whichever way it was dragged", () => {
    expect(makeLoop(120, 60, TAKE)).toEqual({ startS: 60, endS: 120 });
  });

  it("pushes the END out when a left-to-right drag is too short, leaving where it began", () => {
    // The member put the start down deliberately; the other edge is wherever
    // their finger stopped.
    expect(makeLoop(100, 100.4, TAKE)).toEqual({ startS: 100, endS: 100 + MIN_LOOP_S });
  });

  it("pushes the START back when a right-to-left drag is too short", () => {
    expect(makeLoop(100, 99.6, TAKE)).toEqual({ startS: 100 - MIN_LOOP_S, endS: 100 });
  });

  it("pulls the anchor in rather than overflowing the end of the axis", () => {
    expect(makeLoop(TAKE, TAKE, TAKE)).toEqual({ startS: TAKE - MIN_LOOP_S, endS: TAKE });
  });

  it("clamps a drag that ran off either end of the axis", () => {
    expect(makeLoop(-50, 60, TAKE)).toEqual({ startS: 0, endS: 60 });
    expect(makeLoop(300, 9000, TAKE)).toEqual({ startS: 300, endS: TAKE });
  });

  it("refuses a take too short to hold a region", () => {
    expect(canLoop(1)).toBe(false);
    expect(makeLoop(0, 1, 1)).toBeNull();
    expect(makeLoop(0, 10, 0)).toBeNull();
  });
});

describe("setLoopEdge", () => {
  it("opens the first 'from here' against the end, so playback keeps wrapping while you listen", () => {
    expect(setLoopEdge(null, "start", 90, TAKE)).toEqual({ startS: 90, endS: TAKE });
  });

  it("opens the first 'to here' from the beginning", () => {
    expect(setLoopEdge(null, "end", 90, TAKE)).toEqual({ startS: 0, endS: 90 });
  });

  it("moves the edge it was given and leaves the other alone", () => {
    const region = { startS: 60, endS: 120 };
    expect(setLoopEdge(region, "start", 80, TAKE)).toEqual({ startS: 80, endS: 120 });
    expect(setLoopEdge(region, "end", 200, TAKE)).toEqual({ startS: 60, endS: 200 });
  });

  it("swaps rather than refuses when the marks cross", () => {
    // Pressing 'to here' before the start means the span between the two
    // marks; making someone redo it backwards helps nobody.
    expect(setLoopEdge({ startS: 60, endS: 120 }, "end", 20, TAKE)).toEqual({
      startS: 20,
      endS: 60,
    });
  });

  it("anchors the mark just pressed, so the minimum moves the OLDER edge", () => {
    // Two taps in quick succession: the second is the fresher intent, so the
    // first one gives.
    expect(setLoopEdge({ startS: 60, endS: TAKE }, "end", 60.5, TAKE)).toEqual({
      startS: 60.5 - MIN_LOOP_S,
      endS: 60.5,
    });
  });

  it("refuses on a take too short to hold a region", () => {
    expect(setLoopEdge(null, "start", 0, 1)).toBeNull();
  });
});

describe("nudgeLoopEdge", () => {
  it("moves one edge by the delta", () => {
    expect(nudgeLoopEdge({ startS: 60, endS: 120 }, "start", LOOP_NUDGE_S, TAKE)).toEqual({
      startS: 60 + LOOP_NUDGE_S,
      endS: 120,
    });
  });

  it("stops at the minimum instead of dragging the far edge along", () => {
    // The difference from a drag, and the reason it is written down: an arrow
    // key that pushed the other edge could shrink forever without refusing.
    expect(nudgeLoopEdge({ startS: 60, endS: 61 + MIN_LOOP_S }, "start", 5, TAKE)).toEqual({
      startS: 61,
      endS: 61 + MIN_LOOP_S,
    });
    expect(nudgeLoopEdge({ startS: 60, endS: 61 + MIN_LOOP_S }, "end", -5, TAKE)).toEqual({
      startS: 60,
      endS: 60 + MIN_LOOP_S,
    });
  });

  it("cannot walk an edge off the axis", () => {
    expect(nudgeLoopEdge({ startS: 1, endS: 120 }, "start", -9000, TAKE)?.startS).toBe(0);
    expect(nudgeLoopEdge({ startS: 60, endS: TAKE - 1 }, "end", 9000, TAKE)?.endS).toBe(TAKE);
  });

  it("has nothing to nudge without a region", () => {
    expect(nudgeLoopEdge(null, "start", 1, TAKE)).toBeNull();
  });
});

describe("loopEngagedFrom", () => {
  it("catches anything landing before the end", () => {
    expect(loopEngagedFrom(0, { startS: 60, endS: 120 })).toBe(true);
    expect(loopEngagedFrom(90, { startS: 60, endS: 120 })).toBe(true);
  });

  it("lets go of a landing at or past the end", () => {
    // Jumping ahead to check the ending must not yank you back.
    expect(loopEngagedFrom(120, { startS: 60, endS: 120 })).toBe(false);
    expect(loopEngagedFrom(300, { startS: 60, endS: 120 })).toBe(false);
  });

  it("is never engaged without a region", () => {
    expect(loopEngagedFrom(0, null)).toBe(false);
  });
});

describe("loopWrapTarget", () => {
  const region = { startS: 60, endS: 120 };

  it("says nothing until the end is reached", () => {
    expect(loopWrapTarget({ positionS: 119.9, region, engaged: true })).toBeNull();
  });

  it("wraps to the start at the end", () => {
    expect(loopWrapTarget({ positionS: 120, region, engaged: true })).toBe(60);
  });

  it("wraps on `ended`, which is how a region against the take's own end behaves", () => {
    // The element runs out before the position is ever read past `endS`, and
    // without this the loop just stops.
    expect(
      loopWrapTarget({
        positionS: 399,
        region: { startS: 300, endS: TAKE },
        engaged: true,
        ended: true,
      }),
    ).toBe(300);
  });

  it("does not wrap when playback landed outside the region", () => {
    expect(loopWrapTarget({ positionS: 200, region, engaged: false })).toBeNull();
    expect(loopWrapTarget({ positionS: 200, region, engaged: false, ended: true })).toBeNull();
  });

  it("does not wrap without a region", () => {
    expect(loopWrapTarget({ positionS: 200, region: null, engaged: true })).toBeNull();
  });
});

describe("loopFractions", () => {
  it("places the region on the axis", () => {
    expect(loopFractions({ startS: 100, endS: 200 }, TAKE)).toEqual({ start: 0.25, end: 0.5 });
  });

  it("has nowhere to draw before the duration is known", () => {
    expect(loopFractions({ startS: 100, endS: 200 }, 0)).toBeNull();
    expect(loopFractions(null, TAKE)).toBeNull();
  });
});
