// `/songs` and `/songs/[slug]` page logic. Read-only — no writes, no
// playback. The library list's search/sort/instrument-filter controls are a
// plain GET form (works with JS off — see `songs/index.astro`); this module
// parses that query string and calls the one repo query that backs it,
// `songsRepo.listWithStats`.
import type { Db } from "@bandlib/db";
import { eventsRepo, type instrumentsRepo, songsRepo, takesRepo } from "@bandlib/db";

export type SongListItem = songsRepo.SongWithStats;

export interface SongsListQuery {
  search?: string;
  sort?: songsRepo.SongSort;
  instrumentIds: string[];
}

const VALID_SORTS: readonly songsRepo.SongSort[] = ["title", "recent", "takes"];

/** Parses `/songs`'s query string into the shape `listWithStats` expects. */
export function parseSongsListQuery(searchParams: URLSearchParams): SongsListQuery {
  const search = searchParams.get("q")?.trim() || undefined;
  const rawSort = searchParams.get("sort");
  const sort = VALID_SORTS.includes(rawSort as songsRepo.SongSort)
    ? (rawSort as songsRepo.SongSort)
    : undefined;
  // Dedupe: takes.listByInstruments (which listWithStats delegates to for
  // the filter) returns nothing at all if the same id appears twice.
  const instrumentIds = [...new Set(searchParams.getAll("instrument").filter(Boolean))];
  return { search, sort, instrumentIds };
}

export async function listSongsForLibrary(db: Db, query: SongsListQuery): Promise<SongListItem[]> {
  return songsRepo.listWithStats(db, {
    search: query.search,
    sort: query.sort,
    instrumentIds: query.instrumentIds,
  });
}

export interface TakeWithContext extends takesRepo.Take {
  instruments: instrumentsRepo.Instrument[];
  event: eventsRepo.Event | undefined;
}

export interface SongDetail {
  song: songsRepo.Song;
  aliases: songsRepo.SongAlias[];
  instrumentNotes: songsRepo.InstrumentNote[];
  takes: TakeWithContext[];
}

/**
 * Everything `/songs/[slug]` renders in one call: the song, its aliases and
 * per-instrument notes, and every take (newest first) with the instruments
 * and event each one needs to render — all batch-fetched (one query per
 * kind of data, not one per take) rather than N+1.
 */
export async function getSongDetail(db: Db, slug: string): Promise<SongDetail | undefined> {
  const song = await songsRepo.getBySlug(db, slug);
  if (!song) {
    return undefined;
  }

  const [aliases, instrumentNotes, takes] = await Promise.all([
    songsRepo.listAliases(db, song.id),
    songsRepo.listInstrumentNotes(db, song.id),
    takesRepo.listBySong(db, song.id),
  ]);

  const takeIds = takes.map((t) => t.id);
  const eventIds = [...new Set(takes.map((t) => t.eventId))];
  const [instrumentsByTake, events] = await Promise.all([
    takesRepo.listInstrumentsForTakes(db, takeIds),
    eventsRepo.getByIds(db, eventIds),
  ]);
  const eventById = new Map(events.map((e) => [e.id, e]));

  return {
    song,
    aliases,
    instrumentNotes,
    takes: takes.map((take) => ({
      ...take,
      instruments: instrumentsByTake.get(take.id) ?? [],
      event: eventById.get(take.eventId),
    })),
  };
}
