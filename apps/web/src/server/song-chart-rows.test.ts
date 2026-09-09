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

// --- Repeated section names ------------------------------------------------
//
// The bug this pins: a chart whose sections repeat — three verses written out
// three times, which is how a chart is normally written — grew by two empty
// sections on EVERY save. `buildSongChart` paired all three lyric "Sloka"s
// with the first chord "Sloka", so the other two were never consumed and were
// appended as chord-only sections; the row editor rendered those as rows with
// no lyrics and wrote them straight back. 6 rows, then 8, then 10.
//
// Removing the empty rows by hand could never fix it: the next parse of the
// corrected text produced them again.
describe("repeated section names", () => {
  const CHORDS = [
    "Sloka: Am Dm Em7",
    "Refren: C Em7 F Fm7",
    "Sloka: Am Dm Em7",
    "Sloka: Am Dm F",
  ].join("\n");
  const LYRICS = [
    "Sloka\nfirst verse",
    "Refren\nthe hook",
    "Sloka\nsecond verse",
    "Sloka\nlast verse",
  ].join("\n\n");

  it("gives one row per section, none of them empty", () => {
    const result = songToRows(CHORDS, LYRICS);
    expect(result.kind).toBe("rows");
    if (result.kind !== "rows") return;
    expect(result.rows).toHaveLength(4);
    expect(result.rows.every((r) => r.lyrics !== "")).toBe(true);
    expect(result.rows.map((r) => r.label)).toEqual(["Sloka", "Refren", "Sloka", "Sloka"]);
  });

  it("gives the nth repeat the nth chords, not always the first", () => {
    const result = songToRows(CHORDS, LYRICS);
    if (result.kind !== "rows") throw new Error("expected rows");
    // The last verse turns around differently. Reusing the first section here
    // would print the wrong chords under it.
    expect(result.rows[3]?.chords).toBe("Am Dm F");
    expect(result.rows[0]?.chords).toBe("Am Dm Em7");
  });

  it("applies a once-written section to every repeat of it", () => {
    // A chart that names each section's chords once and then repeats the
    // section in the lyrics is the other common convention.
    const result = songToRows("Sloka: Am Dm Em7\nRefren: C F", LYRICS);
    if (result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toHaveLength(4);
    expect(result.rows.map((r) => r.chords)).toEqual([
      "Am Dm Em7",
      "C F",
      "Am Dm Em7",
      "Am Dm Em7",
    ]);
  });

  it("still surfaces a chord section with genuinely no lyrics", () => {
    // Four chord Slokas, three sung. The fourth is real and must not vanish.
    const result = songToRows(`${CHORDS}\nSloka: Am Dm Em7`, LYRICS);
    if (result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toHaveLength(5);
    expect(result.rows[4]?.lyrics).toBe("");
  });

  it("is stable across repeated saves — the actual reported symptom", () => {
    let chords = CHORDS;
    let lyrics = LYRICS;
    const shapes: number[] = [];
    for (let save = 0; save < 4; save++) {
      const result = songToRows(chords, lyrics);
      if (result.kind !== "rows") throw new Error("expected rows");
      shapes.push(result.rows.length);
      ({ chords, lyrics } = rowsToSongText(result.rows));
    }
    expect(shapes).toEqual([4, 4, 4, 4]);
  });
});
