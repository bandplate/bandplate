// Test-only helper: an in-memory libSQL database with the committed
// migrations applied. Not part of the runtime library surface (not
// exported from src/index.ts) — used by *.test.ts files only.
//
// Deliberately avoids `node:fs`/`node:path` imports: it resolves the
// migrations folder via `import.meta.url` + the `URL` global instead, so
// this file needs no Node-specific module even though it only ever runs
// under Node (vitest).
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { type Db, schema } from "../client.js";

const MIGRATIONS_FOLDER = new URL("../../migrations/sqlite", import.meta.url).pathname;

export async function createTestDb(): Promise<Db> {
  const client = createClient({ url: ":memory:" });
  // Concrete LibSQLDatabase here (migrate() needs the concrete type); the
  // return type widens it to Db, same as any other caller of createDb would get.
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
