import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { takes, votes } from "../schema/sqlite/index.js";
import { DEFAULT_PAGE_SIZE, type PageArgs, type Paged } from "./pagination.js";

export type Vote = typeof votes.$inferSelect;

export interface CastVoteInput {
  takeId: string;
  memberId: string;
  keeper: boolean;
  comment?: string | null;
  now: number;
}

/**
 * Builds (without executing) the take-aggregate recompute statement used by
 * `castVote`'s batch. Exported for testing only — not part of the package's
 * public repo surface (not re-exported from src/index.ts) — so that
 * votes.test.ts can exercise the zero-vote COALESCE behavior directly,
 * against an empty votes table, without going through `castVote` itself
 * (that branch is unreachable through `castVote` because the upsert always
 * precedes this UPDATE in the same batch).
 *
 * SUM/COUNT over zero rows yields NULL, not 0 — ratingScore is NOT NULL, so
 * the zero-vote case is handled with COALESCE.
 */
export function buildAggregateUpdate(db: Db, takeId: string, now: number) {
  return db
    .update(takes)
    .set({
      keeperVotes: sql`(SELECT COUNT(*) FROM votes WHERE take_id = ${takeId} AND keeper = 1)`,
      totalVotes: sql`(SELECT COUNT(*) FROM votes WHERE take_id = ${takeId})`,
      ratingScore: sql`(SELECT COALESCE(CAST(SUM(keeper) AS REAL) / COUNT(*), 0) FROM votes WHERE take_id = ${takeId})`,
      updatedAt: now,
    })
    .where(eq(takes.id, takeId));
}

/**
 * Insert-or-update a vote, then recompute the take's vote aggregates from
 * the votes table. This is the reference implementation of the D1 batch
 * constraint: ONE `db.batch([...])` call, a fixed statement list computed
 * up front — never an interactive transaction, never an increment. The
 * aggregates are recomputed via correlated subqueries so they are
 * self-healing, and NEVER read-then-written.
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
    buildAggregateUpdate(db, takeId, now),
  ]);
}

export interface RemoveVoteInput {
  takeId: string;
  memberId: string;
  now: number;
}

/**
 * Deletes a member's vote on a take, then recomputes the take's aggregates —
 * same `db.batch([delete, aggregate-recompute])` shape as `castVote`'s own
 * `db.batch([upsert, aggregate-recompute])`. Not wired to any control today
 * (the vote UI is a two-position keeper/not-keeper toggle — see
 * `VoteToggle.astro` — with no third "no opinion" state reachable once a
 * member has voted), but kept as a real, tested repo capability: it's what
 * makes the zero-vote aggregate case reachable through normal use (a take's
 * only vote being retracted) rather than only through
 * `buildAggregateUpdate` exercised directly, and it's the natural primitive
 * an admin "clear a vote" tool or a future "un-vote" affordance would need.
 */
export async function removeVote(db: Db, input: RemoveVoteInput): Promise<void> {
  const { takeId, memberId, now } = input;

  await db.batch([
    db.delete(votes).where(and(eq(votes.takeId, takeId), eq(votes.memberId, memberId))),
    buildAggregateUpdate(db, takeId, now),
  ]);
}

export async function listByTake(db: Db, takeId: string): Promise<Vote[]> {
  return db.select().from(votes).where(eq(votes.takeId, takeId));
}

/**
 * Every vote one member has cast, most recently changed first.
 *
 * `takeId` breaks the tie: the primary key is `(takeId, memberId)`, so within
 * one member's votes `takeId` is unique and the ordering is total. Two votes
 * cast in the same millisecond — a double-tap, or a test fixture using one
 * literal timestamp — would otherwise have no contractual order, which
 * `/me`'s paged history would turn into a duplicated row.
 */
export interface ListByMemberOptions {
  /** Which page to return. Omitted means the FIRST page — never all of them. */
  page?: PageArgs;
}

export async function listByMember(
  db: Db,
  memberId: string,
  options: ListByMemberOptions = {},
): Promise<Paged<Vote>> {
  const limit = options.page?.limit ?? DEFAULT_PAGE_SIZE;
  const offset = options.page?.offset ?? 0;
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(votes)
      .where(eq(votes.memberId, memberId))
      .orderBy(desc(votes.updatedAt), desc(votes.takeId))
      .limit(limit)
      .offset(offset),
    countByMember(db, memberId),
  ]);
  return { rows, total };
}

/** How many votes one member has cast — the count, without the rows. */
export async function countByMember(db: Db, memberId: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(votes)
    .where(eq(votes.memberId, memberId));
  return rows[0]?.value ?? 0;
}

/**
 * What one member's voting record looks like, in one round trip.
 *
 * `keepers` is how many of their votes were a keeper call.
 *
 * `agreed` / `resolved` are the two halves of "how often you were with the
 * band". RESOLVED means the take has been settled by an explicit admin
 * action — `state` is `keeper` or `rejected` — because that, not the running
 * tally, is the band's verdict. AGREED means their call matched it: they
 * voted keeper on something promoted, or not-a-keeper on something rejected.
 *
 * `resolved` is returned rather than just a percentage so the caller can tell
 * "0 of 4" from "nothing settled yet" — those render differently, and a page
 * that showed 0% for the second would be lying.
 */
export interface VotingRecord {
  keepers: number;
  agreed: number;
  resolved: number;
}

export async function votingRecord(db: Db, memberId: string): Promise<VotingRecord> {
  const rows = await db
    .select({
      keepers: sql<number>`sum(case when ${votes.keeper} then 1 else 0 end)`,
      resolved: sql<number>`sum(case when ${takes.state} in ('keeper', 'rejected') then 1 else 0 end)`,
      agreed: sql<number>`sum(case
        when ${takes.state} = 'keeper' and ${votes.keeper} then 1
        when ${takes.state} = 'rejected' and not ${votes.keeper} then 1
        else 0 end)`,
    })
    .from(votes)
    .innerJoin(takes, eq(takes.id, votes.takeId))
    .where(eq(votes.memberId, memberId));
  const row = rows[0];
  // `sum()` over no rows is NULL, not 0.
  return {
    keepers: row?.keepers ?? 0,
    agreed: row?.agreed ?? 0,
    resolved: row?.resolved ?? 0,
  };
}

/**
 * One member's vote (if any) on each of the given takes, as a `Map` keyed
 * by take id — the initial `aria-pressed` state `VoteToggle.astro` needs
 * for every take row it renders, batch-fetched the same way
 * `favoritesRepo.listTargetIdsByMember` avoids one query per row.
 */
export async function listByMemberForTakes(
  db: Db,
  memberId: string,
  takeIds: string[],
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (takeIds.length === 0) {
    return result;
  }
  const rows = await db
    .select({ takeId: votes.takeId, keeper: votes.keeper })
    .from(votes)
    .where(and(eq(votes.memberId, memberId), inArray(votes.takeId, takeIds)));
  for (const row of rows) {
    result.set(row.takeId, row.keeper);
  }
  return result;
}
