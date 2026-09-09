// `POST /ingest/v1/events` — contract v1 §4 "Phase 1 — declare the event".
import type { Clock } from "@bandplate/core";
import { type Db, eventsRepo } from "@bandplate/db";
import { errorResponse } from "../../errors.js";
import { type GuardedRouter, requireServiceScopes } from "../../route-registry.js";
import { createEventSchema } from "./schemas.js";
import { parseIsoToEpochMs } from "./support.js";

export interface IngestEventRouteDeps {
  db: Db;
  clock: Clock;
}

export function registerIngestEventRoutes(router: GuardedRouter, deps: IngestEventRouteDeps): void {
  router.post("/ingest/v1/events", requireServiceScopes("ingest:write"), async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        c,
        422,
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Invalid body.",
      );
    }

    const now = deps.clock.now();

    // Idempotency (contract v1 §3): re-posting an existing clientRef is a
    // lookup, not an error — no write happens at all on the repeat call,
    // UNLESS the event had been archived, in which case it comes back. The
    // band has just recorded at it, so "retired" has stopped being true; and
    // `getByClientRef` must not filter archived rows anyway, since
    // `client_ref` is UNIQUE and a filtered lookup would drop straight into
    // the insert below and throw on the constraint.
    const existing = await eventsRepo.getByClientRef(deps.db, parsed.data.clientRef);
    if (existing) {
      if (existing.archivedAt !== null) {
        await eventsRepo.update(deps.db, existing.id, { archivedAt: null, updatedAt: now });
      }
      return c.json({ eventId: existing.id, created: false }, 200);
    }

    try {
      const created = await eventsRepo.create(deps.db, {
        kind: parsed.data.kind,
        title: parsed.data.title ?? null,
        heldAt: parseIsoToEpochMs(parsed.data.heldAt),
        venue: parsed.data.venue ?? null,
        notes: parsed.data.notes ?? null,
        clientRef: parsed.data.clientRef,
        createdAt: now,
        updatedAt: now,
      });
      return c.json({ eventId: created.id, created: true }, 200);
    } catch (err) {
      // A concurrent POST with the same clientRef lost the race between
      // the lookup above and this insert — `events.client_ref` is UNIQUE,
      // so the loser's insert throws rather than duplicating the row.
      // Re-fetch and return the winner's row with `created: false` instead
      // of surfacing a 500 for what is, from the caller's perspective, a
      // perfectly idempotent request.
      const winner = await eventsRepo.getByClientRef(deps.db, parsed.data.clientRef);
      if (winner) {
        return c.json({ eventId: winner.id, created: false }, 200);
      }
      throw err;
    }
  });
}
