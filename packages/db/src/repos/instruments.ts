import { uuidv7 } from "@bandplate/core";
import { eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  assets,
  instruments,
  memberInstruments,
  songInstrumentNotes,
  takeInstruments,
} from "../schema/sqlite/index.js";

export type Instrument = typeof instruments.$inferSelect;

export interface CreateInstrumentInput {
  slug: string;
  label: string;
  sortOrder?: number;
  /** A key from `@bandplate/ui/icons/instruments`, or null for initials. */
  icon?: string | null;
  /** A key from `@bandplate/ui/tokens/track-colors`, or null for the neutral. */
  color?: string | null;
  /** Created by ingest for an unrecognised slug, and not yet finished by a human. */
  isStub?: boolean;
}

export async function create(db: Db, input: CreateInstrumentInput): Promise<Instrument> {
  const [row] = await db
    .insert(instruments)
    .values({
      id: uuidv7(),
      slug: input.slug,
      label: input.label,
      sortOrder: input.sortOrder ?? 0,
      icon: input.icon ?? null,
      color: input.color ?? null,
      isStub: input.isStub ?? false,
    })
    .returning();

  if (!row) {
    throw new Error("insert into instruments returned no row");
  }
  return row;
}

export interface ListInstrumentsOptions {
  includeArchived?: boolean;
}

/** List instruments, excluding archived ones by default. */
export async function list(db: Db, options: ListInstrumentsOptions = {}): Promise<Instrument[]> {
  if (options.includeArchived) {
    return db.select().from(instruments).orderBy(instruments.sortOrder);
  }
  return db
    .select()
    .from(instruments)
    .where(isNull(instruments.archivedAt))
    .orderBy(instruments.sortOrder);
}

export async function archive(db: Db, id: string, archivedAt: number): Promise<void> {
  await db.update(instruments).set({ archivedAt }).where(eq(instruments.id, id));
}

export interface UpdateInstrumentInput {
  /**
   * Set false by the admin edit that finishes a stub.
   *
   * Saving the sheet IS the confirmation — there is no separate "approve"
   * press, because the thing a stub is missing is exactly what that form
   * asks for: a label worth reading, an icon, a colour, a place in the order.
   */
  isStub?: boolean;
  label?: string;
  sortOrder?: number;
  /** `null` unarchives; a number archives at that timestamp. */
  archivedAt?: number | null;
  /**
   * A key from `@bandplate/ui/icons/instruments`, or `null` to clear it back
   * to initials. `undefined` (the key absent) leaves the current icon alone —
   * `update` only writes the keys it is given, so a caller editing a label
   * cannot silently erase the icon.
   */
  icon?: string | null;
  /**
   * A key from `@bandplate/ui/tokens/track-colors`, or `null` to clear it
   * back to the neutral. Absent leaves the current colour alone, exactly as
   * `icon` above.
   */
  color?: string | null;
}

export async function update(db: Db, id: string, input: UpdateInstrumentInput): Promise<void> {
  if (Object.keys(input).length === 0) {
    return;
  }
  await db.update(instruments).set(input).where(eq(instruments.id, id));
}

export async function getById(db: Db, id: string): Promise<Instrument | undefined> {
  const [row] = await db.select().from(instruments).where(eq(instruments.id, id)).limit(1);
  return row;
}

/**
 * What would break if an instrument were deleted, counted per table.
 *
 * Every one of these is a row that would be ORPHANED rather than removed.
 * `PRAGMA foreign_keys` is off here so it matches D1, which does not enforce
 * them either — so nothing in the database would refuse the delete, and a
 * chord chart or a stem would simply end up pointing at an id that is not
 * there. The check has to live in code, which is the same conclusion
 * `songsRepo.remove` and `takesRepo.remove` reached.
 *
 * Counted for every instrument at once, four grouped queries rather than four
 * per row: the admin list needs this for each instrument it draws, and a
 * query per instrument per table is forty round trips on a twelve-instrument
 * band.
 */
export interface InstrumentUsage {
  /** Members who list it among their instruments. */
  members: number;
  /** Takes that were recorded with it. */
  takes: number;
  /** Songs with a chart written for it — the only one holding authored text. */
  charts: number;
  /** Audio files that ARE this instrument's stem. */
  assets: number;
}

export const NO_USAGE: InstrumentUsage = { members: 0, takes: 0, charts: 0, assets: 0 };

export function isUnused(usage: InstrumentUsage): boolean {
  return usage.members === 0 && usage.takes === 0 && usage.charts === 0 && usage.assets === 0;
}

export async function usageByInstrument(db: Db): Promise<Map<string, InstrumentUsage>> {
  const [members, takes, charts, assetRows] = await Promise.all([
    db
      .select({ id: memberInstruments.instrumentId, n: sql<number>`count(*)` })
      .from(memberInstruments)
      .groupBy(memberInstruments.instrumentId),
    db
      .select({ id: takeInstruments.instrumentId, n: sql<number>`count(*)` })
      .from(takeInstruments)
      .groupBy(takeInstruments.instrumentId),
    db
      .select({ id: songInstrumentNotes.instrumentId, n: sql<number>`count(*)` })
      .from(songInstrumentNotes)
      .groupBy(songInstrumentNotes.instrumentId),
    db
      .select({ id: assets.instrumentId, n: sql<number>`count(*)` })
      .from(assets)
      .groupBy(assets.instrumentId),
  ]);

  const usage = new Map<string, InstrumentUsage>();
  const bump = (id: string | null, key: keyof InstrumentUsage, n: number) => {
    // `assets.instrument_id` is nullable — every master in the archive lands
    // in that group, and it belongs to no instrument.
    if (!id) {
      return;
    }
    const current = usage.get(id) ?? { ...NO_USAGE };
    current[key] = Number(n);
    usage.set(id, current);
  };
  for (const row of members) bump(row.id, "members", row.n);
  for (const row of takes) bump(row.id, "takes", row.n);
  for (const row of charts) bump(row.id, "charts", row.n);
  for (const row of assetRows) bump(row.id, "assets", row.n);
  return usage;
}

/**
 * Delete an instrument outright.
 *
 * Deliberately NOT a cascade, and deliberately no dependent deletes beside
 * it: an instrument does not OWN any of the rows that reference it. A chord
 * chart belongs to a song, a take's instrument list belongs to the take, a
 * stem belongs to a take's assets. Removing an instrument must never quietly
 * edit any of them, which is why the only safe delete is one with nothing
 * pointing at it — the caller checks `usageByInstrument` first, and checks it
 * again at the moment of deleting.
 */
export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(instruments).where(eq(instruments.id, id));
}
