// `/songs` and `/songs/[slug]` page logic. Read-only — no writes, no
// playback. The library list's search/sort/instrument-filter controls are a
// plain GET form (works with JS off — see `songs/index.astro`); this module
// parses that query string and calls the one repo query that backs it,
// `songsRepo.listWithStats`.
import { type Db, assetsRepo } from "@bandlib/db";
import {
  eventsRepo,
  favoritesRepo,
  type instrumentsRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandlib/db";

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
  /** See `assetsRepo.listPlayableMastersByTakeIds` — undefined means "no play control", not "disabled". */
  playableAssetId: string | undefined;
  /** `undefined` means this member hasn't voted on this take yet — see `TakeRow`'s own `myVote` prop. */
  myVote: boolean | undefined;
  favorited: boolean;
}

export interface SongDetail {
  song: songsRepo.Song;
  /** Whether THIS member has favorited the song itself (not any of its takes) — drives the hero's `FavoriteToggle`. */
  songFavorited: boolean;
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
export async function getSongDetail(
  db: Db,
  slug: string,
  memberId: string,
): Promise<SongDetail | undefined> {
  const song = await songsRepo.getBySlug(db, slug);
  if (!song) {
    return undefined;
  }

  const [aliases, instrumentNotes, takes, songFavorited] = await Promise.all([
    songsRepo.listAliases(db, song.id),
    songsRepo.listInstrumentNotes(db, song.id),
    takesRepo.listBySong(db, song.id),
    favoritesRepo.isFavorited(db, memberId, "song", song.id),
  ]);

  const takeIds = takes.map((t) => t.id);
  const eventIds = [...new Set(takes.map((t) => t.eventId))];
  const [instrumentsByTake, events, playableByTakeId, myVoteByTakeId, favoriteTakeIds] =
    await Promise.all([
      takesRepo.listInstrumentsForTakes(db, takeIds),
      eventsRepo.getByIds(db, eventIds),
      assetsRepo.listPlayableMastersByTakeIds(db, takeIds),
      votesRepo.listByMemberForTakes(db, memberId, takeIds),
      favoritesRepo.listTargetIdsByMember(db, memberId, "take"),
    ]);
  const eventById = new Map(events.map((e) => [e.id, e]));

  return {
    song,
    songFavorited,
    aliases,
    instrumentNotes,
    takes: takes.map((take) => ({
      ...take,
      instruments: instrumentsByTake.get(take.id) ?? [],
      event: eventById.get(take.eventId),
      playableAssetId: playableByTakeId.get(take.id)?.id,
      myVote: myVoteByTakeId.get(take.id),
      favorited: favoriteTakeIds.has(take.id),
    })),
  };
}
