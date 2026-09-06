import { uuidv7 } from "@bandlib/core";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { instruments, takeInstruments, takes } from "../schema/sqlite/index.js";
import type { Instrument } from "./instruments.js";

export type Take = typeof takes.$inferSelect;
export type TakeState = Take["state"];

export interface CreateTakeInput {
  songId: string;
  eventId: string;
  label?: string | null;
  recordedAt: number;
  durationMs?: number | null;
  state?: TakeState;
  clientRef?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  /** Instruments present on this take (populates take_instruments). */
  instrumentIds?: string[];
}

/**
 * Inserts a take and its take_instruments rows atomically. The id is
 * client-generated (uuidv7), so there is no need to read the row back after
 * writing it — that read-then-write pattern is exactly what the D1 batch
 * constraint forbids: two round trips with no atomicity between them would
 * let a partial failure leave a take with zero take_instruments rows, which
 * then silently vanishes from listByInstruments. Instead, when there are
 * instruments to attach, both inserts go into a single `db.batch([...])` so
 * they succeed or fail together; the row returned to the caller is the one
 * constructed locally, matching the column defaults declared in the schema.
 */
export async function create(db: Db, input: CreateTakeInput): Promise<Take> {
  const id = uuidv7();
  const row: Take = {
    id,
    songId: input.songId,
    eventId: input.eventId,
    label: input.label ?? null,
    recordedAt: input.recordedAt,
    durationMs: input.durationMs ?? null,
    state: input.state ?? "uploading",
    keeperVotes: 0,
    totalVotes: 0,
    ratingScore: 0,
    clientRef: input.clientRef ?? null,
    notes: input.notes ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    publishedAt: null,
    purgedAt: null,
  };

  const insertTake = db.insert(takes).values(row);
  const instrumentIds = input.instrumentIds ?? [];

  if (instrumentIds.length > 0) {
    await db.batch([
      insertTake,
      db
        .insert(takeInstruments)
        .values(instrumentIds.map((instrumentId) => ({ takeId: id, instrumentId }))),
    ]);
  } else {
    await insertTake;
  }

  return row;
}

export async function getById(db: Db, id: string): Promise<Take | undefined> {
  const [row] = await db.select().from(takes).where(eq(takes.id, id)).limit(1);
  return row;
}

export async function listBySong(db: Db, songId: string): Promise<Take[]> {
  return db.select().from(takes).where(eq(takes.songId, songId)).orderBy(desc(takes.recordedAt));
}

export interface ListByEventOptions {
  /**
   * `"desc"` (default, newest first) matches every other take listing.
   * `"asc"` gives the order takes were actually recorded during that one
   * session — what the event detail page shows, since "first take of the
   * day first" is how a member reconstructs what happened that day.
   */
  order?: "asc" | "desc";
}

export async function listByEvent(
  db: Db,
  eventId: string,
  options: ListByEventOptions = {},
): Promise<Take[]> {
  const direction = options.order === "asc" ? asc(takes.recordedAt) : desc(takes.recordedAt);
  return db.select().from(takes).where(eq(takes.eventId, eventId)).orderBy(direction);
}

/**
 * Takes that have ALL of the given instruments (AND semantics, not any-of).
 * A take with {bass, drums} matches a query for {bass} and for
 * {bass, drums}, but a take with only {bass} does not match {bass, drums}.
 */
export async function listByInstruments(db: Db, instrumentIds: string[]): Promise<Take[]> {
  if (instrumentIds.length === 0) {
    return [];
  }

  const matches = await db
    .select({ takeId: takeInstruments.takeId })
    .from(takeInstruments)
    .where(inArray(takeInstruments.instrumentId, instrumentIds))
    .groupBy(takeInstruments.takeId)
    .having(sql`count(distinct ${takeInstruments.instrumentId}) = ${instrumentIds.length}`);

  const ids = matches.map((m) => m.takeId);
  if (ids.length === 0) {
    return [];
  }

  return db.select().from(takes).where(inArray(takes.id, ids)).orderBy(desc(takes.recordedAt));
}

export async function setState(
  db: Db,
  id: string,
  state: TakeState,
  updatedAt: number,
): Promise<void> {
  await db.update(takes).set({ state, updatedAt }).where(eq(takes.id, id));
}

/**
 * Batch-fetches the instruments on each of the given takes in one query
 * (rather than one round trip per take row in a list), ordered by the
 * instrument's own sort order. Callers must dedupe `takeIds` themselves —
 * this does not, matching `listByInstruments`.
 */
export async function listInstrumentsForTakes(
  db: Db,
  takeIds: string[],
): Promise<Map<string, Instrument[]>> {
  const result = new Map<string, Instrument[]>();
  if (takeIds.length === 0) {
    return result;
  }

  const rows = await db
    .select({ takeId: takeInstruments.takeId, instrument: instruments })
    .from(takeInstruments)
    .innerJoin(instruments, eq(instruments.id, takeInstruments.instrumentId))
    .where(inArray(takeInstruments.takeId, takeIds))
    .orderBy(instruments.sortOrder);

  for (const row of rows) {
    const existing = result.get(row.takeId);
    if (existing) {
      existing.push(row.instrument);
    } else {
      result.set(row.takeId, [row.instrument]);
    }
  }
  return result;
}
