import type { AuthDeps } from "@bandlib/core";
import { createServiceToken, isScope } from "@bandlib/core";
import { type Db, serviceTokensRepo } from "@bandlib/db";
import { z } from "zod";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, requireScopes } from "../route-registry.js";

const scopeSchema = z.string().refine(isScope, { message: "Unknown scope." });

const createTokenSchema = z.object({
  label: z.string().trim().min(1).max(200),
  scopes: z.array(scopeSchema).min(1),
});

const patchTokenSchema = z.object({
  scopes: z.array(scopeSchema).min(1),
});

export interface AdminTokenRouteDeps {
  db: Db;
  auth: AuthDeps;
}

/** Never include the stored hash in a response — only the raw secret, exactly once, at creation. */
function toPublicToken<T extends { tokenHash: string }>(token: T): Omit<T, "tokenHash"> {
  const { tokenHash: _tokenHash, ...rest } = token;
  return rest;
}

export function registerAdminTokenRoutes(router: GuardedRouter, deps: AdminTokenRouteDeps): void {
  router.get("/admin/tokens", requireScopes("tokens:admin"), async (c) => {
    const tokens = await serviceTokensRepo.list(deps.db);
    return c.json({ tokens: tokens.map(toPublicToken) });
  });

  router.post("/admin/tokens", requireScopes("tokens:admin"), async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = createTokenSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        c,
        400,
        "invalid_body",
        "label and a non-empty scopes array are required.",
      );
    }

    const created = await createServiceToken(deps.auth, {
      label: parsed.data.label,
      scopes: parsed.data.scopes,
    });

    // The raw secret is returned exactly once, here — never stored raw,
    // never logged, and never returned again by any later read.
    return c.json(
      {
        token: {
          id: created.id,
          label: created.label,
          scopes: created.scopes,
          createdAt: created.createdAt,
          rawToken: created.rawToken,
        },
      },
      201,
    );
  });

  router.patch("/admin/tokens/:id", requireScopes("tokens:admin"), async (c) => {
    const id = c.req.param("id");
    if (!id) {
      return errorResponse(c, 400, "invalid_request", "Missing id parameter.");
    }
    const body = await c.req.json().catch(() => undefined);
    const parsed = patchTokenSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(c, 400, "invalid_body", "A non-empty scopes array is required.");
    }

    const existing = await serviceTokensRepo.getById(deps.db, id);
    if (!existing) {
      return errorResponse(c, 404, "not_found", "Token not found.");
    }

    await serviceTokensRepo.setScopes(deps.db, id, parsed.data.scopes);
    const updated = await serviceTokensRepo.getById(deps.db, id);
    if (!updated) {
      return errorResponse(c, 404, "not_found", "Token not found.");
    }
    return c.json({ token: toPublicToken(updated) });
  });

  router.delete("/admin/tokens/:id", requireScopes("tokens:admin"), async (c) => {
    const id = c.req.param("id");
    if (!id) {
      return errorResponse(c, 400, "invalid_request", "Missing id parameter.");
    }
    const existing = await serviceTokensRepo.getById(deps.db, id);
    if (!existing) {
      return errorResponse(c, 404, "not_found", "Token not found.");
    }

    await serviceTokensRepo.revoke(deps.db, id, deps.auth.clock.now());
    return c.json({ ok: true });
  });
}
