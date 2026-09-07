// Ingest API — contract v1 (`docs/ingest-contract-v1.md`). Wires every
// `/ingest/v1/*` route onto the shared `GuardedRouter`.
import type { Clock, Storage } from "@bandlib/core";
import type { Db } from "@bandlib/db";
import { type GuardedRouter, publicRoute } from "../../route-registry.js";
import { registerIngestEventRoutes } from "./events.js";
import { registerIngestInstrumentsRoute } from "./instruments.js";
import { buildIngestOpenApiDocument } from "./openapi.js";
import { registerIngestTakeRoutes } from "./takes.js";

export interface IngestRouteDeps {
  db: Db;
  clock: Clock;
  storage: Storage;
}

export function registerIngestRoutes(router: GuardedRouter, deps: IngestRouteDeps): void {
  registerIngestEventRoutes(router, deps);
  registerIngestTakeRoutes(router, deps);
  registerIngestInstrumentsRoute(router, deps);

  // Public: a bridge needs to be able to fetch the machine-readable
  // contract to generate/validate its own client before it necessarily
  // has a token in hand, and the document itself carries no secrets.
  router.get("/ingest/v1/openapi.json", publicRoute(), (c) => {
    return c.json(buildIngestOpenApiDocument(router));
  });
}
