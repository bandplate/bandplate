// What `/s/<code>` shows a signed-out visitor when the link is PUBLIC: one
// take, or one event and its takes, to listen to and nothing else.
//
// Built from an allow-list rather than by trimming the member page's data:
// a field is here because the public page renders it, and a field that is not
// here cannot reach a stranger. So no notes (the take's or the event's), no
// votes or the band's ruling, no member names (not even whose personal day an
// event is), no venue, no stems, no downloads, and no link into the app. What
// is left is what a link preview already says, plus the instruments, the
// durations and the masters to play.
//
// Whether a link opens anything is `resolveShareCode`'s answer (including
// that it is public); this module only reads what the page shows.
import {
  assetsRepo,
  type Db,
  eventsRepo,
  type instrumentsRepo,
  songsRepo,
  takesRepo,
} from "@bandplate/db";
import { formatLongDate, type Locale, messages } from "@bandplate/i18n";
import { eventLabel, factsLine, formatDuration, takeNote } from "../format.js";
import type { SharePreview } from "../share-target.js";
import { type ResolvedShare, resolveShareCode } from "./share.js";

/**
 * The most takes a public event page lists. A rehearsal is a few dozen at
 * most; this is a ceiling against a runaway day, not a page size anyone is
 * expected to reach.
 */
export const PUBLIC_EVENT_TAKES_LIMIT = 200;

/** What `PlayToggleButton` needs to hand a take to the player. */
export interface PublicPlayable {
  takeId: string;
  assetId: string;
  title: string;
  subtitle: string;
}

export interface PublicTakeView {
  kind: "take";
  code: string;
  preview: SharePreview;
  /** The event's kind, as the small caps over the heading. Empty with no event. */
  kindLabel: string;
  /** The song's title, or the take's date where it has no song. */
  title: string;
  /** The take's own label, unless it only repeats the event's kind. */
  note: string | null;
  /** `TakeFactsCard`'s props, without the band's ruling. */
  facts: {
    event: string | null;
    date: string;
    duration: string;
    verdict: null;
    instruments: instrumentsRepo.Instrument[];
  };
  /** Undefined while the take has no ready master: no play control at all. */
  play: PublicPlayable | undefined;
}

export interface PublicEventTake {
  /** With `notes` always null. */
  take: takesRepo.Take;
  song: { slug: string; title: string } | undefined;
  instruments: instrumentsRepo.Instrument[];
  playableAssetId: string | undefined;
}

export interface PublicEventView {
  kind: "event";
  code: string;
  preview: SharePreview;
  kindLabel: string;
  /** The event's own title, never its venue; its date without one. */
  title: string;
  /** "8. července 2026, 5 nahrávek", or just the count when the title already carries the date. */
  summary: string;
  /** Raw kind, for `TakeRow`'s context. */
  eventKind: string;
  takes: PublicEventTake[];
}

export type PublicShareView = PublicTakeView | PublicEventView;

/**
 * The public page for a code, or undefined when the code does not open one
 * for a signed-out visitor: unknown, a members' link, a song, or a target
 * that may no longer be shared. The caller then does what it does for any
 * code it cannot show (the sign-in card or the login redirect).
 */
export async function loadPublicShare(
  db: Db,
  code: string | undefined,
  locale: Locale,
): Promise<PublicShareView | undefined> {
  const resolved = await resolveShareCode(db, code, locale);
  return resolved && code !== undefined ? loadPublicView(db, code, resolved, locale) : undefined;
}

/** `loadPublicShare` for a code the caller has already resolved. */
export async function loadPublicView(
  db: Db,
  code: string,
  resolved: ResolvedShare,
  locale: Locale,
): Promise<PublicShareView | undefined> {
  if (!resolved.public) {
    return undefined;
  }
  if (resolved.kind === "take") {
    return loadTake(db, code, resolved.targetId, resolved.preview, locale);
  }
  if (resolved.kind === "event") {
    return loadEvent(db, code, resolved.targetId, resolved.preview, locale);
  }
  return undefined;
}

async function loadTake(
  db: Db,
  code: string,
  takeId: string,
  preview: SharePreview,
  locale: Locale,
): Promise<PublicTakeView | undefined> {
  const take = await takesRepo.getById(db, takeId);
  if (!take) {
    return undefined;
  }
  const [song, event, instrumentsByTake, masters] = await Promise.all([
    take.songId ? songsRepo.getById(db, take.songId) : undefined,
    eventsRepo.getById(db, take.eventId),
    takesRepo.listInstrumentsForTakes(db, [take.id]),
    assetsRepo.listPlayableMastersByTakeIds(db, [take.id]),
  ]);
  const t = messages(locale);
  const kindLabel = event ? t.events.kindLabel(event.kind) : "";
  const date = formatLongDate(locale, event ? event.heldAt : take.recordedAt);
  const title = song ? song.title : t.takes.heroTitleByDate(date);
  // The event's title alone: `eventLabel` with no venue, so a personal day
  // (no title) falls back to its kind rather than to whose day it is.
  const eventTitle = event ? eventLabel({ title: event.title ?? null, venue: null }) : "";
  const master = masters.get(take.id);
  return {
    kind: "take",
    code,
    preview,
    kindLabel,
    title,
    note: takeNote(take.label, kindLabel),
    facts: {
      event: event ? factsLine([eventTitle || kindLabel], locale) : null,
      date,
      duration: formatDuration(take.durationMs),
      verdict: null,
      instruments: instrumentsByTake.get(take.id) ?? [],
    },
    play: master
      ? {
          takeId: take.id,
          assetId: master.id,
          title,
          subtitle: event ? factsLine([kindLabel, date], locale) : date,
        }
      : undefined,
  };
}

async function loadEvent(
  db: Db,
  code: string,
  eventId: string,
  preview: SharePreview,
  locale: Locale,
): Promise<PublicEventView | undefined> {
  const [event, paged] = await Promise.all([
    eventsRepo.getById(db, eventId),
    takesRepo.listByEvent(db, eventId, {
      order: "asc",
      page: { limit: PUBLIC_EVENT_TAKES_LIMIT, offset: 0 },
    }),
  ]);
  if (!event) {
    return undefined;
  }
  const takes = paged.rows;
  const takeIds = takes.map((take) => take.id);
  const [songs, instrumentsByTake, masters] = await Promise.all([
    songsRepo.getByIds(db, takesRepo.songIdsOf(takes)),
    takesRepo.listInstrumentsForTakes(db, takeIds),
    assetsRepo.listPlayableMastersByTakeIds(db, takeIds),
  ]);
  const songById = new Map(songs.map((song) => [song.id, song]));
  const t = messages(locale);
  return {
    kind: "event",
    code,
    preview,
    kindLabel: t.events.kindLabel(event.kind),
    // Its own title, or its date, the way the member's event page heads it.
    // The kind is the small caps above either way, so it is not repeated
    // here as the preview's fallback title does.
    title: event.title?.trim() || formatLongDate(locale, event.heldAt),
    // The date only when the title is the event's own: an untitled event's
    // heading is already its kind and date, and saying it twice is noise.
    summary: factsLine(
      [
        event.title?.trim() ? formatLongDate(locale, event.heldAt) : null,
        t.takes.count(paged.total),
      ],
      locale,
    ),
    eventKind: event.kind,
    takes: takes.map((take) => {
      const song = take.songId ? songById.get(take.songId) : undefined;
      return {
        // Whole, because `TakeRow` takes a whole take; it renders the label,
        // the date and the duration. The notes are dropped anyway, so a row
        // that one day shows them still cannot show them here.
        take: { ...take, notes: null },
        song: song ? { slug: song.slug, title: song.title } : undefined,
        instruments: instrumentsByTake.get(take.id) ?? [],
        playableAssetId: masters.get(take.id)?.id,
      };
    }),
  };
}
