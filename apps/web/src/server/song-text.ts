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
import { stripDiacritics } from "@bandplate/core";

// Words that mean ONLY "section of a song" — safe to trust as a label the
// moment they appear alone on a line, no corroboration needed.
const STRONG_SECTION_WORDS = new Set([
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
  // `normalizeLabel` reusing `stripDiacritics` below, so e.g. "předehra"
  // and "predehra" both normalize to this one ASCII entry ("ř" decomposes
  // to "r" + a combining caron, which is then dropped) — no need to list
  // an accented and unaccented form separately.
  "sloka", // verse
  "refren", // chorus ("refrén")
  "bridz", // bridge, alt ("bridž")
  "mezihra", // interlude
  "predehra", // intro ("předehra")
  "dohra", // outro
]);

// Words that ALSO occur as ordinary English words ("most", "solo", "coda"
// are all everyday vocabulary, not just chord-chart jargon) — see
// task-5-report.md "Fix round 3" #1 for the regression this caused: a lyric
// line that is just the word "Most" (as in the English sense, not the Czech
// "bridge") got promoted to a section heading. These are only trusted as
// labels when corroborated — see `isSectionLabel`.
const AMBIGUOUS_SECTION_WORDS = new Set([
  "most", // bridge (Czech) / ordinary English word
  "solo", // solo ("sólo") / ordinary English word
  "coda",
]);

const SECTION_WORDS = new Set([...STRONG_SECTION_WORDS, ...AMBIGUOUS_SECTION_WORDS]);

/** Strips a trailing verse/chorus number ("Verse 2" -> "verse") and normalizes for matching a lyric section to a chord section that covers every repeat of that part — lowercased AND diacritic-stripped (NFKD), so "Sloka 1" and "Refrén" match the same way "Verse 1" and "Chorus" do. Deliberately does NOT go through `normalizeTitle`: that also strips a trailing "(take N)"/"- take N" suffix, which is take-matching semantics that have nothing to do with section-label matching — see task-5-report.md "Fix round 3" #3. */
function normalizeLabel(label: string | undefined): string | undefined {
  if (!label) {
    return undefined;
  }
  const stripped = label.replace(/\s*\d+\s*$/, "").trim();
  if (stripped.length === 0) {
    return undefined;
  }
  const normalized = stripDiacritics(stripped).trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * A label is trusted immediately if it's one of the unambiguous chord-chart
 * words. An ambiguous word (see `AMBIGUOUS_SECTION_WORDS`) is only trusted
 * when `ambiguousAllowed` says so — either:
 *  - a plain `true`/`false`: every ambiguous word is trusted, or none is.
 *    Used for lyrics-only self-corroboration (≥2 distinct section words
 *    already in this same text — see `hasAmbiguousCorroboration`), where
 *    there's no more specific signal available.
 *  - a predicate checked per normalized word: trusts THAT SPECIFIC word
 *    only. Used by `buildSongChart` once chord text exists — a lyric
 *    label is corroborated only when the SAME normalized label already
 *    exists as a recognized chord section, not merely because the chord
 *    side recognized something else entirely. See task-5-report.md
 *    "Fix round 4": a coarser, word-agnostic gate here let a properly
 *    labelled chart (Verse/Chorus/Bridge) still promote a coincidental
 *    English "Most" lyric line into a false heading.
 */
function isSectionLabel(
  candidate: string,
  ambiguousAllowed: boolean | ((normalizedWord: string) => boolean),
): boolean {
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > 24) {
    return false;
  }
  const normalized = normalizeLabel(trimmed);
  if (normalized === undefined) {
    return false;
  }
  if (STRONG_SECTION_WORDS.has(normalized)) {
    return true;
  }
  if (!AMBIGUOUS_SECTION_WORDS.has(normalized)) {
    return false;
  }
  return typeof ambiguousAllowed === "function" ? ambiguousAllowed(normalized) : ambiguousAllowed;
}

/**
 * Self-corroboration for a single field: does this text alone contain ≥2
 * distinct recognized section words? If so, an ambiguous word like "Most"
 * appearing in the same text is very likely intentional structure, not a
 * coincidental ordinary word — a lone "Most" with nothing else section-like
 * around it is exactly the false-positive case this guards against.
 * `extractCandidate` pulls the label-shaped part out of a line: the whole
 * line for lyrics, the part before the colon for chords.
 */
function hasAmbiguousCorroboration(
  text: string,
  extractCandidate: (line: string) => string,
): boolean {
  const found = new Set<string>();
  for (const line of text.split("\n")) {
    const candidate = extractCandidate(line).trim();
    if (!candidate || candidate.length > 24) {
      continue;
    }
    const normalized = normalizeLabel(candidate);
    if (normalized !== undefined && SECTION_WORDS.has(normalized)) {
      found.add(normalized);
    }
  }
  return found.size >= 2;
}

function chordLabelCandidate(line: string): string {
  const colonIndex = line.indexOf(":");
  return colonIndex === -1 ? "" : line.slice(0, colonIndex);
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
 *
 * `ambiguousAllowed` gates whether a bare ambiguous word ("Most", "Solo",
 * "Coda") is trusted as a label — defaults to this text's own
 * self-corroboration (≥2 distinct section words already in these lyrics)
 * when the caller doesn't have outside context. `buildSongChart` instead
 * passes a per-word predicate informed by the chord side (see
 * `isSectionLabel`), since a chord-side match must be specific to that
 * exact label, not a blanket "the chords recognized *something*".
 */
export function splitLyricsIntoSections(
  lyrics: string,
  ambiguousAllowed: boolean | ((normalizedWord: string) => boolean) = hasAmbiguousCorroboration(
    lyrics,
    (line) => line,
  ),
): TextSection[] {
  const sections: TextSection[] = [];
  let current: TextSection | undefined;

  for (const line of lyrics.split("\n")) {
    if (isSectionLabel(line, ambiguousAllowed)) {
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
 *
 * `ambiguousAllowed` — see `splitLyricsIntoSections` — defaults to this
 * text's own self-corroboration.
 */
export function splitChordsIntoSections(
  chords: string,
  ambiguousAllowed: boolean = hasAmbiguousCorroboration(chords, chordLabelCandidate),
): TextSection[] {
  const sections: TextSection[] = [];

  for (const line of chords.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const colonIndex = line.indexOf(":");
    const candidateLabel = colonIndex === -1 ? "" : line.slice(0, colonIndex);
    if (colonIndex !== -1 && isSectionLabel(candidateLabel, ambiguousAllowed)) {
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
 * - `"raw"` — the chord side isn't confidently recognized: either chord
 *   text is present but names no recognized section at all (an
 *   unlabeled/bare progression — pairing has no chord-side structure to
 *   align lyric sections to), or neither side recognized anything (a song
 *   in a language/convention `SECTION_WORDS` doesn't cover). Pairing has
 *   nothing to align by here, and the section splitters both treat a blank
 *   line as a stanza separator to be dropped — exactly right for a real
 *   chart, but destructive for plain text that was never meant to be split
 *   at all. A song like this must degrade to the ORIGINAL two-block layout
 *   (raw text verbatim, so blank lines survive; chords above lyrics;
 *   separate "Chords"/"Lyrics" headings), not to something worse than what
 *   it replaced — see task-5-report.md "Fix round 2" for the Czech input
 *   that found this, and "Fix round 3" #1 for the unlabeled-chords and
 *   partial-recognition gaps closed later. Chords being simply ABSENT (no
 *   chord text at all) does NOT fall to raw — a labeled lyrics-only sheet
 *   still gets its headings, via the unpaired branch below.
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
 * raw two-block layout whenever pairing wouldn't mean anything — see
 * `SongChart` above for the two cases that fall to raw.
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
  const chordsRecognized = chordSections.some((c) => c.label !== undefined);

  // Map of normalized label -> first chord section with that label. Built
  // early so it can also gate ambiguous lyric words below (see
  // `lyricsAmbiguousAllowed`); reused again further down for the actual
  // chord/lyric pairing, rather than being rebuilt.
  const chordByNormLabel = new Map<string, TextSection>();
  for (const c of chordSections) {
    const key = normalizeLabel(c.label);
    if (key && !chordByNormLabel.has(key)) {
      chordByNormLabel.set(key, c);
    }
  }

  // Section labels are primarily a property of the CHORD chart convention
  // ("Label: changes"); a lyric section label only means something when
  // there's a chord section to pair it with. So an ambiguous word in the
  // lyrics (see AMBIGUOUS_SECTION_WORDS) is trusted only when THAT SAME
  // normalized label already exists as a recognized chord section — not
  // merely because the chords recognized *some* label. Fix round 4: the
  // previous gate ("chordsRecognized || ...") granted blanket trust to
  // every ambiguous lyric word the instant the chords had ANY recognized
  // label, so a properly labelled chart (Verse/Chorus/Bridge) still
  // promoted a coincidental English "Most" lyric line into a false heading
  // — see task-5-report.md "Fix round 4". Self-corroboration (≥2 distinct
  // section words within the lyrics alone) is only used as a fallback when
  // there's no chord text at all to check specific labels against (a
  // lyrics-only sheet) — the same case `splitLyricsIntoSections`'s own
  // default handles when called standalone.
  const lyricsAmbiguousAllowed = hasChordText
    ? (word: string) => chordByNormLabel.has(word)
    : hasAmbiguousCorroboration(lyricsText ?? "", (line) => line);
  const lyricSections = hasLyricsText
    ? splitLyricsIntoSections(lyricsText as string, lyricsAmbiguousAllowed)
    : [];
  const lyricsRecognized = lyricSections.some((l) => l.label !== undefined);

  // Raw two-block fallback in two situations, both "structure isn't
  // confidently recognized":
  //  - chord text is PRESENT but produced no recognized label at all — an
  //    unlabeled/bare progression. Pairing has no chord-side structure to
  //    align lyric sections to, so trying anyway either appends the whole
  //    chord block after all the lyrics with no heading (labeled lyrics,
  //    unlabeled chords) or silently swallows any lyric label word that
  //    ISN'T recognized into the previous section's content (partial
  //    recognition) — see task-5-report.md "Fix round 3" #1 for both.
  //  - NEITHER side recognized anything (the original "Fix round 2" case:
  //    a song in a language/convention SECTION_WORDS doesn't cover).
  // Chords being simply ABSENT (no chord text at all) is not this case —
  // that's the legitimate "lyrics only" shape, handled by the unpaired
  // branch below so a labeled lyric sheet still gets its headings.
  if (!chordsRecognized && (hasChordText || !lyricsRecognized)) {
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

  // `chordByNormLabel` was already built above (it also gated
  // `lyricsAmbiguousAllowed`); reused here rather than rebuilt.
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
