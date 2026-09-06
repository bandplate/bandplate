import { uuidv7 } from "@bandlib/core";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { members } from "../schema/sqlite/index.js";

export type MemberRole = (typeof members.$inferSelect)["role"];
export type MemberStatus = (typeof members.$inferSelect)["status"];
export type Member = typeof members.$inferSelect;

export interface CreateMemberInput {
  displayName: string;
  slug: string;
  email: string;
  role?: MemberRole;
  status?: MemberStatus;
  createdAt: number;
}

/** Normalize an email the same way it is stored: lowercased and trimmed. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function create(db: Db, input: CreateMemberInput): Promise<Member> {
  const [row] = await db
    .insert(members)
    .values({
      id: uuidv7(),
      displayName: input.displayName,
      slug: input.slug,
      email: normalizeEmail(input.email),
      role: input.role ?? "member",
      status: input.status ?? "invited",
      createdAt: input.createdAt,
    })
    .returning();

  if (!row) {
    throw new Error("insert into members returned no row");
  }
  return row;
}

export async function getByEmail(db: Db, email: string): Promise<Member | undefined> {
  const [row] = await db
    .select()
    .from(members)
    .where(eq(members.email, normalizeEmail(email)))
    .limit(1);
  return row;
}

export async function getById(db: Db, id: string): Promise<Member | undefined> {
  const [row] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return row;
}

export async function list(db: Db): Promise<Member[]> {
  return db.select().from(members);
}

export async function setStatus(db: Db, id: string, status: MemberStatus): Promise<void> {
  await db.update(members).set({ status }).where(eq(members.id, id));
}

export interface UpdateMemberInput {
  status?: MemberStatus;
  role?: MemberRole;
}

/**
 * Single-statement partial update for `status`/`role` together — used by
 * `PATCH /admin/members/:id` so a `{role, status}` patch is one `UPDATE`
 * rather than two independent round trips that could land half-applied.
 */
export async function update(db: Db, id: string, input: UpdateMemberInput): Promise<void> {
  // Checked against defined values, not just key presence — drizzle's
  // `.set()` itself drops `undefined` entries, so `{status: undefined}`
  // would otherwise slip past a bare `Object.keys(...).length === 0` guard
  // and reach `.set()` with nothing left to set.
  const hasUpdate = Object.values(input).some((v) => v !== undefined);
  if (!hasUpdate) {
    return;
  }
  await db.update(members).set(input).where(eq(members.id, id));
}

export async function count(db: Db): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(members);
  return row?.count ?? 0;
}

export interface CreateIfEmptyInput {
  displayName: string;
  slug: string;
  email: string;
  createdAt: number;
  emailVerifiedAt?: number | null;
}

/**
 * Builds (but does not execute) the guarded bootstrap insert — `INSERT ...
 * SELECT ... WHERE NOT EXISTS (SELECT 1 FROM members)` — so two concurrent
 * bootstrap requests can't race each other into creating two admins.
 * Returning the unexecuted statement (rather than awaiting it here) is
 * what lets `bootstrapAdmin` batch it together with the first session
 * insert via `db.batch([...])` — see `authSessionsRepo.buildCreateIfMemberExistsStatement`.
 * The id is generated up front and handed back alongside the statement so
 * the caller can build the paired session-insert statement against it, and
 * because the guarded insert has to be followed by a plain read-back
 * anyway rather than trying to type the driver's raw run() result (which
 * the shared `Db` interface types as `unknown` by design; see
 * `client.ts`).
 */
export function buildCreateIfEmptyStatement(
  db: Db,
  input: CreateIfEmptyInput,
): { id: string; statement: ReturnType<Db["run"]> } {
  const id = uuidv7();
  const statement = db.run(sql`
    insert into members (id, display_name, slug, email, role, status, created_at, email_verified_at)
    select ${id}, ${input.displayName}, ${input.slug}, ${normalizeEmail(input.email)}, 'admin', 'active', ${input.createdAt}, ${input.emailVerifiedAt ?? null}
    where not exists (select 1 from members)
  `);
  return { id, statement };
}

/**
 * Bootstrap-only guarded insert: creates the very first member (as
 * `admin`/`active`) iff the table is currently empty. Executes
 * `buildCreateIfEmptyStatement` immediately and reads the result back —
 * used directly by tests and by any caller that doesn't need to batch it
 * with anything else. Returns the created row, or `undefined` if a member
 * already existed (bootstrap already happened).
 */
export async function createIfEmpty(
  db: Db,
  input: CreateIfEmptyInput,
): Promise<Member | undefined> {
  const { id, statement } = buildCreateIfEmptyStatement(db, input);
  await statement;
  return getById(db, id);
}
