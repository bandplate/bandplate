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
import { type Db, assetsRepo, instrumentsRepo, songsRepo, takesRepo } from "@bandplate/db";
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

/**
 * The filename a member sees in their Downloads folder. Built from what the
 * take IS — song, date, which mix — rather than from the storage key, which is
 * a UUID path and tells a human nothing:
 *
 *   Neon Skyline - 2026-07-08 - full mix.opus
 *   Neon Skyline - 2026-07-08 - bass stem (lossless).flac
 *
 * `tier` only appears when it is lossless: for a band that mostly downloads the
 * lossy copy, "(lossy)" on every file is noise, while the lossless one is the
 * file you went looking for deliberately.
 */
function downloadFilename(input: {
  songTitle: string | undefined;
  recordedAt: number;
  kind: assetsRepo.AssetKind;
  tier: assetsRepo.AssetTier;
  format: assetsRepo.AssetFormat;
  instrumentLabel: string | undefined;
}): string {
  const date = new Date(input.recordedAt).toISOString().slice(0, 10);
  const what =
    input.kind === "stem" ? `${input.instrumentLabel ?? "unknown"} stem`.toLowerCase() : "full mix";
  const tier = input.tier === "lossless" ? " (lossless)" : "";
  return `${input.songTitle ?? "Take"} - ${date} - ${what}${tier}.${input.format}`;
}

/**
 * `Content-Disposition` for a filename that is very likely to carry Czech
 * diacritics. Both forms are required, and for different readers: `filename`
 * is a bare-ASCII fallback that every client understands, and `filename*`
 * (RFC 5987, percent-encoded UTF-8) is what a modern browser actually uses —
 * omit it and "Píseň o cestách" arrives as "Pise o cestach"; omit the ASCII
 * one and an old client gets no name at all. Quotes and backslashes are
 * stripped rather than escaped, since neither belongs in a song title and
 * escaping them correctly inside a quoted-string is a parser bug waiting to
 * happen.
 */
function contentDisposition(filename: string): string {
  const safe = filename.replace(/[\\"]/g, "");
  const ascii =
    safe
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .trim() || "take";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

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

  // `GET /assets/:id/download` — the same object as `/audio`, presigned to
  // arrive as a FILE rather than as a stream the browser plays inline. It is a
  // separate route rather than a `?download=1` on the one above because the two
  // have genuinely different jobs: `/audio` is on the player's hot path and is
  // re-requested on every Safari seek, so it stays a lookup and a presign,
  // while this one does two extra reads to name the file something a human can
  // find later. Sharing the route would put those reads on the seek path.
  //
  // Unlike `/audio` this serves EVERY ready asset kind the take has, lossless
  // included — that is the point of a download — but still never `peaks`,
  // which is waveform JSON with no meaning outside the app.
  router.get("/assets/:id/download", requireScopes("takes:read"), async (c) => {
    const id = c.req.param("id");
    if (!id) {
      return errorResponse(c, 400, "invalid_request", "Missing id parameter.");
    }

    const asset = await assetsRepo.getById(deps.db, id);
    if (!asset || asset.status !== "ready" || asset.kind === "peaks") {
      return errorResponse(c, 404, "not_found", "Asset not found.");
    }

    const take = await takesRepo.getById(deps.db, asset.takeId);
    const song = take ? await songsRepo.getById(deps.db, take.songId) : undefined;
    const instrument = asset.instrumentId
      ? await instrumentsRepo.getById(deps.db, asset.instrumentId)
      : undefined;

    const url = await deps.storage.signedDownloadUrl(asset.storageKey, {
      expiresIn: DOWNLOAD_URL_MIN_VALIDITY_SECONDS,
      responseContentType: asset.contentType,
      responseContentDisposition: contentDisposition(
        downloadFilename({
          songTitle: song?.title,
          recordedAt: take?.recordedAt ?? asset.createdAt,
          kind: asset.kind,
          tier: asset.tier,
          format: asset.format,
          instrumentLabel: instrument?.label,
        }),
      ),
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
