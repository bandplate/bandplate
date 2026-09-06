#!/usr/bin/env node
// Standalone migration runner — Node tooling (not part of the runtime
// library), used by operators on first run and by CI/deploy scripts.
// Reads `BANDLIB_DATABASE_URL` (matching `apps/web`'s env var) with a
// fallback to the bare `DATABASE_URL` `seed/run.ts` already used, so both
// names work.
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { schema } from "../src/client.js";

const MIGRATIONS_FOLDER = new URL("../migrations/sqlite", import.meta.url).pathname;

async function main() {
  const url = process.env.BANDLIB_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Set BANDLIB_DATABASE_URL (or DATABASE_URL) before running migrations.");
  }
  if (url.startsWith("file:")) {
    await mkdir(dirname(url.slice("file:".length)), { recursive: true });
  }

  console.log(`Running migrations against ${url}`);
  const client = createClient({ url });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("Migrations complete.");
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
