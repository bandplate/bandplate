import type { Storage } from "@bandplate/core";
import type { Db } from "@bandplate/db";
import { assetsRepo, instrumentsRepo, songsRepo, takesRepo } from "@bandplate/db";
// `/admin/instruments` page logic — mirrors
// `packages/api/src/routes/admin-instruments.ts`.
//
// ARCHIVING is the ordinary retirement: the instrument stops being a choice
// and every past take that used it keeps rendering. That is what a band wants
// for an instrument it has stopped playing.
//
// DELETING exists for the other case — a typo, a duplicate, or a stub ingest
// invented from a Reaper track name nobody meant to keep — and is only
// offered while NOTHING references the instrument. It cannot cascade: an
// instrument does not own a song's chart, a take's instrument list, or a
// take's stem, so deleting one must never quietly edit any of them.
import { INSTRUMENT_GLYPHS } from "@bandplate/ui/icons/instruments.js";
import { isTrackColorKey } from "@bandplate/ui/tokens/track-colors.js";
import { z } from "zod";

type Instrument = instrumentsRepo.Instrument;

export async function listInstruments(db: Db): Promise<Instrument[]> {
  return instrumentsRepo.list(db, { includeArchived: true });
}

/**
 * What each instrument is holding, for the admin list.
 *
 * Fetched for the whole table in one go: the delete action is only offered on
 * an instrument nothing references, and "is this one safe to delete" is a
 * question about every row on screen.
 */
export type InstrumentUsage = instrumentsRepo.InstrumentUsage;

export async function instrumentUsage(db: Db): Promise<Map<string, InstrumentUsage>> {
  return instrumentsRepo.usageByInstrument(db);
}

/**
 * An instrument's usage, zeroes included.
 *
 * The map only carries instruments something references, so most rows are
 * absent from it — and "absent" is the answer that matters most, since it is
 * the one that allows a delete. Exported here rather than reached for through
 * `instrumentsRepo` so the page keeps importing from one module.
 */
export function usageOf(
  usage: Map<string, InstrumentUsage>,
  instrumentId: string,
): InstrumentUsage {
  return usage.get(instrumentId) ?? instrumentsRepo.NO_USAGE;
}

export function isInstrumentUnused(usage: InstrumentUsage): boolean {
  return instrumentsRepo.isUnused(usage);
}

export async function getInstrument(db: Db, id: string): Promise<Instrument | undefined> {
  return instrumentsRepo.getById(db, id);
}

const createSchema = z.object({
  slug: z.string().trim().min(1, "slugRequired").max(100),
  label: z.string().trim().min(1, "labelRequired").max(200),
});

export type CreateInstrumentField = "slug" | "label";

export type CreateInstrumentResult =
  | { kind: "ok"; instrument: Instrument }
  | { kind: "invalid"; error: string; field: CreateInstrumentField };

export async function createInstrument(
  db: Db,
  formData: FormData,
): Promise<CreateInstrumentResult> {
  const parsed = createSchema.safeParse({
    slug: formData.get("slug"),
    label: formData.get("label"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = (issue?.path[0] as CreateInstrumentField | undefined) ?? "slug";
    return { kind: "invalid", error: issue?.message ?? "generic", field };
  }
  const instrument = await instrumentsRepo.create(db, parsed.data);
  return { kind: "ok", instrument };
}

const renameSchema = z.object({
  label: z.string().trim().min(1, "labelRequired").max(200).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export type UpdateInstrumentResult = { kind: "ok" } | { kind: "not_found" } | { kind: "invalid" };

export async function updateInstrument(
  db: Db,
  id: string,
  formData: FormData,
): Promise<UpdateInstrumentResult> {
  const label = formData.get("label");
  const sortOrder = formData.get("sortOrder");
  // `icon` is optional and tri-state: absent leaves it alone, "" clears it
  // back to initials, and a key sets it. Validated against the vendored
  // library rather than trusted — the column is free text at the database
  // level, and an unknown key would render nothing at all.
  const rawIcon = formData.get("icon");
  const iconField = rawIcon === null ? undefined : String(rawIcon);
  if (iconField !== undefined && iconField !== "" && !(iconField in INSTRUMENT_GLYPHS)) {
    return { kind: "invalid" };
  }
  // `color` is the same tri-state as `icon`, validated the same way and for
  // the same reason: the column is free text at the database level, and an
  // unknown key would resolve to no custom property at all — a track painted
  // with nothing rather than with the neutral, which is worse than either.
  const rawColor = formData.get("color");
  const colorField = rawColor === null ? undefined : String(rawColor);
  if (colorField !== undefined && colorField !== "" && !isTrackColorKey(colorField)) {
    return { kind: "invalid" };
  }
  const parsed = renameSchema.safeParse({
    label: label ? String(label) : undefined,
    sortOrder: sortOrder ? String(sortOrder) : undefined,
  });
  if (!parsed.success) {
    return { kind: "invalid" };
  }
  const existing = await instrumentsRepo.getById(db, id);
  if (!existing) {
    return { kind: "not_found" };
  }
  const update: instrumentsRepo.UpdateInstrumentInput = {};
  if (parsed.data.label !== undefined) {
    update.label = parsed.data.label;
  }
  if (parsed.data.sortOrder !== undefined) {
    update.sortOrder = parsed.data.sortOrder;
  }
  if (iconField !== undefined) {
    update.icon = iconField === "" ? null : iconField;
  }
  if (colorField !== undefined) {
    update.color = colorField === "" ? null : colorField;
  }
  // Saving the sheet IS the confirmation of a stub, so there is no separate
  // "approve" press to forget: what a stub lacks is a label worth reading, an
  // icon, a colour and a place in the order, and this form is exactly those
  // four fields. Someone who opened it and pressed save has looked.
  //
  // Only ever set FALSE here. Nothing in the admin makes a stub — that is
  // ingest's word for "I invented this" — so the flag has one direction of
  // travel and this is the end of it.
  if (existing.isStub) {
    update.isStub = false;
  }
  await instrumentsRepo.update(db, id, update);
  return { kind: "ok" };
}

export type DeleteInstrumentResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  /** Still referenced. The counts are the message — they say what is in the way. */
  | { kind: "in_use"; usage: instrumentsRepo.InstrumentUsage };

/**
 * Delete an instrument, but only while nothing points at it.
 *
 * The usage is counted AGAIN here rather than trusted from the page that drew
 * the button. Nothing stops a bridge run from declaring a take with this
 * instrument between the list rendering and the press, and `PRAGMA
 * foreign_keys` is off for D1 parity — so the database would accept the
 * delete and leave the new take pointing at nothing. This re-check is the
 * only thing standing between those two facts.
 */
export async function deleteInstrument(db: Db, id: string): Promise<DeleteInstrumentResult> {
  const existing = await instrumentsRepo.getById(db, id);
  if (!existing) {
    return { kind: "not_found" };
  }
  const usage = (await instrumentsRepo.usageByInstrument(db)).get(id) ?? instrumentsRepo.NO_USAGE;
  if (!instrumentsRepo.isUnused(usage)) {
    return { kind: "in_use", usage };
  }
  await instrumentsRepo.remove(db, id);
  return { kind: "ok" };
}

// --- aliases ---------------------------------------------------------------

export type InstrumentAlias = instrumentsRepo.InstrumentAlias;

/** Every alias, grouped by the instrument it belongs to — one query for the whole table. */
export async function aliasesByInstrument(db: Db): Promise<Map<string, InstrumentAlias[]>> {
  const grouped = new Map<string, InstrumentAlias[]>();
  for (const alias of await instrumentsRepo.listAllAliases(db)) {
    const list = grouped.get(alias.instrumentId);
    if (list) {
      list.push(alias);
    } else {
      grouped.set(alias.instrumentId, [alias]);
    }
  }
  return grouped;
}

const aliasSchema = z.object({
  // The same shape an instrument's own slug has, because that is exactly what
  // it is — another name in the one namespace they share.
  slug: z.string().trim().min(1, "slugRequired").max(100),
});

export type AddAliasResult =
  | { kind: "ok" }
  | { kind: "invalid"; error: string }
  | { kind: "not_found" }
  /** Already an instrument's own slug, or already an alias. Named, so the page can say which. */
  | { kind: "taken"; byLabel: string };

export async function addInstrumentAlias(
  db: Db,
  instrumentId: string,
  formData: FormData,
): Promise<AddAliasResult> {
  const parsed = aliasSchema.safeParse({ slug: formData.get("slug")?.toString() });
  if (!parsed.success) {
    return { kind: "invalid", error: parsed.error.issues[0]?.message ?? "slugRequired" };
  }
  const instrument = await instrumentsRepo.getById(db, instrumentId);
  if (!instrument) {
    return { kind: "not_found" };
  }
  const result = await instrumentsRepo.addAlias(db, {
    instrumentId,
    slug: parsed.data.slug,
    source: "manual",
  });
  return result.kind === "ok" ? { kind: "ok" } : { kind: "taken", byLabel: result.by.label };
}

export async function removeInstrumentAlias(db: Db, aliasId: string): Promise<void> {
  await instrumentsRepo.removeAlias(db, aliasId);
}

// --- merge -----------------------------------------------------------------

export type MergePlan = instrumentsRepo.MergePlan;

export interface MergePreview {
  source: Instrument;
  target: Instrument;
  plan: MergePlan;
  /** Songs whose chart for the source is lost, by title — the page names them. */
  losingSongs: { id: string; title: string }[];
  /**
   * Takes losing a stem file.
   *
   * Carries the DATE as well as the song, because a band records the same
   * song many times: without it, seven lines of "a stem on a take of Čoudy"
   * are seven identical sentences, and a list nobody can tell apart is a list
   * nobody reads before approving.
   */
  losingTakes: { assetId: string; takeId: string; songTitle: string; recordedAt: number }[];
}

/**
 * What a merge would do, before it does it.
 *
 * Read-only on purpose: the collisions are the whole reason this is two
 * steps. A song with a chart for both instruments loses one BODY OF AUTHORED
 * TEXT; a take with a stem for each loses an AUDIO FILE and its object in the
 * bucket. Neither is recoverable, so a human sees the list and decides.
 */
export async function previewInstrumentMerge(
  db: Db,
  sourceId: string,
  targetId: string,
): Promise<MergePreview | undefined> {
  const [source, target] = await Promise.all([
    instrumentsRepo.getById(db, sourceId),
    instrumentsRepo.getById(db, targetId),
  ]);
  if (!source || !target || source.id === target.id) {
    return undefined;
  }
  const plan = await instrumentsRepo.planMerge(db, sourceId, targetId);

  const losingSongs =
    plan.chartSongIds.length === 0
      ? []
      : (await songsRepo.getByIds(db, plan.chartSongIds)).map((song) => ({
          id: song.id,
          title: song.title,
        }));

  const losingTakes: MergePreview["losingTakes"] = [];
  for (const assetId of plan.collidingAssetIds) {
    const asset = await assetsRepo.getById(db, assetId);
    if (!asset) {
      continue;
    }
    const take = await takesRepo.getById(db, asset.takeId);
    const song = take?.songId ? await songsRepo.getById(db, take.songId) : undefined;
    losingTakes.push({
      assetId,
      takeId: asset.takeId,
      songTitle: song?.title ?? "",
      recordedAt: take?.recordedAt ?? 0,
    });
  }

  return { source, target, plan, losingSongs, losingTakes };
}

export type MergeInstrumentsResult = { kind: "ok" } | { kind: "not_found" };

/**
 * Fold one instrument into another.
 *
 * The plan is recomputed here rather than carried through the form: what runs
 * has to be what the database looks like NOW, and a bridge run between the
 * preview and the press can add a stem that collides. The preview is what a
 * human agreed to in principle; this is what is true.
 *
 * DB first, bucket best-effort — the same order `deleteAsset` uses, and for
 * the same reason: a row pointing at a missing object is a broken download,
 * while an object with no row is invisible and cheap.
 */
export async function mergeInstruments(
  db: Db,
  storage: Storage,
  sourceId: string,
  targetId: string,
): Promise<MergeInstrumentsResult> {
  const preview = await previewInstrumentMerge(db, sourceId, targetId);
  if (!preview) {
    return { kind: "not_found" };
  }
  // Read the keys BEFORE the merge deletes the rows that hold them.
  const doomed = await Promise.all(
    preview.plan.collidingAssetIds.map((id) => assetsRepo.getById(db, id)),
  );
  const keys = doomed.flatMap((asset) => (asset ? [asset.storageKey] : []));

  await instrumentsRepo.mergeInto(db, sourceId, targetId, preview.plan);

  if (keys.length > 0) {
    try {
      await storage.delete(keys);
    } catch (err) {
      console.error("failed to delete merged-away storage objects", keys, err);
    }
  }
  return { kind: "ok" };
}

export type ArchiveInstrumentResult = { kind: "ok" } | { kind: "not_found" };

export async function setInstrumentArchived(
  db: Db,
  id: string,
  archived: boolean,
  now: number,
): Promise<ArchiveInstrumentResult> {
  const existing = await instrumentsRepo.getById(db, id);
  if (!existing) {
    return { kind: "not_found" };
  }
  await instrumentsRepo.update(db, id, { archivedAt: archived ? now : null });
  return { kind: "ok" };
}
