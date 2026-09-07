import { normalizeTitle, uuidv7 } from "@bandplate/core";
import { type SQL, and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  instruments,
  songAliases,
  songInstrumentNotes,
  songs,
  takes,
} from "../schema/sqlite/index.js";
import { escapeLikePattern } from "./like-pattern.js";
import * as takesRepo from "./takes.js";

export type Song = typeof songs.$inferSelect;
export type SongAlias = typeof songAliases.$inferSelect;
export type SongAliasSource = SongAlias["source"];
export type SongInstrumentNote = typeof songInstrumentNotes.$inferSelect;

export interface CreateSongInput {
  title: string;
  slug: string;
  tempoBpm?: number | null;
  musicalKey?: string | null;
  chordProgression?: string | null;
  lyrics?: string | null;
  notes?: string | null;
  isStub?: boolean;
  createdAt: number;
  updatedAt: number;
}

export async function create(db: Db, input: CreateSongInput): Promise<Song> {
  const [row] = await db
    .insert(songs)
    .values({
      id: uuidv7(),
      title: input.title,
      titleNorm: normalizeTitle(input.title),
      slug: input.slug,
      tempoBpm: input.tempoBpm ?? null,
      musicalKey: input.musicalKey ?? null,
      chordProgression: input.chordProgression ?? null,
      lyrics: input.lyrics ?? null,
      notes: input.notes ?? null,
      isStub: input.isStub ?? false,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .returning();

  if (!row) {
    throw new Error("insert into songs returned no row");
  }
  return row;
}

/**
 * Creates a song and one alias in a single `db.batch([...])` — used by
 * ingest to create a stub song and immediately record the take's
 * `song.externalRef` as an alias in one atomic step (contract v1 §6, case
 * 4), so a crash between the two inserts can never leave a stub with no
 * alias for later ingests to match on. The row returned is the one
 * constructed locally, matching `create`'s own pattern (`takesRepo.create`
 * does the same for its take+take_instruments batch) rather than reading
 * it back, since the id is client-generated (uuidv7) and D1 has no
 * interactive transactions to read-then-write safely within.
 */
export async function createWithAlias(
  db: Db,
  input: CreateSongInput,
  alias?: { value: string; source: SongAliasSource },
): Promise<Song> {
  const id = uuidv7();
  const row: Song = {
    id,
    title: input.title,
    titleNorm: normalizeTitle(input.title),
    slug: input.slug,
    tempoBpm: input.tempoBpm ?? null,
    musicalKey: input.musicalKey ?? null,
    chordProgression: input.chordProgression ?? null,
    lyrics: input.lyrics ?? null,
    notes: input.notes ?? null,
    isStub: input.isStub ?? false,
    archivedAt: null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };

  const insertSong = db.insert(songs).values(row);
  if (alias) {
    const aliasRow = {
      id: uuidv7(),
      songId: id,
      aliasNorm: normalizeTitle(alias.value),
      source: alias.source,
    };
    await db.batch([insertSong, db.insert(songAliases).values(aliasRow)]);
  } else {
    await insertSong;
  }

  return row;
}

export async function getBySlug(db: Db, slug: string): Promise<Song | undefined> {
  const [row] = await db.select().from(songs).where(eq(songs.slug, slug)).limit(1);
  return row;
}

export async function getById(db: Db, id: string): Promise<Song | undefined> {
  const [row] = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
  return row;
}

/** Batch lookup — avoids one round trip per row when rendering an event's take list. */
export async function getByIds(db: Db, ids: string[]): Promise<Song[]> {
  if (ids.length === 0) {
    return [];
  }
  return db.select().from(songs).where(inArray(songs.id, ids));
}

export async function findByTitleNorm(db: Db, titleNorm: string): Promise<Song | undefined> {
  const [row] = await db.select().from(songs).where(eq(songs.titleNorm, titleNorm)).limit(1);
  return row;
}

/** Resolve a song via a normalized alias (manual or ingest-created). */
export async function findByAlias(db: Db, aliasNorm: string): Promise<Song | undefined> {
  const [row] = await db
    .select({ song: songs })
    .from(songAliases)
    .innerJoin(songs, eq(songs.id, songAliases.songId))
    .where(eq(songAliases.aliasNorm, aliasNorm))
    .limit(1);
  return row?.song;
}

/** Alphabetical by normalized title — SQLite row order is not contractual otherwise. */
export async function list(db: Db): Promise<Song[]> {
  return db.select().from(songs).orderBy(songs.titleNorm);
}

export interface SongWithStats extends Song {
  /** Number of takes recorded of this song, across all events. */
  takeCount: number;
  /** `recordedAt` of the most recent take, or `null` for a song with none. */
  lastPlayedAt: number | null;
}

export type SongSort = "title" | "recent" | "takes";

export interface ListWithStatsOptions {
  /** Case/diacritic-insensitive substring match against the title. */
  search?: string;
  /**
   * Restrict to songs that have at least one take carrying ALL of these
   * instruments (AND semantics — delegates to `takes.listByInstruments`,
   * the one place that logic is tested, rather than re-deriving it here).
   */
  instrumentIds?: string[];
  sort?: SongSort;
}

/**
 * The library view's backing query: every song plus its take count and last
 * time it was played, searchable by title and filterable by instrument.
 * Sorting (including the tie-break below) happens in SQL, not a post-fetch
 * JS re-sort — the database already has to group and aggregate this data,
 * so it does the one sort too rather than the result being re-walked in JS.
 */
export async function listWithStats(
  db: Db,
  options: ListWithStatsOptions = {},
): Promise<SongWithStats[]> {
  let songIdFilter: Set<string> | undefined;
  if (options.instrumentIds && options.instrumentIds.length > 0) {
    const matchingTakes = await takesRepo.listByInstruments(db, options.instrumentIds);
    songIdFilter = new Set(matchingTakes.map((t) => t.songId));
    if (songIdFilter.size === 0) {
      return [];
    }
  }

  const conditions: SQL[] = [];
  if (options.search) {
    const pattern = `%${escapeLikePattern(normalizeTitle(options.search))}%`;
    conditions.push(sql`${songs.titleNorm} LIKE ${pattern} ESCAPE '\\'`);
  }
  if (songIdFilter) {
    conditions.push(inArray(songs.id, [...songIdFilter]));
  }

  const base = db
    .select({
      song: songs,
      takeCount: sql<number>`count(${takes.id})`,
      lastPlayedAt: sql<number | null>`max(${takes.recordedAt})`,
    })
    .from(songs)
    .leftJoin(takes, eq(takes.songId, songs.id));

  // `titleNorm` is always the secondary key: `recent`/`takes` tie constantly
  // (several songs share a take count, or share "never played" — a null
  // `lastPlayedAt`), and `Array.sort`'s stability doesn't help when the
  // *input* order (SQLite's `GROUP BY` row order for tied rows) is itself
  // not contractual — confirmed by re-running `sort=takes` against seeded
  // data and observing the tied songs' order vary. SQLite treats NULL as
  // the lowest value, so `ORDER BY max(...) DESC` already puts a
  // never-played song last without a separate NULLS LAST clause.
  const sort = options.sort ?? "title";
  const orderBy =
    sort === "recent"
      ? [desc(sql`max(${takes.recordedAt})`), songs.titleNorm]
      : sort === "takes"
        ? [desc(sql`count(${takes.id})`), songs.titleNorm]
        : [songs.titleNorm];

  const rows =
    conditions.length > 0
      ? await base
          .where(and(...conditions))
          .groupBy(songs.id)
          .orderBy(...orderBy)
      : await base.groupBy(songs.id).orderBy(...orderBy);

  return rows.map((row) => ({
    ...row.song,
    takeCount: row.takeCount,
    lastPlayedAt: row.lastPlayedAt,
  }));
}

/** Every known alias of a song (manual or ingest-created), in no particular order. */
export async function listAliases(db: Db, songId: string): Promise<SongAlias[]> {
  return db.select().from(songAliases).where(eq(songAliases.songId, songId));
}

export interface InstrumentNote {
  instrumentId: string;
  instrumentLabel: string;
  body: string;
  updatedAt: number;
}

/** Per-instrument playing notes for a song, ordered by the instrument's sort order. */
export async function listInstrumentNotes(db: Db, songId: string): Promise<InstrumentNote[]> {
  const rows = await db
    .select({
      instrumentId: songInstrumentNotes.instrumentId,
      instrumentLabel: instruments.label,
      body: songInstrumentNotes.body,
      updatedAt: songInstrumentNotes.updatedAt,
      sortOrder: instruments.sortOrder,
    })
    .from(songInstrumentNotes)
    .innerJoin(instruments, eq(instruments.id, songInstrumentNotes.instrumentId))
    .where(eq(songInstrumentNotes.songId, songId))
    .orderBy(instruments.sortOrder);

  return rows.map(({ sortOrder: _sortOrder, ...rest }) => rest);
}

/** Upserts a per-instrument playing note for a song (composite PK: song + instrument). */
export async function setInstrumentNote(
  db: Db,
  songId: string,
  instrumentId: string,
  body: string,
  updatedAt: number,
): Promise<void> {
  await db
    .insert(songInstrumentNotes)
    .values({ songId, instrumentId, body, updatedAt })
    .onConflictDoUpdate({
      target: [songInstrumentNotes.songId, songInstrumentNotes.instrumentId],
      set: { body, updatedAt },
    });
}

export async function addAlias(
  db: Db,
  songId: string,
  alias: string,
  source: SongAliasSource,
): Promise<SongAlias> {
  const [row] = await db
    .insert(songAliases)
    .values({
      id: uuidv7(),
      songId,
      aliasNorm: normalizeTitle(alias),
      source,
    })
    .returning();

  if (!row) {
    throw new Error("insert into song_aliases returned no row");
  }
  return row;
}
