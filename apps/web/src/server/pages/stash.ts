// The stash's page logic: the recorder's song list, the stash view's rows, and
// the "Přidat k písni" page with its actions (publish, rename, delete).
import { type Storage, canPublish } from "@bandplate/core";
import type { Db } from "@bandplate/db";
import { assetsRepo, eventsRepo, membersRepo, songsRepo, takesRepo } from "@bandplate/db";
import { z } from "zod";
import type { SongOption } from "../../client/recorder-logic.js";
import { type DeleteTakeResult, deleteTake } from "./takes.js";

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

export interface StashRowData extends takesRepo.Take {
  song: songsRepo.Song | undefined;
  /** The personal day this recording sits in — a fact the row's sheet reports. */
  event: eventsRepo.Event | undefined;
  /** Undefined until the recording has landed — the row shows the chip instead of a play control. */
  playableAssetId: string | undefined;
}

/**
 * The stash view's server rows. Local, not-yet-uploaded recordings are the
 * island's.
 *
 * `options.songId` narrows it to one song's — the song page's own stash
 * section uses this rather than a second query shape, so the two callers
 * can never drift on what "this member's stash" means.
 */
export async function getStashRows(
  db: Db,
  memberId: string,
  options: takesRepo.StashOptions = {},
): Promise<StashRowData[]> {
  const rows = await takesRepo.listStash(db, memberId, options);
  if (rows.length === 0) {
    return [];
  }
  const [songs, events, playable] = await Promise.all([
    songsRepo.getByIds(db, takesRepo.songIdsOf(rows)),
    eventsRepo.getByIds(db, [...new Set(rows.map((t) => t.eventId))]),
    assetsRepo.listPlayableMastersByTakeIds(
      db,
      rows.map((t) => t.id),
    ),
  ]);
  const songById = new Map(songs.map((s) => [s.id, s]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  return rows.map((take) => ({
    ...take,
    song: take.songId ? songById.get(take.songId) : undefined,
    event: eventById.get(take.eventId),
    playableAssetId: playable.get(take.id)?.id,
  }));
}

/** Everything the stash view draws: the rows, and what each row's sheet reports. */
export interface StashView {
  rows: StashRowData[];
  /** The signed-in member — every row here is theirs, so this is asked once. */
  owner: membersRepo.Member | undefined;
  /**
   * The picker's options, loaded only when some row still has no song. A
   * library nobody needs to choose from is a query nobody needs to run.
   */
  songChoices: SongOption[];
}

export async function getStashView(db: Db, memberId: string): Promise<StashView> {
  const rows = await getStashRows(db, memberId);
  const [owners, songChoices] = await Promise.all([
    membersRepo.getByIds(db, [memberId]),
    rows.some((row) => !row.songId)
      ? listRecordableSongs(db).then((found) => found.songs)
      : Promise.resolve<SongOption[]>([]),
  ]);
  return { rows, owner: owners[0], songChoices };
}

export interface StashItem {
  take: takesRepo.Take;
  song: songsRepo.Song | undefined;
  event: eventsRepo.Event | undefined;
  owner: membersRepo.Member | undefined;
  playableAsset: assetsRepo.Asset | undefined;
}

/** Only while the take is private AND mine — published, it lives at `/takes/[id]`. */
async function ownStashTake(
  db: Db,
  id: string,
  memberId: string,
): Promise<takesRepo.Take | undefined> {
  const take = await takesRepo.getById(db, id);
  return take && take.visibility === "private" && take.ownerMemberId === memberId
    ? take
    : undefined;
}

export async function getStashItem(
  db: Db,
  id: string,
  memberId: string,
): Promise<StashItem | undefined> {
  const take = await ownStashTake(db, id, memberId);
  if (!take) {
    return undefined;
  }
  const [song, event, owners, playable] = await Promise.all([
    take.songId ? songsRepo.getById(db, take.songId) : undefined,
    eventsRepo.getById(db, take.eventId),
    membersRepo.getByIds(db, [memberId]),
    assetsRepo.listPlayableMastersByTakeIds(db, [take.id]),
  ]);
  return { take, song, event, owner: owners[0], playableAsset: playable.get(take.id) };
}

export type PublishStashResult =
  | { kind: "ok"; take: takesRepo.Take }
  | { kind: "not_found" }
  /** The file has not landed yet — the page shows no button then, so this is a stale page. */
  | { kind: "nothing_to_play" }
  /** No song on the take and none chosen in the form. The picker says so. */
  | { kind: "no_song" }
  /** A song was chosen that is not in the library — a stale page, or a hand-made POST. */
  | { kind: "song_not_found" };

/**
 * "Přidat k písni". `songId` is the song chosen on the way out, for a
 * recording that was made before its member decided what song it was; a
 * recording that already has one needs none and ignores it.
 */
export async function publishStashTake(
  db: Db,
  now: number,
  id: string,
  memberId: string,
  songId?: string | null,
): Promise<PublishStashResult> {
  const take = await ownStashTake(db, id, memberId);
  if (!take) {
    return { kind: "not_found" };
  }
  if (!canPublish(await assetsRepo.listByTake(db, id))) {
    return { kind: "nothing_to_play" };
  }
  // Only when the take needs one: a chosen song never overrides a filed one,
  // so a stale hidden field cannot refile somebody's recording. Trimmed here
  // rather than only at the form: an empty select and a select full of spaces
  // both mean "nothing chosen", and only one of them looks it.
  const chosen = take.songId ? null : songId?.trim() || null;
  // Owner, private, has-a-song and the song EXISTS are all conditions on the
  // write itself — `publishFromStash` takes none of them on trust, because
  // foreign keys are off. So there is nothing to pre-check here, and no
  // window between a check and the write: the result it returns is the answer.
  const result = await takesRepo.publishFromStash(db, id, memberId, now, chosen);
  if (result === "ok") {
    return { kind: "ok", take };
  }
  if (result === "no_song" || result === "song_not_found") {
    return { kind: result };
  }
  return { kind: "not_found" };
}

const labelSchema = z.string().trim().max(200);

export type RenameStashResult = { kind: "ok" } | { kind: "not_found" } | { kind: "invalid" };

export async function renameStashTake(
  db: Db,
  now: number,
  id: string,
  memberId: string,
  formData: FormData,
): Promise<RenameStashResult> {
  const take = await ownStashTake(db, id, memberId);
  if (!take) {
    return { kind: "not_found" };
  }
  const parsed = labelSchema.safeParse(String(formData.get("label") ?? ""));
  if (!parsed.success) {
    return { kind: "invalid" };
  }
  await takesRepo.update(db, id, {
    label: parsed.data === "" ? null : parsed.data,
    updatedAt: now,
  });
  return { kind: "ok" };
}

/**
 * The owner deleting their own unpublished recording.
 *
 * The one member-side delete in the app — destruction otherwise lives under
 * `/admin`. It is safe to hand the owner because a private take has, by
 * construction, no votes, no pins and no listener but them: nothing of the
 * band's is lost. Once published it is the band's, and only an admin deletes it.
 */
export async function deleteStashTake(
  db: Db,
  storage: Storage,
  id: string,
  memberId: string,
): Promise<DeleteTakeResult> {
  if (!(await ownStashTake(db, id, memberId))) {
    return { kind: "not_found" };
  }
  return deleteTake(db, storage, id);
}

/** What went wrong with a write the sheet asked for, in the page's words. */
export type StashWriteError =
  /** No song on the take and none chosen. */
  | "no_song"
  /** A song was chosen that is not in the library. */
  | "song_not_found"
  /** The file has not landed yet, so there is nothing to add. */
  | "nothing_to_play"
  | "label_too_long";

export type StashWriteResult =
  /**
   * `returnTo` is where the sheet's caller wants the member back — its own
   * page, not necessarily the stash view. Always set: a hidden `returnTo`
   * field on the form when the sheet's caller cares (the song page's own
   * section does), and the take's own page (today's behaviour, unchanged)
   * when it's absent — the stash view's sheet never sends one.
   */
  | { kind: "published"; takeId: string; returnTo: string }
  | { kind: "renamed"; takeId: string }
  /** No intent this page knows — a stale form, or a hand-made POST. */
  | { kind: "ignored" }
  | { kind: "not_found" }
  | { kind: "error"; takeId: string; error: StashWriteError };

/**
 * One write from a recording's sheet, wherever the sheet was opened: the stash
 * list and the recording's own no-JS page post the same fields to themselves
 * and land here.
 *
 * The take is named by the FORM, not by the route, so this is the one place
 * the owner check has to hold — and it does, because every write underneath
 * goes through `ownStashTake`. A hand-built POST naming somebody else's
 * recording is answered exactly as one naming a recording that does not
 * exist.
 */
export async function applyStashWrite(
  db: Db,
  now: number,
  memberId: string,
  formData: FormData,
): Promise<StashWriteResult> {
  const intent = String(formData.get("intent") ?? "");
  const takeId = String(formData.get("takeId") ?? "").trim();
  if (!takeId || (intent !== "publish" && intent !== "rename")) {
    return { kind: "ignored" };
  }

  if (intent === "publish") {
    const chosen = String(formData.get("songId") ?? "").trim();
    const result = await publishStashTake(db, now, takeId, memberId, chosen === "" ? null : chosen);
    if (result.kind === "ok") {
      const requestedReturnTo = String(formData.get("returnTo") ?? "").trim();
      return { kind: "published", takeId, returnTo: requestedReturnTo || `/takes/${takeId}` };
    }
    if (result.kind === "not_found") {
      return { kind: "not_found" };
    }
    return { kind: "error", takeId, error: result.kind };
  }

  const result = await renameStashTake(db, now, takeId, memberId, formData);
  if (result.kind === "ok") {
    return { kind: "renamed", takeId };
  }
  if (result.kind === "not_found") {
    return { kind: "not_found" };
  }
  return { kind: "error", takeId, error: "label_too_long" };
}
