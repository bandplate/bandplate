import {
  type Db,
  assetsRepo,
  eventsRepo,
  favoritesRepo,
  membersRepo,
  songsRepo,
  takesRepo,
} from "@bandplate/db";
// Home's data. Three questions, always in this order:
//
//   1. What is new for you: the newest band event with takes published since
//      your last visit ("Na pultu"). Absent when nothing is, and then the
//      page does not draw the section at all.
//   2. What you are working on: the things you pinned, and your stash.
//   3. What the band recorded lately: the event ledger.
//
// The old "needs your vote" queue is still gone. The first section carries a
// count of the new takes you have not voted on, which is a fact about what
// just arrived, not a list of everything you owe.
//
// Recent events carry no takes: home lists EVENTS, and opening one is how you
// reach its takes.
import { type Locale, messages } from "@bandplate/i18n";
import { type EventListItem, withOwnerNames } from "./events.js";
import { decideHomeVisit } from "./home-visit.js";
import { type TakeWithFullContext, attachFullContext } from "./take-context.js";

/** How many events the ledger lists before pointing at `/events` for the rest. */
const RECENT_EVENTS_LIMIT = 5;

/**
 * How many pins the shelf holds.
 *
 * A cap, not a page: the shelf is a horizontal RAIL, and paging a rail is a
 * control that fights the gesture already on it. What a member reaches for at
 * a rehearsal is in the first handful; `total` is what says there are more.
 */
const PINNED_LIMIT = 24;

export interface HomeFavorites {
  songs: songsRepo.Song[];
  takes: TakeWithFullContext[];
  /** Task 8: the brief's DoD is explicit — "Favorites toggle on song, take
   *  and event, and appear on / and /me" — so a favorited event belongs in
   *  this same list, not left out the way Task 6's display-only version
   *  scoped it (that scoping predates the event toggle existing at all). */
  events: eventsRepo.Event[];
}

/** Also used by `server/pages/me.ts` — `/me` shows the same favorites list. */
export async function getFavorites(db: Db, memberId: string): Promise<HomeFavorites> {
  const { rows } = await favoritesRepo.listByMember(db, memberId, {
    page: { limit: PINNED_LIMIT, offset: 0 },
  });
  const songIds = rows.filter((r) => r.targetType === "song").map((r) => r.targetId);
  const takeIds = rows.filter((r) => r.targetType === "take").map((r) => r.targetId);
  const eventIds = rows.filter((r) => r.targetType === "event").map((r) => r.targetId);

  const [songs, takes, events] = await Promise.all([
    songsRepo.getByIds(db, songIds),
    takesRepo.getByIds(db, takeIds),
    eventsRepo.getByIds(db, eventIds),
  ]);
  // Preserve favorites.listByMember's newest-first order rather than
  // whatever order the batch `getByIds` lookups happened to return in.
  const songById = new Map(songs.map((s) => [s.id, s]));
  const takeById = new Map(takes.map((t) => [t.id, t]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  // Archived songs and events drop out of the pinned list. `getByIds` is a
  // LOOKUP and deliberately returns them (a pinned TAKE still has to be able
  // to name its archived song), so the filtering happens here, where the
  // question is "what should this member see pinned" rather than "what row is
  // this". The favourite row itself stays — unarchiving brings the pin back,
  // and a member who archived something by mistake has lost nothing.
  // Explicit predicates: a compound `x !== undefined && ...` does NOT narrow
  // the array's element type the way the bare check does, so without these the
  // result is `(T | undefined)[]`.
  const orderedSongs = songIds
    .map((id) => songById.get(id))
    .filter((s): s is songsRepo.Song => s !== undefined && s.archivedAt === null);
  const orderedTakes = takeIds
    .map((id) => takeById.get(id))
    .filter((t): t is takesRepo.Take => t !== undefined && takesRepo.isVisibleTo(t, memberId));
  const orderedEvents = eventIds
    .map((id) => eventById.get(id))
    .filter((e): e is eventsRepo.Event => e !== undefined && e.archivedAt === null);

  return {
    songs: orderedSongs,
    takes: await attachFullContext(db, orderedTakes, memberId),
    events: orderedEvents,
  };
}

/**
 * One pinned thing, in the order the member pinned it — a single list, not
 * three. A song, a take and an event are different enough to tell apart by
 * their own shape (a take can be played, a song counts its takes, an event
 * names its kind), so grouping them under three sub-headings only added
 * furniture to the page's lead section — and two of the three groups are
 * usually empty, since most people pin takes.
 */
export type PinnedItem =
  | {
      kind: "take";
      id: string;
      take: takesRepo.Take;
      song: songsRepo.Song | undefined;
      event: eventsRepo.Event | undefined;
      /** See `assetsRepo.listPlayableMastersByTakeIds` — undefined means "no play control". */
      playableAssetId: string | undefined;
      /** The recording member's name, for a personal recording. Null for a band take. */
      ownerName: string | null;
    }
  | { kind: "song"; id: string; song: songsRepo.Song; takeCount: number }
  | {
      kind: "event";
      id: string;
      event: eventsRepo.Event;
      takeCount: number;
      /** Whose day this is, for a personal event. Null on a band event. */
      ownerName: string | null;
    };

/**
 * The one word that says what a pinned thing IS — "Take", "Song", or the
 * event's own kind. Defined next to `PinnedItem` rather than in either of the
 * two components that render it, because both the plate's caption and the
 * hero's meta line show it and they must never disagree; the last time a label
 * rule lived in two places it drifted.
 */
export function pinnedKindWord(item: PinnedItem, locale: Locale): string {
  const t = messages(locale);
  if (item.kind === "take") {
    return t.home.takeWord;
  }
  if (item.kind === "song") {
    return t.home.songWord;
  }
  return t.events.kindLabel(item.event.kind);
}

/**
 * The member's favorites as one newest-first list. `favoritesRepo.listByMember`
 * already orders by `createdAt DESC` across all three target types, so the
 * merge is just a matter of keeping that order rather than re-sorting anything.
 */
async function getPinned(
  db: Db,
  memberId: string,
): Promise<{ items: PinnedItem[]; total: number }> {
  const { rows, total } = await favoritesRepo.listByMember(db, memberId, {
    page: { limit: PINNED_LIMIT, offset: 0 },
  });
  if (rows.length === 0) {
    return { items: [], total };
  }

  const songIds = rows.filter((r) => r.targetType === "song").map((r) => r.targetId);
  const takeIds = rows.filter((r) => r.targetType === "take").map((r) => r.targetId);
  const eventIds = rows.filter((r) => r.targetType === "event").map((r) => r.targetId);

  const [songs, takes, events, playableByTakeId, takeCountByPinnedEvent] = await Promise.all([
    songsRepo.getByIds(db, songIds),
    takesRepo.getByIds(db, takeIds),
    eventsRepo.getByIds(db, eventIds),
    assetsRepo.listPlayableMastersByTakeIds(db, takeIds),
    // A COUNT per pinned event, not its takes: the card shows a number, and
    // this used to fetch every take row of every pinned event to call
    // `.length` on the result.
    takesRepo.countByEvents(db, eventIds),
  ]);

  // A pinned take names its own song and event; both may be missing if the
  // row was pinned and the target later archived, which is why every lookup
  // below is allowed to come back undefined rather than asserted.
  const takeSongIds = takesRepo.songIdsOf(takes);
  const takeEventIds = [...new Set(takes.map((t) => t.eventId).filter((id) => id !== null))];
  const [takeSongs, takeEvents, songTakeCount] = await Promise.all([
    songsRepo.getByIds(db, takeSongIds),
    eventsRepo.getByIds(db, takeEventIds as string[]),
    // ONE grouped count for every pinned song. This was a `Promise.all` over
    // `listBySong` — a query per pin, each pulling every take ROW of that song
    // across the wire so that `.length` could be read off it.
    takesRepo.countBySongs(db, songIds),
  ]);

  // Whose each personal take and personal event is: one read for all of them.
  const ownerIds = [
    ...new Set(
      [...takes, ...events].map((x) => x.ownerMemberId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const owners = ownerIds.length > 0 ? await membersRepo.getByIds(db, ownerIds) : [];
  const ownerNameById = new Map(owners.map((m) => [m.id, m.displayName]));
  const ownerName = (id: string | null) => (id ? (ownerNameById.get(id) ?? null) : null);

  const songById = new Map([...songs, ...takeSongs].map((x) => [x.id, x]));
  const eventById = new Map([...events, ...takeEvents].map((x) => [x.id, x]));
  const takeById = new Map(takes.map((t) => [t.id, t]));

  const items: PinnedItem[] = [];
  for (const row of rows) {
    if (row.targetType === "take") {
      const take = takeById.get(row.targetId);
      if (!take || !takesRepo.isVisibleTo(take, memberId)) {
        continue;
      }
      items.push({
        kind: "take",
        id: take.id,
        take,
        song: take.songId ? songById.get(take.songId) : undefined,
        event: take.eventId ? eventById.get(take.eventId) : undefined,
        playableAssetId: playableByTakeId.get(take.id)?.id,
        ownerName: ownerName(take.ownerMemberId),
      });
    } else if (row.targetType === "song") {
      const song = songById.get(row.targetId);
      // Archived: the pin stays in the table but drops off the page, so
      // unarchiving brings it straight back. A pinned TAKE of an archived song
      // is unaffected above — the recording is still there to play.
      if (song && song.archivedAt === null) {
        items.push({
          kind: "song",
          id: song.id,
          song,
          takeCount: songTakeCount.get(song.id) ?? 0,
        });
      }
    } else {
      const event = eventById.get(row.targetId);
      if (event && event.archivedAt === null) {
        items.push({
          kind: "event",
          id: event.id,
          event,
          takeCount: takeCountByPinnedEvent.get(event.id) ?? 0,
          ownerName: ownerName(event.ownerMemberId),
        });
      }
    }
  }
  return { items, total };
}

/** One new take in the lead event, as the play-all queue needs it. */
export interface NewTake {
  take: takesRepo.Take;
  song: songsRepo.Song | undefined;
  /** Undefined until a master is ready; such a take is counted but not queued. */
  playableAssetId: string | undefined;
}

/**
 * "Na pultu": the newest band event with takes published since the member's
 * last visit. Never a personal day (see `takesRepo.publishedSinceConditions`).
 */
export interface OnTheStand {
  event: eventsRepo.Event;
  /**
   * The event's new takes, in recorded order: the play-all queue. Capped at
   * the repo's list ceiling, so never the source of the COUNT; that is
   * `takeCount`.
   */
  takes: NewTake[];
  /** How many new takes the event has, uncapped. */
  takeCount: number;
  /** Of those, how many this member has not voted on and is asked to. */
  unvotedCount: number;
}

/** The stash card. Only ever this member's own recordings. */
export interface StashCard {
  count: number;
  latest: takesRepo.Take;
  latestSong: songsRepo.Song | undefined;
}

/**
 * The lead event and its new takes, or undefined when nothing is new. Plain
 * reads rather than one clever one: pick the event, then list its new takes,
 * count them, and count the unvoted among them. Each stays under D1's
 * parameter cap however many takes arrived.
 */
async function getOnTheStand(
  db: Db,
  memberId: string,
  since: number,
): Promise<OnTheStand | undefined> {
  const eventId = await takesRepo.newestEventWithTakesPublishedSince(db, since);
  if (!eventId) {
    return undefined;
  }
  const [event, takes, takeCount, unvotedCount] = await Promise.all([
    eventsRepo.getById(db, eventId),
    takesRepo.listPublishedSinceInEvent(db, eventId, since),
    takesRepo.countPublishedSinceInEvent(db, eventId, since),
    takesRepo.countUnvotedPublishedSinceInEvent(db, memberId, eventId, since),
  ]);
  if (!event || takes.length === 0) {
    return undefined;
  }
  const [songs, playable] = await Promise.all([
    songsRepo.getByIds(db, takesRepo.songIdsOf(takes)),
    assetsRepo.listPlayableMastersByTakeIds(
      db,
      takes.map((t) => t.id),
    ),
  ]);
  const songById = new Map(songs.map((s) => [s.id, s]));
  return {
    event,
    takes: takes.map((take) => ({
      take,
      song: take.songId ? songById.get(take.songId) : undefined,
      playableAssetId: playable.get(take.id)?.id,
    })),
    takeCount,
    unvotedCount,
  };
}

async function getStashCard(db: Db, memberId: string): Promise<StashCard | undefined> {
  const [count, latest] = await Promise.all([
    takesRepo.countStash(db, memberId),
    takesRepo.latestStash(db, memberId),
  ]);
  if (count === 0 || !latest) {
    return undefined;
  }
  const latestSong = latest.songId ? await songsRepo.getById(db, latest.songId) : undefined;
  return { count, latest, latestSong };
}

/**
 * Reads the member's visit columns and decides what this load means: the
 * moment "new" is measured from, and the write that records the load. The
 * write is handed back rather than awaited here, so it runs alongside the
 * page's reads instead of in front of them.
 */
async function readVisit(
  db: Db,
  memberId: string,
  now: number,
): Promise<{ since: number; record: () => Promise<void> }> {
  const member = await membersRepo.getById(db, memberId);
  const decision = decideHomeVisit(
    {
      lastSeenAt: member?.homeLastSeenAt ?? null,
      lastVisitAt: member?.homeLastVisitAt ?? null,
      memberCreatedAt: member?.createdAt ?? now,
    },
    now,
  );
  const record = async () => {
    if (!member) {
      return;
    }
    // Every load, so a visit lasts as long as home keeps being opened. A lost
    // race (another tab recorded a load in between) leaves the columns as that
    // tab wrote them; this load still measures from what it read, which is the
    // same baseline.
    //
    // A failure is logged and swallowed. Remembering the visit is bookkeeping:
    // the page already knows its baseline, and home must not 500 because a
    // write did not land. The cost is that the next load sees the old columns
    // and may count a visit that was not recorded.
    try {
      await membersRepo.recordHomeLoad(db, memberId, {
        previousLastSeenAt: member.homeLastSeenAt,
        lastSeenAt: decision.lastSeenAt,
        lastVisitAt: decision.lastVisitAt,
      });
    } catch (err) {
      console.error("failed to record the home visit", memberId, err);
    }
  };
  return { since: decision.since, record };
}

export interface HomeData {
  /** What is new since the last visit. Undefined: the section is not drawn. */
  onTheStand: OnTheStand | undefined;
  /** Newest-pinned first, capped at `PINNED_LIMIT`. */
  pinned: PinnedItem[];
  /** How many things the member has pinned in all — may exceed `pinned.length`. */
  pinnedTotal: number;
  /** The ledger — events only, newest first, each with its take count. */
  recentEvents: EventListItem[];
  /** This member's stash, when it holds anything. */
  stash: StashCard | undefined;
}

export async function getHomeData(
  db: Db,
  memberId: string,
  now: number = Date.now(),
): Promise<HomeData> {
  const visit = await readVisit(db, memberId, now);
  const [onTheStand, pinned, recentEvents, stash] = await Promise.all([
    getOnTheStand(db, memberId, visit.since),
    getPinned(db, memberId),
    eventsRepo.listRecentWithTakeCounts(db, { limit: RECENT_EVENTS_LIMIT }),
    getStashCard(db, memberId),
    visit.record(),
  ]);
  return {
    onTheStand,
    pinned: pinned.items,
    pinnedTotal: pinned.total,
    recentEvents: await withOwnerNames(db, recentEvents.rows),
    stash,
  };
}
