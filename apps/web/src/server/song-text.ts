// Splits a song's chord progression and lyrics into labeled sections
// (Verse/Chorus/Bridge/…) and interleaves them into one chart — the review's
// main design finding on the song page: a `<pre>` with a bigger font gave
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
// (verse/chorus/bridge/...) renders as a single unlabeled section, which
// looks the same as the un-sectioned `<pre>` this replaces.

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
]);

/** Strips a trailing verse/chorus number ("Verse 2" -> "verse") and lowercases, for matching a lyric section to a chord section that covers every repeat of that part. */
function normalizeLabel(label: string | undefined): string | undefined {
  if (!label) {
    return undefined;
  }
  const stripped = label.replace(/\s*\d+\s*$/, "").trim();
  return stripped.length > 0 ? stripped.toLowerCase() : undefined;
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
 * The song page's actual chart: chord-only sections that precede the first
 * lyric section (an intro, typically), then each lyric section paired with
 * its matching chord section (by normalized label) when one exists, then
 * any chord sections left over (an outro with no lyrics, typically).
 *
 * Falls back to chord sections and lyric sections side by side, unpaired,
 * when either field is empty — nothing to interleave in that case.
 */
export function buildSongChart(
  chordText: string | null | undefined,
  lyricsText: string | null | undefined,
): ChartSection[] {
  const chordSections = chordText ? splitChordsIntoSections(chordText) : [];
  const lyricSections = lyricsText ? splitLyricsIntoSections(lyricsText) : [];

  if (chordSections.length === 0 || lyricSections.length === 0) {
    return [
      ...chordSections.map(
        (c): ChartSection => ({ label: c.label, chordLines: c.lines, lyricLines: [] }),
      ),
      ...lyricSections.map(
        (l): ChartSection => ({ label: l.label, chordLines: [], lyricLines: l.lines }),
      ),
    ];
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

  return result;
}
