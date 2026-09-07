// `GET /assets/:id/audio` — the one way audio bytes ever reach the
// browser. Authenticates and authorises (any principal with `takes:read`
// — every signed-in member, same as the rest of the read surface, no
// per-take restriction: the app has no concept of a take some members
// can't see), then 302s to a presigned GET. The `<audio>` element follows
// the redirect and issues `Range` requests straight at the bucket — this
// route is never on the hot path for the actual bytes, and Safari
// re-hitting it on every seek (it re-requests and re-follows the
// redirect) is exactly why the handler has to stay cheap: one `getById`,
// one presign call, no fan-out.
//
// `Cache-Control: private, max-age=1800` on the 302 ITSELF (not just the
// bucket response) lets the browser skip re-issuing this redirect request
// for 30 minutes on a repeat visit to the same take, while
// `signedDownloadUrl`'s own quantised signing (see `@bandplate/storage`) is
// what makes the LOCATION it redirects to cache-identical across that
// window too — see task-7-report.md for the proof (a real cache hit,
// verified in a browser).
import type { Storage } from "@bandplate/core";
import { type Db, assetsRepo } from "@bandplate/db";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, requireScopes } from "../route-registry.js";

export interface AudioRouteDeps {
  db: Db;
  storage: Storage;
}

/**
 * Minimum guaranteed real-world validity of the presigned URL this route
 * hands out, in seconds. `signedDownloadUrl` pads this internally by one
 * quantisation window (1h) to make the guarantee hold regardless of where
 * in the window the request lands — so the actual signed TTL is 6h, and
 * every request within a given hour gets a byte-identical Location.
 */
const DOWNLOAD_URL_MIN_VALIDITY_SECONDS = 5 * 60 * 60;

export function registerAudioRoutes(router: GuardedRouter, deps: AudioRouteDeps): void {
  router.get("/assets/:id/audio", requireScopes("takes:read"), async (c) => {
    const id = c.req.param("id");
    if (!id) {
      return errorResponse(c, 400, "invalid_request", "Missing id parameter.");
    }

    const asset = await assetsRepo.getById(deps.db, id);
    // A take with no playable asset gets no play control in the UI at
    // all (see TakeRow/the take detail page) — reaching this route for a
    // missing/not-ready asset means either a stale link or a direct
    // request, not a real user flow. 404 either way; no distinction
    // between "doesn't exist" and "not ready yet" is leaked.
    if (!asset || asset.status !== "ready") {
      return errorResponse(c, 404, "not_found", "Asset not found.");
    }
    // `peaks` assets are waveform data, not audio — out of scope for this
    // endpoint (and for the player entirely; see the brief).
    if (asset.kind !== "master" && asset.kind !== "stem") {
      return errorResponse(c, 404, "not_found", "Asset not found.");
    }

    const url = await deps.storage.signedDownloadUrl(asset.storageKey, {
      expiresIn: DOWNLOAD_URL_MIN_VALIDITY_SECONDS,
      responseContentType: asset.contentType,
    });

    return new Response(null, {
      status: 302,
      headers: {
        location: url,
        "cache-control": "private, max-age=1800",
      },
    });
  });
}
