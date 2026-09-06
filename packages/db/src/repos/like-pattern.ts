/**
 * SQLite LIKE's metacharacters (`%` any run, `_` any single char) are not
 * escaped by default — a search for a literal `%` or `_` would otherwise
 * match everything (or fail to match a title that actually contains one).
 * Escaping them (and the escape character itself) and pairing that with an
 * explicit `ESCAPE` clause makes `%`/`_` in the *search term* literal again.
 *
 * Shared by `songs.ts` (title search) and `takes.ts` (song title/alias
 * search, `/search`'s free-text filter) rather than duplicated in both —
 * originally lived only in `songs.ts`; extracted here once `takes.ts` needed
 * the identical escaping for the same reason.
 */
export function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}
