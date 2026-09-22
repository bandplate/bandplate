// The handful of things that belong to no single page.
//
// Deliberately small, and it should stay that way. A form error belongs to the
// page that raises it; only strings that are genuinely said in several
// unrelated places live here. Today that is two, and both of them were already
// copy-pasted around the codebase — the origin message appears verbatim in
// seven files.
//
// The list footer is the other thing said everywhere: every listing that can
// grow ends in the same control, and the sentences under it are here so each
// page names only WHAT it counts.
import { formatNumber, plural } from "../../plural.js";

/** What a listing counts. A key, so each language declines its own noun. */
export type ListNoun = "song" | "take" | "event" | "vote";

const NOUNS: Record<ListNoun, { one: string; other: string }> = {
  song: { one: "song", other: "songs" },
  take: { one: "take", other: "takes" },
  event: { one: "event", other: "events" },
  vote: { one: "vote", other: "votes" },
};

const n = (value: number): string => formatNumber("en", value);
const noun = (kind: ListNoun, count: number): string => plural("en", count, NOUNS[kind]);

export const common = {
  /**
   * A mutating request whose `Origin` did not match.
   *
   * Vague on purpose: whoever sees this is either behind a proxy that strips
   * the header or is being CSRF'd, and neither is helped by naming the
   * mechanism.
   */
  originError: "Something about that request looked wrong. Reload the page and try again.",

  /** The last resort, when a write failed for a reason the page cannot name. */
  genericError: "That didn't work. Try again.",

  /** The edit sheet's close control. */
  closeWithoutSaving: "Close without saving",

  /** How an instrument set names itself. See `InstrumentSet.astro`. */
  instrumentsVerb: "Instruments",
  playsVerb: "Plays",

  /** The edit sheet's accessible name, built from whatever it is editing. */
  editingSheet: (name: string): string => `Editing ${name}`,

  // --- the list footer ------------------------------------------------------
  // "Load more" under a list that fits on one page when grown, a page counter
  // under one that does not. See `apps/web/src/server/pagination.ts`.

  /** How far a grown list has got: "Showing 100 of 187 takes". */
  listShowing: ({
    noun: kind,
    shown,
    total,
  }: {
    noun: ListNoun;
    shown: number;
    total: number;
  }): string => `Showing ${n(shown)} of ${n(total)} ${noun(kind, total)}`,
  /** A grown list with nothing left to show: "All 187 takes". */
  listAll: ({ noun: kind, total }: { noun: ListNoun; total: number }): string =>
    `All ${n(total)} ${noun(kind, total)}`,
  /** The button that grows the list: "Show 25 more takes". */
  listMore: ({ noun: kind, count }: { noun: ListNoun; count: number }): string =>
    `Show ${n(count)} more ${noun(kind, count)}`,
  /** The quiet link that grows it to the end: "Show all 187 takes". */
  listShowAll: ({ noun: kind, total }: { noun: ListNoun; total: number }): string =>
    `Show all ${n(total)} ${noun(kind, total)}`,
  /** Which rows a counted page holds: "76–100 of 225 takes". */
  listRange: ({
    noun: kind,
    from,
    to,
    total,
  }: {
    noun: ListNoun;
    from: number;
    to: number;
    total: number;
  }): string => `${n(from)}–${n(to)} of ${n(total)} ${noun(kind, total)}`,
  /** The counter's accessible name: "Pagination, page 4 of 9". */
  listPagesNav: ({ page, pageCount }: { page: number; pageCount: number }): string =>
    `Pagination, page ${n(page)} of ${n(pageCount)}`,
  listPrevious: "Previous page",
  listNext: "Next page",
  listTop: "Back to top",
};
