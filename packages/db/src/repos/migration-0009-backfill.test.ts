// Exercises the migration itself, not a repo — `createTestDb` applies every
// committed migration to a fresh (empty) database, which can never observe
// a backfill: there is nothing to backfill in an empty `takes` table. This
// test instead applies migrations 0000-0008 by hand, inserts a row shaped
// like a pre-push-notifications published take, then applies 0009 and
// checks the backfill actually ran — the guarantee the spec's "the
// migration backfills `push_batched_at = published_at` for existing rows,
// or the first deploy would announce the whole archive" depends on.
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = new URL("../../migrations/sqlite", import.meta.url).pathname;

function statementsOf(tag: string): string[] {
  const file = readdirSync(MIGRATIONS_DIR).find((f) => f.startsWith(tag) && f.endsWith(".sql"));
  if (!file) {
    throw new Error(`no migration file found for tag ${tag}`);
  }
  const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("migration 0009 backfill", () => {
  it("sets push_batched_at = published_at for takes that predate the migration", async () => {
    const client = createClient({ url: ":memory:" });

    // Apply every migration up to (and not including) 0009 — the schema as
    // it existed the moment before this migration runs.
    const priorTags = ["0000", "0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"];
    for (const tag of priorTags) {
      for (const statement of statementsOf(tag)) {
        await client.execute(statement);
      }
    }

    // A minimal published take, inserted the way it would have existed
    // before `push_batched_at` was ever a column.
    const now = 1_000_000;
    await client.execute({
      sql: "insert into songs (id, title, title_norm, slug, is_stub, archived_at, created_at, updated_at) values ('song-1','Song','song','song-1',0,null,?,?)",
      args: [now, now],
    });
    await client.execute({
      sql: "insert into events (id, kind, held_at, archived_at, created_at, updated_at) values ('event-1','rehearsal',?,null,?,?)",
      args: [now, now, now],
    });
    await client.execute({
      sql: "insert into takes (id, song_id, event_id, recorded_at, state, keeper_votes, total_votes, rating_score, created_at, updated_at, published_at) values ('take-1','song-1','event-1',?, 'published', 0, 0, 0, ?, ?, ?)",
      args: [now, now, now, now],
    });
    // A never-published take must stay untouched by the backfill (NULL, not
    // some sentinel) — it is genuinely still pending, not "notified before
    // notifications existed".
    await client.execute({
      sql: "insert into takes (id, song_id, event_id, recorded_at, state, keeper_votes, total_votes, rating_score, created_at, updated_at, published_at) values ('take-2','song-1','event-1',?, 'new', 0, 0, 0, ?, ?, null)",
      args: [now, now, now],
    });

    for (const statement of statementsOf("0009")) {
      await client.execute(statement);
    }

    const published = await client.execute("select push_batched_at from takes where id = 'take-1'");
    expect(published.rows[0]?.push_batched_at).toBe(now);

    const unpublished = await client.execute(
      "select push_batched_at from takes where id = 'take-2'",
    );
    expect(unpublished.rows[0]?.push_batched_at).toBeNull();

    client.close();
  });
});
