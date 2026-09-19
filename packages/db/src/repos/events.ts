import { uuidv7 } from "@bandplate/core";
import { type SQL, and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { events, takes } from "../schema/sqlite/index.js";
import { DEFAULT_PAGE_SIZE, type PageArgs, type Paged } from "./pagination.js";

export type Event = typeof events.$inferSelect;
export type EventKind = Event["kind"];

export interface CreateEventInput {
  kind: EventKind;
  title?: string | null;
  heldAt: number;
  venue?: string | null;
  notes?: string | null;
  clientRef?: string | null;
  createdAt: number;
  updatedAt: number;
  ownerMemberId?: string | null;
}

export async function create(db: Db, input: CreateEventInput): Promise<Event> {
  const [row] = await db
    .insert(events)
    .values({
      id: uuidv7(),
      kind: input.kind,
      title: input.title ?? null,
      heldAt: input.heldAt,
      venue: input.venue ?? null,
      notes: input.notes ?? null,
      clientRef: input.clientRef ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      ownerMemberId: input.ownerMemberId ?? null,
    })
    .returning();

  if (!row) {
    throw new Error("insert into events returned no row");
  }
  return row;
}

export interface UpdateEventInput {
  kind?: EventKind;
  title?: string | null;
  heldAt?: number;
  venue?: string | null;
  notes?: string | null;
  /** `null` unarchives; a number archives at that timestamp. */
  archivedAt?: number | null;
  updatedAt: number;
}

/**
 * Write only the keys the caller supplied — a member editing a venue cannot
 * silently blank the notes. `updatedAt` is required rather than derived here
 * so the clock stays in the caller's hands (`deps.clock.now()`), the same way
 * `create` takes it.
 *
 * `clientRef` is deliberately absent: it is the bridge's idempotency key, not
 * a field a human edits. The one place it moves is `adoptClientRef` below.
 */
export async function update(db: Db, id: string, input: UpdateEventInput): Promise<void> {
  await db.update(events).set(input).where(eq(events.id, id));
}

/**
 * Move the bridge's idempotency key onto (or off) an event.
 *
 * Its own function rather than a field on `UpdateEventInput` precisely so it
 * cannot happen as a side effect of the edit form — which row holds the
 * `clientRef` decides which one the bridge writes to forever.
 *
 * `null` RELEASES it, and that half is not optional: `events.client_ref` is
 * UNIQUE, so handing a key to one event while another still holds it fails on
 * the constraint. A merge has to release before it adopts.
 */
export async function setClientRef(
  db: Db,
  id: string,
  clientRef: string | null,
  updatedAt: number,
): Promise<void> {
  await db.update(events).set({ clientRef, updatedAt }).where(eq(events.id, id));
}

/**
 * A LOOKUP, not a listing: it resolves an event a take already points at, so
 * it must keep returning archived rows. Filtering here would blank the event
 * name on a live take row. See `listRecent*` for the browse surfaces, which
 * do filter.
 */
export async function getById(db: Db, id: string): Promise<Event | undefined> {
  const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return row;
}

/**
 * Ingest idempotency lookup: `clientRef` is unique, generated once by the
 * bridge and reused forever (contract v1 §3). Re-posting the same
 * `clientRef` must return the existing row rather than create a duplicate.
 *
 * Must NOT filter on `archivedAt`. `client_ref` is UNIQUE, so a filtered
 * lookup would miss an archived event and send the bridge down the create
 * path straight into the constraint. Callers unarchive on a match instead —
 * the band just played it, so it is not retired after all.
 */
export async function getByClientRef(db: Db, clientRef: string): Promise<Event | undefined> {
  const [row] = await db.select().from(events).where(eq(events.clientRef, clientRef)).limit(1);
  return row;
}

/**
 * Batch LOOKUP — avoids one round trip per row when rendering a take list's
 * event links. Like `getById`, it does not filter archived rows: these
 * resolve an event a take already points at.
 */
export async function getByIds(db: Db, ids: string[]): Promise<Event[]> {
  if (ids.length === 0) {
    return [];
  }
  return db.select().from(events).where(inArray(events.id, ids));
}

export interface ListRecentOptions {
  limit?: number;
  /** Archived events are a browse-surface omission, so listings exclude them by default. */
  includeArchived?: boolean;
}

/**
 * Newest first — this ordering is the default everywhere events appear.
 *
 * `desc(events.id)` is not decoration: `heldAt` is a DATE, so two events held
 * the same day tie on the only sort key, and SQLite is free to order tied
 * rows differently between two runs of the same query. That is invisible in
 * an unpaged list and corrupting in a paged one — the page-2 query can return
 * a row page 1 already showed, dropping another entirely. `id` is uuidv7, so
 * it is a real creation-order tie-break rather than an arbitrary one. Same
 * reasoning, same fix, as `takesRepo.listBySong`.
 */
export async function listRecent(db: Db, options: ListRecentOptions = {}): Promise<Event[]> {
  const query = db
    .select()
    .from(events)
    .where(options.includeArchived ? undefined : isNull(events.archivedAt))
    .orderBy(desc(events.heldAt), desc(events.id));
  if (options.limit !== undefined) {
    return query.limit(options.limit);
  }
  return query;
}

export interface EventWithTakeCount extends Event {
  takeCount: number;
}

export interface ListRecentWithTakeCountsOptions {
  /**
   * A plain ceiling, for the callers that want the newest N and no paging —
   * home's five-event ledger. Ignored when `page` is given.
   */
  limit?: number;
  /** Which page to return. Omitted (with no `limit`) means the FIRST page. */
  page?: PageArgs;
  /** Restrict to these kinds — e.g. the archive's "rehearsals only" filter. */
  kind?: EventKind[];
  /** Archived events are a browse-surface omission, so listings exclude them by default. */
  includeArchived?: boolean;
  /** Only events that ARE archived — the archive pill's own view. */
  onlyArchived?: boolean;
}

/**
 * The conditions both the page query and its count run against, built once.
 * See `takesRepo.searchConditions` for why this is not two copies.
 */
function eventConditions(options: ListRecentWithTakeCountsOptions): SQL[] {
  const conditions: SQL[] = [];
  if (options.kind !== undefined && options.kind.length > 0) {
    conditions.push(inArray(events.kind, options.kind));
  }
  if (options.onlyArchived) {
    conditions.push(isNotNull(events.archivedAt));
  } else if (!options.includeArchived) {
    conditions.push(isNull(events.archivedAt));
  }
  return conditions;
}

/** How many events match — the archive's total, and the Archived pill's badge. */
export async function count(
  db: Db,
  options: ListRecentWithTakeCountsOptions = {},
): Promise<number> {
  const conditions = eventConditions(options);
  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(events)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  return rows[0]?.value ?? 0;
}

/**
 * `listRecent` plus how many takes were recorded that day — the archive
 * list shows this so a member can tell a well-documented rehearsal from an
 * empty placeholder before opening it. This (not `listRecent`) is the
 * archive's actual backing query, so the kind filter lives on its own
 * options type rather than on `listRecent`, which has no caller that needs
 * it.
 */
export async function listRecentWithTakeCounts(
  db: Db,
  options: ListRecentWithTakeCountsOptions = {},
): Promise<Paged<EventWithTakeCount>> {
  // Conditions collected into a list and combined with `and()` rather than
  // branching per combination: with a kind filter and an archived filter that
  // would already be four near-identical query builders. `and()` of an empty
  // list is `undefined`, which `.where()` treats as no filter at all.
  const conditions = eventConditions(options);
  const limit = options.page?.limit ?? options.limit ?? DEFAULT_PAGE_SIZE;
  const offset = options.page?.offset ?? 0;
  const [rows, total] = await Promise.all([
    db
      .select({ event: events, takeCount: sql<number>`count(${takes.id})` })
      .from(events)
      .leftJoin(takes, eq(takes.eventId, events.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(events.id)
      // See `listRecent` for why `id` is here — this is the archive's paged
      // query, so a non-contractual order for same-day events is not cosmetic.
      .orderBy(desc(events.heldAt), desc(events.id))
      .limit(limit)
      .offset(offset),
    count(db, options),
  ]);
  return {
    rows: rows.map((row) => ({ ...row.event, takeCount: row.takeCount })),
    total,
  };
}

/** One day, in epoch milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every event of one kind held on one day — what the duplicate-event warning
 * and the merge offer are built from.
 *
 * A range query, not a JS filter over the whole archive. The callers used to
 * ask `listRecentWithTakeCounts` for every event of that kind and narrow the
 * list themselves, which was already reading the archive to find at most a
 * couple of rows, and which broke outright once that listing returned a PAGE:
 * a duplicate held before the page boundary would simply not be found, and
 * the warning that exists to prevent a split day would go quiet exactly when
 * the archive was big enough to need it.
 */
export async function listOnDay(
  db: Db,
  kind: EventKind,
  dayStart: number,
  options: { includeArchived?: boolean } = {},
): Promise<Event[]> {
  const conditions: SQL[] = [
    eq(events.kind, kind),
    gte(events.heldAt, dayStart),
    lt(events.heldAt, dayStart + DAY_MS),
  ];
  if (!options.includeArchived) {
    conditions.push(isNull(events.archivedAt));
  }
  return db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.heldAt), desc(events.id));
}
