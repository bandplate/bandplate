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
import type { Db, PageArgs, Read } from "@bandplate/db";
import {
  combineReads,
  favoritesRepo,
  instrumentsRepo,
  mapRead,
  readValue,
  runRead,
  runReads,
  songsRepo,
  takesRepo,
} from "@bandplate/db";
import { type ListView, loadList } from "../pagination.js";
import { type StashView, stashViewRead, stashViewRestRead } from "./stash.js";
import { buildFullContextRead, type TakeWithFullContext } from "./take-context.js";

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
  /**
   * A RELATIVE window — "the past month" — which is how a band actually asks
   * this question. Nobody opens the archive wanting takes between the 3rd and
   * the 19th; they want what happened since the last few rehearsals, and
   * answering that with two date pickers made them do arithmetic first.
   *
   * Relative rather than resolved to dates at click time, deliberately: the
   * URL stays true. A link that says `since=30d` still means "the past month"
   * when it is opened next week, where a frozen pair of dates would quietly
   * have become "that particular month".
   */
  since?: RecordedWindow;
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

/**
 * The windows the pills offer, longest-lived first in the UI.
 *
 * Days, not months: a "month" that means 30 days is a rounding nobody notices,
 * and one that means a calendar month needs a timezone and a rule for the 31st.
 */
export const RECORDED_WINDOWS = {
  // A KEY, not a label. The words live in the message catalog; what belongs
  // here is how long each window is, which is the same in every language.
  "7d": { labelKey: "pastWeek", days: 7 },
  "30d": { labelKey: "pastMonth", days: 30 },
  "90d": { labelKey: "past3Months", days: 90 },
  "365d": { labelKey: "pastYear", days: 365 },
} as const;

export type RecordedWindow = keyof typeof RECORDED_WINDOWS;

function parseWindow(raw: string | null): RecordedWindow | undefined {
  return raw && raw in RECORDED_WINDOWS ? (raw as RecordedWindow) : undefined;
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
  // An exact range WINS over a preset when both arrive.
  //
  // They can both arrive with no JS: the pills and the date fields are one GET
  // form, and nothing clears a radio when someone types a date. Rather than
  // add a script to keep them exclusive — the sheet works without one, and
  // this is not the control to make the exception for — the rule is "the more
  // specific answer wins", and the pills re-render with none selected so the
  // page says which one it used.
  const since = dateFrom || dateTo ? undefined : parseWindow(searchParams.get("since"));
  const rawSort = searchParams.get("sort");
  const sort: takesRepo.TakeSort = rawSort === "rating" ? "rating" : "recent";
  const unvotedOnly = searchParams.get("unvoted") === "1";

  return { songId, instrumentIds, since, dateFrom, dateTo, sort, unvotedOnly };
}

export function hasAnyFilter(query: SearchQuery): boolean {
  return (
    Boolean(query.songId) ||
    query.instrumentIds.length > 0 ||
    Boolean(query.since) ||
    Boolean(query.dateFrom) ||
    Boolean(query.dateTo) ||
    query.unvotedOnly
  );
}

/** True when the RECORDED filter is narrowing anything, by either route. */
export function hasRecordedFilter(query: SearchQuery): boolean {
  return Boolean(query.since) || Boolean(query.dateFrom) || Boolean(query.dateTo);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toFilters(query: SearchQuery, memberId: string, now: number): takesRepo.SearchFilters {
  // A preset is resolved HERE, against the caller's clock, rather than when the
  // pill was pressed — see `SearchQuery.since`. `dateTo` stays open: "the past
  // month" has no upper bound, and pinning one to `now` would drop a take
  // stamped a few minutes into the future by a bridge with a fast clock.
  const window = query.since ? RECORDED_WINDOWS[query.since] : undefined;

  return {
    unvotedByMemberId: query.unvotedOnly ? memberId : undefined,
    songId: query.songId,
    instrumentIds: query.instrumentIds.length > 0 ? query.instrumentIds : undefined,
    dateFrom: window
      ? now - window.days * DAY_MS
      : query.dateFrom
        ? Date.parse(`${query.dateFrom}T00:00:00.000Z`)
        : undefined,
    // End-of-day, inclusive — a bare `dateTo` date input has no time
    // component, and a naive `<=` against midnight would silently exclude
    // every take recorded later that same day.
    dateTo: window
      ? undefined
      : query.dateTo
        ? Date.parse(`${query.dateTo}T23:59:59.999Z`)
        : undefined,
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
  /** The clock, for resolving a relative window. See `SearchQuery.since`. */
  now: number,
): Promise<SearchTakesResult> {
  const found = await runRead(db, searchFoundRead(db, query, memberId, page, now));
  return runRead(db, searchResultsRead(db, found, memberId));
}

/** What the search reads first: the page of takes, its total, and which takes are pinned. */
interface SearchFound {
  rows: takesRepo.Take[];
  total: number;
  favoriteTakeIds: Set<string>;
}

function searchFoundRead(
  db: Db,
  query: SearchQuery,
  memberId: string,
  page: PageArgs,
  now: number,
): Read<SearchFound> {
  const read = combineReads({
    found: takesRepo.buildSearchRead(db, toFilters(query, memberId, now), {
      sort: query.sort,
      page,
    }),
    favoriteTakeIds: favoritesRepo.buildListTargetIdsByMemberRead(db, memberId, "take"),
  });
  return mapRead(read, ({ found, favoriteTakeIds }) => ({ ...found, favoriteTakeIds }));
}

/** The found takes with their context: the second of the search's two reads. */
function searchResultsRead(
  db: Db,
  { rows, total, favoriteTakeIds }: SearchFound,
  memberId: string,
): Read<SearchTakesResult> {
  return mapRead(buildFullContextRead(db, rows, memberId), (withContext) => ({
    results: withContext.map((take) => ({ ...take, favorited: favoriteTakeIds.has(take.id) })),
    total,
  }));
}

const NO_SEARCH: SearchFound = { rows: [], total: 0, favoriteTakeIds: new Set() };

const NO_STASH: StashView = { rows: [], owner: undefined, songChoices: [] };

export interface TakesPageData {
  search: SearchTakesResult;
  list: ListView;
  /** The instrument filter's options. */
  instruments: instrumentsRepo.Instrument[];
  /**
   * The song picker's options. A band's repertoire is tens of songs, so the
   * whole list is one cheap query and a plain `<select>` — no autocomplete, no
   * script, and it works with JS off like every other control here.
   */
  songs: songsRepo.Song[];
  stashCount: number;
  /** Empty unless the stash is the list being shown. */
  stash: StashView;
}

/**
 * Everything `/takes` reads, in two round trips: one batch for all that
 * needs only the request (the page of takes and its total, the filter
 * options, the stash), one for what those returned (the takes' context,
 * the stash rows' context).
 *
 * `loadList` may ask for the takes a second time, when the URL guessed the
 * wrong window (an old `?page=` link on a list that now grows). That second
 * ask carries only the search, so it costs two more round trips, never the
 * whole page again.
 *
 * The stash is a different list, not a filter on this one: nothing below the
 * bar is searched while it is open.
 */
export async function getTakesPageData(
  db: Db,
  request: { url: URL; query: SearchQuery; viewingStash: boolean; memberId: string; now: number },
): Promise<TakesPageData> {
  const { url, query, viewingStash, memberId, now } = request;
  const restOfPage = combineReads({
    instruments: instrumentsRepo.buildListRead(db),
    songs: songsRepo.buildListRead(db),
    stashCount: takesRepo.buildCountStashRead(db, memberId),
    stash: viewingStash ? stashViewRead(db, memberId) : readValue(undefined),
  });
  type RestOfPage = typeof restOfPage extends Read<infer T> ? T : never;

  let rest: RestOfPage | undefined;
  let stash = NO_STASH;
  const { result: search, list } = await loadList(
    url,
    TAKES_PER_PAGE,
    async (page) => {
      const first = await runReads(db, {
        search: viewingStash
          ? readValue(NO_SEARCH)
          : searchFoundRead(db, query, memberId, page, now),
        rest: rest ? readValue(rest) : restOfPage,
      });
      const firstAsk = rest === undefined;
      rest = first.rest;
      const second = await runReads(db, {
        results: searchResultsRead(db, first.search, memberId),
        stash:
          firstAsk && first.rest.stash
            ? stashViewRestRead(db, first.rest.stash)
            : readValue(undefined),
      });
      stash = second.stash ?? stash;
      return second.results;
    },
    (found) => found.total,
  );
  if (!rest) {
    throw new Error("loadList returned without loading");
  }
  return {
    search,
    list,
    instruments: rest.instruments,
    songs: rest.songs,
    stashCount: rest.stashCount,
    stash,
  };
}
