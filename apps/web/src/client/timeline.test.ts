import { describe, expect, it } from "vitest";
import {
  barCountForWidth,
  finiteDuration,
  formatClock,
  fractionAt,
  playedFraction,
  scrollFades,
} from "./timeline.js";

describe("formatClock", () => {
  it("floors, because it is a running clock", () => {
    // Rounding would show 1:00 from 0:59.5 on, half a second early.
    expect(formatClock(59.9)).toBe("0:59");
    expect(formatClock(60)).toBe("1:00");
    expect(formatClock(125.2)).toBe("2:05");
  });

  it("reads 0:00 for anything that is not a position yet", () => {
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatClock(-3)).toBe("0:00");
  });

  it("keeps counting minutes past the hour rather than growing an hours field", () => {
    expect(formatClock(3725)).toBe("62:05");
  });
});

describe("fractionAt", () => {
  it("is where across a box a pointer sits, 0..1", () => {
    expect(fractionAt(150, { left: 100, width: 200 })).toBe(0.25);
  });

  it("clamps a pointer past either edge", () => {
    expect(fractionAt(50, { left: 100, width: 200 })).toBe(0);
    expect(fractionAt(900, { left: 100, width: 200 })).toBe(1);
  });

  it("has no answer for a box with no width", () => {
    // A collapsed or not-yet-laid-out box: dividing by it would seek to NaN.
    expect(fractionAt(150, { left: 100, width: 0 })).toBeNull();
  });
});

describe("barCountForWidth", () => {
  const bounds = { pitch: 3, min: 60, max: 1000 };

  it("is one bar per pitch of measured width", () => {
    expect(barCountForWidth(600, bounds)).toBe(200);
    expect(barCountForWidth(601, bounds)).toBe(200);
  });

  it("never drops below the floor or past the ceiling", () => {
    expect(barCountForWidth(30, bounds)).toBe(60);
    expect(barCountForWidth(9000, bounds)).toBe(1000);
  });

  it("has no answer for a box that has not been laid out", () => {
    expect(barCountForWidth(0, bounds)).toBeNull();
  });
});

describe("playedFraction", () => {
  it("is how far through the take the playhead is", () => {
    expect(playedFraction(30, 120)).toBe(0.25);
  });

  it("is zero while there is no duration to divide by", () => {
    expect(playedFraction(30, 0)).toBe(0);
    expect(playedFraction(30, Number.NaN)).toBe(0);
    // A WebM with no duration in its header reports Infinity.
    expect(playedFraction(30, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("finiteDuration", () => {
  it("keeps a real duration and reads everything else as none", () => {
    expect(finiteDuration(183.4)).toBe(183.4);
    expect(finiteDuration(Number.NaN)).toBe(0);
    expect(finiteDuration(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("scrollFades", () => {
  it("fades neither end of a list that fits", () => {
    expect(scrollFades({ scrollTop: 0, clientHeight: 300, scrollHeight: 300 })).toEqual({
      above: false,
      below: false,
    });
  });

  it("fades the end that has more past it", () => {
    expect(scrollFades({ scrollTop: 0, clientHeight: 300, scrollHeight: 900 })).toEqual({
      above: false,
      below: true,
    });
    expect(scrollFades({ scrollTop: 600, clientHeight: 300, scrollHeight: 900 })).toEqual({
      above: true,
      below: false,
    });
    expect(scrollFades({ scrollTop: 200, clientHeight: 300, scrollHeight: 900 })).toEqual({
      above: true,
      below: true,
    });
  });

  it("ignores a sub-pixel remainder, which is rounding and not content", () => {
    expect(scrollFades({ scrollTop: 0.5, clientHeight: 300, scrollHeight: 300.8 })).toEqual({
      above: false,
      below: false,
    });
  });
});
