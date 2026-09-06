import { uuidv7 } from "@bandlib/core";
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

/** Batch lookup — avoids one round trip per row when rendering a take list's event links. */
export async function getByIds(db: Db, ids: string[]): Promise<Event[]> {
  if (ids.length === 0) {
    return [];
  }
  return db.select().from(events).where(inArray(events.id, ids));
}

export interface ListRecentOptions {
  limit?: number;
  /** Restrict to these kinds — e.g. the archive's "rehearsals only" filter. */
  kind?: EventKind[];
}

/** Newest first — this ordering is the default everywhere events appear. */
export async function listRecent(db: Db, options: ListRecentOptions = {}): Promise<Event[]> {
  const hasKindFilter = options.kind !== undefined && options.kind.length > 0;
  const query = hasKindFilter
    ? db
        .select()
        .from(events)
        // biome-ignore lint/style/noNonNullAssertion: guarded by hasKindFilter above
        .where(inArray(events.kind, options.kind!))
        .orderBy(desc(events.heldAt))
    : db.select().from(events).orderBy(desc(events.heldAt));
  if (options.limit !== undefined) {
    return query.limit(options.limit);
  }
  return query;
}

export interface EventWithTakeCount extends Event {
  takeCount: number;
}

/**
 * `listRecent` plus how many takes were recorded that day — the archive
 * list shows this so a member can tell a well-documented rehearsal from an
 * empty placeholder before opening it.
 */
export async function listRecentWithTakeCounts(
  db: Db,
  options: ListRecentOptions = {},
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
