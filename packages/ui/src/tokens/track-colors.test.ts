import { describe, expect, it } from "vitest";
import { isTrackColorKey, TRACK_COLOR_KEYS, TRACK_COLORS, trackColorVar } from "./track-colors.js";

describe("isTrackColorKey", () => {
  it("knows the palette's keys and nothing else", () => {
    expect(isTrackColorKey("rust")).toBe(true);
    expect(isTrackColorKey("RUST")).toBe(false);
    expect(isTrackColorKey("#ff0000")).toBe(false);
  });

  it("is not fooled by what every object inherits", () => {
    // `in` would say yes to these; a stored colour of "toString" is not one.
    expect(isTrackColorKey("toString")).toBe(false);
    expect(isTrackColorKey("__proto__")).toBe(false);
  });
});

describe("trackColorVar", () => {
  it("paints a known key with its theme variable", () => {
    expect(trackColorVar("sea")).toBe("var(--bp-track-sea)");
  });

  it("paints no colour, or a key that has since been dropped, as the neutral", () => {
    // Never a hash of the slug: that would look like a choice nobody made.
    expect(trackColorVar(null)).toBe("var(--bp-track-none)");
    expect(trackColorVar(undefined)).toBe("var(--bp-track-none)");
    expect(trackColorVar("")).toBe("var(--bp-track-none)");
    expect(trackColorVar("mauve")).toBe("var(--bp-track-none)");
  });
});

describe("TRACK_COLOR_KEYS", () => {
  it("lists every colour once, in the order the picker shows them", () => {
    expect(TRACK_COLOR_KEYS).toEqual(Object.keys(TRACK_COLORS));
    expect(new Set(TRACK_COLOR_KEYS).size).toBe(TRACK_COLOR_KEYS.length);
  });

  it("gives every colour its own variable, so no two lanes can resolve to one", () => {
    const vars = TRACK_COLOR_KEYS.map((key) => TRACK_COLORS[key].cssVar);
    expect(new Set(vars).size).toBe(vars.length);
  });
});
