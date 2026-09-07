// `/takes/[id]` — take detail. Read-only: the song, the event, duration,
// label, instruments, state, the current vote tally (already-stored
// aggregates on the take row itself — no separate query), and the take's
// assets (master, stems by instrument, whether a lossless master exists).
// No playback — increment 4 adds the player; see the page for where the
// layout leaves room for it.
//
// `favorited` (Task 6 review round 1, F4): whether the requesting member
// has favorited THIS take — real per-page information (a single take either
// is or isn't one of their favorites), unlike the decorative heading star
// this same review round removed. See `TakeRow`'s own `favorited` prop for
// the rest of this marker's use.
import type { Db } from "@bandplate/db";
import {
  assetsRepo,
  eventsRepo,
  favoritesRepo,
  type instrumentsRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";

export interface TakeDetail {
  take: takesRepo.Take;
  song: songsRepo.Song | undefined;
  event: eventsRepo.Event | undefined;
  instruments: instrumentsRepo.Instrument[];
  assets: assetsRepo.Asset[];
  hasLossless: boolean;
  favorited: boolean;
  /** `undefined` means this member hasn't voted on this take yet — see `TakeRow`'s own `myVote` prop. */
  myVote: boolean | undefined;
}

export async function getTakeDetail(
  db: Db,
  id: string,
  memberId: string,
): Promise<TakeDetail | undefined> {
  const take = await takesRepo.getById(db, id);
  if (!take) {
    return undefined;
  }

  const [song, event, instrumentsByTake, assets, hasLossless, favoriteTakeIds, myVoteByTakeId] =
    await Promise.all([
      songsRepo.getById(db, take.songId),
      eventsRepo.getById(db, take.eventId),
      takesRepo.listInstrumentsForTakes(db, [take.id]),
      assetsRepo.listByTake(db, take.id),
      assetsRepo.takeHasLossless(db, take.id),
      favoritesRepo.listTargetIdsByMember(db, memberId, "take"),
      votesRepo.listByMemberForTakes(db, memberId, [take.id]),
    ]);

  return {
    take,
    song,
    event,
    instruments: instrumentsByTake.get(take.id) ?? [],
    assets,
    hasLossless,
    favorited: favoriteTakeIds.has(take.id),
    myVote: myVoteByTakeId.get(take.id),
  };
}
