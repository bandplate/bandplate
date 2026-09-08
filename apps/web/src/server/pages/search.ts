// `/takes` — cross-cutting take search: instrument (AND), date range,
// rating, state, and free text across song titles and aliases. A plain GET
// form (see search/index.astro) — this module parses the query string into
// `takesRepo.SearchFilters` and calls the one repo query that backs it, the
// same shape `server/pages/songs.ts` uses for its own GET-form filtering.
import type { Db } from "@bandplate/db";
import { favoritesRepo, takesRepo } from "@bandplate/db";
import { type TakeWithFullContext, attachFullContext } from "./take-context.js";

const VALID_STATES: readonly takesRepo.TakeState[] = [
  "uploading",
  "new",
  "published",
  "keeper",
  "rejected",
  "purged",
];

export type SearchRating = "50" | "75" | "100";
const VALID_RATINGS: readonly SearchRating[] = ["50", "75", "100"];
const RATING_THRESHOLDS: Record<SearchRating, number> = { "50": 0.5, "75": 0.75, "100": 1 };

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
  rating?: SearchRating;
  /** Defaults to `"recent"` — see `takesRepo.TakeSort`'s own comment for why `"rating"` isn't just `ratingScore DESC`. */
  sort: takesRepo.TakeSort;
  states: takesRepo.TakeState[];
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
  const rawRating = searchParams.get("rating");
  const rating = VALID_RATINGS.includes(rawRating as SearchRating)
    ? (rawRating as SearchRating)
    : undefined;
  const states = [
    ...new Set(
      searchParams
        .getAll("state")
        .filter((s): s is takesRepo.TakeState => (VALID_STATES as readonly string[]).includes(s)),
    ),
  ];
  const rawSort = searchParams.get("sort");
  const sort: takesRepo.TakeSort = rawSort === "rating" ? "rating" : "recent";
  const unvotedOnly = searchParams.get("unvoted") === "1";

  return { songId, instrumentIds, dateFrom, dateTo, rating, sort, states, unvotedOnly };
}

export function hasAnyFilter(query: SearchQuery): boolean {
  return (
    Boolean(query.songId) ||
    query.instrumentIds.length > 0 ||
    Boolean(query.dateFrom) ||
    Boolean(query.dateTo) ||
    Boolean(query.rating) ||
    query.states.length > 0 ||
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
    minRating: query.rating ? RATING_THRESHOLDS[query.rating] : undefined,
    states: query.states.length > 0 ? query.states : undefined,
  };
}

export interface SearchTakesResult {
  results: Array<TakeWithFullContext & { favorited: boolean }>;
  /** True when more takes match the filters than were returned (F6, review
   *  round 1) — `takesRepo.search` caps an unfiltered/broad archive search
   *  rather than returning it all. */
  truncated: boolean;
}

export async function searchTakes(
  db: Db,
  query: SearchQuery,
  memberId: string,
): Promise<SearchTakesResult> {
  const [{ results, truncated }, favoriteTakeIds] = await Promise.all([
    takesRepo.search(db, toFilters(query, memberId), { sort: query.sort }),
    favoritesRepo.listTargetIdsByMember(db, memberId, "take"),
  ]);
  const withContext = await attachFullContext(db, results, memberId);
  return {
    results: withContext.map((take) => ({ ...take, favorited: favoriteTakeIds.has(take.id) })),
    truncated,
  };
}
