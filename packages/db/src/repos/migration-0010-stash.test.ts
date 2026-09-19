// Exercises migration 0010 itself, the same way `migration-0009-backfill.test.ts`
// does for 0009: `createTestDb` migrates an EMPTY database, which can never show
// what a new column does to rows that already exist. Every take in the archive
// must come out of this migration as a band take with no owner — otherwise the
// first deploy hides the whole archive behind the new visibility floor.
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = new URL("../../migrations/sqlite", import.meta.url).pathname;

function statementsOf(tag: string): string[] {
  const file = readdirSync(MIGRATIONS_DIR).find((f) => f.startsWith(tag) && f.endsWith(".sql"));
  if (!file) {
    throw new Error(`no migration file found for tag ${tag}`);
  }
  return readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("migration 0010 (stash)", () => {
  it("files every existing take as a band take with no owner, and every event with no owner", async () => {
    const client = createClient({ url: ":memory:" });
    for (const tag of [
      "0000",
      "0001",
      "0002",
      "0003",
      "0004",
      "0005",
      "0006",
      "0007",
      "0008",
      "0009",
    ]) {
      for (const statement of statementsOf(tag)) {
        await client.execute(statement);
      }
    }

    const now = 1_000_000;
    await client.execute({
      sql: "insert into songs (id, title, title_norm, slug, is_stub, created_at, updated_at) values ('song-1','Song','song','song-1',0,?,?)",
      args: [now, now],
    });
    await client.execute({
      sql: "insert into events (id, kind, held_at, created_at, updated_at) values ('event-1','rehearsal',?,?,?)",
      args: [now, now, now],
    });
    await client.execute({
      sql: "insert into takes (id, song_id, event_id, recorded_at, state, keeper_votes, total_votes, rating_score, created_at, updated_at, published_at, push_batched_at) values ('take-1','song-1','event-1',?,'published',0,0,0,?,?,?,?)",
      args: [now, now, now, now, now],
    });

    for (const statement of statementsOf("0010")) {
      await client.execute(statement);
    }

    const take = await client.execute(
      "select visibility, owner_member_id from takes where id = 'take-1'",
    );
    expect(take.rows[0]?.visibility).toBe("band");
    expect(take.rows[0]?.owner_member_id).toBeNull();

    const event = await client.execute("select owner_member_id from events where id = 'event-1'");
    expect(event.rows[0]?.owner_member_id).toBeNull();

    client.close();
  });
});
