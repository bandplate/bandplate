// Test-only helper: an in-memory libSQL database with the committed
// migrations applied. Not part of the runtime library surface (not
// exported from src/index.ts) — used by *.test.ts files only.
//
// Deliberately avoids `node:fs`/`node:path` imports: it resolves the
// migrations folder via `import.meta.url` + the `URL` global instead, so
// this file needs no Node-specific module even though it only ever runs
// under Node (vitest).
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { type Db, schema } from "../client.js";

const MIGRATIONS_FOLDER = new URL("../../migrations/sqlite", import.meta.url).pathname;

/**
 * Holds the local client to one rule D1 enforces by losing data: inside a
 * batch, D1 returns each row as an object keyed by column name, so a result
 * with two columns of the same name keeps one of them and Drizzle maps the
 * rest of the row off by one. libSQL returns arrays and gets it right, so
 * without this a test would pass on exactly the query production garbles.
 * See `read.ts`.
 */
function refuseDuplicateColumnsInBatches(client: Client): void {
  const batch = client.batch.bind(client);
  client.batch = (async (...args: Parameters<Client["batch"]>) => {
    const results = await batch(...args);
    for (const [index, result] of results.entries()) {
      const seen = new Set<string>();
      for (const column of result.columns) {
        if (seen.has(column)) {
          throw new Error(
            `batch statement ${index} returns two columns named "${column}"; D1 would silently drop one (see packages/db/src/read.ts)`,
          );
        }
        seen.add(column);
      }
    }
    return results;
  }) as Client["batch"];
}

export async function createTestDb(): Promise<Db> {
  const client = createClient({ url: ":memory:" });
  refuseDuplicateColumnsInBatches(client);
  // Concrete LibSQLDatabase here (migrate() needs the concrete type); the
  // return type widens it to Db, same as any other caller of createDb would get.
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
