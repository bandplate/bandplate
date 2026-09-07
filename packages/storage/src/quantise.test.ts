import { describe, expect, it } from "vitest";
import { QUANTISE_BUCKET_MS, quantiseToHourBucket } from "./quantise.js";

describe("quantiseToHourBucket", () => {
  it("rounds down to the start of the current hour", () => {
    const tenOhFive = Date.parse("2025-06-01T10:05:00.000Z");
    expect(quantiseToHourBucket(tenOhFive)).toBe(Date.parse("2025-06-01T10:00:00.000Z"));
  });

  it("is a no-op for a timestamp already on an hour boundary", () => {
    const onTheHour = Date.parse("2025-06-01T10:00:00.000Z");
    expect(quantiseToHourBucket(onTheHour)).toBe(onTheHour);
  });

  it("rounds down a timestamp one millisecond before the next hour", () => {
    const almostEleven = Date.parse("2025-06-01T10:59:59.999Z");
    expect(quantiseToHourBucket(almostEleven)).toBe(Date.parse("2025-06-01T10:00:00.000Z"));
  });

  it("QUANTISE_BUCKET_MS is exactly one hour", () => {
    expect(QUANTISE_BUCKET_MS).toBe(60 * 60 * 1000);
  });
});
