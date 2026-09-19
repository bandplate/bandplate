// The stash's page logic: the recorder's song list (here), and the stash
// view, the "Přidat k písni" page and its three actions (Task 10).
import type { Db } from "@bandplate/db";
import { songsRepo } from "@bandplate/db";
import type { SongOption } from "../../client/recorder-logic.js";

/** How many songs the picker loads. A band's repertoire is tens; this is a ceiling, not a page. */
const RECORDABLE_SONGS_LIMIT = 500;

/** How many songs the picker's "Recent" group names above the full list. */
export const RECENT_SONGS_LIMIT = 5;

export interface RecordableSongs {
  /** Every live song, by title. */
  songs: SongOption[];
  /**
   * The band's most recently played songs, most recent first. What the band is
   * working on now is what an idea is most likely about.
   */
  recentIds: string[];
}

/**
 * The picker's whole library in one query. The island filters and groups it
 * itself, so search works with no signal once the page has loaded.
 */
export async function listRecordableSongs(db: Db): Promise<RecordableSongs> {
  const { rows } = await songsRepo.listWithStats(db, {
    sort: "title",
    page: { limit: RECORDABLE_SONGS_LIMIT, offset: 0 },
  });
  const recentIds = rows
    .filter((song) => song.lastPlayedAt !== null)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    .slice(0, RECENT_SONGS_LIMIT)
    .map((song) => song.id);
  return {
    songs: rows.map((song) => ({ id: song.id, title: song.title, slug: song.slug })),
    recentIds,
  };
}

/** `?song=` from the song page's "Nahrát nápad": a slug, or an id from anywhere else. */
export async function resolvePreselectedSong(
  db: Db,
  param: string | null,
): Promise<SongOption | undefined> {
  if (!param) {
    return undefined;
  }
  const song = (await songsRepo.getBySlug(db, param)) ?? (await songsRepo.getById(db, param));
  return song ? { id: song.id, title: song.title, slug: song.slug } : undefined;
}
