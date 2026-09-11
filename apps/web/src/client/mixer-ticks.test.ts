import { describe, expect, it } from "vitest";
import { formatTick, timelineTicks } from "./mixer-ticks.js";

describe("formatTick", () => {
  it("is m:ss with a padded second", () => {
    expect(formatTick(0)).toBe("0:00");
    expect(formatTick(9)).toBe("0:09");
    expect(formatTick(252)).toBe("4:12");
  });
});

describe("timelineTicks", () => {
  it("is empty for a take whose duration is not known yet", () => {
    // `duration` is NaN until metadata arrives, and Infinity for a VBR mp3
    // with no Xing header. Neither is a timeline.
    expect(timelineTicks(0)).toEqual([]);
    expect(timelineTicks(Number.NaN)).toEqual([]);
    expect(timelineTicks(Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("counts a four-minute take in thirties", () => {
    const ticks = timelineTicks(252);
    expect(ticks.map((t) => t.label)).toEqual([
      "0:00",
      "0:30",
      "1:00",
      "1:30",
      "2:00",
      "2:30",
      "3:00",
      "3:30",
      "4:00",
    ]);
  });

  it("counts an eight-minute take in minutes, not in thirties", () => {
    // Thirties would be seventeen lines — texture, not a scale.
    const ticks = timelineTicks(483);
    expect(ticks).toHaveLength(9);
    expect(ticks[1]?.atS).toBe(60);
  });

  it("counts a ninety-second take in fifteens", () => {
    const ticks = timelineTicks(90);
    expect(ticks[1]?.atS).toBe(15);
    expect(ticks.map((t) => t.label)).toContain("0:45");
  });

  it("marks whole minutes major and the rest minor", () => {
    const ticks = timelineTicks(252);
    expect(ticks.filter((t) => t.major).map((t) => t.label)).toEqual([
      "0:00",
      "1:00",
      "2:00",
      "3:00",
      "4:00",
    ]);
  });

  it("positions each tick at its TRUE fraction, which is the whole point", () => {
    // Spacing them evenly is what makes a label drift off its own line as
    // soon as the take is not a round number of intervals long.
    const ticks = timelineTicks(252);
    expect(ticks[0]?.fraction).toBe(0);
    expect(ticks[3]?.fraction).toBeCloseTo(90 / 252, 10);
    expect(ticks.at(-1)?.fraction).toBeCloseTo(240 / 252, 10);
  });

  it("stops before the end rather than drawing a line on the frame's edge", () => {
    for (const seconds of [252, 483, 90, 61]) {
      const last = timelineTicks(seconds).at(-1);
      expect(last?.atS).toBeLessThan(seconds);
      expect(last?.fraction).toBeLessThan(1);
    }
  });

  it("never returns a tick past the end for an awkward duration", () => {
    const ticks = timelineTicks(61);
    expect(ticks.every((t) => t.fraction >= 0 && t.fraction < 1)).toBe(true);
  });
});
