// `/` — the home page. Three sections, in the order the brief specifies:
// favorites, recent events with their takes (each with a real favorite
// toggle on the event row itself — Task 8), and "needs your vote"
// (published takes this member hasn't voted on, each with a real vote and
// favorite control).
import { type Db, assetsRepo } from "@bandlib/db";
import {
  eventsRepo,
  favoritesRepo,
  type instrumentsRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandlib/db";
import { type TakeWithFullContext, attachFullContext } from "./take-context.js";

/** How many recent events (each with their takes) the home page shows. */
const RECENT_EVENTS_LIMIT = 3;
/** How many unvoted takes to surface before pointing at /search for the rest. */
const UNVOTED_LIMIT = 6;

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
  const rows = await favoritesRepo.listByMember(db, memberId);
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
  const orderedSongs = songIds.map((id) => songById.get(id)).filter((s) => s !== undefined);
  const orderedTakes = takeIds.map((id) => takeById.get(id)).filter((t) => t !== undefined);
  const orderedEvents = eventIds.map((id) => eventById.get(id)).filter((e) => e !== undefined);

  return {
    songs: orderedSongs,
    takes: await attachFullContext(db, orderedTakes, memberId),
    events: orderedEvents,
  };
}

interface RecentEventTake {
  instruments: instrumentsRepo.Instrument[];
  song: songsRepo.Song | undefined;
  /** See `assetsRepo.listPlayableMastersByTakeIds` — undefined means "no play control", not "disabled". */
  playableAssetId: string | undefined;
  /** `undefined` means this member hasn't voted on this take yet — see `TakeRow`'s own `myVote` prop. */
  myVote: boolean | undefined;
}

export interface RecentEventWithTakes {
  event: eventsRepo.EventWithTakeCount;
  /** Whether THIS member has favorited the event itself — drives the row's `FavoriteToggle`. */
  eventFavorited: boolean;
  takes: Array<
    takesRepo.Take &
      RecentEventTake & {
        /** Also one of this member's favorites — filled in by `getHomeData`
         *  from a separate, already-concurrent query (see there). Real
         *  per-row information (F4, review round 1): this list mixes
         *  favorited and non-favorited takes. */
        favorited: boolean;
      }
  >;
}

/** Pre-`favorited` shape — `getHomeData` fills that in once it has the
 *  member's favorite take ids, so this function doesn't need them. */
interface RecentEventWithTakesRaw {
  event: eventsRepo.EventWithTakeCount;
  takes: Array<takesRepo.Take & RecentEventTake>;
}

async function getRecentEventsWithTakes(
  db: Db,
  memberId: string,
): Promise<RecentEventWithTakesRaw[]> {
  const events = await eventsRepo.listRecentWithTakeCounts(db, { limit: RECENT_EVENTS_LIMIT });
  if (events.length === 0) {
    return [];
  }

  const eventIds = events.map((e) => e.id);
  const takesByEvent = await takesRepo.listByEvents(db, eventIds, { order: "asc" });
  const allTakes = events.flatMap((e) => takesByEvent.get(e.id) ?? []);
  const takeIds = allTakes.map((t) => t.id);
  const songIds = [...new Set(allTakes.map((t) => t.songId))];

  const [instrumentsByTake, songs, playableByTakeId, myVoteByTakeId] = await Promise.all([
    takesRepo.listInstrumentsForTakes(db, takeIds),
    songsRepo.getByIds(db, songIds),
    assetsRepo.listPlayableMastersByTakeIds(db, takeIds),
    votesRepo.listByMemberForTakes(db, memberId, takeIds),
  ]);
  const songById = new Map(songs.map((s) => [s.id, s]));

  return events.map((event) => ({
    event,
    takes: (takesByEvent.get(event.id) ?? []).map((take) => ({
      ...take,
      instruments: instrumentsByTake.get(take.id) ?? [],
      song: songById.get(take.songId),
      playableAssetId: playableByTakeId.get(take.id)?.id,
      myVote: myVoteByTakeId.get(take.id),
    })),
  }));
}

async function getUnvotedTakes(db: Db, memberId: string): Promise<TakeWithFullContext[]> {
  const takes = await takesRepo.listUnvotedByMember(db, memberId, { limit: UNVOTED_LIMIT });
  // Every one of these is, by definition (`listUnvotedByMember`'s own
  // query), a take this member has NOT voted on — `attachFullContext`'s
  // `myVote` would always resolve to `undefined` here anyway, but passing
  // `memberId` through keeps this call honest rather than relying on that
  // coincidence, and means a future reordering of this section (e.g. after
  // an optimistic vote, before the next full reload) can't silently show a
  // stale "pressed" state.
  return attachFullContext(db, takes, memberId);
}

export interface HomeData {
  favorites: HomeFavorites;
  /** Every one of `favorites.songs`' own ids — always favorited, but `FavoriteToggle` still needs an explicit `favorited` boolean per row. */
  favoriteSongIds: Set<string>;
  recentEvents: RecentEventWithTakes[];
  unvotedTakes: Array<TakeWithFullContext & { favorited: boolean }>;
}

export async function getHomeData(db: Db, memberId: string): Promise<HomeData> {
  const [
    favorites,
    favoriteTakeIds,
    favoriteSongIds,
    favoriteEventIds,
    recentEvents,
    unvotedTakes,
  ] = await Promise.all([
    getFavorites(db, memberId),
    // Separate, lighter queries rather than deriving these from
    // `favorites` above — keeps them concurrent with
    // `recentEvents`/`unvotedTakes` rather than serialized behind
    // `getFavorites`' own song+take lookups.
    favoritesRepo.listTargetIdsByMember(db, memberId, "take"),
    favoritesRepo.listTargetIdsByMember(db, memberId, "song"),
    favoritesRepo.listTargetIdsByMember(db, memberId, "event"),
    getRecentEventsWithTakes(db, memberId),
    getUnvotedTakes(db, memberId),
  ]);

  return {
    favorites,
    favoriteSongIds,
    recentEvents: recentEvents.map((entry) => ({
      ...entry,
      eventFavorited: favoriteEventIds.has(entry.event.id),
      takes: entry.takes.map((take) => ({ ...take, favorited: favoriteTakeIds.has(take.id) })),
    })),
    unvotedTakes: unvotedTakes.map((take) => ({
      ...take,
      favorited: favoriteTakeIds.has(take.id),
    })),
  };
}
