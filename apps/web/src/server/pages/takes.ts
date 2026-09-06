// `/takes/[id]` — take detail. Read-only: the song, the event, duration,
// label, instruments, state, the current vote tally (already-stored
// aggregates on the take row itself — no separate query), and the take's
// assets (master, stems by instrument, whether a lossless master exists).
// No playback — increment 4 adds the player; see the page for where the
// layout leaves room for it.
import type { Db } from "@bandlib/db";
import { assetsRepo, eventsRepo, type instrumentsRepo, songsRepo, takesRepo } from "@bandlib/db";

export interface TakeDetail {
  take: takesRepo.Take;
  song: songsRepo.Song | undefined;
  event: eventsRepo.Event | undefined;
  instruments: instrumentsRepo.Instrument[];
  assets: assetsRepo.Asset[];
  hasLossless: boolean;
}

export async function getTakeDetail(db: Db, id: string): Promise<TakeDetail | undefined> {
  const take = await takesRepo.getById(db, id);
  if (!take) {
    return undefined;
  }

  const [song, event, instrumentsByTake, assets, hasLossless] = await Promise.all([
    songsRepo.getById(db, take.songId),
    eventsRepo.getById(db, take.eventId),
    takesRepo.listInstrumentsForTakes(db, [take.id]),
    assetsRepo.listByTake(db, take.id),
    assetsRepo.takeHasLossless(db, take.id),
  ]);

  return {
    take,
    song,
    event,
    instruments: instrumentsByTake.get(take.id) ?? [],
    assets,
    hasLossless,
  };
}
