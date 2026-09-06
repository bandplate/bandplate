import { uuidv7 } from "@bandlib/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { authSessions, members } from "../schema/sqlite/index.js";

export type Session = typeof authSessions.$inferSelect;

export interface CreateSessionInput {
  memberId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  userAgent?: string | null;
}

function buildRow(input: CreateSessionInput): Session {
  return {
    id: uuidv7(),
    memberId: input.memberId,
    tokenHash: input.tokenHash,
    createdAt: input.createdAt,
    lastSeenAt: input.createdAt,
    expiresAt: input.expiresAt,
    userAgent: input.userAgent ?? null,
    revokedAt: null,
  };
}

export async function create(db: Db, input: CreateSessionInput): Promise<Session> {
  const row = buildRow(input);
  await db.insert(authSessions).values(row);
  return row;
}

/**
 * Builds (but does not execute) a guarded session insert — `INSERT ...
 * SELECT ... WHERE EXISTS (SELECT 1 FROM members WHERE id = ?)` — for use
 * inside a `db.batch([...])` alongside a guarded member insert. Returning
 * the unexecuted statement (a `RunnableQuery`, same shape `db.batch`
 * already accepts for `db.insert(...)`/`db.update(...)` builders) is what
 * lets `bootstrapAdmin` land the member row and its very first session in
 * one atomic batch: if the member insert didn't happen (guarded elsewhere
 * against a non-empty table), this row's own `memberId` never exists
 * either, so this guarded insert is a no-op in the same batch — no
 * orphaned session can result.
 */
export function buildCreateIfMemberExistsStatement(
  db: Db,
  input: CreateSessionInput,
): { session: Session; statement: ReturnType<Db["run"]> } {
  const row = buildRow(input);
  const statement = db.run(sql`
    insert into auth_sessions (id, member_id, token_hash, created_at, last_seen_at, expires_at, user_agent, revoked_at)
    select ${row.id}, ${row.memberId}, ${row.tokenHash}, ${row.createdAt}, ${row.lastSeenAt}, ${row.expiresAt}, ${row.userAgent}, null
    where exists (select 1 from members where id = ${row.memberId})
  `);
  return { session: row, statement };
}

export interface CreateFromLoginInput extends CreateSessionInput {
  /**
   * When set, the member's `invited` -> `active` activation (and
   * `emailVerifiedAt`) is written in the *same* `db.batch` as the session
   * insert — this is what keeps a first login atomic against D1's lack of
   * interactive transactions: either both writes land, or neither does.
   */
  activateMemberAt?: number;
}

export async function createFromLogin(db: Db, input: CreateFromLoginInput): Promise<Session> {
  const row = buildRow(input);
  const insertSession = db.insert(authSessions).values(row);

  if (input.activateMemberAt !== undefined) {
    await db.batch([
      insertSession,
      db
        .update(members)
        .set({ status: "active", emailVerifiedAt: input.activateMemberAt })
        .where(eq(members.id, input.memberId)),
    ]);
  } else {
    await insertSession;
  }

  return row;
}

export async function getByHash(db: Db, tokenHash: string): Promise<Session | undefined> {
  const [row] = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function touch(
  db: Db,
  id: string,
  input: { lastSeenAt: number; expiresAt: number },
): Promise<void> {
  await db.update(authSessions).set(input).where(eq(authSessions.id, id));
}

export async function revoke(db: Db, id: string, revokedAt: number): Promise<void> {
  await db.update(authSessions).set({ revokedAt }).where(eq(authSessions.id, id));
}

export async function revokeAllForMember(
  db: Db,
  memberId: string,
  revokedAt: number,
): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt })
    .where(and(eq(authSessions.memberId, memberId), isNull(authSessions.revokedAt)));
}

/**
 * The most recent `lastSeenAt` across ALL of a member's sessions (including
 * revoked/expired ones — this is "when were they last active", not "is
 * their current session still valid"), for every member with at least one
 * session, in a single grouped query. Used by the admin members list ("last
 * seen" column) so it isn't N+1 queries against a handful of members.
 */
export async function getLastSeenAtByMember(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({
      memberId: authSessions.memberId,
      lastSeenAt: sql<number>`max(${authSessions.lastSeenAt})`,
    })
    .from(authSessions)
    .groupBy(authSessions.memberId);

  const result = new Map<string, number>();
  for (const row of rows) {
    result.set(row.memberId, row.lastSeenAt);
  }
  return result;
}
