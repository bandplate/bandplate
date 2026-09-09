// `/takes/[id]` — take detail. Read-only: the song, the event, duration,
// label, instruments, state, the current vote tally (already-stored
// aggregates on the take row itself — no separate query), and the take's
// assets (master, stems by instrument, whether a lossless master exists).
// No playback — increment 4 adds the player; see the page for where the
// layout leaves room for it.
//
// `favorited` (Task 6 review round 1, F4): whether the requesting member
// has favorited THIS take — real per-page information (a single take either
// is or isn't one of their favorites), unlike the decorative heading star
// this same review round removed. See `TakeRow`'s own `favorited` prop for
// the rest of this marker's use.
import { type Storage, canPublish } from "@bandplate/core";
import type { Db } from "@bandplate/db";
import {
  assetsRepo,
  eventsRepo,
  favoritesRepo,
  instrumentsRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
import { z } from "zod";
import { formatBytes } from "../format.js";

export interface TakeDetail {
  take: takesRepo.Take;
  song: songsRepo.Song | undefined;
  event: eventsRepo.Event | undefined;
  instruments: instrumentsRepo.Instrument[];
  /**
   * Every instrument in the vocabulary, by id — what to LABEL a stem with.
   *
   * Deliberately not the same as `instruments` above, which is what was
   * played and captured on this take. The ingest contract (§4) says outright
   * that the two sets differ: a take can capture the whole band in the master
   * and hold isolated files for only three players, and a re-declared take
   * never re-derives its instrument list (§3), so a stem added by a later
   * re-render has no entry there at all. Labelling stems from that list
   * printed "Unknown instrument" over a perfectly well-named file.
   */
  instrumentsById: Map<string, instrumentsRepo.Instrument>;
  assets: assetsRepo.Asset[];
  hasLossless: boolean;
  favorited: boolean;
  /** `undefined` means this member hasn't voted on this take yet — see `TakeRow`'s own `myVote` prop. */
  myVote: boolean | undefined;
}

export async function getTakeDetail(
  db: Db,
  id: string,
  memberId: string,
): Promise<TakeDetail | undefined> {
  const take = await takesRepo.getById(db, id);
  if (!take) {
    return undefined;
  }

  const [
    song,
    event,
    instrumentsByTake,
    vocabulary,
    assets,
    hasLossless,
    favoriteTakeIds,
    myVoteByTakeId,
  ] = await Promise.all([
    songsRepo.getById(db, take.songId),
    eventsRepo.getById(db, take.eventId),
    takesRepo.listInstrumentsForTakes(db, [take.id]),
    // Archived included: a stem recorded on an instrument the band has since
    // retired still deserves its name rather than "Unknown".
    instrumentsRepo.list(db, { includeArchived: true }),
    assetsRepo.listByTake(db, take.id),
    assetsRepo.takeHasLossless(db, take.id),
    favoritesRepo.listTargetIdsByMember(db, memberId, "take"),
    votesRepo.listByMemberForTakes(db, memberId, [take.id]),
  ]);

  return {
    take,
    song,
    event,
    instruments: instrumentsByTake.get(take.id) ?? [],
    instrumentsById: new Map(vocabulary.map((i) => [i.id, i])),
    assets,
    hasLossless,
    favorited: favoriteTakeIds.has(take.id),
    myVote: myVoteByTakeId.get(take.id),
  };
}

// ---------------------------------------------------------------------------
// Writes (M8)
// ---------------------------------------------------------------------------

function optionalText(value: FormDataEntryValue | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/** Local-time `YYYY-MM-DD` — the same parse `server/pages/events.ts` explains. */
function parseDateInput(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

const takeFieldsSchema = z.object({
  songId: z.string().trim().min(1, "Choose which song this is."),
  eventId: z.string().trim().min(1, "Choose which session this came from."),
  recordedAt: z
    .string()
    .trim()
    .min(1, "Enter the date it was recorded.")
    .transform(parseDateInput)
    .refine((v): v is number => v !== undefined, "That date didn't look right."),
  label: z.string().trim().max(200).nullable(),
  notes: z.string().trim().max(20_000).nullable(),
});

export type TakeField = "songId" | "eventId" | "recordedAt" | "label" | "notes";

export type TakeFormFailure =
  | { kind: "invalid"; error: string; field: TakeField }
  /** The song or event named doesn't exist — a stale form, or a hand-built POST. */
  | { kind: "unknown_parent"; field: "songId" | "eventId" };

export type CreateTakeResult = { kind: "ok"; take: takesRepo.Take } | TakeFormFailure;
export type UpdateTakeResult = { kind: "ok" } | { kind: "not_found" } | TakeFormFailure;

function invalidTake(parsed: z.SafeParseError<unknown>): TakeFormFailure {
  const issue = parsed.error.issues[0];
  return {
    kind: "invalid",
    error: issue?.message ?? "Invalid input.",
    field: (issue?.path[0] as TakeField | undefined) ?? "songId",
  };
}

/**
 * Instrument ids off the form, filtered to ones that exist.
 *
 * Filtered rather than rejected: a checkbox naming an instrument that has
 * since been archived (or deleted out from under the form) is a stale page,
 * not an attack, and losing one checkbox is a better answer than refusing the
 * whole take. Archived instruments are excluded from the picker, so this only
 * bites a form left open across an admin change.
 */
async function readInstrumentIds(db: Db, formData: FormData): Promise<string[]> {
  const requested = new Set(formData.getAll("instrumentIds").map(String));
  if (requested.size === 0) {
    return [];
  }
  const known = await instrumentsRepo.list(db, { includeArchived: true });
  return known.filter((i) => requested.has(i.id)).map((i) => i.id);
}

/**
 * Create a take as an EMPTY CONTAINER — song, event, when, and what was
 * played. No audio.
 *
 * This is the shape the ingest contract deliberately does not have: its
 * `createTakeSchema` requires `assets.min(1)`, because a bridge declares a
 * whole manifest it has already rendered. A person adds the take first and
 * puts files in it over however many visits it takes, so requiring a file up
 * front would mean losing the metadata if the upload fails.
 *
 * It starts in `uploading` — `takesRepo.create`'s own default, and the honest
 * word: the container exists and there is nothing in it. It becomes
 * `published` only when someone presses Publish; see the page.
 *
 * `clientRef` stays null. That key is the bridge's, and a manual take has no
 * business claiming one — which does mean a bridge push of the same
 * performance will duplicate it. A duplicate take is at least VISIBLY a
 * duplicate, and the fix is to delete one; there is no reliable key to match
 * a human's take against a machine's.
 */
export async function createTake(
  db: Db,
  now: number,
  formData: FormData,
): Promise<CreateTakeResult> {
  const parsed = takeFieldsSchema.safeParse({
    songId: formData.get("songId"),
    eventId: formData.get("eventId"),
    recordedAt: formData.get("recordedAt"),
    label: optionalText(formData.get("label")),
    notes: optionalText(formData.get("notes")),
  });
  if (!parsed.success) {
    return invalidTake(parsed);
  }

  const [song, event] = await Promise.all([
    songsRepo.getById(db, parsed.data.songId),
    eventsRepo.getById(db, parsed.data.eventId),
  ]);
  if (!song) {
    return { kind: "unknown_parent", field: "songId" };
  }
  if (!event) {
    return { kind: "unknown_parent", field: "eventId" };
  }

  const take = await takesRepo.create(db, {
    songId: song.id,
    eventId: event.id,
    label: parsed.data.label,
    notes: parsed.data.notes,
    recordedAt: parsed.data.recordedAt,
    createdAt: now,
    updatedAt: now,
    instrumentIds: await readInstrumentIds(db, formData),
  });
  return { kind: "ok", take };
}

/**
 * Save the take edit sheet.
 *
 * `eventId` is not editable here — see `takesRepo.UpdateTakeInput`. `songId`
 * is: filing a take under the wrong song is the likeliest correction after a
 * bridge run.
 */
export async function updateTake(
  db: Db,
  now: number,
  id: string,
  formData: FormData,
): Promise<UpdateTakeResult> {
  const take = await takesRepo.getById(db, id);
  if (!take) {
    return { kind: "not_found" };
  }

  const parsed = takeFieldsSchema.safeParse({
    songId: formData.get("songId"),
    // The edit sheet does not offer the event, so it echoes the take's own.
    eventId: take.eventId,
    recordedAt: formData.get("recordedAt"),
    label: optionalText(formData.get("label")),
    notes: optionalText(formData.get("notes")),
  });
  if (!parsed.success) {
    return invalidTake(parsed);
  }

  const song = await songsRepo.getById(db, parsed.data.songId);
  if (!song) {
    return { kind: "unknown_parent", field: "songId" };
  }

  await takesRepo.update(
    db,
    id,
    {
      songId: song.id,
      label: parsed.data.label,
      notes: parsed.data.notes,
      recordedAt: parsed.data.recordedAt,
      updatedAt: now,
    },
    await readInstrumentIds(db, formData),
  );
  return { kind: "ok" };
}

export type PublishTakeResult =
  | { kind: "ok"; take: takesRepo.Take }
  | { kind: "not_found" }
  /** Nothing on it can be listened to yet — see `canPublish`. */
  | { kind: "nothing_to_play" };

/**
 * Publish (or, going the other way, un-publish) a take.
 *
 * EXPLICIT, not automatic. Ingest publishes on commit because it declared a
 * whole manifest and can tell when it is complete; the manual flow has no
 * manifest, so "first ready file" would publish the take into everyone's
 * field of view while the member is still uploading stems.
 *
 * Un-publishing is admin-only at the page level, and deleting the last
 * playable asset does NOT do it implicitly — one member's delete should not
 * silently change what everyone else sees.
 */
export async function setTakePublished(
  db: Db,
  now: number,
  id: string,
  published: boolean,
): Promise<PublishTakeResult> {
  const take = await takesRepo.getById(db, id);
  if (!take) {
    return { kind: "not_found" };
  }
  if (published) {
    const assets = await assetsRepo.listByTake(db, id);
    if (!canPublish(assets)) {
      return { kind: "nothing_to_play" };
    }
  }
  await takesRepo.setStateWithPublishedAt(
    db,
    id,
    published ? "published" : "new",
    published ? now : null,
    now,
  );
  return { kind: "ok", take };
}

export type DeleteTakeResult =
  | { kind: "ok"; take: takesRepo.Take; deletedAssets: number }
  | { kind: "not_found" };

/**
 * Delete a take and everything under it, permanently.
 *
 * Hard delete, not the unused `purged` state: nothing in the app has ever
 * written `purged`, and half-adopting it here would leave a tombstone every
 * listing would then have to learn to skip.
 *
 * DB first, then the bucket, best-effort — so a storage failure leaves a
 * harmless stray object rather than a row pointing at nothing. Same ordering
 * and same reasoning as `DELETE /ingest/v1/takes/:takeId`.
 */
export async function deleteTake(db: Db, storage: Storage, id: string): Promise<DeleteTakeResult> {
  const take = await takesRepo.getById(db, id);
  if (!take) {
    return { kind: "not_found" };
  }
  const assets = await assetsRepo.listByTake(db, id);
  await takesRepo.remove(db, id);

  if (assets.length > 0) {
    try {
      await storage.delete(assets.map((a) => a.storageKey));
    } catch (err) {
      console.error("failed to delete storage objects for take", id, err);
    }
  }
  return { kind: "ok", take, deletedAssets: assets.length };
}

/**
 * What deleting this take costs, in one sentence — shared by the confirm
 * dialog on the edit sheet and the no-JS confirm page, for the same reason
 * `archiveSongConsequence` is: they are the same promise and must not drift.
 *
 * Unlike archiving, this one has no reassurance to offer. It says the number
 * of files and their total size because "5 files, 312 MB" is the fact that
 * makes someone stop and check, and it names the votes because those are the
 * band's work, not the uploader's.
 */
export function deleteTakeConsequence(assets: assetsRepo.Asset[], totalVotes: number): string {
  const files =
    assets.length === 0
      ? "It has no files yet."
      : `It permanently removes ${assets.length} ${assets.length === 1 ? "file" : "files"} (${formatBytes(
          assets.reduce((sum, a) => sum + a.bytes, 0),
        )}).`;
  const votes =
    totalVotes === 0
      ? ""
      : ` The ${totalVotes} ${totalVotes === 1 ? "vote" : "votes"} cast on it ${totalVotes === 1 ? "goes" : "go"} too.`;
  return `This can't be undone. ${files}${votes} The song and the event stay.`;
}

export type DeleteAssetResult =
  | { kind: "ok"; asset: assetsRepo.Asset; takeId: string; leavesNothingPlayable: boolean }
  | { kind: "not_found" };

/**
 * Delete one file off a take.
 *
 * Deliberately does NOT unpublish the take when it removes the last playable
 * asset — it only reports that it did. One member's delete should not change
 * what everyone else sees; the take page shows a warning instead, and an admin
 * decides.
 *
 * DB first, bucket best-effort, like `deleteTake`.
 */
export async function deleteAsset(
  db: Db,
  storage: Storage,
  assetId: string,
): Promise<DeleteAssetResult> {
  const asset = await assetsRepo.getById(db, assetId);
  if (!asset) {
    return { kind: "not_found" };
  }
  await assetsRepo.remove(db, assetId);

  const remaining = await assetsRepo.listByTake(db, asset.takeId);
  try {
    await storage.delete([asset.storageKey]);
  } catch (err) {
    console.error("failed to delete storage object", asset.storageKey, err);
  }
  return {
    kind: "ok",
    asset,
    takeId: asset.takeId,
    leavesNothingPlayable: !canPublish(remaining),
  };
}

/** What deleting one file costs — shared by the confirm dialog and its page. */
export function deleteAssetConsequence(
  label: string,
  asset: assetsRepo.Asset,
  isLastPlayable: boolean,
): string {
  const head = `This can't be undone. It removes the ${label} (${asset.format}, ${asset.tier}, ${formatBytes(asset.bytes)}) from storage.`;
  return isLastPlayable
    ? `${head} It is the only thing this take can be played from, so the take will have nothing to play.`
    : `${head} The take keeps its other files.`;
}
