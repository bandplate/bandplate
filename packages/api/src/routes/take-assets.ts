// The browser's own way to put audio on a take — the two calls that cannot
// be a form.
//
// `/ingest/v1/*` is closed to a member session by construction
// (`requireServiceScopes` 401s a cookie principal), and rightly so: it speaks
// the bridge's language of client refs and slug-keyed manifests. This is the
// same job in the language the UI already holds — take ids and instrument ids.
//
// WHY THESE TWO ARE JSON when every other M8 write is an Astro form: a
// presigned upload is three hops — declare, PUT the bucket, verify — and the
// middle one is a cross-origin PUT the browser makes itself. An HTML form can
// only POST multipart to its own action, so no arrangement of forms performs
// it. Everything either side of the bytes stays a form.
//
// They live in the Hono app rather than as bespoke `.ts` pages under
// `src/pages/` because `GuardedRouter` makes an unguarded route a type error
// (and `assertEveryRouteIsGuarded` a boot failure), `originCheckMiddleware`
// still applies to a cookie request, and `routes/{votes,favorites,audio}.ts`
// are the existing precedent for a cookie-principal JSON route.
import type { Clock, DeclaredAsset, Storage } from "@bandplate/core";
import {
  UPLOAD_URL_TTL_SECONDS,
  contentTypeForFormat,
  resolveSlotForUpload,
} from "@bandplate/core";
import { type Db, assetsRepo, instrumentsRepo, takesRepo } from "@bandplate/db";
import { z } from "zod";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, requireScopes } from "../route-registry.js";

export interface TakeAssetRouteDeps {
  db: Db;
  clock: Clock;
  storage: Storage;
}

/**
 * What the browser declares. A sibling of the ingest contract's
 * `assetInputSchema`, not a reuse of it, and the differences are all
 * deliberate:
 *
 *  - `instrumentId`, not a slug. The UI renders its checkboxes from the
 *    instruments table and holds ids; making it look slugs up would be a
 *    translation layer for nobody's benefit.
 *  - no `sha256`. `crypto.subtle.digest` needs the whole file as one
 *    ArrayBuffer and the platform has no incremental SHA-256, so hashing a
 *    300 MB wav would kill the tab. Integrity comes from the signed exact
 *    Content-Length plus the verify HEAD instead.
 *  - `durationMs` is MEASURED, off an `<audio>` element, before the bytes
 *    move. The bridge can only declare what its renderer told it.
 *  - no `peaks`. Nothing computes peaks yet; when something does, it will be
 *    a producer, not a person with a file picker.
 */
const declareAssetSchema = z.object({
  kind: z.enum(["master", "stem"]),
  instrumentId: z.string().trim().min(1).nullish(),
  tier: z.enum(["lossy", "lossless"]),
  format: z.enum(["opus", "mp3", "flac", "wav"]),
  bytes: z.number().int().positive(),
  durationMs: z.number().int().nonnegative().nullish(),
  /**
   * Whether the caller has already been told the slot is taken and said to go
   * ahead. Absent or false, an occupied slot comes back 409 untouched — the
   * browser is the one caller that must ask a person before destroying a file.
   */
  replace: z.boolean().default(false),
});

export function registerTakeAssetRoutes(router: GuardedRouter, deps: TakeAssetRouteDeps): void {
  router.post("/takes/:takeId/assets", requireScopes("takes:write"), async (c) => {
    const takeId = c.req.param("takeId");
    if (!takeId) {
      return errorResponse(c, 400, "invalid_request", "Missing takeId parameter.");
    }
    const body = await c.req.json().catch(() => undefined);
    const parsed = declareAssetSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        c,
        422,
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Invalid body.",
      );
    }
    const input = parsed.data;

    const take = await takesRepo.getById(deps.db, takeId);
    if (!take) {
      return errorResponse(c, 404, "take_not_found", "Take not found.");
    }

    // A master has no instrument and a stem must have one. Coercing either
    // way would silently file the object under the wrong key, so both are a
    // 422 rather than a quiet fix.
    if (input.kind === "master" && input.instrumentId) {
      return errorResponse(c, 422, "validation_failed", "A master has no instrument.");
    }
    if (input.kind === "stem" && !input.instrumentId) {
      return errorResponse(c, 422, "validation_failed", "A stem needs an instrument.");
    }

    let instrumentSlug: string | null = null;
    if (input.kind === "stem" && input.instrumentId) {
      const instrument = await instrumentsRepo.getById(deps.db, input.instrumentId);
      if (!instrument || instrument.archivedAt !== null) {
        const active = await instrumentsRepo.list(deps.db);
        return errorResponse(
          c,
          422,
          "unknown_instrument",
          `Not an instrument this band uses. Current: ${active.map((i) => i.slug).join(", ")}.`,
        );
      }
      instrumentSlug = instrument.slug;
    }

    const declared: DeclaredAsset = {
      kind: input.kind,
      instrumentId: input.kind === "stem" ? (input.instrumentId ?? null) : null,
      instrumentSlug,
      tier: input.tier,
      format: input.format,
      bytes: input.bytes,
      durationMs: input.durationMs ?? null,
    };

    const now = deps.clock.now();
    const { outcome, asset } = await resolveSlotForUpload(
      deps.db,
      deps.storage,
      now,
      takeId,
      declared,
      { replace: input.replace },
    );

    if (outcome === "occupied") {
      // Everything the UI needs to say "this take already has a lossy master
      // (opus, 4.2 MB) — replace it?" without a second round trip.
      return c.json(
        {
          error: {
            code: "slot_occupied",
            message: "Something is already in that slot.",
            existing: {
              assetId: asset.id,
              kind: asset.kind,
              tier: asset.tier,
              format: asset.format,
              bytes: asset.bytes,
              status: asset.status,
            },
          },
        },
        409,
      );
    }

    // A stem is PROOF the instrument was played, so the take's instrument set
    // — the superset of "what has its own file" — has to contain it.
    // Idempotent, and deliberately not symmetric: deleting a stem later does
    // not un-play the instrument.
    if (declared.kind === "stem" && declared.instrumentId) {
      await takesRepo.addInstrument(deps.db, takeId, declared.instrumentId);
    }

    return c.json({
      assetId: asset.id,
      outcome,
      method: "PUT",
      url: await deps.storage.signedUploadUrl(asset.storageKey, {
        contentType: asset.contentType,
        contentLength: asset.bytes,
        expiresIn: UPLOAD_URL_TTL_SECONDS,
      }),
      // The browser sets Content-Length itself and is forbidden from
      // overriding it, so only the type is listed — but BOTH are signed, so
      // a body of the wrong length is refused by the bucket, which is what
      // makes the verify step below meaningful.
      headers: { "Content-Type": contentTypeForFormat(input.format) },
      expiresAt: new Date(now + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    });
  });

  router.post("/assets/:assetId/verify", requireScopes("takes:write"), async (c) => {
    const assetId = c.req.param("assetId");
    if (!assetId) {
      return errorResponse(c, 400, "invalid_request", "Missing assetId parameter.");
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({ durationMs: z.number().int().nonnegative().nullish() })
      .safeParse(body ?? {});
    const measuredDuration = parsed.success ? (parsed.data.durationMs ?? null) : null;

    const asset = await assetsRepo.getById(deps.db, assetId);
    if (!asset) {
      return errorResponse(c, 404, "asset_not_found", "Asset not found.");
    }
    if (asset.status === "ready") {
      return c.json({ assetId, status: "ready", alreadyReady: true });
    }

    // The object either arrived whole or it did not. A single-part PUT is
    // atomic and its signed Content-Length means a short body is refused
    // outright, so a size mismatch here means something stranger than a
    // truncated upload — either way the row stays `pending` and the UI offers
    // to try again.
    const head = await deps.storage.head(asset.storageKey);
    if (!head) {
      return errorResponse(c, 409, "asset_missing", "That file didn't arrive.");
    }
    if (head.size !== asset.bytes) {
      return errorResponse(
        c,
        409,
        "asset_incomplete",
        `Expected ${asset.bytes} bytes, found ${head.size}.`,
      );
    }

    const now = deps.clock.now();
    await assetsRepo.markReady(deps.db, assetId, now, {
      durationMs: measuredDuration ?? asset.durationMs,
    });

    // The take's own duration is the PERFORMANCE's length, which the master
    // defines — a stem could be a twelve-second overdub. Written only when
    // it is not already known, so a later re-upload never quietly moves it.
    // This is the first code in the app that ever sets `takes.durationMs`:
    // ingest declares whatever the bridge was told, and the seed invents one.
    let takeDurationMs: number | null = null;
    if (asset.kind === "master" && measuredDuration !== null) {
      const take = await takesRepo.getById(deps.db, asset.takeId);
      if (take && take.durationMs === null) {
        await takesRepo.update(deps.db, take.id, { durationMs: measuredDuration, updatedAt: now });
        takeDurationMs = measuredDuration;
      }
    }

    return c.json({ assetId, status: "ready", takeDurationMs });
  });
}
