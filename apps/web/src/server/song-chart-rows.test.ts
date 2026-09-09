import { describe, expect, it } from "vitest";
import {
  type ChartRow,
  rowsToSongText,
  songChartRoundTrips,
  songToRows,
} from "./song-chart-rows.js";

const row = (label: string, chords: string, lyrics: string): ChartRow => ({
  label,
  chords,
  lyrics,
});

describe("songToRows", () => {
  it("reads a labelled chart in both conventions into rows", () => {
    const result = songToRows(
      "Verse: Am Dm7\nRefrén: F C G",
      "Verse\nŽivot si mě ubalil,\npomalu mě teď kouří.\n\nRefrén\nHoří, hoří, hoří.",
    );

    expect(result.kind).toBe("rows");
    if (result.kind !== "rows") return;
    expect(result.rows).toEqual([
      { label: "Verse", chords: "Am Dm7", lyrics: "Život si mě ubalil,\npomalu mě teď kouří." },
      { label: "Refrén", chords: "F C G", lyrics: "Hoří, hoří, hoří." },
    ]);
  });

  it("pairs a numbered lyric section with its unnumbered chord section", () => {
    // The parser matches "Verse 1" to "Verse" — a real chart repeats the same
    // changes for every verse.
    const result = songToRows("Verse: Am F", "Verse 1\nfirst\n\nVerse 2\nsecond");

    expect(result.kind).toBe("rows");
    if (result.kind !== "rows") return;
    expect(result.rows.map((r) => [r.label, r.chords])).toEqual([
      ["Verse 1", "Am F"],
      ["Verse 2", "Am F"],
    ]);
  });

  it("reads Czech labels, accents or not", () => {
    const result = songToRows("Sloka: Am\nRefrén: F", "Sloka\nprvní\n\nRefrén\ndruhý");
    expect(result.kind).toBe("rows");
    if (result.kind !== "rows") return;
    expect(result.rows.map((r) => r.label)).toEqual(["Sloka", "Refrén"]);
  });

  it("says empty when there is nothing yet", () => {
    expect(songToRows(null, null)).toEqual({ kind: "empty" });
    expect(songToRows("", "")).toEqual({ kind: "empty" });
  });

  it("refuses text it cannot name, rather than inventing rows", () => {
    // THE case that keeps this safe. A chord block with no `Label:` line is
    // what the screenshot that started this had — the parser degrades it to
    // plain text on the song page, and the editor must not pretend otherwise.
    expect(songToRows("    Verse\nAm Dm7", "    Verse\nsome words")).toEqual({ kind: "freeform" });
    // A song in a convention the vocabulary does not cover at all.
    expect(songToRows("Am - F - C", "some words\nmore words")).toEqual({ kind: "freeform" });
  });
});

describe("rowsToSongText", () => {
  it("writes each convention the way its parser reads it", () => {
    const text = rowsToSongText([
      row("Verse", "Am Dm7", "first line\nsecond line"),
      row("Refrén", "F C G", "hoří"),
    ]);

    expect(text.chords).toBe("Verse: Am Dm7\nRefrén: F C G");
    expect(text.lyrics).toBe("Verse\nfirst line\nsecond line\n\nRefrén\nhoří");
  });

  it("writes a second chord line bare, as a continuation", () => {
    const text = rowsToSongText([row("Verse", "Am Dm7\nF C", "words")]);
    expect(text.chords).toBe("Verse: Am Dm7\nF C");
  });

  it("writes a section that has chords but no words", () => {
    const text = rowsToSongText([row("Intro", "Am", ""), row("Verse", "F", "words")]);
    expect(text.chords).toBe("Intro: Am\nVerse: F");
    expect(text.lyrics).toBe("Verse\nwords");
  });

  it("drops a row with nothing in it, and a row with no name", () => {
    const text = rowsToSongText([
      row("Verse", "Am", "words"),
      row("Chorus", "", ""),
      row("", "F", "orphaned"),
    ]);
    expect(text.chords).toBe("Verse: Am");
    expect(text.lyrics).toBe("Verse\nwords");
  });
});

describe("songChartRoundTrips", () => {
  it("is true for a chart the parser reads back identically", () => {
    expect(
      songChartRoundTrips([row("Verse", "Am Dm7", "words"), row("Refrén", "F C G", "hoří")]),
    ).toBe(true);
  });

  it("is true for Czech labels", () => {
    expect(songChartRoundTrips([row("Sloka", "Am", "první"), row("Refrén", "F", "druhý")])).toBe(
      true,
    );
  });

  it("is true for an empty chart", () => {
    expect(songChartRoundTrips([])).toBe(true);
    expect(songChartRoundTrips([row("Verse", "", "")])).toBe(true);
  });

  it("is FALSE for a section name the parser does not know", () => {
    // "Breakdown" is in the vocabulary; "Kytarové sólo" is not. Better to say
    // so beside the row than to let the member find out on the song page.
    expect(songChartRoundTrips([row("Kytarové sólo", "Am", "words")])).toBe(false);
  });

  it("is false when a name would swallow the section next to it", () => {
    // Two rows, only one of them nameable: the unrecognised one's content gets
    // folded into its neighbour by the parser, which is exactly the silent
    // loss this check exists to catch.
    expect(songChartRoundTrips([row("Verse", "Am", "words"), row("Zpěv", "F", "more words")])).toBe(
      false,
    );
  });
});
