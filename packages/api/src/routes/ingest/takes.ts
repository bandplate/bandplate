// `POST /ingest/v1/takes`, `GET /ingest/v1/takes/:id/uploads`,
// `POST /ingest/v1/takes/:id/commit`, `DELETE /ingest/v1/takes/:id` —
// contract v1 §4 "Phase 2 — declare a take", "Phase 3 — commit", and §8.
import type { Clock, Storage } from "@bandplate/core";
import { buildUploadItems } from "@bandplate/core";
import { type Db, assetsRepo, eventsRepo, instrumentsRepo, takesRepo } from "@bandplate/db";
import { errorResponse } from "../../errors.js";
import { type GuardedRouter, requireServiceScopes } from "../../route-registry.js";
import { syncDeclaredAssets } from "./asset-sync.js";
import { loadInstrumentVocab, stubLabelFromSlug, unknownSlugs } from "./instrument-vocab.js";
import { commitTakeSchema, createTakeSchema } from "./schemas.js";
import { resolveSong } from "./song-resolution.js";
import { parseIsoToEpochMs } from "./support.js";

export interface IngestTakeRouteDeps {
  db: Db;
  clock: Clock;
  storage: Storage;
}

function instrumentIdToSlugMap(
  vocab: Awaited<ReturnType<typeof loadInstrumentVocab>>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const [slug, row] of vocab.bySlug) {
    m.set(row.id, slug);
  }
  return m;
}

export function registerIngestTakeRoutes(router: GuardedRouter, deps: IngestTakeRouteDeps): void {
  router.post("/ingest/v1/takes", requireServiceScopes("ingest:write"), async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = createTakeSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        c,
        422,
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Invalid body.",
      );
    }
    const input = parsed.data;
    const now = deps.clock.now();

    let vocab = await loadInstrumentVocab(deps.db);
    const declaredSlugs = [
      ...input.instruments,
      ...input.assets.filter((a) => a.kind === "stem").map((a) => a.instrument),
      // A peaks asset names the source it describes, so its slug is validated
      // like any other; an unknown one would otherwise silently resolve to
      // null and file the waveform against the master.
      ...input.assets.flatMap((a) => (a.kind === "peaks" && a.instrument ? [a.instrument] : [])),
    ];
    const unknown = unknownSlugs(vocab, declaredSlugs);
    // Created BEFORE anything else in this request touches the database, and
    // the vocabulary is reloaded rather than patched in memory — everything
    // downstream resolves slugs through `vocab`, and a half-updated map would
    // file a stem against the wrong instrument in the one case hardest to
    // notice.
    //
    // Sequentially, not in a batch: the slug is UNIQUE, so two bridges
    // declaring the same new slug at once means one insert loses. Reloading
    // afterwards is what converges them — the loser's slug is in the
    // vocabulary either way, which is the outcome that matters.
    let createdInstruments: string[] = [];
    if (unknown.length > 0 && input.createMissingInstruments) {
      for (const slug of unknown) {
        try {
          await instrumentsRepo.create(deps.db, {
            slug,
            label: stubLabelFromSlug(slug),
            isStub: true,
          });
        } catch {
          // Lost the race on the UNIQUE slug. The reload below picks up
          // whichever insert won, so this declaration proceeds regardless.
        }
      }
      createdInstruments = unknown;
      vocab = await loadInstrumentVocab(deps.db);
    }

    const stillUnknown = unknownSlugs(vocab, declaredSlugs);
    if (stillUnknown.length > 0) {
      return c.json(
        {
          error: {
            code: "unknown_instrument",
            message: `Unknown instrument slug(s): ${stillUnknown.join(", ")}.`,
          },
          validSlugs: vocab.validSlugs,
        },
        422,
      );
    }

    const existingTake = await takesRepo.getByClientRef(deps.db, input.clientRef);

    let takeId: string;
    let songId: string;
    let songCreated: boolean;
    let songMatch: string;
    let state: takesRepo.TakeState;

    if (existingTake) {
      // Idempotent re-declare (contract v1 §3/§4): the take itself (its
      // song, its instruments) is NOT re-derived from this call's body —
      // only its assets are reconciled below. Re-running the bridge with a
      // materially different `song`/`instruments` on an already-declared
      // take is out of scope for v1 (the contract doesn't describe it);
      // treating the first successful declaration as authoritative is the
      // safer default over silently mutating a take's identity underneath
      // already-cast votes/favorites.
      takeId = existingTake.id;
      songId = existingTake.songId;
      songCreated = false;
      songMatch = "existing";
      state = existingTake.state;
    } else {
      const event = await eventsRepo.getByClientRef(deps.db, input.eventClientRef);
      if (!event) {
        return errorResponse(
          c,
          404,
          "event_not_found",
          `No event with clientRef ${input.eventClientRef}. POST /ingest/v1/events first.`,
        );
      }

      const resolved = await resolveSong(deps.db, now, {
        externalRef: input.song.externalRef,
        title: input.song.title,
        createIfMissing: input.song.createIfMissing,
      });
      if (!resolved.found) {
        return c.json(
          {
            error: {
              code: "song_not_found",
              message: `No song matched "${input.song.title}" and createIfMissing was false.`,
            },
            candidates: resolved.candidates.map((s) => ({
              id: s.id,
              title: s.title,
              slug: s.slug,
            })),
          },
          409,
        );
      }

      const instrumentIds = input.instruments.map((slug) => {
        // biome-ignore lint/style/noNonNullAssertion: validated against vocab above
        return vocab.bySlug.get(slug)!.id;
      });

      try {
        const created = await takesRepo.create(deps.db, {
          songId: resolved.song.id,
          eventId: event.id,
          label: input.label ?? null,
          recordedAt: parseIsoToEpochMs(input.recordedAt),
          durationMs: input.durationMs ?? null,
          clientRef: input.clientRef,
          createdAt: now,
          updatedAt: now,
          instrumentIds,
        });
        takeId = created.id;
        state = created.state;
      } catch (err) {
        // Same idempotency-under-a-race guard as the events route: a
        // concurrent POST with the same take clientRef lost the insert
        // race (`takes.client_ref` is UNIQUE) — fall back to the winner's
        // row rather than 500ing on what is, from the caller's
        // perspective, a retried request.
        const winner = await takesRepo.getByClientRef(deps.db, input.clientRef);
        if (!winner) {
          throw err;
        }
        takeId = winner.id;
        state = winner.state;
      }
      songId = resolved.song.id;
      songCreated = resolved.created;
      songMatch = resolved.match;
    }

    const assetRows = await syncDeclaredAssets(
      deps.db,
      deps.storage,
      now,
      takeId,
      input.assets,
      new Map([...vocab.bySlug].map(([slug, row]) => [slug, row.id])),
    );
    const uploads = await buildUploadItems(
      deps.storage,
      now,
      assetRows,
      instrumentIdToSlugMap(vocab),
    );

    // `createdInstruments` is how a bridge learns it just invented vocabulary
    // — the mirror of `songMatch: "created-stub"`. A mapping file that has
    // drifted shows up here as a slug nobody meant to add, on the run that
    // added it, rather than as a strange row in the admin table weeks later.
    return c.json(
      { takeId, songId, songCreated, songMatch, state, uploads, createdInstruments },
      200,
    );
  });

  router.get(
    "/ingest/v1/takes/:takeId/uploads",
    requireServiceScopes("ingest:write"),
    async (c) => {
      const takeId = c.req.param("takeId");
      if (!takeId) {
        return errorResponse(c, 400, "invalid_request", "Missing takeId parameter.");
      }
      const take = await takesRepo.getById(deps.db, takeId);
      if (!take) {
        return errorResponse(c, 404, "not_found", "Take not found.");
      }

      const vocab = await loadInstrumentVocab(deps.db);
      const assetRows = await assetsRepo.listByTake(deps.db, takeId);
      const uploads = await buildUploadItems(
        deps.storage,
        deps.clock.now(),
        assetRows,
        instrumentIdToSlugMap(vocab),
      );

      return c.json({ takeId, uploads }, 200);
    },
  );

  router.post(
    "/ingest/v1/takes/:takeId/commit",
    requireServiceScopes("ingest:write"),
    async (c) => {
      const takeId = c.req.param("takeId");
      if (!takeId) {
        return errorResponse(c, 400, "invalid_request", "Missing takeId parameter.");
      }
      const body = await c.req.json().catch(() => ({}));
      const parsed = commitTakeSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return errorResponse(
          c,
          422,
          "validation_failed",
          parsed.error.issues[0]?.message ?? "Invalid body.",
        );
      }

      const take = await takesRepo.getById(deps.db, takeId);
      if (!take) {
        return errorResponse(c, 404, "not_found", "Take not found.");
      }

      const now = deps.clock.now();
      const assets = await assetsRepo.listByTake(deps.db, takeId);

      // HEAD every pending asset; flip anything whose object matches its
      // declared size to `ready` (contract v1 §4 "Phase 3 — commit"). This
      // sweep runs unconditionally, even for an already-published take:
      // `POST /takes` resets a changed-hash slot to `pending` regardless of
      // take state (a re-rendered master on a published take), and if this
      // sweep only ran for a not-yet-published take, that reset would never
      // get cleared — the take stays "published" in name while its master
      // asset is stranded at `pending` forever, unplayable. Running the
      // sweep first, then branching on state, is what makes a changed-hash
      // re-declaration on a published take converge back to playable.
      for (const asset of assets) {
        if (asset.status === "ready") {
          continue;
        }
        const head = await deps.storage.head(asset.storageKey);
        if (head && head.size === asset.bytes) {
          await assetsRepo.markReady(deps.db, asset.id, now);
          asset.status = "ready";
          asset.readyAt = now;
        }
      }

      // Commit is safe to retry (contract v1 §4): once published, a later
      // commit call — even one asking for `publish: false` — is a no-op
      // that reports the current state rather than un-publishing it. The
      // sweep above already ran, so any asset a re-declaration reset to
      // `pending` and that has since been re-uploaded is reflected here.
      if (take.state === "published") {
        return c.json(
          {
            takeId,
            state: take.state,
            assets: assets
              .filter((a) => a.status === "ready")
              .map((a) => ({ assetId: a.id, status: a.status, bytes: a.bytes })),
          },
          200,
        );
      }

      const notReady = assets.filter((a) => a.status !== "ready");
      const hasMasterOrStem = assets.some(
        (a) => (a.kind === "master" || a.kind === "stem") && a.status === "ready",
      );

      if (notReady.length > 0 || !hasMasterOrStem) {
        const missing =
          notReady.length > 0
            ? notReady.map((a) => ({ assetId: a.id, storageKey: a.storageKey }))
            : assets
                .filter((a) => a.kind === "master" || a.kind === "stem")
                .map((a) => ({ assetId: a.id, storageKey: a.storageKey }));
        return c.json(
          {
            error: {
              code: "assets_incomplete",
              message: hasMasterOrStem
                ? "Some declared assets have not finished uploading."
                : "At least one master or stem asset must be ready before a take can be committed.",
            },
            missing,
          },
          409,
        );
      }

      const nextState = parsed.data.publish ? "published" : "new";
      await takesRepo.setStateWithPublishedAt(
        deps.db,
        takeId,
        nextState,
        parsed.data.publish ? now : null,
        now,
      );

      return c.json(
        {
          takeId,
          state: nextState,
          assets: assets.map((a) => ({ assetId: a.id, status: a.status, bytes: a.bytes })),
        },
        200,
      );
    },
  );

  router.delete("/ingest/v1/takes/:takeId", requireServiceScopes("ingest:write"), async (c) => {
    const takeId = c.req.param("takeId");
    if (!takeId) {
      return errorResponse(c, 400, "invalid_request", "Missing takeId parameter.");
    }
    const take = await takesRepo.getById(deps.db, takeId);
    if (!take) {
      return errorResponse(c, 404, "not_found", "Take not found.");
    }
    if (take.state !== "uploading" && take.state !== "new") {
      return errorResponse(
        c,
        409,
        "take_not_deletable",
        "Only a take in state 'uploading' or 'new' may be deleted via ingest; reject a published take through the UI instead.",
      );
    }

    const assets = await assetsRepo.listByTake(deps.db, takeId);
    // DB rows are the source of truth and go first, in one batch (see the
    // "no interactive transactions" rule) — `takesRepo.remove` deletes
    // `assets`/`take_instruments`/`takes` together. The object-store
    // cleanup below is best-effort: if it fails, the row-level truth is
    // already gone and a stray object in the bucket is a harmless orphan,
    // not a correctness problem the way an orphaned DB row referencing a
    // deleted take would be.
    await takesRepo.remove(deps.db, takeId);
    if (assets.length > 0) {
      try {
        await deps.storage.delete(assets.map((a) => a.storageKey));
      } catch (err) {
        console.error("[ingest] failed to delete storage objects for removed take", takeId, err);
      }
    }

    return c.json({ ok: true }, 200);
  });
}
