import type { AuthDeps } from "@bandplate/core";
import {
  createMemberSchema,
  patchMemberSchema,
  revokeAllSessionsForMember,
  slugify,
  updateMemberWithGuards,
} from "@bandplate/core";
import { type Db, membersRepo } from "@bandplate/db";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, requireScopes } from "../route-registry.js";

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

    // A service-token caller has no member id and can never match `id` —
    // see `updateMemberWithGuards`'s doc comment.
    const principal = c.get("principal");
    const actingMemberId = principal?.kind === "member" ? principal.memberId : undefined;

    const result = await updateMemberWithGuards(deps.db, id, actingMemberId, parsed.data);
    switch (result.kind) {
      case "not_found":
        return errorResponse(c, 404, "not_found", "Member not found.");
      case "self":
        return errorResponse(c, 400, "self_target", "You cannot change your own role or status.");
      case "last_admin":
        return errorResponse(
          c,
          409,
          "last_admin",
          "At least one other admin must remain before this change.",
        );
      case "ok":
        return c.json({ member: result.member });
    }
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
