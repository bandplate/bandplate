// Shared batch-fetch helper for every take listing that is NOT scoped to a
// single song or a single event — `/`'s favorites and "needs your vote"
// sections, `/search`'s results, and `/me`'s vote history. Each of those
// needs a take's song AND event (TakeRow's "full" context — see
// TakeRow.astro's header comment), unlike `/songs/[slug]` (song implied) or
// `/events/[id]` (event implied), which each only need the other half.
//
// Same batching shape as `server/pages/songs.ts#getSongPageData` and
// `server/pages/events.ts#getEventPageData`: one query per kind of data
// (songs, events, instruments), never one round trip per take. And since
// every one of those is keyed only by the takes, they are planned as ONE read
// (`buildFullContextRead`) that a loader can put in the same batch as
// whatever else it is waiting on.
import {
  assetsRepo,
  combineReads,
  type Db,
  eventsRepo,
  type instrumentsRepo,
  mapRead,
  membersRepo,
  type Read,
  readValue,
  runRead,
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
  return runRead(db, buildFullContextRead(db, takes, memberId));
}

/** `attachFullContext`, planned: every lookup it makes, for the caller's one batch. */
export function buildFullContextRead(
  db: Db,
  takes: takesRepo.Take[],
  memberId?: string,
): Read<TakeWithFullContext[]> {
  if (takes.length === 0) {
    return readValue([]);
  }

  const takeIds = takes.map((t) => t.id);
  const songIds = takesRepo.songIdsOf(takes);
  const eventIds = [...new Set(takes.map((t) => t.eventId))];
  const ownerIds = [
    ...new Set(takes.map((t) => t.ownerMemberId).filter((id): id is string => id !== null)),
  ];

  const lookups = combineReads({
    instrumentsByTake: takesRepo.buildListInstrumentsForTakesRead(db, takeIds),
    songs: songsRepo.buildGetByIdsRead(db, songIds),
    events: eventsRepo.buildGetByIdsRead(db, eventIds),
    playableByTakeId: assetsRepo.buildListPlayableMastersByTakeIdsRead(db, takeIds),
    myVoteByTakeId: memberId
      ? votesRepo.buildListByMemberForTakesRead(db, memberId, takeIds)
      : readValue(new Map<string, boolean>()),
    owners: membersRepo.buildGetByIdsRead(db, ownerIds),
  });
  return mapRead(
    lookups,
    ({ instrumentsByTake, songs, events, playableByTakeId, myVoteByTakeId, owners }) => {
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
    },
  );
}
