// What a listing's URL asks for, and what the footer under it offers.
//
// `@bandplate/db`'s `PageArgs` is `limit`/`offset`, which is what a query
// wants and what nobody wants to type into an address bar. This module is the
// translation, and the only place the off-by-one between them lives.
//
// --- Two footers, one rule ----------------------------------------------
//
// A listing that can hold everything it has in one grown page (at most
// `MAX_SHOWN` rows) ends in "load more": `?shown=50` asks for the first 50
// rows, the button asks for one batch more, and the list grows in place. That
// is what people do in a newest-first archive: go a bit further back, not
// jump to page 7.
//
// Past `MAX_SHOWN` a grown page gets heavy, so the listing pages instead,
// under a compact "‹ 4 / 9 ›" counter. `?page=4` is page 4 at the listing's
// own page size.
//
// Which one a listing gets depends on its TOTAL, which only the query knows.
// `loadList` runs the query with a first guess and runs it again, once, when
// the guess was wrong; see there.
//
// Every paginated listing goes through here, so the footer under songs
// behaves exactly like the one under takes, including when somebody edits
// the URL by hand.
import { clampPageSize, type PageArgs } from "@bandplate/db";
import type { ListNoun, Locale } from "@bandplate/i18n";
import { messages } from "@bandplate/i18n";
import type { ListMoreLabels } from "@bandplate/ui/components/ListMore.astro";
import type { PageCounterLabels } from "@bandplate/ui/components/PageCounter.astro";

/** The query parameter a paged (counter) listing pages on. */
export const PAGE_PARAM = "page";

/** The query parameter a grown ("load more") listing grows on. */
export const SHOWN_PARAM = "shown";

/**
 * The most rows one grown page holds. A listing with more than this pages
 * instead. Must not exceed `MAX_PAGE_SIZE`, which caps every query's limit;
 * a test pins the two together.
 */
export const MAX_SHOWN = 200;

/**
 * A ceiling on the page NUMBER itself, independent of how many pages exist.
 * `?page=999999999` is a URL anyone can type; multiplied by a page size it
 * becomes an OFFSET the database walks row by row. Nothing in this archive
 * will ever have a millionth page.
 */
export const MAX_PAGE_NUMBER = 1_000_000;

/**
 * The prefix of the anchors a grown list plants at each batch boundary. The
 * id is `dalsi-<row number>`: `#dalsi-51` is the row the "show more" link
 * that asked for rows 51+ lands on.
 */
export const MORE_ANCHOR_PREFIX = "dalsi-";

/** A positive integer from the URL, or `undefined` for absent or junk. */
function positiveInt(searchParams: URLSearchParams, name: string): number | undefined {
  const raw = searchParams.get(name);
  if (raw === null) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

/**
 * The requested page, 1-based and sanitised.
 *
 * Anything that is not a positive integer (`?page=0`, `?page=-3`,
 * `?page=abc`, `?page=2.5`) is page one rather than an error. A listing is a
 * GET surface people link to and edit by hand; there is nothing to tell them
 * off about, and a 400 here would break a stale bookmark for no gain.
 */
export function parsePageNumber(searchParams: URLSearchParams): number {
  // A page number far past the end is not clamped here: `listView` needs the
  // true request to notice it is out of range and say so. Only the absurd is
  // capped, so `?page=1e9` cannot become an offset the database has to think
  // about.
  return Math.min(positiveInt(searchParams, PAGE_PARAM) ?? 1, MAX_PAGE_NUMBER);
}

/**
 * How many rows a grown list shows: at least one batch, at most `MAX_SHOWN`,
 * and a whole number of batches (rounded UP, so `?shown=30` on a list of 25s
 * shows 50 rather than cutting the second batch short).
 */
export function sanitizeShown(requested: number | undefined, pageSize: number): number {
  const wanted = requested === undefined || !Number.isFinite(requested) ? pageSize : requested;
  const batches = Math.max(1, Math.ceil(wanted / pageSize));
  return Math.min(batches * pageSize, MAX_SHOWN);
}

/** Turns a 1-based page number into the `limit`/`offset` the repos take. */
export function toPageArgs(page: number, perPage: number): PageArgs {
  const limit = clampPageSize(perPage, perPage);
  return { limit, offset: (Math.max(1, page) - 1) * limit };
}

/** What the URL asked for, before anyone knows how long the list is. */
export interface ListRequest {
  pageSize: number;
  /** `?page=`, when present: a counter link, or an old numbered-page link. */
  page: number | undefined;
  /** `?shown=`, when present: a "show more" link. Not yet sanitised. */
  shown: number | undefined;
}

export function listRequest(searchParams: URLSearchParams, pageSize: number): ListRequest {
  const page = searchParams.has(PAGE_PARAM) ? parsePageNumber(searchParams) : undefined;
  // Junk (`?shown=abc`) counts as present-but-default rather than absent, so
  // it still means "a grown list" and not "whatever `page` says".
  const shown = searchParams.has(SHOWN_PARAM)
    ? (positiveInt(searchParams, SHOWN_PARAM) ?? pageSize)
    : undefined;
  return { pageSize, page, shown };
}

/**
 * How many rows the grown list shows for this request.
 *
 * An old link with `?page=N` (from before lists grew) still shows what it
 * pointed at: page N of a grown list is the first N batches.
 */
function shownFor(request: ListRequest): number {
  if (request.shown !== undefined) {
    return sanitizeShown(request.shown, request.pageSize);
  }
  if (request.page !== undefined) {
    return sanitizeShown(request.page * request.pageSize, request.pageSize);
  }
  return request.pageSize;
}

/** Which counted page this request lands on. A `shown` link maps to the page its last batch is on. */
function pageFor(request: ListRequest): number {
  if (request.page !== undefined) {
    return request.page;
  }
  if (request.shown !== undefined) {
    return Math.ceil(sanitizeShown(request.shown, request.pageSize) / request.pageSize);
  }
  return 1;
}

/**
 * The query to run before the total is known.
 *
 * A `page` in the URL guesses "counter", everything else guesses "grown".
 * Both agree on the bare URL (one batch from the top), which is by far the
 * commonest request, so it is never queried twice.
 */
export function firstGuess(request: ListRequest): PageArgs {
  if (request.page !== undefined) {
    return toPageArgs(request.page, request.pageSize);
  }
  return { limit: shownFor(request), offset: 0 };
}

/**
 * One-off confirmation flags a write redirects back with ("saved",
 * "archived_ok", ...). They say "this just happened", so a link to more of
 * the same list drops them, or the banner would come back with every batch.
 * Filters (`archived=1`, `stash=1`, `unvoted=1`) are NOT here: those are the
 * list itself.
 */
export const FLASH_PARAMS = [
  "archived_ok",
  "unarchived",
  "song_deleted",
  "deleted",
  "renamed",
  "stash_renamed",
  "published",
  "created",
  "saved",
  "dup",
  "take_deleted",
  "merged",
] as const;

function hrefWith(url: URL, set: Record<string, number | undefined>, hash = ""): string {
  const params = new URLSearchParams(url.search);
  for (const name of FLASH_PARAMS) {
    params.delete(name);
  }
  for (const [name, value] of Object.entries(set)) {
    if (value === undefined) {
      params.delete(name);
    } else {
      params.set(name, String(value));
    }
  }
  const query = params.toString();
  return `${url.pathname}${query === "" ? "" : `?${query}`}${hash}`;
}

/** The grown list's footer. */
export interface MoreView {
  mode: "more";
  /** The query this view needs. */
  args: PageArgs;
  pageSize: number;
  total: number;
  /** How many rows are on the page: the grown size, or the total if smaller. */
  shown: number;
  /** The "show more" link and how many rows it adds; absent once everything is shown. */
  nextHref: string | undefined;
  nextCount: number;
  /** "Show all N": only while MORE than one further batch remains. */
  allHref: string | undefined;
  redirectTo: undefined;
}

/** The counted list's footer. */
export interface CounterView {
  mode: "counter";
  args: PageArgs;
  pageSize: number;
  total: number;
  page: number;
  pageCount: number;
  /** 1-based index of the first and last row on this page. */
  from: number;
  to: number;
  prevHref: string | undefined;
  nextHref: string | undefined;
  /**
   * Where to send a member who asked for a page past the end: the last real
   * page, with every other filter preserved. `undefined` when the request was
   * in range, which is the overwhelming case.
   *
   * A redirect rather than an empty list: `?page=9` on a listing that lost
   * rows since the link was made is a stale bookmark, not a mistake worth
   * showing someone a blank page over.
   */
  redirectTo: string | undefined;
}

export type ListView = MoreView | CounterView;

/**
 * Everything the footer renders, derived from the request and the TRUE total.
 *
 * `total` comes from the repo rather than from `rows.length`; that is the
 * whole point of `Paged`.
 */
export function listView(input: { url: URL; request: ListRequest; total: number }): ListView {
  const { url, request, total } = input;
  const { pageSize } = request;

  if (total <= MAX_SHOWN) {
    const limit = shownFor(request);
    const shown = Math.min(limit, total);
    const remaining = total - shown;
    const anchor = `#${MORE_ANCHOR_PREFIX}${shown + 1}`;
    return {
      mode: "more",
      args: { limit, offset: 0 },
      pageSize,
      total,
      shown,
      // Both links drop `page`: an old numbered link has done its job once it
      // has been read as a grown list.
      nextHref:
        remaining > 0
          ? hrefWith(
              url,
              { [PAGE_PARAM]: undefined, [SHOWN_PARAM]: sanitizeShown(shown + pageSize, pageSize) },
              anchor,
            )
          : undefined,
      nextCount: Math.min(pageSize, remaining),
      // One batch left is what the button already does; offering "all" beside
      // it would be two controls for one outcome.
      allHref:
        remaining > pageSize
          ? hrefWith(url, { [PAGE_PARAM]: undefined, [SHOWN_PARAM]: total }, anchor)
          : undefined,
      redirectTo: undefined,
    };
  }

  const pageCount = Math.ceil(total / pageSize);
  const requested = pageFor(request);
  const page = Math.min(requested, pageCount);
  // Page one is the bare URL. Two addresses for one page is one of them
  // getting shared, indexed and bookmarked wrongly.
  const pageHref = (p: number) =>
    hrefWith(url, { [SHOWN_PARAM]: undefined, [PAGE_PARAM]: p <= 1 ? undefined : p });
  return {
    mode: "counter",
    args: toPageArgs(page, pageSize),
    pageSize,
    total,
    page,
    pageCount,
    from: (page - 1) * pageSize + 1,
    to: Math.min(page * pageSize, total),
    prevHref: page > 1 ? pageHref(page - 1) : undefined,
    nextHref: page < pageCount ? pageHref(page + 1) : undefined,
    // Past the end: the last real page. A `?shown=` link that arrived after
    // the list outgrew the ceiling: the same page under its one address, so
    // there are never two URLs for it.
    redirectTo: requested > pageCount || request.shown !== undefined ? pageHref(page) : undefined,
  };
}

/** Whether a list needs a footer at all: one that fits in its first batch does not. */
export function hasFooter(view: ListView): boolean {
  return view.mode === "counter" || view.total > view.pageSize;
}

/**
 * The anchor to plant in the row at `index` (0-based), if any.
 *
 * Every batch boundary of a grown list carries one, not just the latest: the
 * "show all" link lands on the first new row too, and the page cannot tell
 * from its own URL which boundary that was.
 */
export function moreAnchorId(view: ListView, index: number): string | undefined {
  if (view.mode !== "more" || index <= 0 || index % view.pageSize !== 0) {
    return undefined;
  }
  return `${MORE_ANCHOR_PREFIX}${index + 1}`;
}

/**
 * Runs a listing's query with the right `limit`/`offset` and returns it with
 * its footer.
 *
 * The footer's mode depends on the total, and the total only comes back with
 * the rows. So: run the first guess, work out the view from its total, and
 * run the query again only when the guess fetched the wrong window: an old
 * `?page=3` on a list that now grows, or a `?shown=` link on a list that has
 * since outgrown `MAX_SHOWN`. The bare URL never runs twice.
 *
 * `total` reads the count out of whatever shape the loader returns (a
 * `null` detail is a 404 the page handles itself, so it counts as 0).
 */
export async function loadList<R>(
  url: URL,
  pageSize: number,
  load: (args: PageArgs) => Promise<R>,
  total: (result: R) => number,
): Promise<{ result: R; list: ListView }> {
  const request = listRequest(url.searchParams, pageSize);
  const guess = firstGuess(request);
  const result = await load(guess);
  const list = listView({ url, request, total: total(result) });
  // The page is about to redirect; the rows would be thrown away.
  if (list.redirectTo !== undefined) {
    return { result, list };
  }
  if (list.args.limit === guess.limit && list.args.offset === guess.offset) {
    return { result, list };
  }
  // No second look at the total. A row added between the two queries moves
  // the count by one, and re-deciding the mode on it could flip-flop.
  return { result: await load(list.args), list };
}

/** Every word the grown list's footer says. */
export function listMoreLabels(view: MoreView, noun: ListNoun, locale: Locale): ListMoreLabels {
  const t = messages(locale).common;
  return {
    count:
      view.shown >= view.total
        ? t.listAll({ noun, total: view.total })
        : t.listShowing({ noun, shown: view.shown, total: view.total }),
    more: t.listMore({ noun, count: view.nextCount }),
    all: t.listShowAll({ noun, total: view.total }),
  };
}

/** Every word the page counter says. */
export function pageCounterLabels(
  view: CounterView,
  noun: ListNoun,
  locale: Locale,
): PageCounterLabels {
  const t = messages(locale).common;
  return {
    range: t.listRange({ noun, from: view.from, to: view.to, total: view.total }),
    nav: t.listPagesNav({ page: view.page, pageCount: view.pageCount }),
    previous: t.listPrevious,
    next: t.listNext,
    top: t.listTop,
  };
}
