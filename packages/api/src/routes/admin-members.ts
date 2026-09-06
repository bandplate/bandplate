import type { AuthDeps } from "@bandlib/core";
import { revokeAllSessionsForMember, slugify } from "@bandlib/core";
import { type Db, membersRepo } from "@bandlib/db";
import { z } from "zod";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, requireScopes } from "../route-registry.js";

const createMemberSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  email: z.string().trim().min(1).max(320),
  role: z.enum(["member", "admin"]).optional(),
});

const patchMemberSchema = z
  .object({
    status: z.enum(["invited", "active", "disabled"]).optional(),
    role: z.enum(["member", "admin"]).optional(),
  })
  .refine((v) => v.status !== undefined || v.role !== undefined, {
    message: "At least one of status or role is required.",
  });

export interface AdminMemberRouteDeps {
  db: Db;
  auth: AuthDeps;
}

export function registerAdminMemberRoutes(router: GuardedRouter, deps: AdminMemberRouteDeps): void {
  router.get("/admin/members", requireScopes("members:admin"), async (c) => {
    const members = await membersRepo.list(deps.db);
    return c.json({ members });
  });

  router.post("/admin/members", requireScopes("members:admin"), async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = createMemberSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(c, 400, "invalid_body", "displayName and email are required.");
    }

    const existing = await membersRepo.getByEmail(deps.db, parsed.data.email);
    if (existing) {
      return errorResponse(c, 409, "email_taken", "A member with this email already exists.");
    }

    const member = await membersRepo.create(deps.db, {
      displayName: parsed.data.displayName,
      slug: slugify(parsed.data.displayName),
      email: parsed.data.email,
      role: parsed.data.role,
      createdAt: deps.auth.clock.now(),
    });

    return c.json({ member }, 201);
  });

  router.patch("/admin/members/:id", requireScopes("members:admin"), async (c) => {
    const id = c.req.param("id");
    if (!id) {
      return errorResponse(c, 400, "invalid_request", "Missing id parameter.");
    }
    const body = await c.req.json().catch(() => undefined);
    const parsed = patchMemberSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(c, 400, "invalid_body", "status and/or role must be valid.");
    }

    const existing = await membersRepo.getById(deps.db, id);
    if (!existing) {
      return errorResponse(c, 404, "not_found", "Member not found.");
    }

    // One statement, not two independent round trips — a {role, status}
    // patch must not be able to land half-applied. Only include keys that
    // were actually provided (rather than passing `status: undefined`
    // through) so `membersRepo.update`'s "nothing to do" guard sees an
    // accurate key count.
    const update: membersRepo.UpdateMemberInput = {};
    if (parsed.data.status !== undefined) {
      update.status = parsed.data.status;
    }
    if (parsed.data.role !== undefined) {
      update.role = parsed.data.role;
    }
    await membersRepo.update(deps.db, id, update);

    const updated = await membersRepo.getById(deps.db, id);
    return c.json({ member: updated });
  });

  router.post("/admin/members/:id/revoke-sessions", requireScopes("members:admin"), async (c) => {
    const id = c.req.param("id");
    if (!id) {
      return errorResponse(c, 400, "invalid_request", "Missing id parameter.");
    }
    const existing = await membersRepo.getById(deps.db, id);
    if (!existing) {
      return errorResponse(c, 404, "not_found", "Member not found.");
    }

    await revokeAllSessionsForMember(deps.auth, id);
    return c.json({ ok: true });
  });
}
