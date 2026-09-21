// Filing a recording in its member's stash — the one rule behind
// `POST /stash/takes`. It lives in core, like `resolveSlotForUpload`, so the
// route stays a parser and a status-code map.
//
// The browser calls this from a sync loop that may run the same recording many
// times: after a dropped response, from two tabs, after a phone woke up in a
// tunnel. So it is idempotent on the client's own id, and every path that can
// race (the personal event, the take) re-reads instead of failing.
import { assetsRepo, type Db, eventsRepo, songsRepo, takesRepo } from "@bandplate/db";
import { zonedParts } from "../notifications/schedule.js";

/** Keeps the browser's local ids out of the bridge's `client_ref` namespace. */
export const STASH_CLIENT_REF_PREFIX = "stash:";

export interface CreateStashTakeInput {
  /** The recording's local id (IndexedDB key). */
  clientRef: string;
  /**
   * The song this is for, or NULL for a recording whose member has not decided
   * yet. A stash take may have no song; it gets one when it is added to the
   * band (`publishStashTake`), which is the only place the invariant "a
   * band-visible take always has a song" can be broken.
   */
  songId: string | null;
  label: string | null;
  /** Wall-clock start of the recording, epoch ms. */
  recordedAt: number;
  durationMs: number | null;
}

export type CreateStashTakeResult =
  | { kind: "ok"; take: takesRepo.Take; created: boolean; masterReady: boolean }
  | { kind: "song_not_found" }
  /** The clientRef is already somebody else's take. Never expected; never merged. */
  | { kind: "conflict" };

async function hasReadyMaster(db: Db, takeId: string): Promise<boolean> {
  return (await assetsRepo.listPlayableMastersByTakeIds(db, [takeId])).has(takeId);
}

export async function createStashTake(
  db: Db,
  now: number,
  memberId: string,
  input: CreateStashTakeInput,
): Promise<CreateStashTakeResult> {
  const clientRef = `${STASH_CLIENT_REF_PREFIX}${input.clientRef}`;

  const existing = await takesRepo.getByClientRef(db, clientRef);
  if (existing) {
    if (existing.ownerMemberId !== memberId) {
      return { kind: "conflict" };
    }
    return {
      kind: "ok",
      take: existing,
      created: false,
      masterReady: await hasReadyMaster(db, existing.id),
    };
  }

  // A named song must exist; no song named is its own, allowed answer.
  const song = input.songId ? await songsRepo.getById(db, input.songId) : null;
  if (input.songId && !song) {
    return { kind: "song_not_found" };
  }

  const event = await eventsRepo.findOrCreatePersonal(db, {
    memberId,
    dayKey: zonedParts(input.recordedAt).date,
    heldAt: input.recordedAt,
    now,
  });

  try {
    const take = await takesRepo.create(db, {
      songId: song?.id ?? null,
      eventId: event.id,
      label: input.label,
      recordedAt: input.recordedAt,
      durationMs: input.durationMs,
      clientRef,
      visibility: "private",
      ownerMemberId: memberId,
      createdAt: now,
      updatedAt: now,
    });
    return { kind: "ok", take, created: true, masterReady: false };
  } catch (err) {
    const raced = await takesRepo.getByClientRef(db, clientRef);
    if (raced && raced.ownerMemberId === memberId) {
      return {
        kind: "ok",
        take: raced,
        created: false,
        masterReady: await hasReadyMaster(db, raced.id),
      };
    }
    throw err;
  }
}
