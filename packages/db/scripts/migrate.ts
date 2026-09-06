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

// A libSQL URL can carry a live credential (`libsql://host?authToken=...`).
// Never print the raw URL — scheme + host only (which also drops any
// userinfo, `URL#host` never includes it), matching what an operator needs
// to confirm they're pointed at the right database without leaking the
// token into CI/deploy logs. `file:` URLs carry no credential and no
// query string in normal use, so keep the path for those — the point is
// to redact secrets, not to make local dev output useless.
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      return `file://${parsed.pathname}`;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "(unparseable database url)";
  }
}

async function main() {
  const url = process.env.BANDLIB_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Set BANDLIB_DATABASE_URL (or DATABASE_URL) before running migrations.");
  }
  if (url.startsWith("file:")) {
    await mkdir(dirname(url.slice("file:".length)), { recursive: true });
  }

  console.log(`Running migrations against ${redactUrl(url)}`);
  const client = createClient({ url });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("Migrations complete.");
  client.close();
}

main().catch((err) => {
  // libSQL/fetch errors routinely embed the request URL (and therefore the
  // auth token) in their message — e.g. a connection failure repeats the
  // full URL back. Never dump the raw error; log only its name/message
  // with the URL itself redacted, plus the (credential-free) database host
  // for context.
  const url = process.env.BANDLIB_DATABASE_URL ?? process.env.DATABASE_URL;
  const message = err instanceof Error ? err.message : String(err);
  const redactedMessage = url ? message.split(url).join(redactUrl(url)) : message;
  console.error(
    `Migration failed against ${url ? redactUrl(url) : "(no database url)"}: ${redactedMessage}`,
  );
  process.exitCode = 1;
});
