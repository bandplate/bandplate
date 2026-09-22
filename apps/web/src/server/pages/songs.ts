import {
  allocateSongSlug,
  chartChanged,
  describeError,
  logError,
  normalizeTitle,
  type Storage,
} from "@bandplate/core";
import {
  assetsRepo,
  type Db,
  eventsRepo,
  favoritesRepo,
  type instrumentsRepo,
  membersRepo,
  notificationsRepo,
  type PageArgs,
  type Paged,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
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
import { formatBytes, type Locale, messages } from "@bandplate/i18n";
import { z } from "zod";
import { getStashRows, type StashRowData } from "./stash.js";

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

/** Rows per page in the song library. */
export const SONGS_PER_PAGE = 25;

export async function listSongsForLibrary(
  db: Db,
  query: SongsListQuery,
  page: PageArgs,
): Promise<Paged<SongListItem>> {
  // `onlyArchived` is a repo option now rather than a `.filter()` here. It had
  // to become one: the old shape asked for BOTH sets and dropped the live ones
  // in JS, which cannot be paged (the page would be however many of its 25
  // rows happened to be archived) and cannot be counted.
  return songsRepo.listWithStats(db, {
    search: query.search,
    sort: query.sort,
    onlyArchived: query.archived === true,
    page,
  });
}

/** How many songs are archived — the Archived pill shows nothing when it is 0. */
export async function countArchivedSongs(db: Db): Promise<number> {
  return songsRepo.count(db, { onlyArchived: true });
}

export interface TakeWithContext extends takesRepo.Take {
  instruments: instrumentsRepo.Instrument[];
  event: eventsRepo.Event | undefined;
  /** See `assetsRepo.listPlayableMastersByTakeIds` — undefined means "no play control", not "disabled". */
  playableAssetId: string | undefined;
  /** `undefined` means this member hasn't voted on this take yet — see `TakeRow`'s own `myVote` prop. */
  myVote: boolean | undefined;
  favorited: boolean;
  /** The recording member's name, for a personal recording. Null for a band take. */
  ownerName: string | null;
}

export interface SongDetail {
  song: songsRepo.Song;
  /** Whether THIS member has favorited the song itself (not any of its takes) — drives the hero's `FavoriteToggle`. */
  songFavorited: boolean;
  aliases: songsRepo.SongAlias[];
  instrumentNotes: songsRepo.InstrumentNote[];
  /** ONE PAGE of takes, newest first, plus how many the song has in all. */
  takes: TakeWithContext[];
  takeTotal: number;
  /**
   * This member's own private takes of this song, full rows for the song
   * page's own stash section. `takesRepo.listStash` is scoped by owner AND
   * `visibility='private'` already, so this never carries another member's
   * recording — see `songs.test.ts`'s "another member sees none" case.
   *
   * No separate count beside it: the section draws every row it is given
   * (a member's stash of ONE song is small), so `stashRows.length` IS the
   * count, and a second field saying so could only ever disagree.
   */
  stashRows: StashRowData[];
  /** This member's own display name — every `stashRows` row is theirs, so it's asked once for the item sheet. */
  stashOwnerName: string | undefined;
}

/**
 * Rows per page in a song's take list.
 *
 * Smaller than the archive's page: this list sits below the lyrics and chords
 * on a page whose subject is the SONG, and a take list that runs longer than
 * the thing it belongs to has taken the page over. It is also what the
 * three-take fold above it was already saying.
 */
export const SONG_TAKES_PER_PAGE = 15;

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
  takesPage: PageArgs = { limit: SONG_TAKES_PER_PAGE, offset: 0 },
): Promise<SongDetail | undefined> {
  const song = await songsRepo.getBySlug(db, slug);
  if (!song) {
    return undefined;
  }

  const [aliases, instrumentNotes, pagedTakes, songFavorited, stashRows] = await Promise.all([
    songsRepo.listAliases(db, song.id),
    songsRepo.listInstrumentNotes(db, song.id),
    takesRepo.listBySong(db, song.id, { page: takesPage }),
    favoritesRepo.isFavorited(db, memberId, "song", song.id),
    getStashRows(db, memberId, { songId: song.id }),
  ]);
  const takes = pagedTakes.rows;

  const takeIds = takes.map((t) => t.id);
  const eventIds = [...new Set(takes.map((t) => t.eventId))];
  const ownerIds = [
    // `memberId` itself, so `ownerNameById` below also answers the stash
    // section's "Kdo nahrál" without a second lookup — every `stashRows` row
    // is this member's own.
    ...new Set([
      ...takes.map((t) => t.ownerMemberId).filter((id): id is string => id !== null),
      memberId,
    ]),
  ];
  const [instrumentsByTake, events, playableByTakeId, myVoteByTakeId, favoriteTakeIds, owners] =
    await Promise.all([
      takesRepo.listInstrumentsForTakes(db, takeIds),
      eventsRepo.getByIds(db, eventIds),
      assetsRepo.listPlayableMastersByTakeIds(db, takeIds),
      votesRepo.listByMemberForTakes(db, memberId, takeIds),
      favoritesRepo.listTargetIdsByMember(db, memberId, "take"),
      membersRepo.getByIds(db, ownerIds),
    ]);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const ownerNameById = new Map(owners.map((m) => [m.id, m.displayName]));

  return {
    song,
    songFavorited,
    aliases,
    instrumentNotes,
    takeTotal: pagedTakes.total,
    stashRows,
    stashOwnerName: ownerNameById.get(memberId),
    takes: takes.map((take) => ({
      ...take,
      instruments: instrumentsByTake.get(take.id) ?? [],
      event: eventById.get(take.eventId),
      playableAssetId: playableByTakeId.get(take.id)?.id,
      myVote: myVoteByTakeId.get(take.id),
      favorited: favoriteTakeIds.has(take.id),
      ownerName: take.ownerMemberId ? (ownerNameById.get(take.ownerMemberId) ?? null) : null,
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

const titleSchema = z.string().trim().min(1, "titleRequired").max(300);
const tempoSchema = z.coerce.number().positive("tempoPositive").max(400, "tempoCeiling").optional();

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
    error: issue?.message ?? "generic",
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
  memberId: string,
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
    const { row: song, statement } = songsRepo.buildCreateStatement(db, {
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
    // Same batch as the insert — see `notificationsRepo.buildRecordChartChange`'s
    // doc comment for why this must land atomically with the song row.
    await db.batch([
      statement,
      notificationsRepo.buildRecordChartChange(db, {
        songId: song.id,
        memberId,
        kind: "created",
        changedAt: now,
      }),
    ]);
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
  memberId: string,
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

  const updateInput: songsRepo.UpdateSongInput = {
    title: parsed.data.title,
    musicalKey: parsed.data.musicalKey,
    tempoBpm: parsed.data.tempoBpm ?? null,
    chordProgression: parsed.data.chordProgression,
    lyrics: parsed.data.lyrics,
    notes: parsed.data.notes,
    isStub: false,
    updatedAt: now,
  };

  // A stub promotion counts as "created" — it's the first time anyone has
  // confirmed this song is real — regardless of whether the chart text
  // itself changed. Otherwise only an actual chord/lyrics change (by
  // content, not bytes — see `chartChanged`) is worth telling the rest of
  // the band about; a title/key/tempo/notes-only edit records nothing.
  const kind: "created" | "edited" | undefined = song.isStub
    ? "created"
    : chartChanged(
          { chordProgression: song.chordProgression, lyrics: song.lyrics },
          { chordProgression: parsed.data.chordProgression, lyrics: parsed.data.lyrics },
        )
      ? "edited"
      : undefined;

  try {
    if (kind) {
      // Same batch as the update — see `notificationsRepo.buildRecordChartChange`'s
      // doc comment for why this must land atomically with the song row.
      await db.batch([
        songsRepo.buildUpdateStatement(db, id, updateInput),
        notificationsRepo.buildRecordChartChange(db, {
          songId: id,
          memberId,
          kind,
          changedAt: now,
        }),
      ]);
    } else {
      await songsRepo.update(db, id, updateInput);
    }
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
export function archiveSongConsequence(takeCount: number, locale: Locale): string {
  return messages(locale).songs.archiveConsequence({ takeCount });
}

export type DeleteSongResult =
  | { kind: "ok"; song: songsRepo.Song; deletedTakes: number; deletedAssets: number }
  | { kind: "not_found" };

/**
 * Delete a song and everything under it, permanently.
 *
 * The heaviest action in the app, and the only one that reaches recordings the
 * band made rather than metadata about them: a song's takes go with it, and so
 * do their audio files, their votes and everyone's pins.
 *
 * It is offered anyway, beside archiving rather than instead of it, because
 * the two answer different questions. Archiving says "we don't play this any
 * more" and keeps every recording. This says "this should never have been
 * here" — the stub the bridge invented from a mis-typed title, the duplicate,
 * the test song. Those genuinely need removing, and leaving them archived
 * forever is its own kind of mess.
 *
 * The DB half — every take gone, one at a time through `takesRepo.remove`
 * rather than a single bulk delete, because each one also owns objects in
 * the bucket and votes and pins of its own, then the song's own rows —
 * lives in `songsRepo.removeWithTakes`, so this and `deleteTake` cannot
 * diverge in what they forget, and so `orphans.test.ts` in `@bandplate/db`
 * can pin the cascade against the same function this calls.
 *
 * DB first, bucket best-effort, like every other delete here: a storage
 * failure leaves stray objects rather than rows pointing at nothing.
 */
export async function deleteSong(db: Db, storage: Storage, id: string): Promise<DeleteSongResult> {
  const song = await songsRepo.getById(db, id);
  if (!song) {
    return { kind: "not_found" };
  }

  const { takes, storageKeys } = await songsRepo.removeWithTakes(db, id);

  if (storageKeys.length > 0) {
    try {
      await storage.delete(storageKeys);
    } catch (err) {
      const { message, stack } = describeError(err);
      logError({
        kind: "storage-delete",
        message: `failed to delete storage objects for song ${id}: ${message}`,
        stack,
      });
    }
  }

  return { kind: "ok", song, deletedTakes: takes.length, deletedAssets: storageKeys.length };
}

/**
 * What deleting this song costs, in one sentence — said by both the confirm
 * dialog and the confirm page, like its archive counterpart above.
 *
 * It leads with the RECORDINGS, not the song, because that is the part nobody
 * expects: a song row is cheap, and the takes under it are the band's actual
 * work.
 */
export function deleteSongConsequence(
  takeCount: number,
  fileCount: number,
  byteTotal: number,
  locale: Locale,
): string {
  return messages(locale).songs.deleteConsequence({
    takeCount,
    fileCount,
    // Formatted here, where the locale is known — `packages/i18n`'s catalog
    // takes primitives only, so it never sees a byte count it would have to
    // format itself.
    byteTotal: formatBytes(locale, byteTotal),
  });
}
