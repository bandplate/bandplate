// `/admin/takes/[id]/keeper` and `/admin/takes/[id]/reject` page logic —
// same shape as `admin-instruments.ts`. `state='keeper'`/`state='rejected'`
// are explicit admin actions, never an automatic threshold on vote counts
// (brief §1: "That separation is deliberate — it's what makes 'upload a
// lossless master for this one' a decision rather than a side effect of
// the fourth vote").
import type { Db } from "@bandplate/db";
import { songsRepo, takesRepo } from "@bandplate/db";

export interface TakeForAdminAction {
  take: takesRepo.Take;
  song: songsRepo.Song | undefined;
}

export async function getTakeForAdminAction(
  db: Db,
  id: string,
): Promise<TakeForAdminAction | undefined> {
  const take = await takesRepo.getById(db, id);
  if (!take) {
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
  if (!existing) {
    return { kind: "not_found" };
  }
  await takesRepo.setState(db, id, state, now);
  return { kind: "ok" };
}
