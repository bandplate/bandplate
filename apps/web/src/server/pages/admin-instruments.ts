// `/admin/instruments` page logic — mirrors
// `packages/api/src/routes/admin-instruments.ts`. Instruments are archived,
// never deleted, so historical takes keep rendering an instrument the band
// has dropped (see the schema comment in `packages/db`).
import type { Db } from "@bandlib/db";
import { instrumentsRepo } from "@bandlib/db";
import { z } from "zod";

type Instrument = instrumentsRepo.Instrument;

export async function listInstruments(db: Db): Promise<Instrument[]> {
  return instrumentsRepo.list(db, { includeArchived: true });
}

export async function getInstrument(db: Db, id: string): Promise<Instrument | undefined> {
  return instrumentsRepo.getById(db, id);
}

const createSchema = z.object({
  slug: z.string().trim().min(1, "Enter a slug.").max(100),
  label: z.string().trim().min(1, "Enter a label.").max(200),
});

export type CreateInstrumentResult =
  | { kind: "ok"; instrument: Instrument }
  | { kind: "invalid"; error: string };

export async function createInstrument(
  db: Db,
  formData: FormData,
): Promise<CreateInstrumentResult> {
  const parsed = createSchema.safeParse({
    slug: formData.get("slug"),
    label: formData.get("label"),
  });
  if (!parsed.success) {
    return { kind: "invalid", error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const instrument = await instrumentsRepo.create(db, parsed.data);
  return { kind: "ok", instrument };
}

const renameSchema = z.object({
  label: z.string().trim().min(1, "Enter a label.").max(200).optional(),
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
