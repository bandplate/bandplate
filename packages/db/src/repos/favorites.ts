import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { favorites } from "../schema/sqlite/index.js";

export type Favorite = typeof favorites.$inferSelect;
export type FavoriteTargetType = Favorite["targetType"];

export interface AddFavoriteInput {
  memberId: string;
  targetType: FavoriteTargetType;
  targetId: string;
  createdAt: number;
}

export async function add(db: Db, input: AddFavoriteInput): Promise<void> {
  await db
    .insert(favorites)
    .values({
      memberId: input.memberId,
      targetType: input.targetType,
      targetId: input.targetId,
      createdAt: input.createdAt,
    })
    .onConflictDoNothing();
}

export async function remove(
  db: Db,
  memberId: string,
  targetType: FavoriteTargetType,
  targetId: string,
): Promise<void> {
  await db
    .delete(favorites)
    .where(
      and(
        eq(favorites.memberId, memberId),
        eq(favorites.targetType, targetType),
        eq(favorites.targetId, targetId),
      ),
    );
}

/**
 * Every member's pin on one target, gone.
 *
 * For deletion only: a take or a song that no longer exists must not leave
 * favourite rows pointing at nothing. `targetExists` in the favorites page
 * handler deliberately does NOT filter, so a stale pin can still be cleared by
 * hand — but a row whose target was deleted outright has nothing to clear.
 */
export async function removeAllForTarget(
  db: Db,
  targetType: FavoriteTargetType,
  targetId: string,
): Promise<void> {
  await db
    .delete(favorites)
    .where(and(eq(favorites.targetType, targetType), eq(favorites.targetId, targetId)));
}

export async function listByMember(db: Db, memberId: string): Promise<Favorite[]> {
  return db
    .select()
    .from(favorites)
    .where(eq(favorites.memberId, memberId))
    .orderBy(desc(favorites.createdAt));
}

export async function isFavorited(
  db: Db,
  memberId: string,
  targetType: FavoriteTargetType,
  targetId: string,
): Promise<boolean> {
  const rows = await db
    .select({ memberId: favorites.memberId })
    .from(favorites)
    .where(
      and(
        eq(favorites.memberId, memberId),
        eq(favorites.targetType, targetType),
        eq(favorites.targetId, targetId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface ToggleFavoriteInput {
  memberId: string;
  targetType: FavoriteTargetType;
  targetId: string;
  now: number;
}

/**
 * Flips one favorite: adds it if absent, removes it if present, and reports
 * which happened — what `VoteToggle`/`FavoriteToggle`'s single "one tap"
 * control needs, so the caller (an Astro page's own POST handler, or the
 * JSON API route) doesn't have to track "was this already a favorite"
 * itself. A read-then-write, not a single atomic statement — unlike
 * `votesRepo.castVote`, there's no aggregate to keep self-healing here, and
 * `add`/`remove` are each already idempotent (`onConflictDoNothing` /
 * delete-where-absent-is-a-no-op), so a rare double-submit race just means
 * the second request reads the row the first one already wrote and toggles
 * it again — the same "last click wins" behavior every other read-then-act
 * mutation in this codebase already accepts (e.g. `admin-instruments.ts`'s
 * `setInstrumentArchived`), not the D1 batch constraint's multi-statement
 * atomicity concern.
 */
export async function toggle(db: Db, input: ToggleFavoriteInput): Promise<{ favorited: boolean }> {
  const already = await isFavorited(db, input.memberId, input.targetType, input.targetId);
  if (already) {
    await remove(db, input.memberId, input.targetType, input.targetId);
    return { favorited: false };
  }
  await add(db, {
    memberId: input.memberId,
    targetType: input.targetType,
    targetId: input.targetId,
    createdAt: input.now,
  });
  return { favorited: true };
}

/**
 * Just the target ids of one type, as a `Set` for O(1) membership checks —
 * `/takes/[id]` and `/search` (Task 6 review round 1's per-row favorite
 * marker, F4) each need "is THIS take one of this member's favorites"
 * without fetching every favorite row and its full target object the way
 * `listByMember` does for the home/`/me` favorites sections.
 */
export async function listTargetIdsByMember(
  db: Db,
  memberId: string,
  targetType: FavoriteTargetType,
): Promise<Set<string>> {
  const rows = await db
    .select({ targetId: favorites.targetId })
    .from(favorites)
    .where(and(eq(favorites.memberId, memberId), eq(favorites.targetType, targetType)));
  return new Set(rows.map((r) => r.targetId));
}
