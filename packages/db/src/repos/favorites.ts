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

export async function listByMember(db: Db, memberId: string): Promise<Favorite[]> {
  return db
    .select()
    .from(favorites)
    .where(eq(favorites.memberId, memberId))
    .orderBy(desc(favorites.createdAt));
}
