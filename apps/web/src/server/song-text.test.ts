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

  it("recognizes Czech section labels, including with diacritics", () => {
    const lyrics = [
      "Sloka 1",
      "Řádek jedna",
      "",
      "Refrén",
      "Řádek dva",
      "",
      "Most",
      "Řádek tři",
    ].join("\n");
    const sections = splitLyricsIntoSections(lyrics);
    expect(sections).toEqual([
      { label: "Sloka 1", lines: ["Řádek jedna"] },
      { label: "Refrén", lines: ["Řádek dva"] },
      { label: "Most", lines: ["Řádek tři"] },
    ]);
  });

  it("recognizes the same Czech label whether or not it carries diacritics", () => {
    // "Refrén" and "Refren" both normalize to the same ASCII key (NFKD
    // diacritic stripping), so either spelling must be recognized.
    const withDiacritic = splitLyricsIntoSections("Refrén\nline");
    const without = splitLyricsIntoSections("Refren\nline");
    expect(withDiacritic).toEqual([{ label: "Refrén", lines: ["line"] }]);
    expect(without).toEqual([{ label: "Refren", lines: ["line"] }]);
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

  it("splits Czech 'Label: changes' lines, diacritics and all", () => {
    const chords = ["Předehra: Dm - C", "Sloka: Dm - C - Bb - A", "Dohra: Dm (doznívá)"].join("\n");
    const sections = splitChordsIntoSections(chords);
    expect(sections).toEqual([
      { label: "Předehra", lines: ["Dm - C"] },
      { label: "Sloka", lines: ["Dm - C - Bb - A"] },
      { label: "Dohra", lines: ["Dm (doznívá)"] },
    ]);
  });
});

describe("buildSongChart", () => {
  it("interleaves a chord section above every lyric section with a matching (number-stripped) label", () => {
    const chords = ["Intro: Am - F", "Verse: Am - F - C - G", "Chorus: F - C - G - Am"].join("\n");
    const lyrics = ["Verse 1", "line a", "", "Chorus", "line b", "", "Verse 2", "line c"].join(
      "\n",
    );

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual({
      kind: "sections",
      sections: [
        { label: "Intro", chordLines: ["Am - F"], lyricLines: [] },
        { label: "Verse 1", chordLines: ["Am - F - C - G"], lyricLines: ["line a"] },
        { label: "Chorus", chordLines: ["F - C - G - Am"], lyricLines: ["line b"] },
        // Verse 2 reuses the SAME "Verse" chords — a real chart repeats
        // the same changes for every verse rather than needing a second
        // entry.
        { label: "Verse 2", chordLines: ["Am - F - C - G"], lyricLines: ["line c"] },
      ],
    });
  });

  it("appends a trailing chord-only section (e.g. an outro) after every lyric section", () => {
    const chords = ["Verse: Am - F", "Outro: Am (fade)"].join("\n");
    const lyrics = ["Verse 1", "line a"].join("\n");

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual({
      kind: "sections",
      sections: [
        { label: "Verse 1", chordLines: ["Am - F"], lyricLines: ["line a"] },
        { label: "Outro", chordLines: ["Am (fade)"], lyricLines: [] },
      ],
    });
  });

  it("falls back to chord sections then lyric sections, unpaired, when lyrics are empty", () => {
    const chart = buildSongChart("Verse: Am - F", "");
    expect(chart).toEqual({
      kind: "sections",
      sections: [{ label: "Verse", chordLines: ["Am - F"], lyricLines: [] }],
    });
  });

  it("falls back to lyric sections, unpaired, when chords are empty", () => {
    const chart = buildSongChart(null, "Verse 1\nline a");
    expect(chart).toEqual({
      kind: "sections",
      sections: [{ label: "Verse 1", chordLines: [], lyricLines: ["line a"] }],
    });
  });

  it("returns kind 'none' when both fields are empty", () => {
    expect(buildSongChart(null, null)).toEqual({ kind: "none" });
    expect(buildSongChart("", "")).toEqual({ kind: "none" });
  });

  it("interleaves real Czech input, matching Sloka/Refrén/Most across diacritics", () => {
    const chords = [
      "Předehra: Dm - C - Bb - A",
      "Sloka: Dm - C - Bb - A (x2)",
      "Refrén: Bb - A - Dm",
      "Most: Gm - A - Dm",
      "Dohra: Dm (doznívá)",
    ].join("\n");
    const lyrics = [
      "Sloka 1",
      "Jedeme dál po cestě, co nikdy nekončí",
      "",
      "Refrén",
      "Zpátky se nedívej, jeď dál",
      "",
      "Sloka 2",
      "Za oknem mizí města, jedno jak druhé",
      "",
      "Most",
      "Někde na půli cesty najdeme domov",
    ].join("\n");

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual({
      kind: "sections",
      sections: [
        { label: "Předehra", chordLines: ["Dm - C - Bb - A"], lyricLines: [] },
        {
          label: "Sloka 1",
          chordLines: ["Dm - C - Bb - A (x2)"],
          lyricLines: ["Jedeme dál po cestě, co nikdy nekončí"],
        },
        {
          label: "Refrén",
          chordLines: ["Bb - A - Dm"],
          lyricLines: ["Zpátky se nedívej, jeď dál"],
        },
        // Sloka 2 reuses the same "Sloka" chords, same as the English
        // Verse-repeat case above.
        {
          label: "Sloka 2",
          chordLines: ["Dm - C - Bb - A (x2)"],
          lyricLines: ["Za oknem mizí města, jedno jak druhé"],
        },
        {
          label: "Most",
          chordLines: ["Gm - A - Dm"],
          lyricLines: ["Někde na půli cesty najdeme domov"],
        },
        { label: "Dohra", chordLines: ["Dm (doznívá)"], lyricLines: [] },
      ],
    });
  });

  // The regression this whole finding is about: before this fix, unrecognized
  // text on both sides (no English OR Czech section words) fell through to
  // the interleaving branch anyway, since neither `chordSections.length` nor
  // `lyricSections.length` was 0 — producing lyrics-before-chords (order
  // inverted) with every blank line silently dropped. A song in a language
  // `SECTION_WORDS` doesn't cover must degrade to the ORIGINAL two-block
  // layout instead: chords above lyrics, verbatim text, blank lines intact.
  it("falls back to a raw two-block layout, chords above lyrics, when nothing is recognized on either side", () => {
    const chords = "Dm C Bb A, opakovat";
    const lyrics = ["Jen pár řádků", "", "co nemají žádnou nálepku", "", "vůbec žádnou"].join("\n");

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual({ kind: "raw", chordText: chords, lyricsText: lyrics });
  });

  it("raw fallback works with only one side present (still no recognized label)", () => {
    expect(buildSongChart(null, "Just a couple\nof plain lines")).toEqual({
      kind: "raw",
      chordText: undefined,
      lyricsText: "Just a couple\nof plain lines",
    });
    expect(buildSongChart("Dm C Bb A", null)).toEqual({
      kind: "raw",
      chordText: "Dm C Bb A",
      lyricsText: undefined,
    });
  });
});
