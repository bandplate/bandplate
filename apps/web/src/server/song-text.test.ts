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

  // Fix round 3 #1: "most"/"solo"/"coda" are ordinary English words, not
  // just Czech/chord-chart jargon. An English song with unlabeled chords
  // and a lyric line that just happens to be "Most" must NOT get promoted
  // into a fake "sections" chart (heading lost, order inverted, blank
  // lines stripped) — it must fall back to the safe raw two-block layout.
  it("does not treat a bare 'Most' lyric line as a section label without corroboration (unlabeled chords)", () => {
    const chords = ["Am F C G", "Am F G"].join("\n");
    const lyrics = [
      "I gave you all I had",
      "",
      "Most",
      "of what I never said",
      "",
      "and the rest stayed home",
    ].join("\n");

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual({ kind: "raw", chordText: chords, lyricsText: lyrics });
  });

  it("does not treat a bare 'Solo' lyric line as a label without corroboration, even standalone", () => {
    // Called directly (no chord-side context at all): self-corroboration
    // requires >=2 distinct section words in this same text. Only one
    // ambiguous word appears (and nothing else section-like), so it's not
    // trusted as a label.
    const sections = splitLyricsIntoSections(
      ["Solo", "guitar takes it away", "", "and then it fades"].join("\n"),
    );
    expect(sections).toEqual([
      {
        label: undefined,
        lines: ["Solo", "guitar takes it away", "and then it fades"],
      },
    ]);
  });

  it("DOES trust two distinct ambiguous words together as self-corroborating", () => {
    // "Solo" and "Coda" are each individually ambiguous, but two distinct
    // section words appearing in the same text is exactly the
    // self-corroboration signal — a coincidence of one ordinary word is
    // plausible, a coincidence of two different ones in section-label
    // position is not.
    const sections = splitLyricsIntoSections(
      ["Solo", "guitar takes it away", "", "Coda", "and then it fades"].join("\n"),
    );
    expect(sections).toEqual([
      { label: "Solo", lines: ["guitar takes it away"] },
      { label: "Coda", lines: ["and then it fades"] },
    ]);
  });

  it("trusts an ambiguous word once the chord side already has a matching recognized label", () => {
    // Chords use a real, unambiguous label ("Verse") AND a chord section
    // for "Most" itself, so the lyric "Most" line is corroborated
    // SPECIFICALLY — that exact label exists on the chord side — as
    // intentional structure (the Czech sense), even though "Most" alone in
    // the lyrics wouldn't self-corroborate.
    const chords = ["Verse: Am F C G", "Most: F C G Am"].join("\n");
    const lyrics = ["Verse 1", "line a", "", "Most", "line b"].join("\n");

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual({
      kind: "sections",
      sections: [
        { label: "Verse 1", chordLines: ["Am F C G"], lyricLines: ["line a"] },
        { label: "Most", chordLines: ["F C G Am"], lyricLines: ["line b"] },
      ],
    });
  });

  // Fix round 4: round 3's gate trusted an ambiguous lyric word the instant
  // the chord side recognized ANY label at all, never checking whether
  // THIS word had a matching chord section. A properly labelled chart
  // (Verse/Chorus/Bridge, no "Most" chord section anywhere) must NOT
  // promote a coincidental English "Most" lyric line into a false heading
  // — it stays ordinary content of whatever section it falls inside, so
  // the stanza around it isn't orphaned. See task-5-report.md
  // "Fix round 4" for the built-server reproduction this closes.
  it("does not trust an ambiguous lyric word just because the chords recognized a DIFFERENT label", () => {
    const chords = ["Verse: Am F C G", "Chorus: F C G Am", "Bridge: Dm G C"].join("\n");
    const lyrics = [
      "Verse 1",
      "I gave you all I had",
      "",
      "Chorus",
      "and the rest stayed home",
      "",
      "Most",
      "of what I never said",
    ].join("\n");

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual({
      kind: "sections",
      sections: [
        {
          label: "Verse 1",
          chordLines: ["Am F C G"],
          lyricLines: ["I gave you all I had"],
        },
        {
          // "Most" was not corroborated (no matching chord section), so it
          // stays a plain lyric line folded into the still-open "Chorus"
          // section rather than becoming its own heading.
          label: "Chorus",
          chordLines: ["F C G Am"],
          lyricLines: ["and the rest stayed home", "Most", "of what I never said"],
        },
        { label: "Bridge", chordLines: ["Dm G C"], lyricLines: [] },
      ],
    });
  });

  // Fix round 3 #1, pre-existing gap 1: unlabeled chords + labeled lyrics.
  // Previously this appended the whole chord block after all the lyrics
  // with no label and no "Chords" heading (`chordSections.length !== 0` and
  // `lyricSections.length !== 0`, so it never hit the old raw-fallback
  // guard, which required BOTH sides unrecognized). Must now fall back to
  // the raw two-block layout instead.
  it("falls back to raw when chords are unlabeled even though the lyrics have recognized section labels", () => {
    const chords = ["Am F C G", "F C G Am"].join("\n");
    const lyrics = ["Verse 1", "line a", "", "Chorus", "line b"].join("\n");

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual({ kind: "raw", chordText: chords, lyricsText: lyrics });
  });

  // Fix round 3 #1, pre-existing gap 2: partial recognition. A
  // Polish-style song where only "Refren" is a recognized word swallowed
  // "Zwrotka 2"/"Trzecia linia" into the Refren section's lyrics, since an
  // unrecognized label-shaped line is treated as ordinary content. With
  // unlabeled chords (a very plausible real case — a bare progression
  // pasted alongside properly-annotated lyrics), this must now fall back
  // to raw rather than scrambling the structure.
  it("falls back to raw on partial recognition instead of swallowing unrecognized labels into the wrong section", () => {
    const chords = ["Am E F C"].join("\n");
    const lyrics = [
      "Refren",
      "linia refrenu",
      "",
      "Zwrotka 2",
      "druga linia",
      "",
      "Trzecia linia",
    ].join("\n");

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual({ kind: "raw", chordText: chords, lyricsText: lyrics });
  });

  it("still interleaves a real Czech chart with a recognized (unambiguous) chord side", () => {
    const chords = ["Sloka: Dm C", "Refren: Bb A"].join("\n");
    const lyrics = ["Sloka 1", "radek jedna", "", "Refren", "radek dva"].join("\n");

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual({
      kind: "sections",
      sections: [
        { label: "Sloka 1", chordLines: ["Dm C"], lyricLines: ["radek jedna"] },
        { label: "Refren", chordLines: ["Bb A"], lyricLines: ["radek dva"] },
      ],
    });
  });

  // Accepted conservative false-negative (see task-5-report.md "Fix round
  // 4"): a genuinely single-section Czech chart, where "Most" is the ONLY
  // section on either side. The chord-side self-corroboration inside
  // `splitChordsIntoSections` requires >=2 distinct section words within
  // the chords text alone to trust an ambiguous word with no outside
  // context, so a lone "Most: ..." chord line isn't recognized as a label
  // — the whole chart falls back to the raw two-block layout rather than
  // interleaving. Raw is the documented safe fallback, so this is fine;
  // the rule is deliberately not contorted to rescue this single case.
  it("falls back to raw for a genuinely single-section Czech chart (accepted false negative)", () => {
    const chords = "Most: F C G Am";
    const lyrics = ["Most", "jenom slova"].join("\n");

    const chart = buildSongChart(chords, lyrics);

    expect(chart).toEqual({ kind: "raw", chordText: chords, lyricsText: lyrics });
  });
});
