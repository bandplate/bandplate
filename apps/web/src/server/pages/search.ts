// `/takes` — the archive, narrowed by song, instrument (AND), date range,
// and "not voted by me". A plain GET form (see takes/index.astro) —
// this module parses the query string into `takesRepo.SearchFilters` and calls
// the one repo query that backs it, the same shape `server/pages/songs.ts`
// uses for its own GET-form filtering.
//
// There is no STATE filter. A member browsing the archive is not asking which
// takes are `uploading` or `purged`; the states that mean anything to them —
// keeper and rejected — are already visible on every row. It was six
// checkboxes for a lifecycle only the ingest pipeline and the admin surfaces
// care about.
//
// There is no RATING filter either. "75% keeper or better" asks a member to
// think in percentages about a tally of at most seven votes, and the keeper
// badge already says the thing they actually wanted to find.
import type { Db, PageArgs } from "@bandplate/db";
import { favoritesRepo, takesRepo } from "@bandplate/db";
import { type TakeWithFullContext, attachFullContext } from "./take-context.js";

export interface SearchQuery {
  /**
   * A song id, not a title string. The field was free text matched with LIKE
   * against titles and aliases, which asked a member to spell a song the way
   * the archive happens to store it — including its diacritics — to find takes
   * they can see listed on the next page over. Every take belongs to exactly
   * one song out of a repertoire of tens, so the honest control is a picker,
   * and picking one is exact where typing was a guess.
   */
  songId?: string;
  instrumentIds: string[];
  /** `yyyy-mm-dd`, kept as the raw string so the date input can redisplay it. */
  dateFrom?: string;
  dateTo?: string;
  /** Defaults to `"recent"` — see `takesRepo.TakeSort`'s own comment for why `"rating"` isn't just `ratingScore DESC`. */
  sort: takesRepo.TakeSort;
  /**
   * "Only takes I haven't voted on." This is where `/me`'s count sends you —
   * the count is the question, this is the answer, and making it a filter
   * rather than a page of its own means it composes with everything else here
   * ("what haven't I judged from last month", "…with horns on it").
   */
  unvotedOnly: boolean;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateInput(raw: string | null): string | undefined {
  if (!raw) {
    return undefined;
  }
  const match = DATE_PATTERN.exec(raw);
  if (!match) {
    return undefined;
  }
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  // `Date.parse`/`new Date(...)` silently ROLL OVER an out-of-range date
  // (2024-02-30 becomes March 1st) rather than rejecting it — a bare
  // `Number.isNaN(Date.parse(...))` check never catches that, since
  // rolling over always produces a valid timestamp. Reconstructing the
  // date and checking its UTC components match the input is what actually
  // rejects a non-existent calendar date instead of silently searching a
  // different one than the member typed.
  const ms = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(ms);
  const isRealDate =
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day;
  return isRealDate ? raw : undefined;
}

export function parseSearchQuery(searchParams: URLSearchParams): SearchQuery {
  const songId = searchParams.get("song")?.trim() || undefined;
  // Dedupe: takes.listByInstruments (which takes.search delegates to for
  // the instrument filter) returns nothing at all if the same id appears
  // twice — see server/pages/songs.ts's identical note.
  const instrumentIds = [...new Set(searchParams.getAll("instrument").filter(Boolean))];
  const dateFrom = parseDateInput(searchParams.get("dateFrom"));
  const dateTo = parseDateInput(searchParams.get("dateTo"));
  const rawSort = searchParams.get("sort");
  const sort: takesRepo.TakeSort = rawSort === "rating" ? "rating" : "recent";
  const unvotedOnly = searchParams.get("unvoted") === "1";

  return { songId, instrumentIds, dateFrom, dateTo, sort, unvotedOnly };
}

export function hasAnyFilter(query: SearchQuery): boolean {
  return (
    Boolean(query.songId) ||
    query.instrumentIds.length > 0 ||
    Boolean(query.dateFrom) ||
    Boolean(query.dateTo) ||
    query.unvotedOnly
  );
}

function toFilters(query: SearchQuery, memberId: string): takesRepo.SearchFilters {
  return {
    unvotedByMemberId: query.unvotedOnly ? memberId : undefined,
    songId: query.songId,
    instrumentIds: query.instrumentIds.length > 0 ? query.instrumentIds : undefined,
    dateFrom: query.dateFrom ? Date.parse(`${query.dateFrom}T00:00:00.000Z`) : undefined,
    // End-of-day, inclusive — a bare `dateTo` date input has no time
    // component, and a naive `<=` against midnight would silently exclude
    // every take recorded later that same day.
    dateTo: query.dateTo ? Date.parse(`${query.dateTo}T23:59:59.999Z`) : undefined,
  };
}

/** Rows per page in the takes archive. */
export const TAKES_PER_PAGE = 25;

export interface SearchTakesResult {
  results: Array<TakeWithFullContext & { favorited: boolean }>;
  /**
   * Every take matching the filters, not just this page.
   *
   * This replaced a `truncated` boolean. The flag could say "there are more"
   * but never how many, so `/takes` had to hedge its own count as "200+" —
   * a number no member could act on and no filter could be judged against.
   */
  total: number;
}

export async function searchTakes(
  db: Db,
  query: SearchQuery,
  memberId: string,
  page: PageArgs,
): Promise<SearchTakesResult> {
  const [{ rows, total }, favoriteTakeIds] = await Promise.all([
    takesRepo.search(db, toFilters(query, memberId), { sort: query.sort, page }),
    favoritesRepo.listTargetIdsByMember(db, memberId, "take"),
  ]);
  const withContext = await attachFullContext(db, rows, memberId);
  return {
    results: withContext.map((take) => ({ ...take, favorited: favoriteTakeIds.has(take.id) })),
    total,
  };
}
