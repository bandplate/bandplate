// `/events` and `/events/[id]` page logic. Read-only, same shape as
// `server/pages/songs.ts`.
import { type Db, assetsRepo } from "@bandlib/db";
import { eventsRepo, type instrumentsRepo, songsRepo, takesRepo } from "@bandlib/db";

export type EventListItem = eventsRepo.EventWithTakeCount;

const VALID_KINDS: readonly eventsRepo.EventKind[] = ["rehearsal", "concert", "session"];

/** Parses `/events`'s `?kind=` query param (repeatable, like `?kind=concert&kind=session`). */
export function parseEventsListKindFilter(searchParams: URLSearchParams): eventsRepo.EventKind[] {
  const raw = searchParams.getAll("kind");
  const valid = raw.filter((k): k is eventsRepo.EventKind =>
    (VALID_KINDS as readonly string[]).includes(k),
  );
  return [...new Set(valid)];
}

export async function listEventsForArchive(
  db: Db,
  kind: eventsRepo.EventKind[],
): Promise<EventListItem[]> {
  return eventsRepo.listRecentWithTakeCounts(db, { kind });
}

export interface TakeWithContext extends takesRepo.Take {
  instruments: instrumentsRepo.Instrument[];
  song: songsRepo.Song | undefined;
  /** See `assetsRepo.listPlayableMastersByTakeIds` — undefined means "no play control", not "disabled". */
  playableAssetId: string | undefined;
}

export interface EventDetail {
  event: eventsRepo.Event;
  takes: TakeWithContext[];
}

/**
 * Everything `/events/[id]` renders: the event plus every take recorded
 * that day IN RECORDED ORDER (not newest-first — this is the one place
 * that ordering differs, since it's reconstructing what happened during a
 * single session), each with its song and instruments batch-fetched.
 */
export async function getEventDetail(db: Db, id: string): Promise<EventDetail | undefined> {
  const event = await eventsRepo.getById(db, id);
  if (!event) {
    return undefined;
  }

  const takes = await takesRepo.listByEvent(db, event.id, { order: "asc" });
  const takeIds = takes.map((t) => t.id);
  const songIds = [...new Set(takes.map((t) => t.songId))];
  const [instrumentsByTake, songs, playableByTakeId] = await Promise.all([
    takesRepo.listInstrumentsForTakes(db, takeIds),
    songsRepo.getByIds(db, songIds),
    assetsRepo.listPlayableMastersByTakeIds(db, takeIds),
  ]);
  const songById = new Map(songs.map((s) => [s.id, s]));

  return {
    event,
    takes: takes.map((take) => ({
      ...take,
      instruments: instrumentsByTake.get(take.id) ?? [],
      song: songById.get(take.songId),
      playableAssetId: playableByTakeId.get(take.id)?.id,
    })),
  };
}
