import type { AuthDeps } from "@bandplate/core";
import { bootstrapAdmin } from "@bandplate/core";
import { type Db, membersRepo } from "@bandplate/db";
import { z } from "zod";
import { setSessionCookie } from "../cookies.js";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, publicRoute } from "../route-registry.js";

const bootstrapBodySchema = z.object({
  bootstrapToken: z.string().min(1),
  displayName: z.string().trim().min(1).max(200),
  email: z.string().trim().min(1).max(320),
});

export interface SetupRouteDeps {
  db: Db;
  auth: AuthDeps;
  cookieSecure: boolean;
}

export function registerSetupRoutes(router: GuardedRouter, deps: SetupRouteDeps): void {
  router.get("/setup", publicRoute(), async (c) => {
    const count = await membersRepo.count(deps.db);
    if (count > 0) {
      return errorResponse(c, 404, "not_found", "Not found.");
    }
    return c.json({ bootstrapAvailable: true });
  });

  router.post("/setup", publicRoute(), async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = bootstrapBodySchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        c,
        400,
        "invalid_body",
        "bootstrapToken, displayName and email are required.",
      );
    }

    const result = await bootstrapAdmin(deps.auth, parsed.data);

    if (!result.ok || !result.sessionToken) {
      if (result.reason === "already-bootstrapped") {
        return errorResponse(c, 404, "not_found", "Not found.");
      }
      return errorResponse(c, 401, "invalid_bootstrap_token", "Invalid bootstrap token.");
    }

    setSessionCookie(c, result.sessionToken, { secure: deps.cookieSecure });
    return c.json({ ok: true, testEmailSent: result.testEmailSent === true }, 201);
  });
}
