import { uuidv7 } from "@bandlib/core";
import { and, eq, isNull } from "drizzle-orm";
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
