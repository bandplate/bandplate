import { uuidv7 } from "@bandplate/core";
import { DEFAULT_LOCALE, type Locale } from "@bandplate/i18n";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { type Read, readAll, readOne, runRead } from "../read.js";
import { instruments, memberInstruments, members } from "../schema/sqlite/index.js";
import { chunk } from "./chunk.js";
import { assertColumnCount } from "./column-order-guard.js";
import type { Instrument } from "./instruments.js";

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
  /**
   * The language this member reads the app in until they change it on `/me`
   * — the installation's `BANDPLATE_DEFAULT_LOCALE`. Omitted falls to the
   * column default, which is English; a Czech deployment passes `cs`, and
   * that is also what their invitation is written in.
   */
  locale?: Locale;
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
      locale: input.locale ?? DEFAULT_LOCALE,
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
  return runRead(db, buildGetByIdRead(db, id));
}

/** `getById`, planned for the caller's batch. */
export function buildGetByIdRead(db: Db, id: string): Read<Member | undefined> {
  return readOne(db.select().from(members).where(eq(members.id, id)).limit(1), (rows) => rows[0]);
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
  /**
   * The language this member reads the app in.
   *
   * Folded in here rather than given its own `setLocale` function, following
   * `instrumentsRepo.UpdateInstrumentInput`'s settled precedent. Note that it
   * is NOT an admin concern like `status` and `role` are: a member sets their
   * own on `/me`, which is why that path deliberately does not go through
   * `updateMemberWithGuards` — see that function.
   */
  locale?: Locale;
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

export interface HomeLoadWrite {
  /** What `homeLastSeenAt` held when the decision was made. */
  previousLastSeenAt: number | null;
  /** This load's time: the new `homeLastSeenAt`. */
  lastSeenAt: number;
  /** `homeLastVisitAt` after this load — moved only when a new visit started. */
  lastVisitAt: number | null;
}

/**
 * Records a home load: `homeLastSeenAt` becomes this load's time, and
 * `homeLastVisitAt` takes whatever `decideHomeVisit` said (the previous
 * visit's end when this load started a new one, unchanged otherwise). One
 * UPDATE, on every load.
 *
 * A compare-and-swap on `homeLastSeenAt`: the write only lands if it still
 * holds what the decision read. Two tabs opening home in the same instant
 * after a long gap would otherwise both roll the visit over, and the second
 * would copy the first's brand-new "last seen" into `homeLastVisitAt`, which
 * makes "new since your last visit" mean "new in the last millisecond". The
 * losing write is simply dropped: the winner already recorded a load at the
 * same moment. Returns whether it landed.
 */
export async function recordHomeLoad(db: Db, id: string, write: HomeLoadWrite): Promise<boolean> {
  const rows = await db
    .update(members)
    .set({ homeLastSeenAt: write.lastSeenAt, homeLastVisitAt: write.lastVisitAt })
    .where(
      and(
        eq(members.id, id),
        write.previousLastSeenAt === null
          ? isNull(members.homeLastSeenAt)
          : eq(members.homeLastSeenAt, write.previousLastSeenAt),
      ),
    )
    .returning({ id: members.id });
  return rows.length === 1;
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
  /**
   * The bootstrap admin's language. `/setup` passes what the request's
   * `Accept-Language` asked for, so the very first member is not handed
   * English merely because English is the default — they can still change it
   * on `/me` afterwards.
   */
  locale?: Locale;
}

/**
 * Builds (but does not execute) the guarded bootstrap insert — `INSERT ...
 * SELECT ... WHERE NOT EXISTS (SELECT 1 FROM members)` — so two concurrent
 * bootstrap requests can't race each other into creating two admins.
 * Returning the unexecuted statement (rather than awaiting it here) is
 * what lets `bootstrapAdmin` batch it together with the first session
 * insert via `db.batch([...])` — see `authSessionsRepo.buildCreateIfMemberExistsStatement`.
 * The id is generated up front and handed back alongside the statement so
 * the caller can build the paired session-insert statement against it.
 *
 * Built via `db.insert(members).select(sql\`...\`)` — NOT `db.run(sql\`...\`)`
 * — deliberately. `db.run()`/`.all()`/`.get()`/`.values()` return a
 * `SQLiteRaw` wrapper whose `_prepare()` returns itself, which has no
 * `.stmt`; libSQL's own `.batch()` tolerates that shape, but the D1
 * driver's `.batch()` calls `preparedQuery.stmt.bind(...)` on every item
 * and crashes with "Cannot read properties of undefined (reading 'bind')"
 * — a read-then-write/interactive-transaction-shaped gap D1 actually
 * enforces where libSQL didn't (see the increment 7 report). `.insert(...).
 * select(rawSqlObject)` is a real `SQLiteInsertBase`, whose `_prepare()`
 * goes through the driver's `session.prepareQuery()` like any other
 * builder-produced statement, so it batches correctly under both drivers.
 * Passing a raw `SQL` object (rather than a query-builder callback) to
 * `.select()` is an explicitly supported overload — see
 * `SQLiteInsertBuilder.select`'s `select(selectQuery: SQL)` signature.
 */
export function buildCreateIfEmptyStatement(db: Db, input: CreateIfEmptyInput) {
  // 11 values below (id, displayName, slug, email, role, status, createdAt,
  // emailVerifiedAt, locale, homeLastSeenAt, homeLastVisitAt) must match
  // `members`' column count and order — see `column-order-guard.ts` for why
  // this is checked explicitly rather than left implicit. Drizzle emits
  // columns in schema DECLARATION order, and `locale` then the two home-visit
  // timestamps were declared last, in that order. The first admin has never
  // opened home, so both are NULL.
  assertColumnCount(members, 11);
  const id = uuidv7();
  const statement = db.insert(members).select(sql`
    select ${id}, ${input.displayName}, ${input.slug}, ${normalizeEmail(input.email)}, 'admin', 'active', ${input.createdAt}, ${input.emailVerifiedAt ?? null}, ${input.locale ?? DEFAULT_LOCALE}, null, null
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

// ---------------------------------------------------------------------------
// member <-> instrument (which instruments a member plays) — see
// `schema/sqlite/index.ts`'s `memberInstruments` for why this is a join
// table rather than a JSON column. Admin-managed (the admin member form's
// multi-select), read everywhere a member's own instruments are shown
// (`/me`, the admin roster).
// ---------------------------------------------------------------------------

/**
 * Replace-all: a member's full set of instrument ids, in one write. Delete +
 * insert rather than a diff — the multi-select this backs submits the whole
 * set every time, so there's nothing to diff against, and the two
 * statements go into one `db.batch([...])` so a member is never left with a
 * partially-applied set if the write fails partway (no interactive
 * transactions, per the project's D1-compatibility rule).
 */
export async function setInstruments(
  db: Db,
  memberId: string,
  instrumentIds: string[],
): Promise<void> {
  const uniqueIds = [...new Set(instrumentIds)];
  const deleteStatement = db
    .delete(memberInstruments)
    .where(eq(memberInstruments.memberId, memberId));

  if (uniqueIds.length === 0) {
    await deleteStatement;
    return;
  }

  const insertStatement = db
    .insert(memberInstruments)
    .values(uniqueIds.map((instrumentId) => ({ memberId, instrumentId })));
  await db.batch([deleteStatement, insertStatement]);
}

/**
 * A member's own instruments, in the band's own sort order — INCLUDING
 * archived ones. Archiving an instrument only ever sets `instruments.archivedAt`
 * (the row, and this join, are never deleted), so a member who plays an
 * instrument the band has since dropped keeps rendering it here, same as
 * `takesRepo.listInstrumentsForTakes` does for takes.
 */
export async function listInstrumentsForMember(db: Db, memberId: string): Promise<Instrument[]> {
  return runRead(db, buildListInstrumentsForMemberRead(db, memberId));
}

/** `listInstrumentsForMember`, planned for the caller's batch. */
export function buildListInstrumentsForMemberRead(db: Db, memberId: string): Read<Instrument[]> {
  return readOne(
    db
      .select({ instrument: instruments })
      .from(memberInstruments)
      .innerJoin(instruments, eq(instruments.id, memberInstruments.instrumentId))
      .where(eq(memberInstruments.memberId, memberId))
      .orderBy(instruments.sortOrder),
    (rows) => rows.map((row) => row.instrument),
  );
}

/**
 * Batch version of `listInstrumentsForMember` for a roster listing (the
 * admin members page) — one query for every member's instruments instead of
 * one round trip per row. Callers must dedupe `memberIds` themselves,
 * matching `takesRepo.listInstrumentsForTakes`'s own contract.
 */
export async function listInstrumentsForMembers(
  db: Db,
  memberIds: string[],
): Promise<Map<string, Instrument[]>> {
  const result = new Map<string, Instrument[]>();
  if (memberIds.length === 0) {
    return result;
  }

  for (const ids of chunk(memberIds, GET_BY_IDS_CHUNK_SIZE)) {
    const rows = await buildListInstrumentsForMembersChunkQuery(db, ids);
    for (const row of rows) {
      const existing = result.get(row.memberId);
      if (existing) {
        existing.push(row.instrument);
      } else {
        result.set(row.memberId, [row.instrument]);
      }
    }
  }
  return result;
}

/** One chunk of `listInstrumentsForMembers`. Exported for testing only. */
export function buildListInstrumentsForMembersChunkQuery(db: Db, memberIds: string[]) {
  return db
    .select({ memberId: memberInstruments.memberId, instrument: instruments })
    .from(memberInstruments)
    .innerJoin(instruments, eq(instruments.id, memberInstruments.instrumentId))
    .where(inArray(memberInstruments.memberId, memberIds))
    .orderBy(instruments.sortOrder);
}

/** Batch lookup — the owner names on a list of personal recordings, in one query. */
export async function getByIds(db: Db, ids: string[]): Promise<Member[]> {
  return runRead(db, buildGetByIdsRead(db, ids));
}

/** `getByIds`, planned: every chunk goes out in the caller's one batch. */
export function buildGetByIdsRead(db: Db, ids: string[]): Read<Member[]> {
  // Chunked: D1 caps a statement at 100 bound parameters (see `chunk.ts`),
  // and the ids are this query's only one.
  return readAll(
    chunk(ids, GET_BY_IDS_CHUNK_SIZE).map((part) => buildGetByIdsChunkQuery(db, part)),
    (parts) => parts.flat(),
  );
}

export const GET_BY_IDS_CHUNK_SIZE = 100;

/** One chunk of `getByIds`. Exported for testing only. */
export function buildGetByIdsChunkQuery(db: Db, ids: string[]) {
  return db.select().from(members).where(inArray(members.id, ids));
}
