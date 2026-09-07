// `POST /votes` — the JSON API surface for casting a keeper/not-keeper
// vote, scope-gated through `GuardedRouter` (see the brief's §5: "Scoped
// through GuardedRouter (votes:write for voting)"). The member-facing app
// itself does NOT call this route — its no-JS-first forms and the
// `VoteFavorite` island both post to apps/web's own Astro page handler
// (`apps/web/src/pages/takes/[id]/vote.astro`), which calls
// `@bandplate/db`'s `votesRepo.castVote` directly, the same way
// `admin-instruments.ts`'s Astro page mirrors (rather than calls through
// HTTP to) `packages/api/src/routes/admin-instruments.ts`. This route
// exists so the same mutation is reachable — with the same authorization
// rule — from a service token or any future non-browser client, and so
// "every mutation is scope-gated through GuardedRouter" holds for votes
// the same way it already does for every other write in this package.
import type { Clock } from "@bandplate/core";
import { type Db, takesRepo, votesRepo } from "@bandplate/db";
import { z } from "zod";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, requireScopes } from "../route-registry.js";

export interface VoteRouteDeps {
  db: Db;
  clock: Clock;
}

const castVoteSchema = z.object({
  takeId: z.string().min(1),
  keeper: z.boolean(),
});

export function registerVoteRoutes(router: GuardedRouter, deps: VoteRouteDeps): void {
  router.post("/votes", requireScopes("votes:write"), async (c) => {
    const principal = c.get("principal");
    // A member votes only as themselves — the acting member id comes from
    // the resolved principal, NEVER from the request body (see this
    // route's own test: a `memberId` field in the body is simply not part
    // of `castVoteSchema` at all, so there's nothing to read even if a
    // caller sends one). `votes:write` is granted to every member
    // (`scopesForRole`) but could in principle be granted to a service
    // token too — a service token has no `memberId` for `castVote` to
    // attribute the vote to, so it's rejected here rather than voting as
    // no one / a made-up id.
    if (principal?.kind !== "member") {
      return errorResponse(c, 403, "forbidden", "Only a signed-in member can vote.");
    }

    const body = await c.req.json().catch(() => undefined);
    const parsed = castVoteSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(c, 400, "invalid_body", "takeId and keeper (boolean) are required.");
    }

    const take = await takesRepo.getById(deps.db, parsed.data.takeId);
    if (!take) {
      return errorResponse(c, 404, "not_found", "Take not found.");
    }

    await votesRepo.castVote(deps.db, {
      takeId: parsed.data.takeId,
      memberId: principal.memberId,
      keeper: parsed.data.keeper,
      now: deps.clock.now(),
    });

    const updated = await takesRepo.getById(deps.db, parsed.data.takeId);
    return c.json(
      {
        vote: { takeId: parsed.data.takeId, keeper: parsed.data.keeper },
        take: {
          id: parsed.data.takeId,
          keeperVotes: updated?.keeperVotes ?? 0,
          totalVotes: updated?.totalVotes ?? 0,
          ratingScore: updated?.ratingScore ?? 0,
        },
      },
      200,
    );
  });
}
