import { normalizeTitle, uuidv7 } from "@bandplate/core";
import { type SQL, and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  favorites,
  instruments,
  songAliases,
  songChartChanges,
  songInstrumentNotes,
  songs,
  takes,
} from "../schema/sqlite/index.js";
import { escapeLikePattern } from "./like-pattern.js";
import { DEFAULT_PAGE_SIZE, type PageArgs, type Paged } from "./pagination.js";
import { bandTakeCondition } from "./take-visibility.js";
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
    chartNotifiedAt: null,
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

/**
 * Builds (does not execute) one `songs` insert, for a caller that needs to
 * fold it into a `db.batch([...])` alongside another write —
 * `createSong` batches this with `notificationsRepo.buildRecordChartChange`
 * so the song and the "who created it" row land atomically. Constructs the
 * row locally rather than using `.returning()`, the same reason
 * `createWithAlias` does: a `db.batch` statement's own result isn't read
 * back mid-batch, and the id is client-generated (uuidv7) anyway.
 */
export function buildCreateStatement(db: Db, input: CreateSongInput) {
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
    chartNotifiedAt: null,
  };
  const statement = db.insert(songs).values(row);
  return { id, row, statement };
}

export interface UpdateSongInput {
  title?: string;
  tempoBpm?: number | null;
  musicalKey?: string | null;
  chordProgression?: string | null;
  lyrics?: string | null;
  notes?: string | null;
  isStub?: boolean;
  /** `null` unarchives; a number archives at that timestamp. */
  archivedAt?: number | null;
  updatedAt: number;
}

/**
 * Write only the keys the caller supplied — a member editing lyrics cannot
 * silently blank the chords.
 *
 * Two fields are deliberately NOT in the input:
 *
 * `titleNorm` is DERIVED here whenever `title` changes, never accepted, so it
 * cannot drift from the title it is supposed to normalize — the same rule
 * `create` and `createWithAlias` already follow. It is UNIQUE, so a rename
 * onto another song's normalized title throws; callers pre-check with
 * `findByTitleNorm` for a friendly field error and catch the throw as the
 * race fallback, the shape `resolveSong` already uses.
 *
 * `slug` is absent because it is allocated once at creation and a rename
 * never changes it. `/songs/[slug]` is the URL: regenerating it on a title
 * edit would silently break every link and bookmark that already exists, and
 * there is no redirect table to catch them. A song whose title has been fixed
 * keeps its original slug, which is mildly ugly and reliably correct.
 */
/**
 * Builds (does not execute) the same update `update` runs — for a caller
 * that needs to fold it into a `db.batch([...])` alongside another write
 * (`updateSong` batches this with
 * `notificationsRepo.buildRecordChartChange`).
 */
export function buildUpdateStatement(db: Db, id: string, input: UpdateSongInput) {
  const { title, ...rest } = input;
  const values = title === undefined ? rest : { ...rest, title, titleNorm: normalizeTitle(title) };
  return db.update(songs).set(values).where(eq(songs.id, id));
}

export async function update(db: Db, id: string, input: UpdateSongInput): Promise<void> {
  await buildUpdateStatement(db, id, input);
}

/**
 * A LOOKUP, not a listing: archived songs must still render at their own URL.
 * A take of an archived song links here, and 404ing a link that works is
 * worse than a page carrying an "Archived" banner. Same reasoning as
 * `getById`/`getByIds` below, and the mirror of `listWithStats`, which does
 * filter because it is a browse surface.
 */
export async function getBySlug(db: Db, slug: string): Promise<Song | undefined> {
  const [row] = await db.select().from(songs).where(eq(songs.slug, slug)).limit(1);
  return row;
}

export async function getById(db: Db, id: string): Promise<Song | undefined> {
  const [row] = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
  return row;
}

/**
 * Batch LOOKUP — avoids one round trip per row when rendering an event's take
 * list. Does not filter archived rows: these resolve a song a take already
 * points at, and filtering would blank the title on a live take row.
 */
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

export interface ListSongsOptions {
  /** Archived songs are a browse-surface omission, so listings exclude them by default. */
  includeArchived?: boolean;
}

/** Alphabetical by normalized title — SQLite row order is not contractual otherwise. */
export async function list(db: Db, options: ListSongsOptions = {}): Promise<Song[]> {
  return db
    .select()
    .from(songs)
    .where(options.includeArchived ? undefined : isNull(songs.archivedAt))
    .orderBy(songs.titleNorm);
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
  /** Archived songs are a browse-surface omission, so listings exclude them by default. */
  includeArchived?: boolean;
  /** Only songs that ARE archived — the archive pill's own view. */
  onlyArchived?: boolean;
  /** Which page to return. Omitted means the FIRST page — never all of them. */
  page?: PageArgs;
}

/**
 * The conditions both the page query and its count run against, built once —
 * see `takesRepo.searchConditions` for why this is not two copies.
 *
 * The instrument filter is a SUBQUERY over the same condition
 * `takesRepo.listByInstruments` uses. It was a pre-pass that fetched every
 * matching take, projected its song ids into a `Set`, and fed them back as an
 * `inArray` — which grew the bound-parameter list with the archive and made a
 * pushed-down `count(*)` impossible. See `takesRepo.hasAllInstruments`.
 */
function songConditions(db: Db, options: ListWithStatsOptions): SQL[] {
  const conditions: SQL[] = [];
  if (options.search) {
    const pattern = `%${escapeLikePattern(normalizeTitle(options.search))}%`;
    conditions.push(sql`${songs.titleNorm} LIKE ${pattern} ESCAPE '\\'`);
  }
  if (options.instrumentIds && options.instrumentIds.length > 0) {
    conditions.push(
      inArray(
        songs.id,
        db
          .select({ songId: takes.songId })
          .from(takes)
          .where(and(takesRepo.hasAllInstruments(db, options.instrumentIds), bandTakeCondition())),
      ),
    );
  }
  if (options.onlyArchived) {
    conditions.push(isNotNull(songs.archivedAt));
  } else if (!options.includeArchived) {
    conditions.push(isNull(songs.archivedAt));
  }
  return conditions;
}

/** How many songs match — the library's total, and the Archived pill's badge. */
export async function count(db: Db, options: ListWithStatsOptions = {}): Promise<number> {
  const conditions = songConditions(db, options);
  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(songs)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  return rows[0]?.value ?? 0;
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
): Promise<Paged<SongWithStats>> {
  const conditions = songConditions(db, options);
  const limit = options.page?.limit ?? DEFAULT_PAGE_SIZE;
  const offset = options.page?.offset ?? 0;

  // `titleNorm` is always the secondary key: `recent`/`takes` tie constantly
  // (several songs share a take count, or share "never played" — a null
  // `lastPlayedAt`), and `Array.sort`'s stability doesn't help when the
  // *input* order (SQLite's `GROUP BY` row order for tied rows) is itself
  // not contractual — confirmed by re-running `sort=takes` against seeded
  // data and observing the tied songs' order vary. SQLite treats NULL as
  // the lowest value, so `ORDER BY max(...) DESC` already puts a
  // never-played song last without a separate NULLS LAST clause.
  //
  // It is also what makes this query safe to PAGE: `titleNorm` is uniquely
  // indexed, so every ordering here is total and a row cannot drift between
  // pages. Nothing further is needed — see `pagination.ts`'s ordering rule.
  const sort = options.sort ?? "title";
  const orderBy =
    sort === "recent"
      ? [desc(sql`max(${takes.recordedAt})`), songs.titleNorm]
      : sort === "takes"
        ? [desc(sql`count(${takes.id})`), songs.titleNorm]
        : [songs.titleNorm];

  // `and()` of an empty list is `undefined`, which `.where()` treats as no
  // filter — so one query builder covers every combination of search,
  // instrument and archived filters.
  const [rows, total] = await Promise.all([
    db
      .select({
        song: songs,
        takeCount: sql<number>`count(${takes.id})`,
        lastPlayedAt: sql<number | null>`max(${takes.recordedAt})`,
      })
      .from(songs)
      .leftJoin(takes, and(eq(takes.songId, songs.id), bandTakeCondition()))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(songs.id)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    count(db, options),
  ]);

  return {
    rows: rows.map((row) => ({
      ...row.song,
      takeCount: row.takeCount,
      lastPlayedAt: row.lastPlayedAt,
    })),
    total,
  };
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

/**
 * Delete a song and everything that belongs to it ALONE — its aliases, its
 * per-instrument notes, its chart-change history, and every member's pin on
 * it.
 *
 * Its TAKES are not touched here, and that is deliberate: a take owns audio
 * objects in the bucket, and a repo has no business reaching for storage. The
 * caller deletes the takes first (each through `takesRepo.remove`, which also
 * takes their votes and pins) and then calls this. `deleteSong` in
 * `apps/web/src/server/pages/songs.ts` is that caller, and it is the only one.
 *
 * Explicit deletes rather than the schema's `ON DELETE CASCADE`: FKs are never
 * enforced here — `PRAGMA foreign_keys` stays off so behaviour matches D1,
 * which does not enforce them either — so a cascade would silently do nothing.
 */
export async function remove(db: Db, id: string): Promise<void> {
  await db.batch([
    db.delete(songAliases).where(eq(songAliases.songId, id)),
    db.delete(songInstrumentNotes).where(eq(songInstrumentNotes.songId, id)),
    db.delete(songChartChanges).where(eq(songChartChanges.songId, id)),
    db.delete(favorites).where(and(eq(favorites.targetType, "song"), eq(favorites.targetId, id))),
    db.delete(songs).where(eq(songs.id, id)),
  ]);
}

/**
 * Drop one alias. Deliberately NOT a replace-all `setAliases`: an alias with
 * `source: "ingest"` is what makes the bridge match this song instead of
 * re-creating it as a stub on the next run (contract v1 §6, case 1), so a
 * human saving an edit form must not be able to sweep one away as a side
 * effect. Removing an alias is its own explicit act.
 */
export async function removeAlias(db: Db, aliasId: string): Promise<void> {
  await db.delete(songAliases).where(eq(songAliases.id, aliasId));
}
