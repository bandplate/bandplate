import { uuidv7 } from "@bandlib/core";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { events } from "../schema/sqlite/index.js";

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
