import { normalizeTitle, uuidv7 } from "@bandlib/core";
import { eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { songAliases, songs } from "../schema/sqlite/index.js";

export type Song = typeof songs.$inferSelect;
export type SongAlias = typeof songAliases.$inferSelect;
export type SongAliasSource = SongAlias["source"];

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

export async function getBySlug(db: Db, slug: string): Promise<Song | undefined> {
  const [row] = await db.select().from(songs).where(eq(songs.slug, slug)).limit(1);
  return row;
}

export async function getById(db: Db, id: string): Promise<Song | undefined> {
  const [row] = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
  return row;
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

export async function list(db: Db): Promise<Song[]> {
  return db.select().from(songs);
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
