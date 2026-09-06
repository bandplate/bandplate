// `/` — the home page. Three sections, in the order the brief specifies:
// favorites (display only — the toggle is increment 5's), recent events
// with their takes, and "needs your vote" (published takes this member
// hasn't voted on — also display only, no vote control yet).
import type { Db } from "@bandlib/db";
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

export interface RecentEventWithTakes {
  event: eventsRepo.EventWithTakeCount;
  takes: Array<
    takesRepo.Take & { instruments: instrumentsRepo.Instrument[]; song: songsRepo.Song | undefined }
  >;
}

async function getRecentEventsWithTakes(db: Db): Promise<RecentEventWithTakes[]> {
  const events = await eventsRepo.listRecentWithTakeCounts(db, { limit: RECENT_EVENTS_LIMIT });
  if (events.length === 0) {
    return [];
  }

  const eventIds = events.map((e) => e.id);
  const takesByEvent = await takesRepo.listByEvents(db, eventIds, { order: "asc" });
  const allTakes = events.flatMap((e) => takesByEvent.get(e.id) ?? []);
  const takeIds = allTakes.map((t) => t.id);
  const songIds = [...new Set(allTakes.map((t) => t.songId))];

  const [instrumentsByTake, songs] = await Promise.all([
    takesRepo.listInstrumentsForTakes(db, takeIds),
    songsRepo.getByIds(db, songIds),
  ]);
  const songById = new Map(songs.map((s) => [s.id, s]));

  return events.map((event) => ({
    event,
    takes: (takesByEvent.get(event.id) ?? []).map((take) => ({
      ...take,
      instruments: instrumentsByTake.get(take.id) ?? [],
      song: songById.get(take.songId),
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
  unvotedTakes: TakeWithFullContext[];
}

export async function getHomeData(db: Db, memberId: string): Promise<HomeData> {
  const [favorites, recentEvents, unvotedTakes] = await Promise.all([
    getFavorites(db, memberId),
    getRecentEventsWithTakes(db),
    getUnvotedTakes(db, memberId),
  ]);
  return { favorites, recentEvents, unvotedTakes };
}
