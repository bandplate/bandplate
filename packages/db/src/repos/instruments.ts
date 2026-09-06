import { uuidv7 } from "@bandlib/core";
import { eq, isNull } from "drizzle-orm";
import type { Db } from "../client.js";
import { instruments } from "../schema/sqlite/index.js";

export type Instrument = typeof instruments.$inferSelect;

export interface CreateInstrumentInput {
  slug: string;
  label: string;
  sortOrder?: number;
}

export async function create(db: Db, input: CreateInstrumentInput): Promise<Instrument> {
  const [row] = await db
    .insert(instruments)
    .values({
      id: uuidv7(),
      slug: input.slug,
      label: input.label,
      sortOrder: input.sortOrder ?? 0,
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
