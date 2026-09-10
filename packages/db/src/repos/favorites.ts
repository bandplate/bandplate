import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { favorites } from "../schema/sqlite/index.js";
import { DEFAULT_PAGE_SIZE, type PageArgs, type Paged } from "./pagination.js";

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

/**
 * One member's pins, newest first.
 *
 * `(targetType, targetId)` completes the ordering — with `memberId` fixed
 * they are the rest of the primary key, so no two rows can tie on all three.
 * Pins made in one burst share a `createdAt` far more often than takes share
 * a `recordedAt`, which makes this the listing where a missing tie-break
 * would have surfaced first.
 */
export interface ListByMemberOptions {
  /** Which page to return. Omitted means the FIRST page — never all of them. */
  page?: PageArgs;
}

export async function listByMember(
  db: Db,
  memberId: string,
  options: ListByMemberOptions = {},
): Promise<Paged<Favorite>> {
  const limit = options.page?.limit ?? DEFAULT_PAGE_SIZE;
  const offset = options.page?.offset ?? 0;
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(favorites)
      .where(eq(favorites.memberId, memberId))
      .orderBy(desc(favorites.createdAt), desc(favorites.targetType), desc(favorites.targetId))
      .limit(limit)
      .offset(offset),
    countByMember(db, memberId),
  ]);
  return { rows, total };
}

/** How many things one member has pinned — the count, without the rows. */
export async function countByMember(db: Db, memberId: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(favorites)
    .where(eq(favorites.memberId, memberId));
  return rows[0]?.value ?? 0;
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
