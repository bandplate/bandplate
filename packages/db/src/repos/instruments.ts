import { uuidv7 } from "@bandplate/core";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { type Read, readOne, runRead } from "../read.js";
import {
  assets,
  instrumentAliases,
  instruments,
  memberInstruments,
  songInstrumentNotes,
  takeInstruments,
} from "../schema/sqlite/index.js";
import { chunk } from "./chunk.js";

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
  return runRead(db, buildListRead(db, options));
}

/** `list`, planned for the caller's batch. */
export function buildListRead(db: Db, options: ListInstrumentsOptions = {}): Read<Instrument[]> {
  return readOne(
    db
      .select()
      .from(instruments)
      .where(options.includeArchived ? undefined : isNull(instruments.archivedAt))
      .orderBy(instruments.sortOrder),
    (rows) => rows,
  );
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
  // Its aliases go too, explicitly. The schema declares `ON DELETE cascade`
  // and that cascade never runs: `PRAGMA foreign_keys` is off here to match
  // D1, so the rows would simply be left pointing at an id that is gone — and
  // an orphaned alias is worse than a leak, because it still RESOLVES. The
  // next ingest run would map a slug onto a deleted instrument.
  await db.batch([
    db.delete(instrumentAliases).where(eq(instrumentAliases.instrumentId, id)),
    db.delete(instruments).where(eq(instruments.id, id)),
  ]);
}

// --- aliases ---------------------------------------------------------------

export type InstrumentAlias = typeof instrumentAliases.$inferSelect;

export interface AddAliasInput {
  instrumentId: string;
  slug: string;
  source: "manual" | "ingest";
}

export type AddAliasResult =
  | { kind: "ok"; alias: InstrumentAlias }
  /** The slug is already an instrument's own, or already an alias of one. */
  | { kind: "taken"; by: Instrument };

export async function listAliases(db: Db, instrumentId: string): Promise<InstrumentAlias[]> {
  return db
    .select()
    .from(instrumentAliases)
    .where(eq(instrumentAliases.instrumentId, instrumentId))
    .orderBy(instrumentAliases.slug);
}

export async function listAllAliases(db: Db): Promise<InstrumentAlias[]> {
  return db.select().from(instrumentAliases).orderBy(instrumentAliases.slug);
}

/**
 * Resolve a slug to an instrument, canonical name or alias.
 *
 * One namespace across two tables, which is the whole reason this exists as a
 * function rather than as a lookup somewhere: a caller that checks
 * `instruments.slug` alone will quietly fail to find an instrument that has
 * been merged away, and re-create the row the merge just removed.
 */
export async function findBySlug(db: Db, slug: string): Promise<Instrument | undefined> {
  const [own] = await db.select().from(instruments).where(eq(instruments.slug, slug)).limit(1);
  if (own) {
    return own;
  }
  const [alias] = await db
    .select()
    .from(instrumentAliases)
    .where(eq(instrumentAliases.slug, slug))
    .limit(1);
  if (!alias) {
    return undefined;
  }
  return getById(db, alias.instrumentId);
}

/**
 * Record another slug for an instrument.
 *
 * Refuses rather than throws when the slug is spoken for, and says BY WHAT —
 * the caller is either a human typing into a form or a merge, and both need
 * to name the instrument already holding it. The check covers instruments and
 * aliases together because they share one namespace; the UNIQUE index only
 * covers half of it.
 *
 * Not a transaction, and it does not need to be: the index is the backstop.
 * A racing writer means the insert throws, which is a crash rather than a
 * corrupted lookup — and the lookup is the thing that must never be wrong.
 */
export async function addAlias(db: Db, input: AddAliasInput): Promise<AddAliasResult> {
  const holder = await findBySlug(db, input.slug);
  if (holder) {
    return { kind: "taken", by: holder };
  }
  const [row] = await db
    .insert(instrumentAliases)
    .values({
      id: uuidv7(),
      instrumentId: input.instrumentId,
      slug: input.slug,
      source: input.source,
    })
    .returning();
  if (!row) {
    throw new Error("insert into instrument_aliases returned no row");
  }
  return { kind: "ok", alias: row };
}

export async function removeAlias(db: Db, aliasId: string): Promise<void> {
  await db.delete(instrumentAliases).where(eq(instrumentAliases.id, aliasId));
}

// --- merge -----------------------------------------------------------------

/**
 * What merging one instrument into another would cost.
 *
 * Most of a merge is free: a member who plays both, or a take that lists
 * both, simply stops listing one — nothing is lost, because "plays bass" was
 * already true. The two that are NOT free share a shape — a slot that only
 * one row can occupy — and both hold something a person made:
 *
 *   CHARTS   a song with a chart for each instrument. `song_instrument_notes`
 *            is keyed (song, instrument), so one of the two bodies of
 *            authored text has to go.
 *   STEMS    a take with a stem for each. `assets_slot_idx` is keyed
 *            (take, kind, instrument, tier), so one of two AUDIO FILES has to
 *            go — and its object in the bucket with it.
 *
 * Which is why this is planned before it is done. Nothing here writes; the
 * caller shows the plan, and a human decides whether losing those rows is
 * what they meant. The target always wins: you merge a source INTO a target,
 * so the target is the survivor in every sense, and the plan names exactly
 * what the source loses.
 */
export interface MergePlan {
  /** Source charts the target already has one for. Their bodies are lost. */
  chartSongIds: string[];
  /** Source assets whose slot the target already fills. The FILES are lost. */
  collidingAssetIds: string[];
  /** Non-colliding rows, which simply move across. */
  movedCharts: number;
  movedAssets: number;
  movedMembers: number;
  movedTakes: number;
}

export async function planMerge(db: Db, sourceId: string, targetId: string): Promise<MergePlan> {
  const [srcCharts, tgtCharts, srcAssets, tgtAssets, srcMembers, tgtMembers, srcTakes, tgtTakes] =
    await Promise.all([
      db
        .select({ songId: songInstrumentNotes.songId })
        .from(songInstrumentNotes)
        .where(eq(songInstrumentNotes.instrumentId, sourceId)),
      db
        .select({ songId: songInstrumentNotes.songId })
        .from(songInstrumentNotes)
        .where(eq(songInstrumentNotes.instrumentId, targetId)),
      db
        .select({ id: assets.id, takeId: assets.takeId, kind: assets.kind, tier: assets.tier })
        .from(assets)
        .where(eq(assets.instrumentId, sourceId)),
      db
        .select({ takeId: assets.takeId, kind: assets.kind, tier: assets.tier })
        .from(assets)
        .where(eq(assets.instrumentId, targetId)),
      db
        .select({ memberId: memberInstruments.memberId })
        .from(memberInstruments)
        .where(eq(memberInstruments.instrumentId, sourceId)),
      db
        .select({ memberId: memberInstruments.memberId })
        .from(memberInstruments)
        .where(eq(memberInstruments.instrumentId, targetId)),
      db
        .select({ takeId: takeInstruments.takeId })
        .from(takeInstruments)
        .where(eq(takeInstruments.instrumentId, sourceId)),
      db
        .select({ takeId: takeInstruments.takeId })
        .from(takeInstruments)
        .where(eq(takeInstruments.instrumentId, targetId)),
    ]);

  // Intersected here rather than in SQL: these are one instrument's rows, so
  // the sets are small, and the slot key is easier to get right in one place
  // than spread across four correlated subqueries.
  const targetSongs = new Set(tgtCharts.map((r) => r.songId));
  const chartSongIds = srcCharts.map((r) => r.songId).filter((id) => targetSongs.has(id));

  const slot = (r: { takeId: string; kind: string; tier: string }) =>
    `${r.takeId}\u0000${r.kind}\u0000${r.tier}`;
  const targetSlots = new Set(tgtAssets.map(slot));
  const collidingAssetIds = srcAssets.filter((r) => targetSlots.has(slot(r))).map((r) => r.id);

  const targetMembers = new Set(tgtMembers.map((r) => r.memberId));
  const targetTakes = new Set(tgtTakes.map((r) => r.takeId));

  return {
    chartSongIds,
    collidingAssetIds,
    movedCharts: srcCharts.length - chartSongIds.length,
    movedAssets: srcAssets.length - collidingAssetIds.length,
    movedMembers: srcMembers.filter((r) => !targetMembers.has(r.memberId)).length,
    movedTakes: srcTakes.filter((r) => !targetTakes.has(r.takeId)).length,
  };
}

/**
 * Fold one instrument into another and delete it.
 *
 * The plan is passed in rather than recomputed so that what a human approved
 * is what runs. Storage is NOT touched here — a repo has no business reaching
 * for a bucket, the same rule `songsRepo.remove` states — so the caller
 * deletes the objects for `collidingAssetIds` after this returns.
 *
 * The source's slug becomes an alias of the target, and the source's own
 * aliases move across. That is the point of the whole operation: without it
 * the next ingest run meets the old slug, finds nothing, and re-creates the
 * instrument that was just merged away.
 */
// D1 allows at most 100 bound parameters per statement (see `chunk.ts`). A
// merge's colliding/duplicate lists are sized by the SOURCE instrument's
// usage — a take id list, a member id list — which is caller-sized and can
// pass 100 on a heavily used instrument, so each delete below chunks its
// list. 99 where the chunk's statement also binds `sourceId` via `eq(...)`
// alongside the `inArray(...)`; 100 where the id list is the statement's
// only bound value. Each is pinned by a `.toSQL()` test in
// `batch-param-limit.test.ts`.
/** `inArray(songId)` plus `eq(instrumentId, sourceId)`. */
export const MERGE_CHART_CHUNK_SIZE = 99;
/** `inArray(id)` alone. */
export const MERGE_ASSET_CHUNK_SIZE = 100;
/** `inArray(memberId)` plus `eq(instrumentId, sourceId)`. */
export const MERGE_MEMBER_CHUNK_SIZE = 99;
/** `inArray(takeId)` plus `eq(instrumentId, sourceId)`. */
export const MERGE_TAKE_CHUNK_SIZE = 99;

/** One chunk of the colliding-chart delete in `mergeInto`. Exported for testing only. */
export function buildDeleteCollidingChartsChunkQuery(db: Db, sourceId: string, songIds: string[]) {
  return db
    .delete(songInstrumentNotes)
    .where(
      and(
        eq(songInstrumentNotes.instrumentId, sourceId),
        inArray(songInstrumentNotes.songId, songIds),
      ),
    );
}

/** One chunk of the colliding-asset delete in `mergeInto`. Exported for testing only. */
export function buildDeleteCollidingAssetsChunkQuery(db: Db, assetIds: string[]) {
  return db.delete(assets).where(inArray(assets.id, assetIds));
}

/** One chunk of the duplicate-member delete in `mergeInto`. Exported for testing only. */
export function buildDeleteDuplicateMembersChunkQuery(
  db: Db,
  sourceId: string,
  memberIds: string[],
) {
  return db
    .delete(memberInstruments)
    .where(
      and(
        eq(memberInstruments.instrumentId, sourceId),
        inArray(memberInstruments.memberId, memberIds),
      ),
    );
}

/** One chunk of the duplicate-take delete in `mergeInto`. Exported for testing only. */
export function buildDeleteDuplicateTakesChunkQuery(db: Db, sourceId: string, takeIds: string[]) {
  return db
    .delete(takeInstruments)
    .where(
      and(eq(takeInstruments.instrumentId, sourceId), inArray(takeInstruments.takeId, takeIds)),
    );
}

export async function mergeInto(
  db: Db,
  sourceId: string,
  targetId: string,
  plan: MergePlan,
): Promise<void> {
  const source = await getById(db, sourceId);
  if (!source) {
    return;
  }
  const collidingSongs = new Set(plan.chartSongIds);
  const collidingAssets = new Set(plan.collidingAssetIds);

  // Read the join rows the target already holds, so the source's duplicates
  // can be DELETED rather than repointed into a primary-key collision.
  const [tgtMembers, tgtTakes] = await Promise.all([
    db
      .select({ memberId: memberInstruments.memberId })
      .from(memberInstruments)
      .where(eq(memberInstruments.instrumentId, targetId)),
    db
      .select({ takeId: takeInstruments.takeId })
      .from(takeInstruments)
      .where(eq(takeInstruments.instrumentId, targetId)),
  ]);
  const targetMembers = tgtMembers.map((r) => r.memberId);
  const targetTakes = tgtTakes.map((r) => r.takeId);

  // One batch, so the whole fold is one transaction: a merge that half
  // happened would leave charts and audio deleted with the instrument still
  // standing.
  //
  // `db.batch` wants a NON-EMPTY tuple, which an array built conditionally
  // cannot satisfy at the type level even though the unconditional block
  // below guarantees it. One cast, here, rather than splitting this into two
  // batches that could tear.
  type BatchStatement = Parameters<typeof db.batch>[0][number];
  const statements: BatchStatement[] = [];

  // 1. The rows that cannot survive, gone first — so nothing below can land
  //    on a slot they still occupy. Each list is chunked (see the size
  //    constants above): a heavily-used instrument can carry well past 100
  //    colliding songs, assets, members or takes, and D1 would reject a
  //    single statement built from the whole list. Still all one `db.batch`
  //    call below, so the extra statements stay in the same transaction.
  for (const ids of chunk([...collidingSongs], MERGE_CHART_CHUNK_SIZE)) {
    statements.push(buildDeleteCollidingChartsChunkQuery(db, sourceId, ids));
  }
  for (const ids of chunk([...collidingAssets], MERGE_ASSET_CHUNK_SIZE)) {
    statements.push(buildDeleteCollidingAssetsChunkQuery(db, ids));
  }
  for (const ids of chunk(targetMembers, MERGE_MEMBER_CHUNK_SIZE)) {
    statements.push(buildDeleteDuplicateMembersChunkQuery(db, sourceId, ids));
  }
  for (const ids of chunk(targetTakes, MERGE_TAKE_CHUNK_SIZE)) {
    statements.push(buildDeleteDuplicateTakesChunkQuery(db, sourceId, ids));
  }

  // 2. Everything left over moves across.
  statements.push(
    db
      .update(songInstrumentNotes)
      .set({ instrumentId: targetId })
      .where(eq(songInstrumentNotes.instrumentId, sourceId)),
    db.update(assets).set({ instrumentId: targetId }).where(eq(assets.instrumentId, sourceId)),
    db
      .update(memberInstruments)
      .set({ instrumentId: targetId })
      .where(eq(memberInstruments.instrumentId, sourceId)),
    db
      .update(takeInstruments)
      .set({ instrumentId: targetId })
      .where(eq(takeInstruments.instrumentId, sourceId)),
    // 3. Its aliases move too, and its own slug becomes one. Before the
    //    delete below, which would otherwise take them with it.
    db
      .update(instrumentAliases)
      .set({ instrumentId: targetId })
      .where(eq(instrumentAliases.instrumentId, sourceId)),
    db
      .insert(instrumentAliases)
      .values({ id: uuidv7(), instrumentId: targetId, slug: source.slug, source: "manual" }),
    db.delete(instruments).where(eq(instruments.id, sourceId)),
  );

  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
}
