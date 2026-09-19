// `POST /stash/takes` — the browser's recorder filing a recording in the
// member's stash. JSON rather than an Astro form for the same reason
// `take-assets.ts` is: it is called by a sync loop in the background, often
// long after the page that recorded it is gone, and the answer it needs back
// (the take id, whether the file already landed) is data, not a page.
//
// Idempotent on `clientRef` (the recording's IndexedDB key): a phone that lost
// the response in a tunnel will ask again, and must get the same take.
import type { Clock } from "@bandplate/core";
import { createStashTake } from "@bandplate/core";
import type { Db } from "@bandplate/db";
import { z } from "zod";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, requireScopes } from "../route-registry.js";
import { viewerMemberId } from "../viewer.js";

export interface StashRouteDeps {
  db: Db;
  clock: Clock;
}

const createStashTakeSchema = z.object({
  clientRef: z.string().trim().min(8).max(100),
  songId: z.string().trim().min(1, "A recording belongs to a song."),
  label: z.string().trim().max(200).nullish(),
  recordedAt: z.number().int().positive(),
  durationMs: z.number().int().nonnegative().nullish(),
});

export function registerStashRoutes(router: GuardedRouter, deps: StashRouteDeps): void {
  router.post("/stash/takes", requireScopes("takes:write"), async (c) => {
    const memberId = viewerMemberId(c);
    if (!memberId) {
      return errorResponse(c, 403, "forbidden", "Only a signed-in member has a stash.");
    }

    const body = await c.req.json().catch(() => undefined);
    const parsed = createStashTakeSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        c,
        422,
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Invalid body.",
      );
    }
    const input = parsed.data;

    const result = await createStashTake(deps.db, deps.clock.now(), memberId, {
      clientRef: input.clientRef,
      songId: input.songId,
      label: input.label ? input.label : null,
      recordedAt: input.recordedAt,
      durationMs: input.durationMs ?? null,
    });

    if (result.kind === "song_not_found") {
      return errorResponse(c, 404, "song_not_found", "That song is not in the library.");
    }
    if (result.kind === "conflict") {
      return errorResponse(
        c,
        409,
        "client_ref_taken",
        "That recording id belongs to someone else.",
      );
    }
    return c.json(
      { takeId: result.take.id, created: result.created, masterReady: result.masterReady },
      result.created ? 201 : 200,
    );
  });
}
