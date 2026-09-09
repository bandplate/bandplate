// The row editor's decisions, with no DOM in sight — same split as
// `upload-actions.ts` and `vote-favorite-actions.ts`.
//
// One rule worth stating: this file must NOT hold a second copy of the section
// vocabulary. `song-text.ts` owns it and exports `KNOWN_SECTION_WORDS`; the
// page passes it in. A duplicated list here would go stale the first time a
// word is added to the parser, and the symptom would be a warning beside a
// name that actually works.

export interface EditorRow {
  /** Stable across reorders, so a keyed list does not re-mount inputs mid-type. */
  id: string;
  label: string;
  chords: string;
  lyrics: string;
}

let rowIdCounter = 0;

export function newRow(label = "", chords = "", lyrics = ""): EditorRow {
  rowIdCounter += 1;
  return { id: `r${rowIdCounter}`, label, chords, lyrics };
}

/**
 * Lowercase, strip diacritics, drop a trailing number — the same folding
 * `normalizeLabel` does in the parser, in one line and without importing it.
 * "Sloka 1", "sloka" and "SLOKA" all land on the same word.
 */
export function normalizeSectionName(label: string): string {
  return label
    .replace(/\s*\d+\s*$/, "")
    .trim()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** Whether the parser will recognise this row's name as a section. */
export function isKnownSection(label: string, vocabulary: readonly string[]): boolean {
  const normalized = normalizeSectionName(label);
  return normalized.length > 0 && vocabulary.includes(normalized);
}

/**
 * Rows out to the two columns, in the conventions each parser reads.
 *
 * Deliberately the same shape as `server/song-chart-rows.ts`'s
 * `rowsToSongText`, and tested against the same cases — the server writes the
 * initial rows, the client writes them back, and both have to agree on the
 * text or a song would change shape simply by being opened and saved.
 */
export function rowsToText(rows: EditorRow[]): { chords: string; lyrics: string } {
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

/** Move a row one place up or down. Out of range is a no-op, not a wrap. */
export function moveRow(rows: EditorRow[], index: number, direction: -1 | 1): EditorRow[] {
  const target = index + direction;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) {
    return rows;
  }
  const next = [...rows];
  const [moved] = next.splice(index, 1);
  if (!moved) {
    return rows;
  }
  next.splice(target, 0, moved);
  return next;
}
