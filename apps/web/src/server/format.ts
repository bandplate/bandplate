// Formatting for the pages, and the words that are not yet in the catalog.
//
// The date, duration and byte formatters used to live here as module-level
// `Intl` singletons pinned to three hardcoded locales. A singleton cannot take
// a locale, so they now live in `@bandplate/i18n` and are cached per locale
// there; what is left here are thin wrappers that supply one.
//
// The wrappers still take no locale of their own. Pages do not carry one yet —
// that arrives with `Astro.locals.locale` — so they pass `DEFAULT_LOCALE` and
// render exactly what they rendered before. Each grows a `locale` parameter as
// its page is translated, one area per commit.
import {
  DEFAULT_LOCALE,
  formatBytes as i18nFormatBytes,
  formatDateTime as i18nFormatDateTime,
  formatDuration as i18nFormatDuration,
  formatLongDate as i18nFormatLongDate,
  formatShortDate as i18nFormatShortDate,
  type Locale,
  messages,
  votingMessages,
} from "@bandplate/i18n";

/**
 * A date and a time, for admin tables.
 *
 * It was pinned to `en-CA` to get an ISO shape, on the argument that this is
 * technical data rather than prose. That is overruled: it reads as unformatted
 * on a Czech page, and a person is reading the column either way.
 */
export function formatTimestamp(locale: Locale, ms: number | undefined | null): string {
  return i18nFormatDateTime(locale, ms);
}

/** Human-readable dates for the member-facing pages. */
export function formatLongDate(ms: number | undefined | null): string {
  return i18nFormatLongDate(DEFAULT_LOCALE, ms);
}

export function formatShortDate(ms: number | undefined | null): string {
  return i18nFormatShortDate(DEFAULT_LOCALE, ms);
}

/**
 * The kind badge already names the kind ("rehearsal"/"concert"/"session") —
 * an untitled event must not repeat it as a second, capitalised word (e.g.
 * "rehearsal Rehearsal"). When there's a real title and/or venue, show
 * those; when there's neither (the common untitled-rehearsal case), the
 * badge plus date is the whole row and that's enough. Shared by
 * `/events` and `/` (Task 6's home "recent events" section) rather than
 * duplicated in both.
 */
export function eventLabel(event: { title: string | null; venue: string | null }): string {
  return [event.title, event.venue].filter(Boolean).join(" — ");
}

/**
 * The name a row gives an event. A band event is its title and venue; a
 * personal event has neither, and is named for whose day it is. The row's
 * kind column says "osobní nahrávky" beside it, so together they read as the
 * spec's "Osobní nahrávky, Filip" in the row's own columns.
 */
export function eventName(
  event: { kind: string; title: string | null; venue: string | null },
  ownerName: string | null | undefined,
): string {
  return event.kind === "personal" ? (ownerName ?? "") : eventLabel(event);
}

/**
 * The one word a row shows for an event's kind.
 *
 * The words themselves live in the catalog now (`events.kindLabel`), including
 * the pass-through for kinds it has never heard of — `events.kind` is a plain
 * `string` in the schema because an admin-editable vocabulary was always the
 * intent. This wrapper stays English-bound like the date formatters above, for
 * the pages that have not been translated yet; each drops it for
 * `t.events.kindLabel` as its own area lands.
 */
export function eventKindLabel(kind: string): string {
  return messages(DEFAULT_LOCALE).events.kindLabel(kind);
}

/**
 * A take's own note, unless it only repeats the kind badge rendered beside it.
 * The seeded concert takes are labelled "live" from back when nothing on the
 * row said so, and ingest can produce the same thing from a Reaper region
 * name — either way the word appeared twice, once as a badge and once as a
 * note. Compared against the label actually rendered rather than against the
 * raw kind, so it stays true if `eventKindLabel` maps a kind differently.
 *
 * Shared by `TakeRow.astro` and `/takes/[id]`: both show a badge and a note,
 * so both had the duplicate.
 */
export function takeNote(label: string | null | undefined, kindLabel: string): string | null {
  if (!label) {
    return null;
  }
  return label.trim().toLowerCase() === kindLabel.toLowerCase() ? null : label;
}

/**
 * The facts under a detail page's name in the phone header: "Dmi, 76 bpm",
 * "Zkouška, Dezerter". A list, so commas and no verbs, and never the `·`
 * separator (docs/design-foundation.md). Blank parts drop out rather than
 * leaving ", ," behind.
 *
 * Capitalised at the start, because the catalog's kind words are lowercase
 * to read right mid-sentence, and a line of facts (or a lone value: a take
 * panel's "Zkouška") must not open on one.
 */
export function factsLine(parts: readonly (string | null | undefined)[], locale: Locale): string {
  const line = parts.filter((part): part is string => Boolean(part?.trim())).join(", ");
  if (line === "") {
    return line;
  }
  return line.charAt(0).toLocaleUpperCase(locale) + line.slice(1);
}

/** Byte count as a human `MB`/`KB`/`B` figure — `/takes/[id]`'s asset list. */
export function formatBytes(bytes: number): string {
  return i18nFormatBytes(DEFAULT_LOCALE, bytes);
}

/**
 * The vote-tally sentence — `/takes/[id]`'s metadata row and
 * `VoteToggle.astro`'s compact row display.
 *
 * `VoteFavorite.tsx` re-renders this in the browser after an optimistic vote.
 * It used to hold a hand-maintained copy of the wording, kept honest by a
 * byte-equality test; both sides now call the same catalog entry, so there is
 * nothing left to keep in step.
 */
export function formatVoteTally(
  keeperVotes: number,
  totalVotes: number,
  ratingScore: number,
): string {
  return votingMessages(DEFAULT_LOCALE).tally({ keeperVotes, totalVotes, ratingScore });
}

/** `durationMs` as `m:ss` (or `h:mm:ss` past an hour). */
export function formatDuration(ms: number | undefined | null): string {
  return i18nFormatDuration(ms);
}
