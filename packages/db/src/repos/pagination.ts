// Paging, as the repos speak it.
//
// The repos deal in `limit`/`offset` — a database's own vocabulary — and the
// web layer translates page NUMBERS into them (`apps/web/src/server/
// pagination.ts`). Keeping the arithmetic on one side of that line means a
// repo test never has to reason about what "page 3" means, and a page never
// has to know that an offset is zero-based.
//
// --- Why offset, and not a keyset cursor ---------------------------------
//
// A keyset cursor (`WHERE (recorded_at, id) < (?, ?)`) is the textbook answer
// and the wrong one here. `/takes` sorts by `keeperVotes, ratingScore,
// recordedAt, id` under `sort=rating` — a four-column cursor to encode,
// decode and validate, per sort mode, for an archive of a few thousand rows
// where the offset it replaces costs nothing. Offset also gives page numbers
// and a total, which a browse surface wants and a cursor cannot express.
//
// The price of offset is drift: a take inserted while a member is on page 2
// pushes one row from page 2 onto page 3. At this scale that is a row seen
// twice at worst, against ingest that runs in batches between rehearsals.
//
// --- The ordering rule that makes any of this correct --------------------
//
// EVERY paginated query must have a totally-ordered `ORDER BY`. A sort key
// with ties (`heldAt` alone, `recordedAt` alone) leaves SQLite free to return
// tied rows in a different order for the page-1 and the page-2 query — which
// shows one row twice and silently drops another. Every listing here
// therefore ends on a unique column, `id` unless something else already is;
// see `takesRepo.listBySong`, which has documented this since before anything
// paged.

/** Where a page starts and how long it runs. Built by the caller from a page number. */
export interface PageArgs {
  limit: number;
  offset: number;
}

/**
 * One page of rows plus how many there are in total.
 *
 * `total` counts every matching row, ignoring `limit`/`offset` — it is what
 * the page count is derived from, and what lets a listing say "48 takes"
 * rather than the hedge ("200+") a bare truncation flag forces.
 */
export interface Paged<T> {
  rows: T[];
  total: number;
}

/**
 * What a listing returns when the caller names no page.
 *
 * There is deliberately no "give me everything" mode on a paged query: an
 * omitted page means page ONE, never the whole table. A caller that forgets to
 * page therefore renders a short list — wrong, and visible — rather than
 * loading an archive that grows without bound, which is wrong and invisible
 * until the day it isn't.
 */
export const DEFAULT_PAGE_SIZE = 25;

/**
 * The ceiling on `perPage`, enforced at the repo boundary rather than trusted
 * from the caller — `?perPage=100000` is a URL anyone can type, and every
 * listing here is reachable by GET.
 */
export const MAX_PAGE_SIZE = 100;

/** Clamps a requested page size into `1..MAX_PAGE_SIZE`. */
export function clampPageSize(requested: number, fallback: number): number {
  if (!Number.isFinite(requested) || requested < 1) {
    return fallback;
  }
  return Math.min(Math.floor(requested), MAX_PAGE_SIZE);
}
