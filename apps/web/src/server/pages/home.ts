// Home's data. Two questions only: what has this member PINNED, and what
// has the band recorded lately.
//
// It used to answer a third — "which published takes haven't you voted on" —
// and render them as a queue. That is gone: nothing on the page everyone opens
// should nag, and a take usually arrives as a shared link anyway. The unvoted
// count moved to `/me`, where it is something you go looking for. With it went
// `getUnvotedTakes`, `UNVOTED_LIMIT` and this module's use of
// `takesRepo.listUnvotedByMember` (the repo function stays — `/me` counts with
// it now).
//
// Recent events no longer carry their takes either. Home lists EVENTS, and
// opening one is how you reach its takes; fetching every take of the three
// newest events to render a list nobody was reading cost four extra queries
// per page load.
import { type Db, assetsRepo } from "@bandplate/db";
import {
  eventsRepo,
  favoritesRepo,
  type instrumentsRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
import { eventKindLabel } from "../format.js";
import { type TakeWithFullContext, attachFullContext } from "./take-context.js";

/** How many events the ledger lists before pointing at `/events` for the rest. */
const RECENT_EVENTS_LIMIT = 5;

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
  const orderedTakes = takeIds.map((id) => takeById.get(id)).filter((t) => t !== undefined);
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
    }
  | { kind: "song"; id: string; song: songsRepo.Song; takeCount: number }
  | { kind: "event"; id: string; event: eventsRepo.Event; takeCount: number };

/**
 * The one word that says what a pinned thing IS — "Take", "Song", or the
 * event's own kind. Defined next to `PinnedItem` rather than in either of the
 * two components that render it, because both the plate's caption and the
 * hero's meta line show it and they must never disagree; the last time a label
 * rule lived in two places it drifted.
 */
export function pinnedKindWord(item: PinnedItem): string {
  if (item.kind === "take") {
    return "Take";
  }
  if (item.kind === "song") {
    return "Song";
  }
  return eventKindLabel(item.event.kind);
}

/**
 * The member's favorites as one newest-first list. `favoritesRepo.listByMember`
 * already orders by `createdAt DESC` across all three target types, so the
 * merge is just a matter of keeping that order rather than re-sorting anything.
 */
async function getPinned(db: Db, memberId: string): Promise<PinnedItem[]> {
  const rows = await favoritesRepo.listByMember(db, memberId);
  if (rows.length === 0) {
    return [];
  }

  const songIds = rows.filter((r) => r.targetType === "song").map((r) => r.targetId);
  const takeIds = rows.filter((r) => r.targetType === "take").map((r) => r.targetId);
  const eventIds = rows.filter((r) => r.targetType === "event").map((r) => r.targetId);

  const [songs, takes, events, playableByTakeId, takesByPinnedEvent] = await Promise.all([
    songsRepo.getByIds(db, songIds),
    takesRepo.getByIds(db, takeIds),
    eventsRepo.getByIds(db, eventIds),
    assetsRepo.listPlayableMastersByTakeIds(db, takeIds),
    eventIds.length > 0 ? takesRepo.listByEvents(db, eventIds) : Promise.resolve(new Map()),
  ]);

  // A pinned take names its own song and event; both may be missing if the
  // row was pinned and the target later archived, which is why every lookup
  // below is allowed to come back undefined rather than asserted.
  const takeSongIds = [...new Set(takes.map((t) => t.songId))];
  const takeEventIds = [...new Set(takes.map((t) => t.eventId).filter((id) => id !== null))];
  const [takeSongs, takeEvents, takeCountsBySong] = await Promise.all([
    songsRepo.getByIds(db, takeSongIds),
    eventsRepo.getByIds(db, takeEventIds as string[]),
    // Pinned songs are few, so one small query each beats loading the whole
    // song table with its stats join to read three numbers off it.
    Promise.all(
      songIds.map(async (id) => [id, (await takesRepo.listBySong(db, id)).length] as const),
    ),
  ]);

  const songById = new Map([...songs, ...takeSongs].map((x) => [x.id, x]));
  const eventById = new Map([...events, ...takeEvents].map((x) => [x.id, x]));
  const takeById = new Map(takes.map((t) => [t.id, t]));
  const songTakeCount = new Map(takeCountsBySong);

  const items: PinnedItem[] = [];
  for (const row of rows) {
    if (row.targetType === "take") {
      const take = takeById.get(row.targetId);
      if (!take) {
        continue;
      }
      items.push({
        kind: "take",
        id: take.id,
        take,
        song: songById.get(take.songId),
        event: take.eventId ? eventById.get(take.eventId) : undefined,
        playableAssetId: playableByTakeId.get(take.id)?.id,
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
          takeCount: (takesByPinnedEvent.get(event.id) ?? []).length,
        });
      }
    }
  }
  return items;
}

export interface HomeData {
  /** Newest-pinned first. The first entry is the page's hero. */
  pinned: PinnedItem[];
  /** The ledger — events only, newest first, each with its take count. */
  recentEvents: eventsRepo.EventWithTakeCount[];
}

export async function getHomeData(db: Db, memberId: string): Promise<HomeData> {
  const [pinned, recentEvents] = await Promise.all([
    getPinned(db, memberId),
    eventsRepo.listRecentWithTakeCounts(db, { limit: RECENT_EVENTS_LIMIT }),
  ]);
  return { pinned, recentEvents };
}
