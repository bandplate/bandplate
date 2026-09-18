import { describe, expect, it } from "vitest";
import { BAND_TIME_ZONE, weeklyReminderSlot, zonedParts } from "./schedule.js";

describe("BAND_TIME_ZONE", () => {
  it("is Europe/Prague", () => {
    expect(BAND_TIME_ZONE).toBe("Europe/Prague");
  });
});

describe("zonedParts", () => {
  it("reads a Wednesday-UTC instant as Thursday once Prague's day has turned", () => {
    // 2026-07-08T23:30:00Z is Wednesday in UTC; Prague is CEST (UTC+2) in
    // July, so locally it is already 01:30 Thursday.
    const parts = zonedParts(Date.parse("2026-07-08T23:30:00Z"));
    expect(parts.weekday).toBe(4); // Thursday
    expect(parts.hour).toBe(1);
    expect(parts.minute).toBe(30);
    expect(parts.date).toBe("2026-07-09");
  });

  it("defaults to BAND_TIME_ZONE when no tz is given", () => {
    // 2026-01-01T00:00:00Z is CET (UTC+1) in Prague -> 01:00 local.
    const parts = zonedParts(Date.parse("2026-01-01T00:00:00Z"));
    expect(parts.hour).toBe(1);
    expect(parts.date).toBe("2026-01-01");
  });

  it("accepts an explicit timezone override, never the host's", () => {
    const parts = zonedParts(Date.parse("2026-01-01T00:00:00Z"), "UTC");
    expect(parts.hour).toBe(0);
    expect(parts.date).toBe("2026-01-01");
  });
});

describe("weeklyReminderSlot", () => {
  it("fires across the spring-forward transition into CEST", () => {
    // 2026-03-29T17:00:00Z is Sunday 19:00 CEST in Prague.
    expect(weeklyReminderSlot(Date.parse("2026-03-29T17:00:00Z"))).toEqual({
      dateKey: "2026-03-29",
    });
  });

  it("fires across the fall-back transition into CET", () => {
    // 2026-10-25T18:00:00Z is Sunday 19:00 CET in Prague.
    expect(weeklyReminderSlot(Date.parse("2026-10-25T18:00:00Z"))).toEqual({
      dateKey: "2026-10-25",
    });
  });

  it("does not fire 10 minutes before the slot, post fall-back", () => {
    // 2026-10-25T17:50:00Z is Sunday 18:50 CET.
    expect(weeklyReminderSlot(Date.parse("2026-10-25T17:50:00Z"))).toBeNull();
  });

  it("does not fire on a Saturday, even past 19:00 local", () => {
    // 2026-10-24T18:00:00Z is Saturday 20:00 CEST.
    expect(weeklyReminderSlot(Date.parse("2026-10-24T18:00:00Z"))).toBeNull();
  });
});
