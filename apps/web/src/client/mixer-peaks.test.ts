import { describe, expect, it } from "vitest";
import { mixerLaneBars, sharedPeakScale } from "./mixer-peaks.js";

describe("sharedPeakScale", () => {
  it("is the loudest bar anywhere in the set, not in any one lane", () => {
    expect(sharedPeakScale([[0.2, 0.4], [0.9], [0.1]])).toBe(0.9);
  });

  it("is 1 for an empty set, so applying it cannot divide by zero", () => {
    expect(sharedPeakScale([])).toBe(1);
  });

  it("is 1 when every lane is silent, rather than 0", () => {
    expect(sharedPeakScale([[0, 0], [0]])).toBe(1);
  });
});

describe("mixerLaneBars", () => {
  // The contract's -128..127 integers. 127 is full scale.
  const loud = [127, 127, 127, 127];
  const quiet = [32, 32, 32, 32];

  it("draws a quiet lane shorter than a loud one — the whole point", () => {
    // Per-source normalisation (the player's) would draw both at full height,
    // which makes a stack of lanes say nothing about relative level.
    const [a, b] = mixerLaneBars([loud, quiet], 2);
    expect(a?.[0]).toBeCloseTo(1, 10);
    expect(b?.[0]).toBeCloseTo(32 / 127, 10);
  });

  it("still fills the height for the loudest lane, so the stack is not tiny", () => {
    const [a] = mixerLaneBars([quiet, quiet], 2);
    expect(a?.[0]).toBeCloseTo(1, 10);
  });

  it("keeps a lane with no peaks as null, in its own position", () => {
    // Dropping it would shift every lane below it onto the wrong instrument.
    const out = mixerLaneBars([loud, null, quiet], 2);
    expect(out).toHaveLength(3);
    expect(out[1]).toBeNull();
    expect(out[0]?.[0]).toBeCloseTo(1, 10);
  });

  it("survives a set where every lane is missing", () => {
    expect(mixerLaneBars([null, null], 2)).toEqual([null, null]);
  });

  it("survives a set that is entirely silence without dividing by zero", () => {
    const out = mixerLaneBars(
      [
        [0, 0],
        [0, 0],
      ],
      2,
    );
    expect(out[0]).toEqual([0, 0]);
  });

  it("gives every lane the same number of bars, so they line up on one axis", () => {
    const out = mixerLaneBars(
      [
        [1, 2, 3, 4, 5, 6, 7],
        [9, 9],
      ],
      4,
    );
    expect(out[0]).toHaveLength(4);
    expect(out[1]).toHaveLength(4);
  });
});
