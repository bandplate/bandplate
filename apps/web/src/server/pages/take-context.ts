// Shared batch-fetch helper for every take listing that is NOT scoped to a
// single song or a single event — `/`'s favorites and "needs your vote"
// sections, `/search`'s results, and `/me`'s vote history. Each of those
// needs a take's song AND event (TakeRow's "full" context — see
// TakeRow.astro's header comment), unlike `/songs/[slug]` (song implied) or
// `/events/[id]` (event implied), which each only need the other half.
//
// Same batching shape as `server/pages/songs.ts#getSongDetail` and
// `server/pages/events.ts#getEventDetail`: one query per kind of data
// (songs, events, instruments), never one round trip per take.
import type { Db } from "@bandlib/db";
import { eventsRepo, type instrumentsRepo, songsRepo, takesRepo } from "@bandlib/db";

export interface TakeWithFullContext extends takesRepo.Take {
  instruments: instrumentsRepo.Instrument[];
  song: songsRepo.Song | undefined;
  event: eventsRepo.Event | undefined;
}

export async function attachFullContext(
  db: Db,
  takes: takesRepo.Take[],
): Promise<TakeWithFullContext[]> {
  if (takes.length === 0) {
    return [];
  }

  const takeIds = takes.map((t) => t.id);
  const songIds = [...new Set(takes.map((t) => t.songId))];
  const eventIds = [...new Set(takes.map((t) => t.eventId))];

  const [instrumentsByTake, songs, events] = await Promise.all([
    takesRepo.listInstrumentsForTakes(db, takeIds),
    songsRepo.getByIds(db, songIds),
    eventsRepo.getByIds(db, eventIds),
  ]);
  const songById = new Map(songs.map((s) => [s.id, s]));
  const eventById = new Map(events.map((e) => [e.id, e]));

  return takes.map((take) => ({
    ...take,
    instruments: instrumentsByTake.get(take.id) ?? [],
    song: songById.get(take.songId),
    event: eventById.get(take.eventId),
  }));
}
