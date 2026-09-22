import { describeError, logError } from "@bandplate/core";
import {
  assetsRepo,
  combineReads,
  type Db,
  eventsRepo,
  favoritesRepo,
  mapRead,
  membersRepo,
  type Read,
  readValue,
  runReads,
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
import { type EventListItem, withOwnerNamesRead } from "./events.js";
import { decideHomeVisit } from "./home-visit.js";
import { attachFullContext, type TakeWithFullContext } from "./take-context.js";

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
 * What a page of pins has to look up about the pinned things themselves. Every
 * one of these is keyed by the favourite rows alone.
 */
interface PinnedLookups {
  songs: songsRepo.Song[];
  takes: takesRepo.Take[];
  events: eventsRepo.Event[];
  playableByTakeId: Map<string, assetsRepo.Asset>;
  /**
   * A COUNT per pinned event, not its takes: the card shows a number, and
   * this used to fetch every take row of every pinned event to call
   * `.length` on the result.
   */
  takeCountByPinnedEvent: Map<string, number>;
  /**
   * ONE grouped count for every pinned song. This was a `Promise.all` over
   * `listBySong` — a query per pin, each pulling every take ROW of that song
   * across the wire so that `.length` could be read off it.
   */
  songTakeCount: Map<string, number>;
}

/** And what the pinned TAKES and EVENTS, once read, name in turn. */
interface PinnedNames {
  takeSongs: songsRepo.Song[];
  takeEvents: eventsRepo.Event[];
  owners: membersRepo.Member[];
}

function pinnedIds(rows: favoritesRepo.Favorite[]) {
  return {
    songIds: rows.filter((r) => r.targetType === "song").map((r) => r.targetId),
    takeIds: rows.filter((r) => r.targetType === "take").map((r) => r.targetId),
    eventIds: rows.filter((r) => r.targetType === "event").map((r) => r.targetId),
  };
}

function pinnedLookupsRead(db: Db, rows: favoritesRepo.Favorite[]): Read<PinnedLookups> {
  const { songIds, takeIds, eventIds } = pinnedIds(rows);
  return combineReads({
    songs: songsRepo.buildGetByIdsRead(db, songIds),
    takes: takesRepo.buildGetByIdsRead(db, takeIds),
    events: eventsRepo.buildGetByIdsRead(db, eventIds),
    playableByTakeId: assetsRepo.buildListPlayableMastersByTakeIdsRead(db, takeIds),
    takeCountByPinnedEvent: takesRepo.buildCountByEventsRead(db, eventIds),
    songTakeCount: takesRepo.buildCountBySongsRead(db, songIds),
  });
}

function pinnedNamesRead(db: Db, { takes, events }: PinnedLookups): Read<PinnedNames> {
  // A pinned take names its own song and event; both may be missing if the
  // row was pinned and the target later archived, which is why every lookup
  // below is allowed to come back undefined rather than asserted.
  const takeEventIds = [...new Set(takes.map((t) => t.eventId).filter((id) => id !== null))];
  // Whose each personal take and personal event is: one read for all of them.
  const ownerIds = [
    ...new Set(
      [...takes, ...events].map((x) => x.ownerMemberId).filter((id): id is string => Boolean(id)),
    ),
  ];
  return combineReads({
    takeSongs: songsRepo.buildGetByIdsRead(db, takesRepo.songIdsOf(takes)),
    takeEvents: eventsRepo.buildGetByIdsRead(db, takeEventIds),
    owners: membersRepo.buildGetByIdsRead(db, ownerIds),
  });
}

/**
 * The member's favorites as one newest-first list. `favoritesRepo.listByMember`
 * already orders by `createdAt DESC` across all three target types, so the
 * merge is just a matter of keeping that order rather than re-sorting anything.
 */
function assemblePinned(
  memberId: string,
  rows: favoritesRepo.Favorite[],
  lookups: PinnedLookups,
  names: PinnedNames,
): PinnedItem[] {
  const { songs, takes, events, playableByTakeId, takeCountByPinnedEvent, songTakeCount } = lookups;
  const { takeSongs, takeEvents, owners } = names;
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
  return items;
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

interface StandFound {
  event: eventsRepo.Event | undefined;
  takes: takesRepo.Take[];
  takeCount: number;
  unvotedCount: number;
}

/**
 * The lead event and its new takes. Plain reads rather than one clever one:
 * pick the event, list its new takes, count them, and count the unvoted among
 * them. Each stays under D1's parameter cap however many takes arrived.
 *
 * All four name the event by the query that picks it rather than by its id,
 * so they go out together instead of waiting for the id to come back. They
 * share a batch, which is one transaction, so all four agree on which event
 * that is.
 */
function onTheStandRead(db: Db, memberId: string, since: number): Read<StandFound> {
  const newest = takesRepo.buildNewestEventWithTakesPublishedSinceQuery(db, since);
  return combineReads({
    event: eventsRepo.buildGetByIdRead(db, newest),
    takes: takesRepo.buildListPublishedSinceInEventRead(db, newest, since),
    takeCount: takesRepo.buildCountPublishedSinceInEventRead(db, newest, since),
    unvotedCount: takesRepo.buildCountUnvotedPublishedSinceInEventRead(db, memberId, newest, since),
  });
}

/** The new takes' songs and players, or undefined when nothing is new. */
function onTheStandSongsRead(db: Db, found: StandFound): Read<OnTheStand | undefined> {
  const { event, takes, takeCount, unvotedCount } = found;
  if (!event || takes.length === 0) {
    return readValue(undefined);
  }
  const read = combineReads({
    songs: songsRepo.buildGetByIdsRead(db, takesRepo.songIdsOf(takes)),
    playable: assetsRepo.buildListPlayableMastersByTakeIdsRead(
      db,
      takes.map((t) => t.id),
    ),
  });
  return mapRead(read, ({ songs, playable }) => {
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
  });
}

function stashCard(
  count: number,
  latest: takesRepo.Take | undefined,
  latestSong: songsRepo.Song | undefined,
): StashCard | undefined {
  if (count === 0 || !latest) {
    return undefined;
  }
  return { count, latest, latestSong };
}

/**
 * Decides what this load means from the member's visit columns: the moment
 * "new" is measured from, and the write that records the load. The write is
 * handed back rather than awaited here, so it runs alongside the page's reads
 * instead of in front of them.
 */
function decideVisit(
  db: Db,
  memberId: string,
  member: membersRepo.Member | undefined,
  now: number,
): { since: number; record: () => Promise<void> } {
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
      const { message, stack } = describeError(err);
      logError({
        kind: "home-visit-write",
        message: `failed to record the home visit for member ${memberId}: ${message}`,
        stack,
      });
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

/**
 * Home in three round trips, each a single batch, whatever the member has
 * pinned or missed. Every read goes out as early as what it is keyed by
 * allows (on D1 each round trip is a network hop, and the page waits on the
 * hops in sequence, not on the rows):
 *
 *   1. what needs only the member and the clock: their visit columns, their
 *      pins, the ledger, their stash
 *   2. what those answered: the new takes since the visit, the pinned things
 *      themselves, the ledger's owners, the stash's song. The visit write goes
 *      out alongside, on its own so its failure stays its own
 *   3. what the pinned takes and the new takes name in turn
 */
export async function getHomeData(
  db: Db,
  memberId: string,
  now: number = Date.now(),
): Promise<HomeData> {
  const first = await runReads(db, {
    member: membersRepo.buildGetByIdRead(db, memberId),
    favorites: favoritesRepo.buildListByMemberRead(db, memberId, {
      page: { limit: PINNED_LIMIT, offset: 0 },
    }),
    recentEvents: eventsRepo.buildListRecentWithTakeCountsRead(db, { limit: RECENT_EVENTS_LIMIT }),
    stashCount: takesRepo.buildCountStashRead(db, memberId),
    stashLatest: takesRepo.buildLatestStashRead(db, memberId),
  });
  const visit = decideVisit(db, memberId, first.member, now);
  const pins = first.favorites.rows;
  const latestSongId = first.stashLatest?.songId;

  const [second] = await Promise.all([
    runReads(db, {
      stand: onTheStandRead(db, memberId, visit.since),
      pinned: pins.length > 0 ? pinnedLookupsRead(db, pins) : readValue(undefined),
      recentEvents: withOwnerNamesRead(db, first.recentEvents.rows),
      latestSong: latestSongId
        ? mapRead(songsRepo.buildGetByIdsRead(db, [latestSongId]), (songs) => songs[0])
        : readValue(undefined),
    }),
    visit.record(),
  ]);

  const third = await runReads(db, {
    onTheStand: onTheStandSongsRead(db, second.stand),
    pinnedNames: second.pinned ? pinnedNamesRead(db, second.pinned) : readValue(undefined),
  });

  return {
    onTheStand: third.onTheStand,
    pinned:
      second.pinned && third.pinnedNames
        ? assemblePinned(memberId, pins, second.pinned, third.pinnedNames)
        : [],
    pinnedTotal: first.favorites.total,
    recentEvents: second.recentEvents,
    stash: stashCard(first.stashCount, first.stashLatest, second.latestSong),
  };
}
