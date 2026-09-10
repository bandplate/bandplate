import { describe, expect, it } from "vitest";
import { KNOWN_SECTION_WORDS } from "../server/song-text.js";
import {
  type EditorRow,
  isKnownSection,
  moveRow,
  newRow,
  normalizeSectionName,
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

  // A row with no name CANNOT be written: both conventions begin with the
  // label (`Verse: Am Dm7`, and the label alone above its words), so there is
  // nowhere to put its text. That is correct and deliberate.
  //
  // What it costs is the whole point of `ChartEditor`'s submit guard: dropping
  // row 3 here means a member who typed a verse into the row the editor opens
  // with, and did not name it, loses every word on Save with nothing said —
  // which is exactly what was reported. If this test is ever relaxed so a
  // nameless row survives, that guard is the thing to revisit; if it stays,
  // the guard is what keeps the loss from being silent.
  it("drops an empty row and a row with no name — the guarded case", () => {
    expect(
      rowsToText([
        { id: "1", label: "Verse", chords: "Am", lyrics: "" },
        { id: "2", label: "Chorus", chords: "", lyrics: "" },
        { id: "3", label: "", chords: "F", lyrics: "orphan" },
      ]),
    ).toEqual({ chords: "Verse: Am", lyrics: "" });
  });

  // The reported case in its narrowest form: words, no chords, a named
  // section. This one MUST survive — it is the row the guard exists to let
  // through once the member has named it.
  it("keeps a named section that has only words", () => {
    expect(rowsToText([{ id: "1", label: "Verse", chords: "", lyrics: "the words" }])).toEqual({
      chords: "",
      lyrics: "Verse\nthe words",
    });
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
