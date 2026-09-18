// `GET /ingest/v1/instruments` — contract v1 §7/§8: the live vocabulary a
// bridge should build its Reaper-track-name -> slug mapping UI from,
// rather than hardcoding it.
//
// Each entry carries its aliases: other names for the same instrument, every
// one of them accepted wherever `slug` is. A bridge that checks its slugs
// before declaring anything needs them, or it refuses a slug the server would
// take — which is exactly what happened the first time a band gave an
// instrument a second name.
import { type Db, instrumentsRepo } from "@bandplate/db";
import { type GuardedRouter, requireServiceScopes } from "../../route-registry.js";

export interface IngestInstrumentsRouteDeps {
  db: Db;
}

export function registerIngestInstrumentsRoute(
  router: GuardedRouter,
  deps: IngestInstrumentsRouteDeps,
): void {
  router.get("/ingest/v1/instruments", requireServiceScopes("ingest:write"), async (c) => {
    const [instruments, aliases] = await Promise.all([
      instrumentsRepo.list(deps.db),
      instrumentsRepo.listAllAliases(deps.db),
    ]);
    // `list` excludes archived instruments, so their aliases have nowhere to
    // attach and drop out here — matching `loadInstrumentVocab`, where an
    // alias of an archived instrument does not resolve either.
    const aliasesById = new Map<string, string[]>();
    for (const alias of aliases) {
      const slugs = aliasesById.get(alias.instrumentId) ?? [];
      slugs.push(alias.slug);
      aliasesById.set(alias.instrumentId, slugs);
    }
    return c.json(
      {
        instruments: instruments.map((i) => ({
          slug: i.slug,
          label: i.label,
          aliases: aliasesById.get(i.id) ?? [],
        })),
      },
      200,
    );
  });
}
