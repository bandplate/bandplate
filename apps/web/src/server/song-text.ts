// Splits a song's chord progression and lyrics into labeled sections
// (Verse/Chorus/Bridge/… — and the band's own language, Czech: Sloka/
// Refrén/Most/…) and interleaves them into one chart — the review's main
// design finding on the song page: a `<pre>` with a bigger font gave
// structural markers ("Verse 1", "Chorus") zero typographic distinction
// from the lyric lines, and the two blocks (chords, lyrics) had no
// relationship to each other despite being read together. This is the
// fix: parse both fields by their section labels, pair a lyric section with
// the chord section for the same part of the song (matched after stripping
// a trailing verse number — "Verse 1" and "Verse 2" both pair with a single
// "Verse" chord line, since a real chart repeats the same changes for every
// verse), and render one interleaved sequence instead of two stacked
// unrelated `<pre>` blocks.
//
// This is a best-effort heuristic over free text, not a structured schema
// (the schema stores `chordProgression`/`lyrics` as plain text columns) —
// it degrades safely: a song whose text names no recognizable section
// falls back to the ORIGINAL two-block layout (raw text, chords above
// lyrics, blank lines intact) via `buildSongChart`'s `"raw"` result — see
// there for why a re-run of the labeled/paired logic on unrecognized text
// is actively worse, not just unhelpful.
import { normalizeTitle } from "@bandlib/core";

const SECTION_WORDS = new Set([
  "intro",
  "verse",
  "chorus",
  "pre-chorus",
  "prechorus",
  "bridge",
  "outro",
  "hook",
  "refrain",
  "interlude",
  "tag",
  "breakdown",
  // Czech — this band's actual language. Diacritics are handled by
  // `normalizeLabel` reusing `normalizeTitle`'s NFKD stripping below, so
  // e.g. "předehra" and "predehra" both normalize to this one ASCII entry
  // ("ř" decomposes to "r" + a combining caron, which is then dropped) —
  // no need to list an accented and unaccented form separately.
  "sloka", // verse
  "refren", // chorus ("refrén")
  "most", // bridge
  "bridz", // bridge, alt ("bridž")
  "mezihra", // interlude
  "predehra", // intro ("předehra")
  "dohra", // outro
  "solo", // solo ("sólo")
  "coda",
]);

/** Strips a trailing verse/chorus number ("Verse 2" -> "verse") and normalizes for matching a lyric section to a chord section that covers every repeat of that part — lowercased AND diacritic-stripped via `normalizeTitle` (NFKD), reused rather than re-implemented, so "Sloka 1" and "Refrén" match the same way "Verse 1" and "Chorus" do. */
function normalizeLabel(label: string | undefined): string | undefined {
  if (!label) {
    return undefined;
  }
  const stripped = label.replace(/\s*\d+\s*$/, "").trim();
  if (stripped.length === 0) {
    return undefined;
  }
  const normalized = normalizeTitle(stripped);
  return normalized.length > 0 ? normalized : undefined;
}

function isSectionLabel(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > 24) {
    return false;
  }
  return SECTION_WORDS.has(normalizeLabel(trimmed) ?? "");
}

export interface TextSection {
  label: string | undefined;
  lines: string[];
}

/**
 * Lyrics are laid out as label-only lines ("Verse 1") followed by content
 * lines, stanzas separated by a blank line. The blank line is structural
 * (a separator), not a rendered lyric, so it's dropped rather than kept as
 * an empty line in the section's content.
 */
export function splitLyricsIntoSections(lyrics: string): TextSection[] {
  const sections: TextSection[] = [];
  let current: TextSection | undefined;

  for (const line of lyrics.split("\n")) {
    if (isSectionLabel(line)) {
      current = { label: line.trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (line.trim() === "") {
      continue;
    }
    if (!current) {
      current = { label: undefined, lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }

  return sections;
}

/**
 * Chord progressions are laid out one section per line, `Label: changes`
 * (the seed's convention — "Verse: Am - F - C - G (x2)"). A line with no
 * recognized label continues the previous section (or starts an unlabeled
 * one, for chord text that doesn't follow the convention at all).
 */
export function splitChordsIntoSections(chords: string): TextSection[] {
  const sections: TextSection[] = [];

  for (const line of chords.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const colonIndex = line.indexOf(":");
    const candidateLabel = colonIndex === -1 ? "" : line.slice(0, colonIndex);
    if (colonIndex !== -1 && isSectionLabel(candidateLabel)) {
      const body = line.slice(colonIndex + 1).trim();
      sections.push({ label: candidateLabel.trim(), lines: body ? [body] : [] });
      continue;
    }
    const last = sections.at(-1);
    if (last) {
      last.lines.push(line);
    } else {
      sections.push({ label: undefined, lines: [line] });
    }
  }

  return sections;
}

export interface ChartSection {
  label: string | undefined;
  chordLines: string[];
  lyricLines: string[];
}

/**
 * `buildSongChart`'s result. Two shapes, deliberately NOT merged into one:
 *
 * - `"sections"` — at least one recognized section label on either side, so
 *   pairing chords to lyrics by label means something. Rendered as the
 *   interleaved chart (one heading, chords above their matching lyrics,
 *   section by section).
 * - `"raw"` — nothing was recognized on EITHER side (a song in a language,
 *   or a convention, `SECTION_WORDS` doesn't cover). Pairing has nothing to
 *   align by here, and the section splitters both treat a blank line as a
 *   stanza separator to be dropped — exactly right for a real chart, but
 *   destructive for plain text that was never meant to be split at all. A
 *   song like this must degrade to the ORIGINAL two-block layout (raw text
 *   verbatim, so blank lines survive; chords above lyrics; separate
 *   "Chords"/"Lyrics" headings), not to something worse than what it
 *   replaced — see task-5-report.md "Fix round 2" for the Czech input that
 *   found this.
 * - `"none"` — both fields empty; nothing to render.
 */
export type SongChart =
  | { kind: "none" }
  | { kind: "raw"; chordText: string | undefined; lyricsText: string | undefined }
  | { kind: "sections"; sections: ChartSection[] };

/**
 * The song page's actual chart: chord-only sections that precede the first
 * lyric section (an intro, typically), then each lyric section paired with
 * its matching chord section (by normalized label) when one exists, then
 * any chord sections left over (an outro with no lyrics, typically).
 *
 * Falls back to chord sections and lyric sections side by side, unpaired,
 * when only one field is empty (nothing to interleave against), and to the
 * raw two-block layout when NEITHER field has a recognized section label at
 * all (nothing to interleave BY) — see `SongChart` above.
 */
export function buildSongChart(
  chordText: string | null | undefined,
  lyricsText: string | null | undefined,
): SongChart {
  const hasChordText = Boolean(chordText);
  const hasLyricsText = Boolean(lyricsText);

  if (!hasChordText && !hasLyricsText) {
    return { kind: "none" };
  }

  const chordSections = hasChordText ? splitChordsIntoSections(chordText as string) : [];
  const lyricSections = hasLyricsText ? splitLyricsIntoSections(lyricsText as string) : [];

  const chordsRecognized = chordSections.some((c) => c.label !== undefined);
  const lyricsRecognized = lyricSections.some((l) => l.label !== undefined);

  if (!chordsRecognized && !lyricsRecognized) {
    return {
      kind: "raw",
      chordText: hasChordText ? (chordText as string) : undefined,
      lyricsText: hasLyricsText ? (lyricsText as string) : undefined,
    };
  }

  if (chordSections.length === 0 || lyricSections.length === 0) {
    return {
      kind: "sections",
      sections: [
        ...chordSections.map(
          (c): ChartSection => ({ label: c.label, chordLines: c.lines, lyricLines: [] }),
        ),
        ...lyricSections.map(
          (l): ChartSection => ({ label: l.label, chordLines: [], lyricLines: l.lines }),
        ),
      ],
    };
  }

  const chordByNormLabel = new Map<string, TextSection>();
  for (const c of chordSections) {
    const key = normalizeLabel(c.label);
    if (key && !chordByNormLabel.has(key)) {
      chordByNormLabel.set(key, c);
    }
  }

  const firstUsedIndex = chordSections.findIndex((c) => {
    const key = normalizeLabel(c.label);
    return key !== undefined && lyricSections.some((l) => normalizeLabel(l.label) === key);
  });
  const leading = firstUsedIndex === -1 ? [] : chordSections.slice(0, firstUsedIndex);

  const consumed = new Set<TextSection>(leading);
  const result: ChartSection[] = leading.map((c) => ({
    label: c.label,
    chordLines: c.lines,
    lyricLines: [],
  }));

  for (const l of lyricSections) {
    const key = normalizeLabel(l.label);
    const chord = key ? chordByNormLabel.get(key) : undefined;
    if (chord) {
      consumed.add(chord);
    }
    result.push({ label: l.label, chordLines: chord?.lines ?? [], lyricLines: l.lines });
  }

  for (const c of chordSections) {
    if (!consumed.has(c)) {
      result.push({ label: c.label, chordLines: c.lines, lyricLines: [] });
    }
  }

  return { kind: "sections", sections: result };
}
