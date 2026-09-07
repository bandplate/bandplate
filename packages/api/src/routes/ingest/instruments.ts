// `GET /ingest/v1/instruments` — contract v1 §7/§8: the live vocabulary a
// bridge should build its Reaper-track-name -> slug mapping UI from,
// rather than hardcoding it.
import { type Db, instrumentsRepo } from "@bandlib/db";
import { type GuardedRouter, requireServiceScopes } from "../../route-registry.js";

export interface IngestInstrumentsRouteDeps {
  db: Db;
}

export function registerIngestInstrumentsRoute(
  router: GuardedRouter,
  deps: IngestInstrumentsRouteDeps,
): void {
  router.get("/ingest/v1/instruments", requireServiceScopes("ingest:write"), async (c) => {
    const instruments = await instrumentsRepo.list(deps.db);
    return c.json({ instruments: instruments.map((i) => ({ slug: i.slug, label: i.label })) }, 200);
  });
}
