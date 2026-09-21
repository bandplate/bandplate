#!/usr/bin/env -S node
// The only sanctioned way to apply migrations to the real, remote D1
// database — `pnpm migrate:remote`, run via `tsx` (a devDependency, same
// pattern as `packages/db`'s `migrate`/`seed` scripts). Never run
// `wrangler d1 migrations apply DB --remote` directly; this script wraps
// that exact command with two things it doesn't have on its own:
//
//   1. A guard (`@bandplate/db/migration-guard`'s `findUnsafeStatements`)
//      over every pending migration file, refusing to touch the database
//      at all if any of them contains a DROP TABLE, an ALTER TABLE ...
//      RENAME TO, a __new_ identifier, or a PRAGMA foreign_keys statement.
//      See that module's doc comment for why: D1 cascades a DROP TABLE
//      into every child table that references it, even with
//      `PRAGMA foreign_keys=OFF` set — which is what deleted ~2,000 rows
//      on 2026-09-20, from a migration that was the normal, correct,
//      drizzle-kit-generated shape for a column change SQLite can't do in
//      place. Schema changes against this database are additive only
//      (ADD COLUMN, new tables); anything else needs a deliberate,
//      reviewed exception, not a script that runs it unattended.
//   2. An unconditional backup (`wrangler d1 export DB --remote`) taken
//      right before applying, so a mistake that gets past the guard (or
//      isn't one the guard covers) is recoverable. See
//      `docs/deploy-cloudflare.md`'s "Migrations" section for how to
//      restore from it.
//
// Run from `apps/web` (same as every other wrangler invocation in this
// repo — see `docs/deploy-cloudflare.md`), so `wrangler.toml` resolves.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findUnsafeStatements, parsePendingMigrations } from "@bandplate/db/migration-guard";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const MIGRATIONS_DIR = join(REPO_ROOT, "packages/db/migrations/sqlite");
const BACKUP_DIR = join(REPO_ROOT, ".data/backups");

const DRY_RUN = process.argv.includes("--dry-run");
const HELP = process.argv.includes("--help") || process.argv.includes("-h");

const HELP_TEXT = `Usage: pnpm migrate:remote [--dry-run]

Applies pending Drizzle migrations to the real, remote D1 database. Run
this instead of \`wrangler d1 migrations apply DB --remote\` directly —
never the raw command. In order:

  1. List pending migrations (wrangler d1 migrations list DB --remote).
  2. Guard every pending migration file for the table-rebuild shape that
     cascades data loss on D1 (DROP TABLE, ALTER TABLE ... RENAME TO, a
     __new_ identifier, PRAGMA foreign_keys). Any finding stops here.
  3. Back up the remote database (wrangler d1 export DB --remote) to
     .data/backups/d1-<timestamp>.sql. Aborts if the export fails or is
     empty.
  4. Apply the migrations (wrangler d1 migrations apply DB --remote).

  --dry-run   Stop after step 2 (the guard). Nothing is backed up or
              applied.
  --help, -h  Print this message and exit 0.
`;

function runWrangler(args: string[]): { status: number | null; stdout: string } {
  // `--remote` never appears here except in the two calls this script
  // itself makes deliberately (list, export, apply) — nothing else in
  // this file, or anything it calls, is allowed to reach out to it.
  const result = spawnSync("wrangler", args, { encoding: "utf8" });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return { status: result.status, stdout: result.stdout ?? "" };
}

function runWranglerInherit(args: string[]): number {
  const result = spawnSync("wrangler", args, { stdio: "inherit" });
  return result.status ?? 1;
}

function fail(message: string): never {
  console.error(`migrate:remote: ${message}`);
  process.exit(1);
}

function main(): void {
  if (HELP) {
    console.log(HELP_TEXT);
    return;
  }

  // (a) What's pending.
  const listResult = runWrangler(["d1", "migrations", "list", "DB", "--remote"]);
  if (listResult.status !== 0) {
    fail("`wrangler d1 migrations list DB --remote` failed — see output above.");
  }
  const pending = parsePendingMigrations(listResult.stdout);
  if (pending.length === 0) {
    console.log("migrate:remote: no migrations to apply.");
    return;
  }
  console.log(`migrate:remote: ${pending.length} migration(s) pending: ${pending.join(", ")}`);

  // (b) The guard. Any finding stops here, before anything touches the
  // database.
  let hasFindings = false;
  for (const name of pending) {
    const path = join(MIGRATIONS_DIR, name);
    let sql: string;
    try {
      sql = readFileSync(path, "utf8");
    } catch (err) {
      fail(
        `pending migration ${name} was reported by wrangler but not found at ${path}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const findings = findUnsafeStatements(sql);
    if (findings.length === 0) {
      continue;
    }
    hasFindings = true;
    console.error(`migrate:remote: ${name} contains statement(s) the guard refuses:`);
    for (const finding of findings) {
      console.error(`  line ${finding.line}: ${finding.statement}`);
      console.error(`    ${finding.reason}`);
    }
  }
  if (hasFindings) {
    fail(
      "refusing to apply — one or more pending migrations need a reviewed, manual exception " +
        "(see docs/deploy-cloudflare.md's Migrations section), not an unattended apply.",
    );
  }
  console.log("migrate:remote: guard passed — no unsafe statements in any pending migration.");

  if (DRY_RUN) {
    console.log("migrate:remote: --dry-run, stopping before backup/apply.");
    return;
  }

  // (c) Back up before touching anything.
  mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(BACKUP_DIR, `d1-${timestamp}.sql`);
  console.log(`migrate:remote: backing up to ${backupPath}`);
  const exportStatus = runWranglerInherit([
    "d1",
    "export",
    "DB",
    "--remote",
    `--output=${backupPath}`,
  ]);
  if (exportStatus !== 0) {
    fail("`wrangler d1 export DB --remote` failed — refusing to apply without a backup.");
  }
  let backupSize: number;
  try {
    backupSize = statSync(backupPath).size;
  } catch {
    fail(`backup export reported success but ${backupPath} does not exist.`);
  }
  if (backupSize === 0) {
    fail(`backup at ${backupPath} is empty — refusing to apply without a real backup.`);
  }
  console.log(`migrate:remote: backup written, ${backupSize} bytes.`);

  // (d) Apply.
  console.log("migrate:remote: applying migrations.");
  const applyStatus = runWranglerInherit(["d1", "migrations", "apply", "DB", "--remote"]);
  if (applyStatus !== 0) {
    fail(
      `\`wrangler d1 migrations apply DB --remote\` failed — restore from ${backupPath} if the database was left in a bad state (see docs/deploy-cloudflare.md).`,
    );
  }
  console.log("migrate:remote: done.");
}

main();
