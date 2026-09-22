import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findUnsafeStatements,
  parsePendingMigrations,
  retryMigrationsList,
  UNSAFE_BASELINE,
} from "./migration-guard.js";

describe("findUnsafeStatements", () => {
  it("passes a pure additive migration", () => {
    const sql = "ALTER TABLE `members` ADD `locale` text DEFAULT 'en' NOT NULL;";
    expect(findUnsafeStatements(sql)).toEqual([]);
  });

  it("passes CREATE TABLE and other additive statements", () => {
    const sql = [
      "CREATE TABLE `foo` (",
      "\t`id` text PRIMARY KEY NOT NULL",
      ");",
      "--> statement-breakpoint",
      "CREATE INDEX `foo_idx` ON `foo` (`id`);",
    ].join("\n");
    expect(findUnsafeStatements(sql)).toEqual([]);
  });

  it("catches DROP TABLE with its line number and a D1-cascade reason", () => {
    const sql = ["ALTER TABLE `x` ADD `y` text;", "DROP TABLE `takes`;"].join("\n");
    const findings = findUnsafeStatements(sql);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 2, statement: "DROP TABLE `takes`;" });
    expect(findings[0]?.reason).toMatch(/cascad/i);
  });

  it("catches ALTER TABLE ... RENAME TO", () => {
    const sql = "ALTER TABLE `__new_takes` RENAME TO `takes`;";
    const findings = findUnsafeStatements(sql);
    // Matches both the RENAME TO pattern and the __new_ identifier pattern.
    expect(findings.some((f) => f.reason.toLowerCase().includes("rename"))).toBe(true);
    expect(findings.every((f) => f.line === 1)).toBe(true);
  });

  it("catches an identifier starting with __new_", () => {
    const sql = "CREATE TABLE `__new_takes` (\n\t`id` text PRIMARY KEY NOT NULL\n);";
    const findings = findUnsafeStatements(sql);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 1 });
    expect(findings[0]?.reason.toLowerCase()).toContain("rebuild");
  });

  it("catches PRAGMA foreign_keys", () => {
    const sql = "PRAGMA foreign_keys=OFF;";
    const findings = findUnsafeStatements(sql);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason.toLowerCase()).toContain("d1");
  });

  it("ignores a pattern that only appears inside a -- comment", () => {
    const sql = [
      "-- this used to DROP TABLE takes, don't do that again",
      "ALTER TABLE `x` ADD `y` text;",
    ].join("\n");
    expect(findUnsafeStatements(sql)).toEqual([]);
  });

  it("catches lower-case variants of every pattern", () => {
    const sql = [
      "drop table `takes`;",
      "alter table `__new_takes` rename to `takes`;",
      "pragma foreign_keys=off;",
    ].join("\n");
    const findings = findUnsafeStatements(sql);
    expect(findings.length).toBeGreaterThanOrEqual(3);
  });

  it("reports one finding per matched line, at the correct line number", () => {
    const sql = [
      "CREATE TABLE `__new_takes` (",
      "\t`id` text PRIMARY KEY NOT NULL",
      ");",
      "--> statement-breakpoint",
      "DROP TABLE `takes`;",
    ].join("\n");
    const findings = findUnsafeStatements(sql);
    const lines = findings.map((f) => f.line).sort();
    expect(lines).toEqual([1, 5]);
  });
});

describe("UNSAFE_BASELINE", () => {
  it("lists exactly the migration files that predate the guard", () => {
    expect(UNSAFE_BASELINE).toEqual([
      "0000_careless_prima.sql",
      "0001_optimal_johnny_storm.sql",
      "0002_careful_carlie_cooper.sql",
      "0003_add_instrument_icon.sql",
      "0004_add_event_archived_at.sql",
      "0005_add_member_locale.sql",
      "0006_add_instrument_color.sql",
      "0007_add_instrument_is_stub.sql",
      "0008_add_instrument_aliases.sql",
      "0009_push_notifications.sql",
      "0010_stash.sql",
      "0011_add_member_home_visit.sql",
    ]);
  });
});

describe("every migration not in UNSAFE_BASELINE is guard-clean", () => {
  const migrationsDir = fileURLToPath(new URL("../migrations/sqlite", import.meta.url));
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
  const checked = files.filter((name) => !UNSAFE_BASELINE.includes(name));

  it("has at least one file left to check (the baseline isn't swallowing everything)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(checked)("%s has no unsafe statements", (name) => {
    const sql = readFileSync(`${migrationsDir}/${name}`, "utf8");
    expect(findUnsafeStatements(sql)).toEqual([]);
  });
});

describe("parsePendingMigrations", () => {
  it("returns an empty list when wrangler reports nothing to apply", () => {
    const output = "✅ No migrations to apply!\n";
    expect(parsePendingMigrations(output)).toEqual([]);
  });

  it("parses a single-row box-drawn table", () => {
    const output = [
      "Migrations to be applied:",
      "┌───────────────────────┐",
      "│ Name                   │",
      "├───────────────────────┤",
      "│ 0012_add_venue.sql     │",
      "└───────────────────────┘",
      "",
    ].join("\n");
    expect(parsePendingMigrations(output)).toEqual(["0012_add_venue.sql"]);
  });

  it("parses a multi-row box-drawn table, in order", () => {
    const output = [
      "Migrations to be applied:",
      "┌──────────────────────────┐",
      "│ Name                      │",
      "├──────────────────────────┤",
      "│ 0012_add_venue.sql        │",
      "├──────────────────────────┤",
      "│ 0013_add_setlist.sql      │",
      "└──────────────────────────┘",
      "",
    ].join("\n");
    expect(parsePendingMigrations(output)).toEqual(["0012_add_venue.sql", "0013_add_setlist.sql"]);
  });

  it("ignores wrangler's other log noise around the table", () => {
    const output = [
      "▲ [WARNING] Some unrelated warning from wrangler",
      "",
      "Migrations to be applied:",
      "┌──────────────────────┐",
      "│ Name                  │",
      "├──────────────────────┤",
      "│ 0012_add_venue.sql    │",
      "└──────────────────────┘",
      "",
    ].join("\n");
    expect(parsePendingMigrations(output)).toEqual(["0012_add_venue.sql"]);
  });
});

describe("retryMigrationsList", () => {
  const flake = [
    "✘ [ERROR] A request to the Cloudflare API (/accounts/abc/d1/database/def/query) failed.",
    "",
    "  The given account is not valid or is not authorized to access this service [code: 7403]",
  ].join("\n");

  it("retries Cloudflare's passing 7403, with a growing wait", () => {
    expect(retryMigrationsList(flake, 1)).toEqual({ retry: true, delayMs: 1000 });
    expect(retryMigrationsList(flake, 2)).toEqual({ retry: true, delayMs: 2000 });
  });

  it("gives up after two retries", () => {
    expect(retryMigrationsList(flake, 3)).toEqual({ retry: false, delayMs: 0 });
  });

  it("never retries any other failure", () => {
    const authFailure = "✘ [ERROR] Authentication error [code: 10000]";
    expect(retryMigrationsList(authFailure, 1)).toEqual({ retry: false, delayMs: 0 });
    expect(retryMigrationsList("", 1)).toEqual({ retry: false, delayMs: 0 });
  });

  it("does not mistake a different code that merely contains 7403", () => {
    expect(retryMigrationsList("[code: 17403]", 1).retry).toBe(false);
  });
});
