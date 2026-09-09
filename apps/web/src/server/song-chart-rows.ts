// The bridge between the song page's chart and a ROW editor.
//
// `song-text.ts` parses two free-text columns into `ChartSection[]` —
// `{label, chordLines, lyricLines}` — which is already exactly a row. This
// module turns that into a row list a form can edit, and turns rows back into
// the two columns the schema stores.
//
// --- Why not change the schema -------------------------------------------
//
// `songs.chord_progression` and `songs.lyrics` stay two plain-text columns.
// The ingest contract writes them, the song page reads them, and a chart that
// nobody ever opens in the row editor must keep rendering exactly as it does
// today. So the row editor is a VIEW over the text, not a replacement for it,
// and every save has to write text the existing parser reads back identically.
// `songChartRoundTrips` is that promise, and it is tested.
//
// --- The free-text escape hatch is not optional ---------------------------
//
// `buildSongChart` degrades on purpose: a song written in a convention it does
// not recognise renders as plain text rather than being mangled. Rows cannot
// hold that — a row IS a label — so `songToRows` refuses rather than
// inventing structure, and the editor falls back to the two text boxes. That
// refusal is the whole reason this is safe: no song silently loses its shape
// by being opened.
import { buildSongChart } from "./song-text.js";

export interface ChartRow {
  /** The section's name — "Verse", "Refrén". A row without one is not a row. */
  label: string;
  /** One line, usually: "Am Dm7". Extra lines are kept and written beneath. */
  chords: string;
  lyrics: string;
}

export type SongRowsResult =
  | { kind: "rows"; rows: ChartRow[] }
  /** Nothing written yet — the editor starts with one empty row. */
  | { kind: "empty" }
  /**
   * Text the parser did not resolve into labelled sections. NOT an error: it
   * is the shape a song keeps when it was written in a convention this app
   * does not know, and the editor must show it as text rather than guess.
   */
  | { kind: "freeform" };

export function songToRows(
  chordText: string | null | undefined,
  lyricsText: string | null | undefined,
): SongRowsResult {
  const chart = buildSongChart(chordText, lyricsText);
  if (chart.kind === "none") {
    return { kind: "empty" };
  }
  if (chart.kind === "raw") {
    return { kind: "freeform" };
  }
  // A section with no label cannot be a row, and half-rows would be worse than
  // text: the editor would silently drop whatever it could not name.
  if (chart.sections.some((s) => !s.label || s.label.trim() === "")) {
    return { kind: "freeform" };
  }
  return {
    kind: "rows",
    rows: chart.sections.map((s) => ({
      label: (s.label ?? "").trim(),
      chords: s.chordLines.join("\n"),
      lyrics: s.lyricLines.join("\n"),
    })),
  };
}

/**
 * Rows back into the two columns, in the exact conventions
 * `splitChordsIntoSections` and `splitLyricsIntoSections` read:
 *
 *   chords  — one section per line, `Label: changes`. A section with more
 *             than one chord line writes the first after the colon and the
 *             rest bare beneath, which is how the parser reads a continuation.
 *   lyrics  — the label alone on its own line, its words beneath, a blank
 *             line between sections.
 *
 * A row with nothing in it is dropped; a row with a label but no content
 * writes only its label, which is what an intro with no words looks like.
 */
export function rowsToSongText(rows: ChartRow[]): { chords: string; lyrics: string } {
  const chordLines: string[] = [];
  const lyricBlocks: string[] = [];

  for (const row of rows) {
    const label = row.label.trim();
    if (!label) {
      continue;
    }
    const chords = row.chords.replace(/\r\n/g, "\n").trim();
    const lyrics = row.lyrics.replace(/\r\n/g, "\n").trim();
    if (!chords && !lyrics) {
      continue;
    }

    if (chords) {
      const [first, ...rest] = chords.split("\n");
      chordLines.push(`${label}: ${first}`);
      for (const line of rest) {
        chordLines.push(line);
      }
    }
    if (lyrics) {
      lyricBlocks.push(`${label}\n${lyrics}`);
    }
  }

  return { chords: chordLines.join("\n"), lyrics: lyricBlocks.join("\n\n") };
}

/**
 * Does writing these rows out and reading them back give the same rows?
 *
 * The editor calls this before saving. `false` means the parser would read the
 * text differently from what is on screen — a section name it does not
 * recognise, most often — and the member is told which row rather than finding
 * out later on the song page. Cheap: it is the same two functions this module
 * already exports.
 */
export function songChartRoundTrips(rows: ChartRow[]): boolean {
  const text = rowsToSongText(rows);
  const back = songToRows(text.chords, text.lyrics);
  if (back.kind !== "rows") {
    // Everything empty round-trips to "empty", which is correct, not a loss.
    return back.kind === "empty" && rowsToSongText(rows).chords === "" && text.lyrics === "";
  }
  const expected = rows.filter((r) => r.label.trim() && (r.chords.trim() || r.lyrics.trim()));
  if (back.rows.length !== expected.length) {
    return false;
  }
  return back.rows.every((got, i) => {
    const want = expected[i];
    if (!want) {
      return false;
    }
    return (
      got.label === want.label.trim() &&
      got.chords === want.chords.trim() &&
      got.lyrics === want.lyrics.trim()
    );
  });
}
