import { describe, expect, it } from "vitest";
import { downsamplePeaks, PEAK_FULL_SCALE } from "./player-store.js";

describe("downsamplePeaks", () => {
  it("reads the contract's -128..127 integers, not 0..1 fractions", () => {
    // Read as fractions instead, every one of these clamps to 1 and the
    // waveform draws as a solid block of full-height bars.
    expect(downsamplePeaks([127, 64, 32, 0], 4)).toEqual([1, 64 / 127, 32 / 127, 0]);
  });

  it("normalises so the loudest bar of this source fills the height", () => {
    // A rehearsal mixed with headroom peaks near half of full scale, which
    // drawn absolutely wastes half the rail and squashes the shape flat.
    const bars = downsamplePeaks([22, 40, 67, 31], 4);
    expect(Math.max(...bars)).toBe(1);
    // Ratios, not the raw values: dividing through by the loudest bar is not
    // bit-identical to dividing the originals.
    for (const [i, want] of [22 / 67, 40 / 67, 1, 31 / 67].entries()) {
      expect(bars[i]).toBeCloseTo(want, 10);
    }
  });

  it("normalises per source, so a quiet stem still shows its shape", () => {
    const loud = downsamplePeaks([120, 60], 2);
    const quiet = downsamplePeaks([12, 6], 2);
    expect(quiet).toEqual(loud);
  });

  it("reads the magnitude, so folded negatives count too", () => {
    // The file alternates sign to fold each bucket's min and max together.
    // Comparing signed values against a max starting at 0 discarded every
    // negative sample -- half the file.
    expect(downsamplePeaks([-127, -127], 1)).toEqual([1]);
    expect(downsamplePeaks([0, -64], 2)).toEqual([0, 1]);
  });

  it("takes the loudest sample in each bucket, not the mean", () => {
    expect(downsamplePeaks([0, 127, 0, 0], 2)).toEqual([1, 0]);
  });

  it("leaves a silent source flat rather than amplifying nothing", () => {
    expect(downsamplePeaks([0, 0, 0, 0], 4)).toEqual([0, 0, 0, 0]);
  });

  it("clamps anything outside the contract's range rather than trusting it", () => {
    expect(downsamplePeaks([9999, -9999], 2)).toEqual([1, 1]);
  });

  it("returns nothing for an empty file, so the player falls back to the rail", () => {
    expect(downsamplePeaks([], 120)).toEqual([]);
  });

  it("keeps PEAK_FULL_SCALE as the contract's full-amplitude value", () => {
    expect(PEAK_FULL_SCALE).toBe(127);
  });
});
