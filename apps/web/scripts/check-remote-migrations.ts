#!/usr/bin/env -S node
// The one place `wrangler d1 migrations list DB --remote` gets run and its
// output parsed, shared by `pnpm ship` (deploy.ts, run locally) and CI's
// `deploy` job (run as its own step, from `apps/web`, right after writing
// `wrangler.toml` from the `WRANGLER_TOML` secret). Both call this so
// there is exactly one parse of wrangler's table output
// (`@bandplate/db/migration-guard`'s `parsePendingMigrations`) instead of
// two that could drift out of sync.
//
// Never applies anything — CI never applies migrations at all, and this
// script only refuses to proceed when something is pending. The only
// sanctioned way to apply is `pnpm migrate:remote`
// (`apps/web/scripts/migrate-remote.ts`), run by hand.
import { spawnSync } from "node:child_process";
import { parsePendingMigrations } from "@bandplate/db/migration-guard";
import { pendingMigrationsGuardMessage } from "./deploy-guard.js";

export function checkRemoteMigrations(): void {
  const result = spawnSync("wrangler", ["d1", "migrations", "list", "DB", "--remote"], {
    encoding: "utf8",
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    console.error(
      "check-remote-migrations: `wrangler d1 migrations list DB --remote` failed — see output above.",
    );
    process.exit(1);
  }

  const pending = parsePendingMigrations(result.stdout ?? "");
  const message = pendingMigrationsGuardMessage(pending);
  if (message) {
    console.error(`check-remote-migrations: ${message}`);
    process.exit(1);
  }
  console.log("check-remote-migrations: no pending remote migrations.");
}

// Run directly (both by `pnpm exec tsx scripts/check-remote-migrations.ts`
// in CI, and indirectly via the import below in deploy.ts) rather than
// only ever being imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  checkRemoteMigrations();
}
