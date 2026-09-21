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
import {
  assetsRepo,
  type Db,
  eventsRepo,
  type instrumentsRepo,
  membersRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";

export interface TakeWithFullContext extends takesRepo.Take {
  instruments: instrumentsRepo.Instrument[];
  song: songsRepo.Song | undefined;
  event: eventsRepo.Event | undefined;
  /** See `assetsRepo.listPlayableMastersByTakeIds` — undefined means "no play control", not "disabled". */
  playableAssetId: string | undefined;
  /** `undefined` means this member hasn't voted on this take yet — `TakeRow`'s own `myVote` prop, threaded through. */
  myVote: boolean | undefined;
  /** The recording member's name, for a personal recording (its event says "osobní nahrávky" and this says whose). Null for a band take. */
  ownerName: string | null;
}

/**
 * `memberId` is optional so this can still batch-fetch context for takes
 * with no signed-in member in view (there is none today — every caller
 * has a principal — but this keeps the function honest rather than forcing
 * a fake id). Omitting it just means every row's `myVote` is `undefined`.
 */
export async function attachFullContext(
  db: Db,
  takes: takesRepo.Take[],
  memberId?: string,
): Promise<TakeWithFullContext[]> {
  if (takes.length === 0) {
    return [];
  }

  const takeIds = takes.map((t) => t.id);
  const songIds = takesRepo.songIdsOf(takes);
  const eventIds = [...new Set(takes.map((t) => t.eventId))];
  const ownerIds = [
    ...new Set(takes.map((t) => t.ownerMemberId).filter((id): id is string => id !== null)),
  ];

  const [instrumentsByTake, songs, events, playableByTakeId, myVoteByTakeId, owners] =
    await Promise.all([
      takesRepo.listInstrumentsForTakes(db, takeIds),
      songsRepo.getByIds(db, songIds),
      eventsRepo.getByIds(db, eventIds),
      assetsRepo.listPlayableMastersByTakeIds(db, takeIds),
      memberId ? votesRepo.listByMemberForTakes(db, memberId, takeIds) : Promise.resolve(new Map()),
      membersRepo.getByIds(db, ownerIds),
    ]);
  const songById = new Map(songs.map((s) => [s.id, s]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const ownerNameById = new Map(owners.map((m) => [m.id, m.displayName]));

  return takes.map((take) => ({
    ...take,
    instruments: instrumentsByTake.get(take.id) ?? [],
    song: take.songId ? songById.get(take.songId) : undefined,
    event: eventById.get(take.eventId),
    playableAssetId: playableByTakeId.get(take.id)?.id,
    myVote: myVoteByTakeId.get(take.id),
    ownerName: take.ownerMemberId ? (ownerNameById.get(take.ownerMemberId) ?? null) : null,
  }));
}
