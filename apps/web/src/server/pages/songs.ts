// `/songs` and `/songs/[slug]` page logic — the reads that back both pages,
// and (since M8) the form handlers that write them. The library list's search
// and sort are a plain GET form (works with JS off — see
// `songs/index.astro`); this module parses that query string and calls the one
// repo query that backs it, `songsRepo.listWithStats`.
//
// The write half lives HERE rather than in `@bandplate/core`, unlike
// `services/members.ts`. That file exists because two callers — a Hono route
// and an Astro page — had drifted apart, and pushing the rule down was the fix.
// Songs have exactly one front door: these pages. A schema in core with a
// single caller would be generality bought on speculation. What IS shared with
// the ingest routes — allocating a slug — already sits in
// `core/services/songs.ts`, because that genuinely has two callers.
//
// There is no instrument filter here any more. It asked "which songs have a
// take carrying all of these instruments", which is a fact about TAKES —
// `/search` filters takes and keeps it. On a page listing songs it was a
// dozen checkboxes answering a question about a different object, and on a
// phone it pushed the songs themselves below the fold.
import { allocateSongSlug, normalizeTitle } from "@bandplate/core";
import { type Db, assetsRepo } from "@bandplate/db";
import {
  eventsRepo,
  favoritesRepo,
  type instrumentsRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
import { z } from "zod";

export type SongListItem = songsRepo.SongWithStats;

export interface SongsListQuery {
  search?: string;
  sort?: songsRepo.SongSort;
  /**
   * Show archived songs INSTEAD of live ones, not in addition to them. The
   * Archived pill sits beside the sort pills and reads as a filter, and a
   * filter that adds rows rather than narrowing them would be the only one in
   * the app that does. It also makes the pill's own state legible: what you
   * are looking at is the archive, or it is the library.
   */
  archived?: boolean;
}

const VALID_SORTS: readonly songsRepo.SongSort[] = ["title", "recent", "takes"];

/** Parses `/songs`'s query string into the shape `listWithStats` expects. */
export function parseSongsListQuery(searchParams: URLSearchParams): SongsListQuery {
  const search = searchParams.get("q")?.trim() || undefined;
  const rawSort = searchParams.get("sort");
  const sort = VALID_SORTS.includes(rawSort as songsRepo.SongSort)
    ? (rawSort as songsRepo.SongSort)
    : undefined;
  const archived = searchParams.get("archived") === "1" ? true : undefined;
  return { search, sort, archived };
}

export async function listSongsForLibrary(db: Db, query: SongsListQuery): Promise<SongListItem[]> {
  const rows = await songsRepo.listWithStats(db, {
    search: query.search,
    sort: query.sort,
    includeArchived: query.archived === true,
  });
  // `includeArchived` widens the repo query to BOTH; the page wants only the
  // archived ones. Filtering here rather than adding an `onlyArchived` option
  // keeps the repo's vocabulary to the one thing every other caller needs.
  return query.archived === true ? rows.filter((r) => r.archivedAt !== null) : rows;
}

/** How many songs are archived — the Archived pill shows nothing when it is 0. */
export async function countArchivedSongs(db: Db): Promise<number> {
  const rows = await songsRepo.listWithStats(db, { includeArchived: true });
  return rows.filter((r) => r.archivedAt !== null).length;
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

// ---------------------------------------------------------------------------
// Writes (M8)
// ---------------------------------------------------------------------------

/**
 * A form always POSTs every field it renders, so an untouched optional input
 * arrives as `""` — which must become NULL, not an empty string. Without this
 * a song edited once would carry `musicalKey: ""`, which is not "no key": it
 * renders as an empty span where "No key or tempo" belongs.
 */
function optionalText(value: FormDataEntryValue | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/** Same, for a number. `z.coerce.number()` turns `""` into 0, which is a real tempo. */
function optionalNumber(value: FormDataEntryValue | null): string | undefined {
  const text = optionalText(value);
  return text === null ? undefined : text;
}

const titleSchema = z.string().trim().min(1, "Enter a title.").max(300);
const tempoSchema = z.coerce
  .number()
  .positive("Tempo has to be a positive number.")
  .max(400, "That tempo looks wrong — 400 bpm is the ceiling.")
  .optional();

const songFieldsSchema = z.object({
  title: titleSchema,
  musicalKey: z.string().trim().max(60).nullable(),
  tempoBpm: tempoSchema,
  chordProgression: z.string().trim().max(20_000).nullable(),
  lyrics: z.string().trim().max(50_000).nullable(),
  notes: z.string().trim().max(20_000).nullable(),
});

export type SongField =
  | "title"
  | "musicalKey"
  | "tempoBpm"
  | "chordProgression"
  | "lyrics"
  | "notes";

/** The two failures both `createSong` and `updateSong` can return. */
export type SongFormFailure =
  | { kind: "invalid"; error: string; field: SongField }
  /** A different song already normalizes to this title — `songs.title_norm` is UNIQUE. */
  | { kind: "duplicate"; existing: songsRepo.Song };

export type CreateSongResult = { kind: "ok"; song: songsRepo.Song } | SongFormFailure;

export type UpdateSongResult = { kind: "ok" } | { kind: "not_found" } | SongFormFailure;

function parseSongFields(formData: FormData) {
  return songFieldsSchema.safeParse({
    title: formData.get("title"),
    musicalKey: optionalText(formData.get("musicalKey")),
    tempoBpm: optionalNumber(formData.get("tempoBpm")),
    chordProgression: optionalText(formData.get("chordProgression")),
    lyrics: optionalText(formData.get("lyrics")),
    notes: optionalText(formData.get("notes")),
  });
}

function invalidSong(parsed: z.SafeParseError<unknown>): SongFormFailure {
  const issue = parsed.error.issues[0];
  return {
    kind: "invalid",
    error: issue?.message ?? "Invalid input.",
    field: (issue?.path[0] as SongField | undefined) ?? "title",
  };
}

/**
 * Create a song from the "Add song" sheet.
 *
 * The duplicate check runs twice, deliberately. Once up front, so the member
 * gets "Nightbus is already in the library" against the field rather than a
 * 500; and once as a catch, because `songs.title_norm` is UNIQUE and two
 * people adding the same song at the same rehearsal is not a hypothetical.
 * The catch converges on the winner, the same shape `resolveSong` and the
 * ingest routes already use for their own UNIQUE races.
 */
export async function createSong(
  db: Db,
  now: number,
  formData: FormData,
): Promise<CreateSongResult> {
  const parsed = parseSongFields(formData);
  if (!parsed.success) {
    return invalidSong(parsed);
  }

  const existing = await songsRepo.findByTitleNorm(db, normalizeTitle(parsed.data.title));
  if (existing) {
    return { kind: "duplicate", existing };
  }

  const slug = await allocateSongSlug(db, parsed.data.title);
  try {
    const song = await songsRepo.create(db, {
      title: parsed.data.title,
      slug,
      musicalKey: parsed.data.musicalKey,
      tempoBpm: parsed.data.tempoBpm ?? null,
      chordProgression: parsed.data.chordProgression,
      lyrics: parsed.data.lyrics,
      notes: parsed.data.notes,
      createdAt: now,
      updatedAt: now,
    });
    return { kind: "ok", song };
  } catch (err) {
    const winner = await songsRepo.findByTitleNorm(db, normalizeTitle(parsed.data.title));
    if (!winner) {
      throw err;
    }
    return { kind: "duplicate", existing: winner };
  }
}

/**
 * Save the edit sheet.
 *
 * Always clears `isStub`. A stub is ingest's guess — "a take named a title
 * nobody recognised" — and a member who has opened this sheet and pressed Save
 * has confirmed the song is real. Making it a checkbox instead would ask them
 * to understand an ingest concept to answer a question they have already
 * answered by being here.
 */
export async function updateSong(
  db: Db,
  now: number,
  id: string,
  formData: FormData,
): Promise<UpdateSongResult> {
  const parsed = parseSongFields(formData);
  if (!parsed.success) {
    return invalidSong(parsed);
  }

  const song = await songsRepo.getById(db, id);
  if (!song) {
    return { kind: "not_found" };
  }

  const titleNorm = normalizeTitle(parsed.data.title);
  if (titleNorm !== song.titleNorm) {
    const clash = await songsRepo.findByTitleNorm(db, titleNorm);
    if (clash && clash.id !== id) {
      return { kind: "duplicate", existing: clash };
    }
  }

  try {
    await songsRepo.update(db, id, {
      title: parsed.data.title,
      musicalKey: parsed.data.musicalKey,
      tempoBpm: parsed.data.tempoBpm ?? null,
      chordProgression: parsed.data.chordProgression,
      lyrics: parsed.data.lyrics,
      notes: parsed.data.notes,
      isStub: false,
      updatedAt: now,
    });
    return { kind: "ok" };
  } catch (err) {
    const clash = await songsRepo.findByTitleNorm(db, titleNorm);
    if (clash && clash.id !== id) {
      return { kind: "duplicate", existing: clash };
    }
    throw err;
  }
}

export type ArchiveSongResult = { kind: "ok"; song: songsRepo.Song } | { kind: "not_found" };

export async function setSongArchived(
  db: Db,
  now: number,
  id: string,
  archived: boolean,
): Promise<ArchiveSongResult> {
  const song = await songsRepo.getById(db, id);
  if (!song) {
    return { kind: "not_found" };
  }
  await songsRepo.update(db, id, { archivedAt: archived ? now : null, updatedAt: now });
  return { kind: "ok", song };
}

/**
 * What archiving this song costs, in one sentence.
 *
 * Exported because TWO surfaces say it: the `ConfirmDialog` island's
 * `data-confirm-body` on the edit sheet, and the no-JS confirm page. They are
 * the same warning and must not drift into two different promises about what
 * happens to the takes.
 *
 * A song with no takes says nothing about takes. "Its 0 takes stay" is
 * technically true and reads like a bug.
 */
export function archiveSongConsequence(takeCount: number): string {
  const head = "It disappears from the song library and from the picker when you add a take.";
  const takes =
    takeCount === 0
      ? ""
      : takeCount === 1
        ? " Its one take stays, keeps playing, and still turns up in search."
        : ` Its ${takeCount} takes stay, keep playing, and still turn up in search.`;
  const tail =
    " If the bridge uploads a take of it again it comes back on its own, and you can put it back by hand any time.";
  return `${head}${takes}${tail}`;
}
