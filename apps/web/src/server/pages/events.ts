import {
  assetsRepo,
  combineReads,
  type Db,
  eventsRepo,
  favoritesRepo,
  instrumentsRepo,
  mapRead,
  membersRepo,
  type PageArgs,
  type Paged,
  type Read,
  readValue,
  runRead,
  runReads,
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
import { type ListView, loadList } from "../pagination.js";

export interface EventListItem extends eventsRepo.EventWithTakeCount {
  /** Whose day this is, for a personal event. Null on a band event. */
  ownerName: string | null;
}

/**
 * Event rows with the owner's name each personal one is labelled with. One
 * batched read for the page, and none at all when no row is personal.
 */
export async function withOwnerNames(
  db: Db,
  events: eventsRepo.EventWithTakeCount[],
): Promise<EventListItem[]> {
  return runRead(db, withOwnerNamesRead(db, events));
}

/** `withOwnerNames`, planned for the caller's batch. */
export function withOwnerNamesRead(
  db: Db,
  events: eventsRepo.EventWithTakeCount[],
): Read<EventListItem[]> {
  const ownerIds = [
    ...new Set(events.map((e) => e.ownerMemberId).filter((id): id is string => Boolean(id))),
  ];
  return mapRead(membersRepo.buildGetByIdsRead(db, ownerIds), (owners) => {
    const nameById = new Map(owners.map((m) => [m.id, m.displayName]));
    return events.map((event) => ({
      ...event,
      ownerName: event.ownerMemberId ? (nameById.get(event.ownerMemberId) ?? null) : null,
    }));
  });
}

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
  const paged = await eventsRepo.listRecentWithTakeCounts(db, {
    kind,
    onlyArchived: archived,
    page,
  });
  return { ...paged, rows: await withOwnerNames(db, paged.rows) };
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

/** What the event page reads keyed by the event id alone, the page of takes aside. */
interface EventFound {
  event: eventsRepo.Event | undefined;
  eventFavorited: boolean;
  favoriteTakeIds: Set<string>;
}

function eventFoundRead(db: Db, id: string, memberId: string): Read<EventFound> {
  return combineReads({
    event: eventsRepo.buildGetByIdRead(db, id),
    eventFavorited: favoritesRepo.buildIsFavoritedRead(db, memberId, "event", id),
    favoriteTakeIds: favoritesRepo.buildListTargetIdsByMemberRead(db, memberId, "take"),
  });
}

/** One page of the event's takes, in recorded order, and their total. */
function eventTakesRead(db: Db, id: string, page: PageArgs): Read<Paged<takesRepo.Take>> {
  return takesRepo.buildListByEventRead(db, id, { order: "asc", page });
}

/**
 * A personal event with no band take is somebody's stash day, and does not
 * exist for anyone — its owner included, who has the stash for that.
 */
function eventExists(
  event: eventsRepo.Event | undefined,
  paged: Paged<takesRepo.Take>,
): event is eventsRepo.Event {
  return event !== undefined && !(event.kind === "personal" && paged.total === 0);
}

/**
 * The second batch: what the page of takes needs to render (instruments,
 * songs, players, this member's votes) and whose day a personal event is.
 */
function eventDetailRead(
  db: Db,
  memberId: string,
  event: eventsRepo.Event,
  found: EventFound,
  paged: Paged<takesRepo.Take>,
): Read<EventDetail> {
  const takes = paged.rows;
  const takeIds = takes.map((t) => t.id);
  const read = combineReads({
    instrumentsByTake: takesRepo.buildListInstrumentsForTakesRead(db, takeIds),
    songs: songsRepo.buildGetByIdsRead(db, takesRepo.songIdsOf(takes)),
    playableByTakeId: assetsRepo.buildListPlayableMastersByTakeIdsRead(db, takeIds),
    myVoteByTakeId: votesRepo.buildListByMemberForTakesRead(db, memberId, takeIds),
    owner: event.ownerMemberId
      ? mapRead(membersRepo.buildGetByIdsRead(db, [event.ownerMemberId]), (owners) => owners[0])
      : readValue(undefined),
  });
  return mapRead(read, (context) => {
    const songById = new Map(context.songs.map((s) => [s.id, s]));
    return {
      event,
      eventFavorited: found.eventFavorited,
      owner: context.owner,
      takeTotal: paged.total,
      takes: takes.map((take) => ({
        ...take,
        instruments: context.instrumentsByTake.get(take.id) ?? [],
        song: take.songId ? songById.get(take.songId) : undefined,
        playableAssetId: context.playableByTakeId.get(take.id)?.id,
        myVote: context.myVoteByTakeId.get(take.id),
        favorited: found.favoriteTakeIds.has(take.id),
      })),
    };
  });
}

export interface EventPageData {
  /** Undefined is a 404. */
  detail: EventDetail | undefined;
  list: ListView;
  /** Any OTHER event of the same kind on the same day: see `sameDayEventsRead`. */
  sameDay: eventsRepo.Event[];
  /** The take sheet's song picker. */
  allSongs: songsRepo.Song[];
  /** The take sheet's instruments, and the roster the take rows line up on. */
  allInstruments: instrumentsRepo.Instrument[];
}

/**
 * Everything `/events/[id]` renders: the event plus every take recorded that
 * day IN RECORDED ORDER (not newest-first — this is the one place that
 * ordering differs, since it's reconstructing what happened during a single
 * session), each with its song and instruments batch-fetched.
 *
 * It reads in two round trips: one batch for all
 * that needs only the request (the event, the page of its takes, the take
 * sheet's pickers), one for what those returned (the takes' context, the
 * owner of a personal day, the same-day duplicates).
 *
 * `loadList` may ask for the takes a second time, when the URL guessed the
 * wrong window. The takes' context waits until the window is settled, so
 * that second ask is one more round trip carrying only the page of takes.
 */
export async function getEventPageData(
  db: Db,
  request: { url: URL; id: string; memberId: string },
): Promise<EventPageData> {
  const { url, id, memberId } = request;
  const restOfPage = combineReads({
    found: eventFoundRead(db, id, memberId),
    allSongs: songsRepo.buildListRead(db),
    allInstruments: instrumentsRepo.buildListRead(db),
  });
  type RestOfPage = typeof restOfPage extends Read<infer T> ? T : never;

  let rest: RestOfPage | undefined;
  const { result: paged, list } = await loadList(
    url,
    EVENT_TAKES_PER_PAGE,
    async (page) => {
      const first = await runReads(db, {
        paged: eventTakesRead(db, id, page),
        rest: rest ? readValue(rest) : restOfPage,
      });
      rest = first.rest;
      return first.paged;
    },
    // Zero for a missing event and for a hidden personal day alike: the
    // count is of band takes, and neither has any.
    (found) => found.total,
  );
  if (!rest) {
    throw new Error("loadList returned without loading");
  }
  const { found, allSongs, allInstruments } = rest;
  if (!eventExists(found.event, paged)) {
    return { detail: undefined, list, sameDay: [], allSongs, allInstruments };
  }
  const { detail, sameDay } = await runReads(db, {
    detail: eventDetailRead(db, memberId, found.event, found, paged),
    sameDay: sameDayEventsRead(db, found.event),
  });
  return { detail, list, sameDay, allSongs, allInstruments };
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
function sameDayEventsRead(db: Db, event: eventsRepo.Event): Read<eventsRepo.Event[]> {
  // A personal event is one member's day: another member's on the same date
  // is not a duplicate of it, and neither is merged (see `mergeEvents`).
  if (event.kind === "personal") {
    return readValue([]);
  }
  const dayStart = new Date(event.heldAt);
  dayStart.setHours(0, 0, 0, 0);
  const start = dayStart.getTime();
  return mapRead(eventsRepo.buildListOnDayRead(db, event.kind, start), (sameDay) =>
    sameDay.filter((e) => e.id !== event.id),
  );
}
