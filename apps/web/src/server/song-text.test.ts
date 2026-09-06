import { describe, expect, it } from "vitest";
import { buildSongChart, splitChordsIntoSections, splitLyricsIntoSections } from "./song-text.js";

describe("splitLyricsIntoSections", () => {
  it("splits label lines from their content, dropping the blank separator lines", () => {
    const lyrics = ["Verse 1", "Line one", "Line two", "", "Chorus", "Line three"].join("\n");
    const sections = splitLyricsIntoSections(lyrics);
    expect(sections).toEqual([
      { label: "Verse 1", lines: ["Line one", "Line two"] },
      { label: "Chorus", lines: ["Line three"] },
    ]);
  });

  it("treats text with no recognized section word as a single unlabeled section", () => {
    const sections = splitLyricsIntoSections("Just a couple\nof plain lines");
    expect(sections).toEqual([{ label: undefined, lines: ["Just a couple", "of plain lines"] }]);
  });
});

describe("splitChordsIntoSections", () => {
  it("splits 'Label: changes' lines into labeled sections", () => {
    const chords = ["Intro: Am - F", "Verse: Am - F - C - G (x2)", "Outro: Am (fade)"].join("\n");
    const sections = splitChordsIntoSections(chords);
    expect(sections).toEqual([
      { label: "Intro", lines: ["Am - F"] },
      { label: "Verse", lines: ["Am - F - C - G (x2)"] },
      { label: "Outro", lines: ["Am (fade)"] },
    ]);
  });

  it("attaches a continuation line with no recognized label to the previous section", () => {
    const chords = ["Verse: Am - F", "  (repeat twice)"].join("\n");
    const sections = splitChordsIntoSections(chords);
    expect(sections).toEqual([{ label: "Verse", lines: ["Am - F", "  (repeat twice)"] }]);
  });
});

describe("buildSongChart", () => {
  it("interleaves a chord section above every lyric section with a matching (number-stripped) label", () => {
    const chords = ["Intro: Am - F", "Verse: Am - F - C - G", "Chorus: F - C - G - Am"].join("\n");
    const lyrics = ["Verse 1", "line a", "", "Chorus", "line b", "", "Verse 2", "line c"].join(
      "\n",
    );

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual([
      { label: "Intro", chordLines: ["Am - F"], lyricLines: [] },
      { label: "Verse 1", chordLines: ["Am - F - C - G"], lyricLines: ["line a"] },
      { label: "Chorus", chordLines: ["F - C - G - Am"], lyricLines: ["line b"] },
      // Verse 2 reuses the SAME "Verse" chords — a real chart repeats the
      // same changes for every verse rather than needing a second entry.
      { label: "Verse 2", chordLines: ["Am - F - C - G"], lyricLines: ["line c"] },
    ]);
  });

  it("appends a trailing chord-only section (e.g. an outro) after every lyric section", () => {
    const chords = ["Verse: Am - F", "Outro: Am (fade)"].join("\n");
    const lyrics = ["Verse 1", "line a"].join("\n");

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual([
      { label: "Verse 1", chordLines: ["Am - F"], lyricLines: ["line a"] },
      { label: "Outro", chordLines: ["Am (fade)"], lyricLines: [] },
    ]);
  });

  it("falls back to chord sections then lyric sections, unpaired, when lyrics are empty", () => {
    const chart = buildSongChart("Verse: Am - F", "");
    expect(chart).toEqual([{ label: "Verse", chordLines: ["Am - F"], lyricLines: [] }]);
  });

  it("falls back to lyric sections, unpaired, when chords are empty", () => {
    const chart = buildSongChart(null, "Verse 1\nline a");
    expect(chart).toEqual([{ label: "Verse 1", chordLines: [], lyricLines: ["line a"] }]);
  });

  it("returns an empty chart when both fields are empty", () => {
    expect(buildSongChart(null, null)).toEqual([]);
    expect(buildSongChart("", "")).toEqual([]);
  });
});
