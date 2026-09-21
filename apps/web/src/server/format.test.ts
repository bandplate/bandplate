import { describe, expect, it } from "vitest";
import { eventName, factsLine } from "./format.js";

describe("eventName", () => {
  it("is a band event's title and venue", () => {
    expect(
      eventName({ kind: "concert", title: "Live at The Attic", venue: "The Attic" }, null),
    ).toBe("Live at The Attic — The Attic");
    expect(eventName({ kind: "rehearsal", title: null, venue: null }, "Filip")).toBe("");
  });

  it("is whose day a personal event is", () => {
    expect(eventName({ kind: "personal", title: null, venue: null }, "Filip")).toBe("Filip");
    // An owner since removed: no name, and never a band-style fallback.
    expect(eventName({ kind: "personal", title: null, venue: null }, null)).toBe("");
  });
});

describe("factsLine", () => {
  it("joins what is there with commas and skips what is not", () => {
    expect(factsLine(["Dmi", null, "76 bpm", ""], "cs")).toBe("Dmi, 76 bpm");
    expect(factsLine([null, undefined, ""], "cs")).toBe("");
  });

  it("starts with a capital, because the catalog's kind words do not", () => {
    // `events.kindLabel` is lowercase in both locales ("zkouška", "rehearsal")
    // so it reads right mid-sentence; as the first word of a line it must not.
    expect(factsLine(["zkouška", "Dezerter"], "cs")).toBe("Zkouška, Dezerter");
    expect(factsLine(["živě", "17. září 2026"], "cs")).toBe("Živě, 17. září 2026");
    expect(factsLine(["rehearsal"], "en")).toBe("Rehearsal");
  });
});
