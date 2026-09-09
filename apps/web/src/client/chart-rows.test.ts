import { describe, expect, it } from "vitest";
import { KNOWN_SECTION_WORDS } from "../server/song-text.js";
import {
  type EditorRow,
  isKnownSection,
  looksLikeChordLine,
  moveRow,
  newRow,
  normalizeSectionName,
  parsePastedChart,
  rowsToText,
} from "./chart-rows.js";

const VOCAB = KNOWN_SECTION_WORDS;

describe("normalizeSectionName", () => {
  it("folds case, diacritics and a trailing number the way the parser does", () => {
    expect(normalizeSectionName("Refrén")).toBe("refren");
    expect(normalizeSectionName("SLOKA 2")).toBe("sloka");
    expect(normalizeSectionName("  Předehra  ")).toBe("predehra");
    expect(normalizeSectionName("Verse 1")).toBe("verse");
  });
});

describe("isKnownSection", () => {
  it("accepts every word the parser knows, in either language", () => {
    for (const name of ["Verse", "Chorus", "Bridge", "Sloka", "Refrén", "Předehra", "Mezihra"]) {
      expect(isKnownSection(name, VOCAB)).toBe(true);
    }
  });

  it("rejects a name the parser would not recognise", () => {
    // The warning this drives is the whole point: better said beside the row
    // than discovered on the song page.
    expect(isKnownSection("Kytarové sólo", VOCAB)).toBe(false);
    expect(isKnownSection("Zpěv", VOCAB)).toBe(false);
    expect(isKnownSection("", VOCAB)).toBe(false);
  });

  it("is driven by the parser's own list, not a copy", () => {
    // If this ever fails, someone has retyped the vocabulary somewhere.
    expect(VOCAB).toContain("refren");
    expect(VOCAB).toContain("mezihra");
  });
});

describe("rowsToText", () => {
  const rows: EditorRow[] = [
    { id: "1", label: "Verse", chords: "Am Dm7", lyrics: "first\nsecond" },
    { id: "2", label: "Refrén", chords: "F C G", lyrics: "hoří" },
  ];

  it("writes each convention the way its parser reads it", () => {
    expect(rowsToText(rows)).toEqual({
      chords: "Verse: Am Dm7\nRefrén: F C G",
      lyrics: "Verse\nfirst\nsecond\n\nRefrén\nhoří",
    });
  });

  it("agrees with the server's writer, byte for byte", async () => {
    // The server writes the initial rows and the client writes them back, so a
    // song must not change shape merely by being opened and saved.
    const { rowsToSongText } = await import("../server/song-chart-rows.js");
    expect(rowsToText(rows)).toEqual(
      rowsToSongText(rows.map(({ label, chords, lyrics }) => ({ label, chords, lyrics }))),
    );
  });

  it("drops an empty row and a row with no name", () => {
    expect(
      rowsToText([
        { id: "1", label: "Verse", chords: "Am", lyrics: "" },
        { id: "2", label: "Chorus", chords: "", lyrics: "" },
        { id: "3", label: "", chords: "F", lyrics: "orphan" },
      ]),
    ).toEqual({ chords: "Verse: Am", lyrics: "" });
  });
});

describe("moveRow", () => {
  const rows = [newRow("A"), newRow("B"), newRow("C")];

  it("moves up and down", () => {
    expect(moveRow(rows, 1, -1).map((r) => r.label)).toEqual(["B", "A", "C"]);
    expect(moveRow(rows, 1, 1).map((r) => r.label)).toEqual(["A", "C", "B"]);
  });

  it("does nothing at the ends — no wrapping", () => {
    expect(moveRow(rows, 0, -1)).toBe(rows);
    expect(moveRow(rows, 2, 1)).toBe(rows);
  });
});

describe("looksLikeChordLine", () => {
  it("recognises chord lines, decoration and all", () => {
    expect(looksLikeChordLine("Am Dm7 F C")).toBe(true);
    expect(looksLikeChordLine("Am - F - C - G (x2)")).toBe(true);
    expect(looksLikeChordLine("| Am | F |")).toBe(true);
    expect(looksLikeChordLine("F#m7 Bb C/E")).toBe(true);
  });

  it("does not mistake words for chords", () => {
    expect(looksLikeChordLine("Život si mě ubalil,")).toBe(false);
    expect(looksLikeChordLine("and I am burning now")).toBe(false);
  });
});

describe("parsePastedChart", () => {
  it("splits a chart in the shape people actually have", () => {
    const rows = parsePastedChart(
      `Verse
Am Dm7
Život si mě ubalil,
pomalu mě teď kouří.

Refrén: F C G
Hoří, hoří, hoří.`,
      VOCAB,
    );

    expect(rows.map((r) => [r.label, r.chords, r.lyrics])).toEqual([
      ["Verse", "Am Dm7", "Život si mě ubalil,\npomalu mě teď kouří."],
      ["Refrén", "F C G", "Hoří, hoří, hoří."],
    ]);
  });

  it("takes a label with a trailing colon and nothing after it", () => {
    const rows = parsePastedChart("Chorus:\nF C\nwords here", VOCAB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Chorus", chords: "F C", lyrics: "words here" });
  });

  it("puts text it cannot name into one unnamed row rather than losing it", () => {
    // Nothing is dropped; the member names it and the warning goes away.
    const rows = parsePastedChart("some words\nmore words", VOCAB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "", lyrics: "some words\nmore words" });
  });
});
