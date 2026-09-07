// `/` — the home page. Three sections, in the order the brief specifies:
// favorites (display only — the toggle is increment 5's), recent events
// with their takes, and "needs your vote" (published takes this member
// hasn't voted on — also display only, no vote control yet).
import { type Db, assetsRepo } from "@bandlib/db";
import { eventsRepo, favoritesRepo, type instrumentsRepo, songsRepo, takesRepo } from "@bandlib/db";
import { type TakeWithFullContext, attachFullContext } from "./take-context.js";

/** How many recent events (each with their takes) the home page shows. */
const RECENT_EVENTS_LIMIT = 3;
/** How many unvoted takes to surface before pointing at /search for the rest. */
const UNVOTED_LIMIT = 6;

export interface HomeFavorites {
  songs: songsRepo.Song[];
  takes: TakeWithFullContext[];
}

/** Also used by `server/pages/me.ts` — `/me` shows the same favorites list. */
export async function getFavorites(db: Db, memberId: string): Promise<HomeFavorites> {
  const rows = await favoritesRepo.listByMember(db, memberId);
  // The brief scopes home's favorites section to "pinned songs and takes" —
  // a favorited EVENT (the schema allows one, and the seed has one) has no
  // home-page representation yet; it isn't part of this task's three
  // sections, so it's simply not surfaced here rather than shoehorned in.
  const songIds = rows.filter((r) => r.targetType === "song").map((r) => r.targetId);
  const takeIds = rows.filter((r) => r.targetType === "take").map((r) => r.targetId);

  const [songs, takes] = await Promise.all([
    songsRepo.getByIds(db, songIds),
    takesRepo.getByIds(db, takeIds),
  ]);
  // Preserve favorites.listByMember's newest-first order rather than
  // whatever order the batch `getByIds` lookups happened to return in.
  const songById = new Map(songs.map((s) => [s.id, s]));
  const takeById = new Map(takes.map((t) => [t.id, t]));
  const orderedSongs = songIds.map((id) => songById.get(id)).filter((s) => s !== undefined);
  const orderedTakes = takeIds.map((id) => takeById.get(id)).filter((t) => t !== undefined);

  return {
    songs: orderedSongs,
    takes: await attachFullContext(db, orderedTakes),
  };
}

interface RecentEventTake {
  instruments: instrumentsRepo.Instrument[];
  song: songsRepo.Song | undefined;
  /** See `assetsRepo.listPlayableMastersByTakeIds` — undefined means "no play control", not "disabled". */
  playableAssetId: string | undefined;
}

export interface RecentEventWithTakes {
  event: eventsRepo.EventWithTakeCount;
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

async function getRecentEventsWithTakes(db: Db): Promise<RecentEventWithTakesRaw[]> {
  const events = await eventsRepo.listRecentWithTakeCounts(db, { limit: RECENT_EVENTS_LIMIT });
  if (events.length === 0) {
    return [];
  }

  const eventIds = events.map((e) => e.id);
  const takesByEvent = await takesRepo.listByEvents(db, eventIds, { order: "asc" });
  const allTakes = events.flatMap((e) => takesByEvent.get(e.id) ?? []);
  const takeIds = allTakes.map((t) => t.id);
  const songIds = [...new Set(allTakes.map((t) => t.songId))];

  const [instrumentsByTake, songs, playableByTakeId] = await Promise.all([
    takesRepo.listInstrumentsForTakes(db, takeIds),
    songsRepo.getByIds(db, songIds),
    assetsRepo.listPlayableMastersByTakeIds(db, takeIds),
  ]);
  const songById = new Map(songs.map((s) => [s.id, s]));

  return events.map((event) => ({
    event,
    takes: (takesByEvent.get(event.id) ?? []).map((take) => ({
      ...take,
      instruments: instrumentsByTake.get(take.id) ?? [],
      song: songById.get(take.songId),
      playableAssetId: playableByTakeId.get(take.id)?.id,
    })),
  }));
}

async function getUnvotedTakes(db: Db, memberId: string): Promise<TakeWithFullContext[]> {
  const takes = await takesRepo.listUnvotedByMember(db, memberId, { limit: UNVOTED_LIMIT });
  return attachFullContext(db, takes);
}

export interface HomeData {
  favorites: HomeFavorites;
  recentEvents: RecentEventWithTakes[];
  unvotedTakes: Array<TakeWithFullContext & { favorited: boolean }>;
}

export async function getHomeData(db: Db, memberId: string): Promise<HomeData> {
  const [favorites, favoriteTakeIds, recentEvents, unvotedTakes] = await Promise.all([
    getFavorites(db, memberId),
    // A separate, lighter query rather than deriving this from `favorites`
    // above — keeps it concurrent with `recentEvents`/`unvotedTakes` rather
    // than serialized behind `getFavorites`' own song+take lookups.
    favoritesRepo.listTargetIdsByMember(db, memberId, "take"),
    getRecentEventsWithTakes(db),
    getUnvotedTakes(db, memberId),
  ]);

  return {
    favorites,
    recentEvents: recentEvents.map((entry) => ({
      ...entry,
      takes: entry.takes.map((take) => ({ ...take, favorited: favoriteTakeIds.has(take.id) })),
    })),
    unvotedTakes: unvotedTakes.map((take) => ({
      ...take,
      favorited: favoriteTakeIds.has(take.id),
    })),
  };
}
