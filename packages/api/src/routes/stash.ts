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
  /**
   * Who the BROWSER thinks recorded this — never who it is filed under (that
   * is always the session's own `viewerMemberId`, below). A shared device's
   * offline queue can hold one member's recording past a sign-out and
   * another member's sign-in, and the queue only learns of that switch
   * through a same-origin signal that can race the network (see
   * `member-signal.ts`). This field is the backstop for that race: if it
   * does not match the session that is about to own the take, the create is
   * refused rather than filing someone else's private recording under
   * whoever is signed in now.
   *
   * Nullish, not required: a tab still running the bundle from before this
   * field existed (a stale service worker, a cached bundle across a deploy)
   * sends a body without it. Rejecting that with 422 would make the OLD
   * client's own `classifyFailure` give up and mark the recording `failed`
   * forever — the exact loss this task exists to prevent, just moved one
   * field over. Missing means "no opinion", and the create files under the
   * session the same way it always did, before this field existed.
   */
  memberId: z.string().trim().min(1).nullish(),
  // Optional: a recording can reach the stash before its member has decided
  // what song it is. A song NAMED still has to exist (404 below).
  songId: z.string().trim().min(1).nullish(),
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

    if (input.memberId != null && input.memberId !== memberId) {
      return errorResponse(
        c,
        403,
        "member_mismatch",
        "This recording belongs to a different member on this device.",
      );
    }

    const result = await createStashTake(deps.db, deps.clock.now(), memberId, {
      clientRef: input.clientRef,
      songId: input.songId ? input.songId : null,
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
