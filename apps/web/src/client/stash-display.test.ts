import { describe, expect, it } from "vitest";
import { stashName, stashNote, stashSongField } from "./stash-display.js";

const words = { noSong: "Zatím bez písně", unknownSong: "Neznámá píseň" };

describe("what a stash recording is called", () => {
  it("goes by its own label, with the song underneath", () => {
    const parts = { songId: "s-1", songTitle: "Čoudy", label: "mezihra" };
    expect(stashName(parts, words)).toBe("mezihra");
    // The song is what it belongs to, and that is the second line.
    expect(stashNote(parts, words)).toBe("Čoudy");
    expect(stashSongField(parts, words)).toBe("Čoudy");
  });

  it("goes by its song when it has no label", () => {
    const parts = { songId: "s-1", songTitle: "Čoudy", label: null };
    expect(stashName(parts, words)).toBe("Čoudy");
    // Not twice: it is already the name above.
    expect(stashNote(parts, words)).toBeNull();
    expect(stashSongField(parts, words)).toBe("Čoudy");
  });

  it("goes by its own label when no song was chosen, and adds nothing under it", () => {
    const parts = { songId: null, songTitle: undefined, label: "nápad na mezihru" };
    expect(stashName(parts, words)).toBe("nápad na mezihru");
    expect(stashNote(parts, words)).toBeNull();
    // The field answers the question it was asked, and there is no song.
    expect(stashSongField(parts, words)).toBe("—");
  });

  it("falls back to 'no song yet' when it has neither", () => {
    const parts = { songId: null, songTitle: null, label: null };
    expect(stashName(parts, words)).toBe("Zatím bez písně");
    expect(stashNote(parts, words)).toBeNull();
    expect(stashSongField(parts, words)).toBe("—");
  });

  it("tells a missing song from a deleted one", () => {
    // A song id is filed and the song is gone: that is not "no song yet",
    // and the field must not say "—" as if none had been chosen.
    const parts = { songId: "s-gone", songTitle: undefined, label: null };
    expect(stashName(parts, words)).toBe("Neznámá píseň");
    expect(stashNote(parts, words)).toBeNull();
    expect(stashSongField(parts, words)).toBe("Neznámá píseň");
    // With a label the label is the name, and the deleted song is still what
    // the second line has to report — saying nothing there would read as a
    // recording that never had one.
    expect(stashName({ ...parts, label: "druhý pokus" }, words)).toBe("druhý pokus");
    expect(stashNote({ ...parts, label: "druhý pokus" }, words)).toBe("Neznámá píseň");
    expect(stashSongField({ ...parts, label: "druhý pokus" }, words)).toBe("Neznámá píseň");
  });
});
