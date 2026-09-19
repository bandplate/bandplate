// `/admin/takes/[id]/keeper` and `/admin/takes/[id]/reject` page logic —
// same shape as `admin-instruments.ts`. `state='keeper'`/`state='rejected'`
// are explicit admin actions, never an automatic threshold on vote counts
// (brief §1: "That separation is deliberate — it's what makes 'upload a
// lossless master for this one' a decision rather than a side effect of
// the fourth vote").
import type { Db } from "@bandplate/db";
import { songsRepo, takesRepo } from "@bandplate/db";

/**
 * A member's personal recording is theirs, not the band's to judge: keeper
 * and rejected are band decisions about band takes. One that was added to its
 * song still carries its owner, and is refused the same way.
 */
function isPersonal(take: takesRepo.Take): boolean {
  return take.ownerMemberId !== null;
}

export interface TakeForAdminAction {
  take: takesRepo.Take;
  song: songsRepo.Song | undefined;
}

export async function getTakeForAdminAction(
  db: Db,
  id: string,
): Promise<TakeForAdminAction | undefined> {
  const take = await takesRepo.getById(db, id);
  if (!take || isPersonal(take)) {
    return undefined;
  }
  const song = await songsRepo.getById(db, take.songId);
  return { take, song };
}

export type SetTakeStateResult = { kind: "ok" } | { kind: "not_found" };

export async function setTakeState(
  db: Db,
  id: string,
  state: takesRepo.TakeState,
  now: number,
): Promise<SetTakeStateResult> {
  const existing = await takesRepo.getById(db, id);
  if (!existing || isPersonal(existing)) {
    return { kind: "not_found" };
  }
  await takesRepo.setState(db, id, state, now);
  return { kind: "ok" };
}
