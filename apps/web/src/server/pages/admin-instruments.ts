import type { Db } from "@bandplate/db";
import { instrumentsRepo } from "@bandplate/db";
// `/admin/instruments` page logic — mirrors
// `packages/api/src/routes/admin-instruments.ts`. Instruments are archived,
// never deleted, so historical takes keep rendering an instrument the band
// has dropped (see the schema comment in `packages/db`).
import { INSTRUMENT_GLYPHS } from "@bandplate/ui/icons/instruments.js";
import { isTrackColorKey } from "@bandplate/ui/tokens/track-colors.js";
import { z } from "zod";

type Instrument = instrumentsRepo.Instrument;

export async function listInstruments(db: Db): Promise<Instrument[]> {
  return instrumentsRepo.list(db, { includeArchived: true });
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
