// `POST /favorites` — the JSON API surface for toggling a favorite/pin on a
// song, take, or event, scope-gated through `GuardedRouter` on the
// `favorites:write` scope (see `@bandplate/core`'s `scopes.ts` for why that's
// a distinct scope from `votes:write`). Same relationship to the
// member-facing app as `routes/votes.ts`: the browser's own forms/island
// post to apps/web's Astro page handler (`apps/web/src/pages/favorites.ts`),
// which calls `@bandplate/db`'s `favoritesRepo.toggle` directly — this route
// is the mirrored, independently-authorized JSON surface for a service
// token or any future non-browser client.
import type { Clock } from "@bandplate/core";
import { type Db, eventsRepo, favoritesRepo, songsRepo, takesRepo } from "@bandplate/db";
import { z } from "zod";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, requireScopes } from "../route-registry.js";

export interface FavoriteRouteDeps {
  db: Db;
  clock: Clock;
}

const toggleFavoriteSchema = z.object({
  targetType: z.enum(["song", "take", "event"]),
  targetId: z.string().min(1),
});

async function targetExists(
  db: Db,
  targetType: "song" | "take" | "event",
  targetId: string,
  memberId: string,
): Promise<boolean> {
  switch (targetType) {
    case "song":
      return (await songsRepo.getById(db, targetId)) !== undefined;
    case "take": {
      const take = await takesRepo.getById(db, targetId);
      return take !== undefined && takesRepo.isVisibleTo(take, memberId);
    }
    case "event":
      return (await eventsRepo.getById(db, targetId)) !== undefined;
  }
}

export function registerFavoriteRoutes(router: GuardedRouter, deps: FavoriteRouteDeps): void {
  router.post("/favorites", requireScopes("favorites:write"), async (c) => {
    const principal = c.get("principal");
    // Same rule as `routes/votes.ts`: a member favorites only as
    // themselves, from the resolved principal — never a body field (there
    // is no `memberId` field in `toggleFavoriteSchema` for a caller to
    // even attempt one), and never on behalf of a service token, which has
    // no member identity to attribute the favorite to.
    if (principal?.kind !== "member") {
      return errorResponse(c, 403, "forbidden", "Only a signed-in member can favorite something.");
    }

    const body = await c.req.json().catch(() => undefined);
    const parsed = toggleFavoriteSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        c,
        400,
        "invalid_body",
        "targetType (song|take|event) and targetId are required.",
      );
    }

    const exists = await targetExists(
      deps.db,
      parsed.data.targetType,
      parsed.data.targetId,
      principal.memberId,
    );
    if (!exists) {
      return errorResponse(c, 404, "not_found", "That song, take, or event was not found.");
    }

    const result = await favoritesRepo.toggle(deps.db, {
      memberId: principal.memberId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      now: deps.clock.now(),
    });

    return c.json(
      { targetType: parsed.data.targetType, targetId: parsed.data.targetId, ...result },
      200,
    );
  });
}
