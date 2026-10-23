// `/public/:code/...` — what a PUBLIC share link lets a signed-out visitor
// hear: the master of the take it names, or of a take of the event it names.
// The same three things the member player asks `/assets` and `/takes` for
// (the audio, its waveform, its sources), authorised by the link instead of
// by a session.
//
// `publicRoute()`, so there is no principal to check; the code IS the
// credential, and every request re-checks it. A link a member has turned back
// into a members' link stops answering here at once. What it cannot take back
// is what a visitor already has: the 302 below is cached for 30 minutes and
// the presigned URL it points at is good for hours (see `audio.ts`). That is
// the same trade as any audio link handed out, and the owner accepted it.
//
// Masters only. Stems, the mixer and downloads stay with the members, so a
// stem's asset id 404s here even on a take the link opens, and `sources`
// lists the master alone (which is also what keeps the player from offering
// the mixer: it needs stems to).
//
// Every refusal is the same 404: an unknown code, a members' link, a song
// link, a take the link does not cover, a private take, an archived event, an
// asset that is not a ready master. Nothing here tells them apart.
import { isShareCode, playableSources, type Storage } from "@bandplate/core";
import { assetsRepo, type Db, eventsRepo, shareLinksRepo, takesRepo } from "@bandplate/db";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, publicRoute } from "../route-registry.js";
import {
  DOWNLOAD_URL_MIN_VALIDITY_SECONDS,
  peaksFor,
  REDIRECT_CACHE_MAX_SECONDS,
} from "./audio.js";

export interface PublicShareRouteDeps {
  db: Db;
  storage: Storage;
}

/**
 * Whether a PUBLIC link opens this take: the take itself, or a take of the
 * event it names. Always a band take that is not a draft (the band has not
 * been shown a draft yet, so a stranger is not either), and never through an
 * archived event
 * (a merge archives the event it empties and moves its link to the
 * survivor, so the shell must not keep playing).
 *
 * The rules are `apps/web`'s `sharePath` for the same targets, restated
 * because the API does not import the web app: band takes only, no draft,
 * no archived event. A personal day with no band take cannot reach here, since there is
 * no band take of it to ask for.
 */
export async function takeOpenedByPublicLink(
  db: Db,
  code: string | undefined,
  takeId: string,
): Promise<takesRepo.Take | undefined> {
  if (!isShareCode(code)) {
    return undefined;
  }
  const [link, take] = await Promise.all([
    shareLinksRepo.resolve(db, code),
    takesRepo.getById(db, takeId),
  ]);
  if (
    !link ||
    link.publicAt === null ||
    !take ||
    take.visibility !== "band" ||
    takesRepo.isDraft(take)
  ) {
    return undefined;
  }
  switch (link.kind) {
    case "take":
      return take.id === link.targetId ? take : undefined;
    case "event": {
      if (take.eventId !== link.targetId) {
        return undefined;
      }
      const event = await eventsRepo.getById(db, link.targetId);
      return event && event.archivedAt === null ? take : undefined;
    }
    case "song":
      return undefined;
  }
}

/** A ready master the link opens, or undefined. */
async function masterOpenedByPublicLink(
  db: Db,
  code: string | undefined,
  assetId: string | undefined,
): Promise<assetsRepo.Asset | undefined> {
  if (!assetId) {
    return undefined;
  }
  const asset = await assetsRepo.getById(db, assetId);
  if (asset?.kind !== "master" || asset.status !== "ready") {
    return undefined;
  }
  return (await takeOpenedByPublicLink(db, code, asset.takeId)) ? asset : undefined;
}

async function presignedRedirect(
  storage: Storage,
  asset: assetsRepo.Asset,
  maxAgeSeconds: number,
): Promise<Response> {
  const url = await storage.signedDownloadUrl(asset.storageKey, {
    expiresIn: DOWNLOAD_URL_MIN_VALIDITY_SECONDS,
    responseContentType: asset.contentType,
  });
  return new Response(null, {
    status: 302,
    headers: { location: url, "cache-control": `private, max-age=${maxAgeSeconds}` },
  });
}

export function registerPublicShareRoutes(router: GuardedRouter, deps: PublicShareRouteDeps): void {
  router.get("/public/:code/assets/:id/audio", publicRoute(), async (c) => {
    const asset = await masterOpenedByPublicLink(deps.db, c.req.param("code"), c.req.param("id"));
    if (!asset) {
      return errorResponse(c, 404, "not_found", "Asset not found.");
    }
    return presignedRedirect(deps.storage, asset, 1800);
  });

  router.get("/public/:code/assets/:id/peaks", publicRoute(), async (c) => {
    const audio = await masterOpenedByPublicLink(deps.db, c.req.param("code"), c.req.param("id"));
    const peaks = audio && peaksFor(audio, await assetsRepo.listByTake(deps.db, audio.takeId));
    if (!peaks) {
      return errorResponse(c, 404, "not_found", "No waveform for this asset.");
    }
    return presignedRedirect(deps.storage, peaks, REDIRECT_CACHE_MAX_SECONDS);
  });

  // The member route's shape, so the same player reads it: one entry, the
  // master, or none when the take has no ready master yet.
  router.get("/public/:code/takes/:id/sources", publicRoute(), async (c) => {
    const takeId = c.req.param("id");
    const take = takeId
      ? await takeOpenedByPublicLink(deps.db, c.req.param("code"), takeId)
      : undefined;
    if (!take) {
      return errorResponse(c, 404, "not_found", "Take not found.");
    }
    const sources = playableSources(await assetsRepo.listByTake(deps.db, take.id))
      .filter((source) => source.kind === "master")
      .map((source) => ({
        assetId: source.assetId,
        kind: source.kind,
        label: "Master",
        icon: null,
      }));
    return c.json({ sources });
  });
}
