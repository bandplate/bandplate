import { uuidv7 } from "@bandlib/core";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { takeInstruments, takes } from "../schema/sqlite/index.js";

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

export async function create(db: Db, input: CreateTakeInput): Promise<Take> {
  const [row] = await db
    .insert(takes)
    .values({
      id: uuidv7(),
      songId: input.songId,
      eventId: input.eventId,
      label: input.label ?? null,
      recordedAt: input.recordedAt,
      durationMs: input.durationMs ?? null,
      state: input.state ?? "uploading",
      clientRef: input.clientRef ?? null,
      notes: input.notes ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .returning();

  if (!row) {
    throw new Error("insert into takes returned no row");
  }

  if (input.instrumentIds && input.instrumentIds.length > 0) {
    await db
      .insert(takeInstruments)
      .values(input.instrumentIds.map((instrumentId) => ({ takeId: row.id, instrumentId })));
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

export async function listByEvent(db: Db, eventId: string): Promise<Take[]> {
  return db.select().from(takes).where(eq(takes.eventId, eventId)).orderBy(desc(takes.recordedAt));
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
