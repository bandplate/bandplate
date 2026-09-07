import { uuidv7 } from "@bandplate/core";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { events, takes } from "../schema/sqlite/index.js";

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
    })
    .returning();

  if (!row) {
    throw new Error("insert into events returned no row");
  }
  return row;
}

export async function getById(db: Db, id: string): Promise<Event | undefined> {
  const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return row;
}

/**
 * Ingest idempotency lookup: `clientRef` is unique, generated once by the
 * bridge and reused forever (contract v1 §3). Re-posting the same
 * `clientRef` must return the existing row rather than create a duplicate.
 */
export async function getByClientRef(db: Db, clientRef: string): Promise<Event | undefined> {
  const [row] = await db.select().from(events).where(eq(events.clientRef, clientRef)).limit(1);
  return row;
}

/** Batch lookup — avoids one round trip per row when rendering a take list's event links. */
export async function getByIds(db: Db, ids: string[]): Promise<Event[]> {
  if (ids.length === 0) {
    return [];
  }
  return db.select().from(events).where(inArray(events.id, ids));
}

export interface ListRecentOptions {
  limit?: number;
}

/** Newest first — this ordering is the default everywhere events appear. */
export async function listRecent(db: Db, options: ListRecentOptions = {}): Promise<Event[]> {
  const query = db.select().from(events).orderBy(desc(events.heldAt));
  if (options.limit !== undefined) {
    return query.limit(options.limit);
  }
  return query;
}

export interface EventWithTakeCount extends Event {
  takeCount: number;
}

export interface ListRecentWithTakeCountsOptions {
  limit?: number;
  /** Restrict to these kinds — e.g. the archive's "rehearsals only" filter. */
  kind?: EventKind[];
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
): Promise<EventWithTakeCount[]> {
  const hasKindFilter = options.kind !== undefined && options.kind.length > 0;
  const base = db
    .select({ event: events, takeCount: sql<number>`count(${takes.id})` })
    .from(events);
  const query = hasKindFilter
    ? base
        .leftJoin(takes, eq(takes.eventId, events.id))
        // biome-ignore lint/style/noNonNullAssertion: guarded by hasKindFilter above
        .where(inArray(events.kind, options.kind!))
        .groupBy(events.id)
        .orderBy(desc(events.heldAt))
    : base
        .leftJoin(takes, eq(takes.eventId, events.id))
        .groupBy(events.id)
        .orderBy(desc(events.heldAt));
  const rows = options.limit !== undefined ? await query.limit(options.limit) : await query;
  return rows.map((row) => ({ ...row.event, takeCount: row.takeCount }));
}
