import { describe, expect, it } from "vitest";
import { eventName } from "./format.js";

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
