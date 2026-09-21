import { describe, expect, it } from "vitest";
import { chartChanged, SONG_THROTTLE_MS, songNotificationKind } from "./songs.js";

describe("SONG_THROTTLE_MS", () => {
  it("is 6 hours", () => {
    expect(SONG_THROTTLE_MS).toBe(21_600_000);
  });
});

describe("chartChanged", () => {
  it("is false when nothing changed", () => {
    expect(
      chartChanged(
        { chordProgression: "C G Am F", lyrics: "verse one" },
        { chordProgression: "C G Am F", lyrics: "verse one" },
      ),
    ).toBe(false);
  });

  it("ignores CRLF vs LF line endings", () => {
    expect(
      chartChanged(
        { chordProgression: "C G\r\nAm F", lyrics: null },
        { chordProgression: "C G\nAm F", lyrics: null },
      ),
    ).toBe(false);
  });

  it("ignores trailing spaces on a line and on the whole text", () => {
    expect(
      chartChanged(
        { chordProgression: "C G  \nAm F  ", lyrics: null },
        { chordProgression: "C G\nAm F", lyrics: null },
      ),
    ).toBe(false);
  });

  it("treats null and empty string as equivalent", () => {
    expect(
      chartChanged({ chordProgression: null, lyrics: null }, { chordProgression: "", lyrics: "" }),
    ).toBe(false);
  });

  it("detects a real edit to the chord progression", () => {
    expect(
      chartChanged(
        { chordProgression: "C G Am F", lyrics: null },
        { chordProgression: "C G Am G", lyrics: null },
      ),
    ).toBe(true);
  });

  it("detects a real edit to the lyrics", () => {
    expect(
      chartChanged(
        { chordProgression: null, lyrics: "verse one" },
        { chordProgression: null, lyrics: "verse two" },
      ),
    ).toBe(true);
  });
});

describe("songNotificationKind", () => {
  it("is created when only created events are present", () => {
    expect(songNotificationKind(["created"])).toBe("created");
  });

  it("is edited when only edited events are present", () => {
    expect(songNotificationKind(["edited", "edited"])).toBe("edited");
  });

  it("prefers created when both happened within the throttle window", () => {
    expect(songNotificationKind(["created", "edited"])).toBe("created");
    expect(songNotificationKind(["edited", "created"])).toBe("created");
  });
});
