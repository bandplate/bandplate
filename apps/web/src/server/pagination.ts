// Page NUMBERS — the half of paging that belongs to the URL rather than to
// the database.
//
// `@bandplate/db`'s `PageArgs` is `limit`/`offset`, which is what a query
// wants and what nobody wants to type into an address bar. This module is the
// translation, and the only place the off-by-one between them lives.
//
// Every paginated listing in the app goes through `pageView`, so the control
// under a list of songs behaves exactly like the one under a list of takes —
// including what it does when someone edits the number in the URL by hand.
import { MAX_PAGE_SIZE, type PageArgs, clampPageSize } from "@bandplate/db";
import type { PaginationLabels } from "@bandplate/ui/components/Pagination.astro";

/** The query parameter every listing pages on. */
export const PAGE_PARAM = "page";

/**
 * The requested page, 1-based and sanitised.
 *
 * Anything that is not a positive integer — `?page=0`, `?page=-3`,
 * `?page=abc`, `?page=2.5` — is page one rather than an error. A listing is a
 * GET surface people link to and edit by hand; there is nothing to tell them
 * off about, and a 400 here would break a stale bookmark for no gain.
 */
export function parsePageNumber(searchParams: URLSearchParams): number {
  const raw = searchParams.get(PAGE_PARAM);
  if (raw === null) {
    return 1;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }
  // A page number far past the end is not clamped here — `pageView` needs the
  // true request to notice it is out of range and say so. Only the absurd is
  // capped, so `?page=1e9` cannot become an offset the database has to think
  // about.
  return Math.min(parsed, MAX_PAGE_NUMBER);
}

/**
 * A ceiling on the page NUMBER itself, independent of how many pages exist.
 * `?page=999999999` is a URL anyone can type; multiplied by a page size it
 * becomes an OFFSET the database walks row by row. Nothing in this archive
 * will ever have a millionth page.
 */
export const MAX_PAGE_NUMBER = 1_000_000;

/** Turns a 1-based page number into the `limit`/`offset` the repos take. */
export function toPageArgs(page: number, perPage: number): PageArgs {
  const limit = clampPageSize(perPage, perPage);
  return { limit, offset: (Math.max(1, page) - 1) * limit };
}

/** Both halves of a paged request, from a URL. */
export function pageRequest(
  searchParams: URLSearchParams,
  perPage: number,
): { page: number; args: PageArgs } {
  const page = parsePageNumber(searchParams);
  return { page, args: toPageArgs(page, perPage) };
}

export type PaginationItem =
  | { kind: "page"; page: number; href: string; current: boolean }
  /** An elided run of page numbers — rendered as an ellipsis, never a link. */
  | { kind: "gap" };

export interface PageView {
  page: number;
  perPage: number;
  total: number;
  pageCount: number;
  /** 1-based index of the first row on this page; 0 when the listing is empty. */
  from: number;
  /** 1-based index of the last row on this page; 0 when the listing is empty. */
  to: number;
  prevHref: string | undefined;
  nextHref: string | undefined;
  items: PaginationItem[];
  /**
   * Where to send a member who asked for a page past the end — the last real
   * page, with every other filter preserved. `undefined` when the request was
   * in range, which is the overwhelming case.
   *
   * A redirect rather than an empty list: `?page=9` on a listing that lost
   * rows since the link was made is a stale bookmark, not a mistake worth
   * showing someone a blank page over.
   */
  redirectTo: string | undefined;
}

/** How many numbered links flank the current page before the run is elided. */
const WINDOW = 2;

function hrefForPage(url: URL, page: number): string {
  const params = new URLSearchParams(url.search);
  if (page <= 1) {
    // Page one is the bare URL. Two addresses for one page is one of them
    // getting shared, indexed and bookmarked wrongly.
    params.delete(PAGE_PARAM);
  } else {
    params.set(PAGE_PARAM, String(page));
  }
  const query = params.toString();
  return query === "" ? url.pathname : `${url.pathname}?${query}`;
}

/**
 * Everything a pagination control renders, derived from what the query
 * actually returned.
 *
 * `total` comes from the repo rather than from `rows.length` — that is the
 * whole point of `Paged`, and the reason a listing can say "48 takes" instead
 * of the hedge a truncation flag forces.
 */
export function pageView(input: {
  url: URL;
  page: number;
  perPage: number;
  total: number;
}): PageView {
  const { url, perPage, total } = input;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, input.page), pageCount);
  const redirectTo = input.page > pageCount ? hrefForPage(url, pageCount) : undefined;

  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  // First and last are ALWAYS present, so "jump to the end" never needs a
  // walk. Everything within `WINDOW` of the current page is present so the
  // neighbours a thumb reaches for are there. The rest is one gap per side.
  const wanted = new Set<number>([1, pageCount]);
  for (let p = page - WINDOW; p <= page + WINDOW; p += 1) {
    if (p >= 1 && p <= pageCount) {
      wanted.add(p);
    }
  }
  const numbers = [...wanted].sort((a, b) => a - b);

  const items: PaginationItem[] = [];
  let previous = 0;
  for (const number of numbers) {
    // A gap standing for exactly ONE page is a lie that costs a click: render
    // that page instead of an ellipsis hiding it.
    if (previous !== 0 && number - previous === 2) {
      const skipped = previous + 1;
      items.push({
        kind: "page",
        page: skipped,
        href: hrefForPage(url, skipped),
        current: false,
      });
    } else if (previous !== 0 && number - previous > 2) {
      items.push({ kind: "gap" });
    }
    items.push({
      kind: "page",
      page: number,
      href: hrefForPage(url, number),
      current: number === page,
    });
    previous = number;
  }

  return {
    page,
    perPage,
    total,
    pageCount,
    from,
    to,
    prevHref: page > 1 ? hrefForPage(url, page - 1) : undefined,
    nextHref: page < pageCount ? hrefForPage(url, page + 1) : undefined,
    items,
    redirectTo,
  };
}

/**
 * What a listing counts. A KEY, not a word — `Pagination` draws sentences and
 * this module builds them, so nothing outside here knows how to spell "takes".
 */
export type CountableNoun = "song" | "take" | "event" | "vote";

/**
 * The English forms of each countable, keyed by `Intl.PluralRules` category.
 *
 * English only ever returns `one` and `other`, so two entries is the whole
 * language. Czech returns `one` / `few` / `many` / `other` and needs the
 * genitive after a numeral ("5 skladeb"), which is the same axis — a record
 * per noun covers both, with no separate case machinery. That is why the shape
 * is a record rather than a singular/plural pair.
 */
const NOUN_FORMS: Record<CountableNoun, Record<string, string>> = {
  song: { one: "song", other: "songs" },
  take: { one: "take", other: "takes" },
  event: { one: "event", other: "events" },
  vote: { one: "vote", other: "votes" },
};

function countable(noun: CountableNoun, count: number): string {
  const forms = NOUN_FORMS[noun];
  const category = new Intl.PluralRules("en").select(count);
  return forms[category] ?? forms.other ?? noun;
}

/**
 * Every word the pagination control says, for one listing.
 *
 * Lives here rather than in `packages/ui` so the brand layer stays free of a
 * locale concept, and so the range line is assembled somewhere that knows how
 * the language works. Built as ONE string rather than as adjacent
 * `{from}–{to} of {total} {noun}` expressions in the template: Astro drops the
 * whitespace between two neighbouring expressions on the same line, which
 * rendered "of 225takes".
 */
export function paginationLabels(
  view: Pick<PageView, "page" | "pageCount" | "total" | "from" | "to">,
  noun: CountableNoun,
): PaginationLabels {
  return {
    range: `${view.from}–${view.to} of ${view.total} ${countable(noun, view.total)}`,
    previous: "Previous",
    next: "Next",
    here: `Page ${view.page} of ${view.pageCount}`,
    nav: `Pagination, page ${view.page} of ${view.pageCount}`,
    page: (n) => `Page ${n}`,
  };
}

/** Re-exported so page modules import one name for the whole concern. */
export { MAX_PAGE_SIZE };
