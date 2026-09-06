import type { Clock } from "@bandlib/core";
import { type Db, instrumentsRepo } from "@bandlib/db";
import { z } from "zod";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, requireScopes } from "../route-registry.js";

const createInstrumentSchema = z.object({
  slug: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().optional(),
});

const patchInstrumentSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    sortOrder: z.number().int().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => v.label !== undefined || v.sortOrder !== undefined || v.archived !== undefined, {
    message: "At least one of label, sortOrder or archived is required.",
  });

export interface AdminInstrumentRouteDeps {
  db: Db;
  clock: Clock;
}

export function registerAdminInstrumentRoutes(
  router: GuardedRouter,
  deps: AdminInstrumentRouteDeps,
): void {
  router.get("/admin/instruments", requireScopes("members:admin"), async (c) => {
    const instruments = await instrumentsRepo.list(deps.db, { includeArchived: true });
    return c.json({ instruments });
  });

  router.post("/admin/instruments", requireScopes("members:admin"), async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = createInstrumentSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(c, 400, "invalid_body", "slug and label are required.");
    }

    const instrument = await instrumentsRepo.create(deps.db, parsed.data);
    return c.json({ instrument }, 201);
  });

  router.patch("/admin/instruments/:id", requireScopes("members:admin"), async (c) => {
    const id = c.req.param("id");
    if (!id) {
      return errorResponse(c, 400, "invalid_request", "Missing id parameter.");
    }
    const body = await c.req.json().catch(() => undefined);
    const parsed = patchInstrumentSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        c,
        400,
        "invalid_body",
        "label, sortOrder and/or archived must be valid.",
      );
    }

    const existing = await instrumentsRepo.getById(deps.db, id);
    if (!existing) {
      return errorResponse(c, 404, "not_found", "Instrument not found.");
    }

    const update: { label?: string; sortOrder?: number; archivedAt?: number | null } = {};
    if (parsed.data.label !== undefined) {
      update.label = parsed.data.label;
    }
    if (parsed.data.sortOrder !== undefined) {
      update.sortOrder = parsed.data.sortOrder;
    }
    if (parsed.data.archived !== undefined) {
      update.archivedAt = parsed.data.archived ? deps.clock.now() : null;
    }

    await instrumentsRepo.update(deps.db, id, update);
    const updated = await instrumentsRepo.getById(deps.db, id);
    return c.json({ instrument: updated });
  });
}
