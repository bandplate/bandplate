// The de-duplication rule behind `InstrumentSet.astro`.
//
// The component is `.astro` and renders in a template, so what is testable —
// and what actually carries the decision — is `instrumentMark`: two
// instruments collapse into one glyph exactly when this matches.
//
// It lives in `@bandplate/ui`, which has no test runner of its own; this is
// the nearest suite to the only component that calls it.
import { instrumentInitials, instrumentMark } from "@bandplate/ui/icons/instruments.js";
import { describe, expect, it } from "vitest";

describe("instrumentInitials", () => {
  it("takes the first letter of each of the first two words", () => {
    expect(instrumentInitials("French Horn")).toBe("FH");
    expect(instrumentInitials("Electric Bass Guitar")).toBe("EB");
    // One word gives one letter — which is why `instrumentMark` refuses to
    // merge on initials.
    expect(instrumentInitials("Trombone")).toBe("T");
  });
});

describe("instrumentMark", () => {
  it("matches for two instruments an admin gave the same glyph", () => {
    // The case this exists for: bass recorded twice, kept as two instruments
    // because the stems are two files.
    expect(instrumentMark({ icon: "guitar-bass-head", label: "Bass" })).toBe(
      instrumentMark({ icon: "guitar-bass-head", label: "Live Bass" }),
    );
  });

  it("differs for different glyphs", () => {
    expect(instrumentMark({ icon: "guitar-bass-head", label: "Bass" })).not.toBe(
      instrumentMark({ icon: "drum-kit", label: "Drums" }),
    );
  });

  it("treats an UNKNOWN icon exactly as a missing one", () => {
    // An unknown key draws initials, so a run holding two different dead keys
    // must not read as two different marks.
    expect(instrumentMark({ icon: "no-such-glyph", label: "Kazoo" })).toBe(
      instrumentMark({ icon: null, label: "Kazoo" }),
    );
    expect(instrumentMark({ label: "kazoo " })).toBe(
      instrumentMark({ icon: null, label: "Kazoo" }),
    );
  });

  it("keeps icon-less instruments apart even when they draw the same initials", () => {
    // "Trombone", "Trumpet" and "Tuba" all render "T". Merging them would lose
    // two real instruments to a shared first letter.
    const marks = new Set(
      ["Trombone", "Trumpet", "Tuba"].map((label) => instrumentMark({ label })),
    );
    expect(marks.size).toBe(3);
  });

  it("never lets an icon-less instrument collide with a glyph of the same name", () => {
    expect(instrumentMark({ icon: null, label: "trumpet" })).not.toBe(
      instrumentMark({ icon: "trumpet", label: "Trumpet" }),
    );
  });
});
