// `GET /assets/:id/audio` — the one way audio bytes ever reach the
// browser. Authenticates and authorises (any principal with `takes:read`
// — every signed-in member, same as the rest of the read surface — plus
// `takesRepo.isVisibleTo`: a private stash take is its owner's alone and
// 404s for everyone else, same as it does everywhere else in the read
// surface), then 302s to a presigned GET. The `<audio>` element follows
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
import { playableSources, type Storage } from "@bandplate/core";
import { assetsRepo, type Db, instrumentsRepo, songsRepo, takesRepo } from "@bandplate/db";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, requireScopes } from "../route-registry.js";
import { viewerMemberId } from "../viewer.js";

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
 * The ceiling on how long a browser may reuse one of these 302s.
 *
 * A cached redirect MUST NOT outlive the signature it points at. When it
 * does, the browser replays it to an expired presigned URL, R2 answers 403
 * with no `Access-Control-Allow-Origin` on it, and the browser reports that
 * as a CORS failure — which is a lie about the cause, and sent us looking at
 * the bucket's CORS rules (correct all along) rather than at this number.
 * The tell is that a hard reload fixes it: that bypasses the HTTP cache, so
 * the redirect is re-issued and signed afresh.
 *
 * Derived from the validity guarantee rather than written out, so the two can
 * never drift apart again. Half of it, so a redirect served at the very end
 * of its cache lifetime still has hours of signature left to play with.
 */
const REDIRECT_CACHE_MAX_SECONDS = Math.floor(DOWNLOAD_URL_MIN_VALIDITY_SECONDS / 2);

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

    const found = await assetsRepo.getByIdWithTakeAccess(deps.db, id);
    const asset = found?.asset;
    // A take with no playable asset gets no play control in the UI at
    // all (see TakeRow/the take detail page) — reaching this route for a
    // missing/not-ready asset means either a stale link or a direct
    // request, not a real user flow. 404 either way; no distinction
    // between "doesn't exist" and "not ready yet" is leaked. Someone else's
    // private take gets the same 404 — see `takesRepo.isVisibleTo`.
    if (
      !found ||
      !asset ||
      asset.status !== "ready" ||
      !takesRepo.isVisibleTo(found, viewerMemberId(c))
    ) {
      return errorResponse(c, 404, "not_found", "Asset not found.");
    }
    // `peaks` assets are waveform data, not audio — they have their own
    // route below. (This comment used to say peaks were out of scope for
    // the player entirely; the player draws a waveform now.)
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

  // `GET /takes/:id/sources` — what this take can be heard as: its master,
  // and one entry per stem it has.
  //
  // The player's source switch needs this wherever you are, and a take ROW
  // (home, /takes, a song page) knows only the master — only the take's own
  // page renders the stems. Fetched when the switch is opened rather than
  // rendered into every row on every page: a row that is never played never
  // pays for it, and the list is at most a dozen entries on a take that is
  // already in the database.
  router.get("/takes/:id/sources", requireScopes("takes:read"), async (c) => {
    const id = c.req.param("id");
    if (!id) {
      return errorResponse(c, 400, "invalid_request", "Missing id parameter.");
    }

    const take = await takesRepo.getById(deps.db, id);
    if (!take || !takesRepo.isVisibleTo(take, viewerMemberId(c))) {
      return errorResponse(c, 404, "not_found", "Take not found.");
    }

    const assets = await assetsRepo.listByTake(deps.db, id);
    // One entry per SOURCE, not per file — `playableSources` owns that rule
    // now, because the mixer asks the same question and two answers to "what
    // can this take be heard as" drift within a release. What stays here is
    // the DECORATION: the label, the glyph and the order, which need the
    // instruments table and are this route's own business.
    const playable = playableSources(assets);

    const instruments = await instrumentsRepo.list(deps.db, { includeArchived: true });
    const byId = new Map(instruments.map((i) => [i.id, i]));

    const sources = playable
      .map((source) => {
        const instrument = source.instrumentId ? byId.get(source.instrumentId) : undefined;
        return {
          assetId: source.assetId,
          kind: source.kind,
          // "Master" is the label the player already announces for a take's
          // main mix — see `PlayerTrack.sourceKind`.
          label: instrument?.label ?? "Master",
          icon: instrument?.icon ?? null,
          sortOrder: instrument?.sortOrder ?? -1,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return c.json({ sources });
  });

  // `GET /assets/:id/peaks` — the waveform for an audio asset, where `:id` is
  // the AUDIO asset, not the peaks row.
  //
  // Addressed that way on purpose. Every play/solo control on the site already
  // carries the audio asset's id (`data-asset-id`), so the player can ask for a
  // shape with what it already holds; the alternative was rendering a second id
  // into every take row on every page against the chance someone presses play.
  // The sibling lookup is one indexed read on a take that is already loaded.
  //
  // 404 when a take has no peaks yet, which is EVERY take until something
  // computes them — the player treats that as "no picture", not as an error,
  // and falls back to a plain rail.
  router.get("/assets/:id/peaks", requireScopes("takes:read"), async (c) => {
    const id = c.req.param("id");
    if (!id) {
      return errorResponse(c, 400, "invalid_request", "Missing id parameter.");
    }

    const found = await assetsRepo.getByIdWithTakeAccess(deps.db, id);
    const audio = found?.asset;
    if (
      !found ||
      !audio ||
      audio.status !== "ready" ||
      !takesRepo.isVisibleTo(found, viewerMemberId(c))
    ) {
      return errorResponse(c, 404, "not_found", "Asset not found.");
    }
    if (audio.kind !== "master" && audio.kind !== "stem") {
      return errorResponse(c, 404, "not_found", "Asset not found.");
    }

    // The peaks row describing THIS source: same take, and the same
    // instrument (null for a master). Peaks are per audio asset — see
    // `peaksStorageKey`'s comment for why that is not per take.
    const siblings = await assetsRepo.listByTake(deps.db, audio.takeId);
    const peaks = siblings.find(
      (a) =>
        a.kind === "peaks" &&
        a.status === "ready" &&
        (a.instrumentId ?? null) === (audio.kind === "stem" ? audio.instrumentId : null),
    );
    if (!peaks) {
      return errorResponse(c, 404, "not_found", "No waveform for this asset.");
    }

    const url = await deps.storage.signedDownloadUrl(peaks.storageKey, {
      expiresIn: DOWNLOAD_URL_MIN_VALIDITY_SECONDS,
      responseContentType: peaks.contentType,
    });

    return new Response(null, {
      status: 302,
      headers: {
        location: url,
        // A waveform never changes once written, so this wants the longest
        // reuse the signature allows — but no longer. It used to say 86400,
        // a full day, against a URL guaranteed for five hours: every visit
        // between the fifth hour and the twenty-fourth replayed a cached
        // redirect to a dead signature and failed as a CORS error.
        "cache-control": `private, max-age=${REDIRECT_CACHE_MAX_SECONDS}`,
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
    if (asset?.status !== "ready" || asset.kind === "peaks") {
      return errorResponse(c, 404, "not_found", "Asset not found.");
    }

    // Same access check as `/audio` and `/peaks`, done explicitly here rather
    // than through `getByIdWithTakeAccess`: this route also needs the take's
    // song and duration for the filename below, which that lookup doesn't
    // carry — so the take is fetched in full and checked before anything
    // else uses it.
    const take = await takesRepo.getById(deps.db, asset.takeId);
    if (!take || !takesRepo.isVisibleTo(take, viewerMemberId(c))) {
      return errorResponse(c, 404, "not_found", "Asset not found.");
    }
    // A stash recording may not have a song yet; `downloadFilename` already
    // falls back to "Take" for the name, so there is nothing to refuse here.
    const song = take.songId ? await songsRepo.getById(deps.db, take.songId) : undefined;
    const instrument = asset.instrumentId
      ? await instrumentsRepo.getById(deps.db, asset.instrumentId)
      : undefined;

    const url = await deps.storage.signedDownloadUrl(asset.storageKey, {
      expiresIn: DOWNLOAD_URL_MIN_VALIDITY_SECONDS,
      responseContentType: asset.contentType,
      responseContentDisposition: contentDisposition(
        downloadFilename({
          songTitle: song?.title,
          recordedAt: take.recordedAt,
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
