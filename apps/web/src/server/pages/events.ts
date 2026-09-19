import { type Db, type PageArgs, type Paged, assetsRepo } from "@bandplate/db";
import {
  eventsRepo,
  favoritesRepo,
  type instrumentsRepo,
  membersRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
// `/events` and `/events/[id]` page logic — reads, and (since M8) the form
// handlers that write them. Same shape as `server/pages/songs.ts`, including
// the note there about why the write half lives in `apps/web` rather than in
// `@bandplate/core`.
import { type Locale, messages } from "@bandplate/i18n";
import { z } from "zod";

export type EventListItem = eventsRepo.EventWithTakeCount;

/** The kinds the archive has a pill for. A personal event has none. */
const VALID_KINDS: readonly eventsRepo.EventKind[] = ["rehearsal", "concert", "session"];

/**
 * Parses `/events`'s `?kind=` query param (repeatable, like `?kind=concert&kind=session`).
 *
 * Every band kind ticked is read as no filter at all, the same as a bare
 * `/events`: the pills already show both states identically, and a filter of
 * all three would quietly drop the personal events (a member's day with a
 * take added to its song) that the unfiltered archive lists.
 */
export function parseEventsListKindFilter(searchParams: URLSearchParams): eventsRepo.EventKind[] {
  const raw = searchParams.getAll("kind");
  const valid = [
    ...new Set(
      raw.filter((k): k is eventsRepo.EventKind => (VALID_KINDS as readonly string[]).includes(k)),
    ),
  ];
  return valid.length === VALID_KINDS.length ? [] : valid;
}

/** `?archived=1` — see the note on `SongsListQuery.archived`; same rule here. */
export function parseEventsListArchivedFilter(searchParams: URLSearchParams): boolean {
  return searchParams.get("archived") === "1";
}

/** Rows per page in the event archive. */
export const EVENTS_PER_PAGE = 20;

export async function listEventsForArchive(
  db: Db,
  kind: eventsRepo.EventKind[],
  archived: boolean,
  page: PageArgs,
): Promise<Paged<EventListItem>> {
  // `onlyArchived` is a repo option now rather than a `.filter()` here — see
  // `listSongsForLibrary` for why a page cannot be narrowed after the fact.
  return eventsRepo.listRecentWithTakeCounts(db, {
    kind,
    onlyArchived: archived,
    page,
  });
}

/** How many events are archived — the Archived pill shows nothing when it is 0. */
export async function countArchivedEvents(db: Db): Promise<number> {
  return eventsRepo.count(db, { onlyArchived: true });
}

export interface TakeWithContext extends takesRepo.Take {
  instruments: instrumentsRepo.Instrument[];
  song: songsRepo.Song | undefined;
  /** See `assetsRepo.listPlayableMastersByTakeIds` — undefined means "no play control", not "disabled". */
  playableAssetId: string | undefined;
  /** `undefined` means this member hasn't voted on this take yet — see `TakeRow`'s own `myVote` prop. */
  myVote: boolean | undefined;
  favorited: boolean;
}

export interface EventDetail {
  event: eventsRepo.Event;
  /** Whether THIS member has favorited the event itself — drives the hero's `FavoriteToggle`. */
  eventFavorited: boolean;
  /** ONE PAGE of takes, in recorded order, plus how many the event has in all. */
  takes: TakeWithContext[];
  takeTotal: number;
  /** Whose day this is, for a personal event. */
  owner: membersRepo.Member | undefined;
}

/**
 * Rows per page on an event.
 *
 * Larger than a song's page: reading an event IS reading its take list in
 * order, so the list is the page rather than a section of it, and a rehearsal
 * that produced thirty takes should mostly fit in one read.
 */
export const EVENT_TAKES_PER_PAGE = 30;

/**
 * Everything `/events/[id]` renders: the event plus every take recorded
 * that day IN RECORDED ORDER (not newest-first — this is the one place
 * that ordering differs, since it's reconstructing what happened during a
 * single session), each with its song and instruments batch-fetched.
 */
export async function getEventDetail(
  db: Db,
  id: string,
  memberId: string,
  takesPage: PageArgs = { limit: EVENT_TAKES_PER_PAGE, offset: 0 },
): Promise<EventDetail | undefined> {
  const event = await eventsRepo.getById(db, id);
  if (!event) {
    return undefined;
  }

  const [pagedTakes, eventFavorited] = await Promise.all([
    takesRepo.listByEvent(db, event.id, { order: "asc", page: takesPage }),
    favoritesRepo.isFavorited(db, memberId, "event", event.id),
  ]);
  // A personal event with no band take is somebody's stash day, and does not
  // exist for anyone — its owner included, who has the stash for that.
  if (event.kind === "personal" && pagedTakes.total === 0) {
    return undefined;
  }
  const [owner] = event.ownerMemberId ? await membersRepo.getByIds(db, [event.ownerMemberId]) : [];
  const takes = pagedTakes.rows;
  const takeIds = takes.map((t) => t.id);
  const songIds = [...new Set(takes.map((t) => t.songId))];
  const [instrumentsByTake, songs, playableByTakeId, myVoteByTakeId, favoriteTakeIds] =
    await Promise.all([
      takesRepo.listInstrumentsForTakes(db, takeIds),
      songsRepo.getByIds(db, songIds),
      assetsRepo.listPlayableMastersByTakeIds(db, takeIds),
      votesRepo.listByMemberForTakes(db, memberId, takeIds),
      favoritesRepo.listTargetIdsByMember(db, memberId, "take"),
    ]);
  const songById = new Map(songs.map((s) => [s.id, s]));

  return {
    event,
    eventFavorited,
    owner,
    takeTotal: pagedTakes.total,
    takes: takes.map((take) => ({
      ...take,
      instruments: instrumentsByTake.get(take.id) ?? [],
      song: songById.get(take.songId),
      playableAssetId: playableByTakeId.get(take.id)?.id,
      myVote: myVoteByTakeId.get(take.id),
      favorited: favoriteTakeIds.has(take.id),
    })),
  };
}

// ---------------------------------------------------------------------------
// Writes (M8)
// ---------------------------------------------------------------------------

function optionalText(value: FormDataEntryValue | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * `<input type="date">` posts `YYYY-MM-DD` and nothing else — no time, no
 * offset. Parsing that with `new Date(...)` would read it as UTC midnight,
 * which in Europe/Prague is the evening BEFORE: a rehearsal entered as 8 July
 * would file itself under 7 July for anyone west of the meridian. Splitting
 * the parts and handing them to the local-time `Date` constructor puts the
 * event at local midnight on the day the member actually typed.
 *
 * This is why `parseIsoToEpochMs` stayed in the ingest routes rather than
 * moving to core with the rest: the bridge sends a full ISO-8601 timestamp
 * WITH an offset, which is a different problem with a different correct
 * answer.
 */
function parseDateInput(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

const eventFieldsSchema = z.object({
  kind: z.enum(["rehearsal", "concert", "session"], {
    errorMap: () => ({ message: "kindRequired" }),
  }),
  heldAt: z
    .string()
    .trim()
    .min(1, "heldAtRequired")
    .transform(parseDateInput)
    .refine((v): v is number => v !== undefined, "dateInvalid"),
  title: z.string().trim().max(300).nullable(),
  venue: z.string().trim().max(300).nullable(),
  notes: z.string().trim().max(20_000).nullable(),
});

export type EventField = "kind" | "heldAt" | "title" | "venue" | "notes";

export type EventFormFailure = { kind: "invalid"; error: string; field: EventField };

export type CreateEventResult =
  | { kind: "ok"; event: eventsRepo.Event; sameDay: eventsRepo.Event[] }
  | EventFormFailure;

export type UpdateEventResult = { kind: "ok" } | { kind: "not_found" } | EventFormFailure;

function parseEventFields(formData: FormData) {
  return eventFieldsSchema.safeParse({
    kind: formData.get("kind"),
    heldAt: formData.get("heldAt"),
    title: optionalText(formData.get("title")),
    venue: optionalText(formData.get("venue")),
    notes: optionalText(formData.get("notes")),
  });
}

function invalidEvent(parsed: z.SafeParseError<unknown>): EventFormFailure {
  const issue = parsed.error.issues[0];
  return {
    kind: "invalid",
    error: issue?.message ?? "generic",
    field: (issue?.path[0] as EventField | undefined) ?? "heldAt",
  };
}

/**
 * Create an event, and report any event of the same kind ALREADY on that day.
 *
 * That report is the duplicate-event guard, and it is deliberately a warning
 * rather than a refusal. A manually created event carries no `clientRef`, so
 * when the bridge later pushes the same rehearsal it finds nothing to match
 * and creates a second one, splitting the day in half. The moment a human is
 * typing the date is the only moment anyone has the context to notice — but
 * two rehearsals on one day is also perfectly real (an afternoon and an
 * evening), so blocking it would be wrong.
 *
 * What is NOT done: auto-matching on (kind, same day) inside the ingest route.
 * That silently merges two genuinely different sessions, and nobody finds out
 * for months.
 */
export async function createEvent(
  db: Db,
  now: number,
  formData: FormData,
): Promise<CreateEventResult> {
  const parsed = parseEventFields(formData);
  if (!parsed.success) {
    return invalidEvent(parsed);
  }

  const dayStart = parsed.data.heldAt;
  // A range query rather than "every event of this kind, narrowed in JS" —
  // see `eventsRepo.listOnDay`. The old shape would have missed a duplicate
  // that fell past the first page.
  const sameDay = await eventsRepo.listOnDay(db, parsed.data.kind, dayStart, {
    includeArchived: true,
  });

  const event = await eventsRepo.create(db, {
    kind: parsed.data.kind,
    title: parsed.data.title,
    heldAt: parsed.data.heldAt,
    venue: parsed.data.venue,
    notes: parsed.data.notes,
    createdAt: now,
    updatedAt: now,
  });
  return { kind: "ok", event, sameDay };
}

export async function updateEvent(
  db: Db,
  now: number,
  id: string,
  formData: FormData,
): Promise<UpdateEventResult> {
  const parsed = parseEventFields(formData);
  if (!parsed.success) {
    return invalidEvent(parsed);
  }
  const event = await eventsRepo.getById(db, id);
  // A personal event is one member's stash day, not the band's to rename,
  // re-kind or re-date. The event page never shows its edit sheet for one
  // (`isPersonal` in `events/[id].astro`); this is the guard for a
  // hand-built POST that never saw the hidden button.
  if (!event || event.kind === "personal") {
    return { kind: "not_found" };
  }
  await eventsRepo.update(db, id, {
    kind: parsed.data.kind,
    title: parsed.data.title,
    heldAt: parsed.data.heldAt,
    venue: parsed.data.venue,
    notes: parsed.data.notes,
    updatedAt: now,
  });
  return { kind: "ok" };
}

export type ArchiveEventResult = { kind: "ok"; event: eventsRepo.Event } | { kind: "not_found" };

export async function setEventArchived(
  db: Db,
  now: number,
  id: string,
  archived: boolean,
): Promise<ArchiveEventResult> {
  const event = await eventsRepo.getById(db, id);
  if (!event) {
    return { kind: "not_found" };
  }
  await eventsRepo.update(db, id, { archivedAt: archived ? now : null, updatedAt: now });
  return { kind: "ok", event };
}

/**
 * What archiving this event costs, in one sentence — the sibling of
 * `archiveSongConsequence` next door, shared by the confirm dialog and the
 * confirm page for the same reason.
 */
export function archiveEventConsequence(takeCount: number, locale: Locale): string {
  return messages(locale).events.archiveConsequence({ takeCount });
}

/**
 * Two events for one session, joined back into one.
 *
 * The repair for the duplicate this app cannot prevent: a member creates the
 * rehearsal (no `clientRef`), the bridge later pushes the same one (with a
 * `clientRef`), nothing matches, and the day exists twice with its takes split
 * between them.
 *
 * The bridge's event is the one that SURVIVES, always — it holds the
 * idempotency key the bridge will keep writing against, and taking that key
 * off it would only send the next push into the same split. The manual event's
 * takes move over and the empty shell is archived rather than deleted, so a
 * favourite pointing at it still resolves.
 *
 * Where NEITHER has a `clientRef` (two manual events), the caller picks which
 * to keep and the survivor adopts nothing.
 */
export type MergeEventsResult =
  | { kind: "ok"; keptId: string; movedTakes: number }
  | { kind: "not_found" }
  | { kind: "same_event" };

export async function mergeEvents(
  db: Db,
  now: number,
  keepId: string,
  mergeId: string,
): Promise<MergeEventsResult> {
  if (keepId === mergeId) {
    return { kind: "same_event" };
  }
  const [keep, merge] = await Promise.all([
    eventsRepo.getById(db, keepId),
    eventsRepo.getById(db, mergeId),
  ]);
  // A personal event is one member's stash day, never half of a band
  // duplicate: merging would hand their recordings to a band event, or fold
  // a band event into their day.
  if (!keep || !merge || keep.kind === "personal" || merge.kind === "personal") {
    return { kind: "not_found" };
  }

  // A count, not a page of rows: `moveAllToEvent` below moves them in SQL,
  // so the only thing needed here is how many there were to report.
  const movingCount = await takesRepo.countByEvent(db, mergeId);
  await takesRepo.moveAllToEvent(db, mergeId, keepId, now);

  // If the survivor has no key and the one being folded in does, it inherits
  // it — otherwise the bridge's next push would recreate the event we just
  // merged away.
  //
  // RELEASE FIRST. `events.client_ref` is UNIQUE, so adopting a key another
  // row still holds fails on the constraint. Not a batch: D1 would apply both
  // statements atomically but SQLite still checks the constraint per
  // statement, so the order is what matters, not the atomicity. Interrupted
  // between the two, the key is simply on neither event and the bridge's next
  // push creates a fresh one — visible, and repairable by this same action.
  if (!keep.clientRef && merge.clientRef) {
    await eventsRepo.setClientRef(db, mergeId, null, now);
    await eventsRepo.setClientRef(db, keepId, merge.clientRef, now);
  }
  await eventsRepo.update(db, mergeId, { archivedAt: now, updatedAt: now });

  return { kind: "ok", keptId: keepId, movedTakes: movingCount };
}

/**
 * Any OTHER event of the same kind on the same day. What the duplicate warning
 * is built from, and what the merge offer needs.
 */
export async function findSameDayEvents(
  db: Db,
  event: eventsRepo.Event,
): Promise<eventsRepo.Event[]> {
  // A personal event is one member's day: another member's on the same date
  // is not a duplicate of it, and neither is merged (see `mergeEvents`).
  if (event.kind === "personal") {
    return [];
  }
  const dayStart = new Date(event.heldAt);
  dayStart.setHours(0, 0, 0, 0);
  const start = dayStart.getTime();
  const sameDay = await eventsRepo.listOnDay(db, event.kind, start);
  return sameDay.filter((e) => e.id !== event.id);
}
