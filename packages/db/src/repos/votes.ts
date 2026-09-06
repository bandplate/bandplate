import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { takes, votes } from "../schema/sqlite/index.js";

export type Vote = typeof votes.$inferSelect;

export interface CastVoteInput {
  takeId: string;
  memberId: string;
  keeper: boolean;
  comment?: string | null;
  now: number;
}

/**
 * Insert-or-update a vote, then recompute the take's vote aggregates from
 * the votes table. This is the reference implementation of the D1 batch
 * constraint: ONE `db.batch([...])` call, a fixed statement list computed
 * up front — never an interactive transaction, never an increment. The
 * aggregates are recomputed via correlated subqueries so they are
 * self-healing, and NEVER read-then-written.
 *
 * SUM/COUNT over zero rows yields NULL, not 0 — ratingScore is NOT NULL, so
 * the zero-vote case is handled with COALESCE.
 */
export async function castVote(db: Db, input: CastVoteInput): Promise<void> {
  const { takeId, memberId, keeper, now } = input;
  const comment = input.comment ?? null;

  await db.batch([
    db
      .insert(votes)
      .values({ takeId, memberId, keeper, comment, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [votes.takeId, votes.memberId],
        set: { keeper, comment, updatedAt: now },
      }),
    db
      .update(takes)
      .set({
        keeperVotes: sql`(SELECT COUNT(*) FROM votes WHERE take_id = ${takeId} AND keeper = 1)`,
        totalVotes: sql`(SELECT COUNT(*) FROM votes WHERE take_id = ${takeId})`,
        ratingScore: sql`(SELECT COALESCE(CAST(SUM(keeper) AS REAL) / COUNT(*), 0) FROM votes WHERE take_id = ${takeId})`,
        updatedAt: now,
      })
      .where(eq(takes.id, takeId)),
  ]);
}

export async function listByTake(db: Db, takeId: string): Promise<Vote[]> {
  return db.select().from(votes).where(eq(votes.takeId, takeId));
}

export async function listByMember(db: Db, memberId: string): Promise<Vote[]> {
  return db.select().from(votes).where(eq(votes.memberId, memberId)).orderBy(desc(votes.updatedAt));
}
