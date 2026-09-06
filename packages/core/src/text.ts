// Text normalization shared by ingest matching and search. Must be
// deterministic and total — never throw, regardless of input.

// Matches a trailing take/version marker such as "(take 3)", "[take 12]",
// "- take 2", case-insensitively, with optional surrounding whitespace.
const TRAILING_TAKE_SUFFIX = /\s*(?:\(\s*take\s+\d+\s*\)|\[\s*take\s+\d+\s*\]|-\s*take\s+\d+)\s*$/i;

// Unicode combining marks (diacritics) left behind after NFKD decomposition.
// (Unicode property escape, not a literal char-class range, so it can't be
// misread as "a base character plus a combining mark".)
const COMBINING_MARKS = /\p{M}/gu;

const WHITESPACE_RUN = /\s+/g;

/**
 * Normalize a song/take title for matching and search:
 * lowercase, diacritics stripped (NFKD), internal whitespace collapsed,
 * trimmed, and a trailing take/version suffix removed.
 *
 * Total and deterministic — safe on empty strings, punctuation-only input,
 * or diacritics-only input.
 */
export function normalizeTitle(s: string): string {
  if (!s) {
    return "";
  }

  let out = s.normalize("NFKD").replace(COMBINING_MARKS, "");
  out = out.replace(TRAILING_TAKE_SUFFIX, "");
  out = out.toLowerCase();
  out = out.replace(WHITESPACE_RUN, " ").trim();

  return out;
}
