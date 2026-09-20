// Exercises migration 0010 itself, the same way `migration-0009-backfill.test.ts`
// does for 0009: `createTestDb` migrates an EMPTY database, which can never show
// what a migration does to rows that already exist.
//
// 0010 has more to prove than a column addition. It rebuilds `takes` (SQLite
// cannot drop `song_id`'s NOT NULL in place), so "the migration ran" is not the
// question — "did every row, every value and every index come out the other
// side" is. Two things in particular:
//
//   * Every take in the archive must come out as a band take with no owner,
//     otherwise the first deploy hides the whole archive behind the new
//     visibility floor.
//   * `takes_push_pending_idx` is a raw partial index hand-added in 0009 that
//     drizzle-kit does not know about, so a generated rebuild drops it and
//     never puts it back. That is the regression this file exists to catch.
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = new URL("../../migrations/sqlite", import.meta.url).pathname;

const BEFORE_0010 = [
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
];

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

async function populatedDb() {
  const client = createClient({ url: ":memory:" });
  for (const tag of BEFORE_0010) {
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
  // A published take with a client_ref and a full row of values, and a plainer
  // one. Both must come out unchanged apart from the two new columns.
  await client.execute({
    sql: "insert into takes (id, song_id, event_id, label, recorded_at, duration_ms, state, keeper_votes, total_votes, rating_score, client_ref, notes, created_at, updated_at, published_at, push_batched_at) values ('take-1','song-1','event-1','Bridge idea',?,90000,'keeper',3,4,0.75,'bridge:1','a note',?,?,?,?)",
    args: [now, now, now, now, now],
  });
  await client.execute({
    sql: "insert into takes (id, song_id, event_id, recorded_at, state, keeper_votes, total_votes, rating_score, created_at, updated_at) values ('take-2','song-1','event-1',?,'published',0,0,0,?,?)",
    args: [now + 1, now, now],
  });
  // A take with a pending push (published, never batched) — the row the
  // partial index exists for.
  await client.execute({
    sql: "insert into takes (id, song_id, event_id, recorded_at, state, keeper_votes, total_votes, rating_score, created_at, updated_at, published_at, push_batched_at) values ('take-3','song-1','event-1',?,'published',0,0,0,?,?,?,NULL)",
    args: [now + 2, now, now, now],
  });
  // A dependent row whose foreign key points at `takes`: the rebuild drops
  // and recreates that table, and this must not go with it. (Foreign keys are
  // ON in this harness — see docs/frontend-traps.md — which is exactly why the
  // migration turns them off around the DROP.)
  await client.execute("insert into instruments (id, slug, label) values ('inst-1','bass','Bass')");
  await client.execute(
    "insert into take_instruments (take_id, instrument_id) values ('take-1','inst-1')",
  );

  return client;
}

async function indexNames(client: Awaited<ReturnType<typeof populatedDb>>): Promise<string[]> {
  const rows = await client.execute(
    "select name from sqlite_master where type = 'index' and tbl_name = 'takes' and name is not null order by name",
  );
  return rows.rows.map((r) => String(r.name)).filter((n) => !n.startsWith("sqlite_autoindex"));
}

async function run0010(client: Awaited<ReturnType<typeof populatedDb>>): Promise<void> {
  for (const statement of statementsOf("0010")) {
    await client.execute(statement);
  }
}

describe("migration 0010 (stash)", () => {
  it("files every existing take as a band take with no owner, and every event with no owner", async () => {
    const client = await populatedDb();
    await run0010(client);

    const takes = await client.execute("select id, visibility, owner_member_id from takes");
    expect(takes.rows.length).toBe(3);
    for (const row of takes.rows) {
      expect(row.visibility).toBe("band");
      expect(row.owner_member_id).toBeNull();
    }

    const event = await client.execute("select owner_member_id from events where id = 'event-1'");
    expect(event.rows[0]?.owner_member_id).toBeNull();

    client.close();
  });

  it("keeps every take row, value for value, and its dependent rows", async () => {
    const client = await populatedDb();
    const before = await client.execute("select * from takes order by id");

    await run0010(client);

    const after = await client.execute(
      "select id, song_id, event_id, label, recorded_at, duration_ms, state, keeper_votes, total_votes, rating_score, client_ref, notes, created_at, updated_at, published_at, purged_at, push_batched_at from takes order by id",
    );
    expect(after.rows.length).toBe(3);
    expect(after.rows.map((r) => JSON.parse(JSON.stringify(r)))).toEqual(
      before.rows.map((r) => JSON.parse(JSON.stringify(r))),
    );

    const deps = await client.execute("select count(*) as n from take_instruments");
    expect(deps.rows[0]?.n).toBe(1);

    client.close();
  });

  it("puts back every index, the hand-written partial one included", async () => {
    const client = await populatedDb();
    const before = await indexNames(client);
    expect(before).toContain("takes_push_pending_idx");

    await run0010(client);

    // The stash index is new; everything that existed before must still be here.
    const after = await indexNames(client);
    for (const name of before) {
      expect(after).toContain(name);
    }
    expect(after).toContain("takes_owner_member_id_visibility_recorded_at_idx");

    // Not just the name: the partial index must still be the one the pending
    // push query can use, which means it still carries its WHERE clause.
    const sqlRow = await client.execute(
      "select sql from sqlite_master where name = 'takes_push_pending_idx'",
    );
    expect(String(sqlRow.rows[0]?.sql)).toContain("push_batched_at");

    client.close();
  });

  it("accepts a take with no song, and still refuses one with no event", async () => {
    const client = await populatedDb();
    await run0010(client);

    const now = 2_000_000;
    await client.execute({
      sql: "insert into takes (id, song_id, event_id, recorded_at, state, keeper_votes, total_votes, rating_score, created_at, updated_at, owner_member_id, visibility) values ('take-4',NULL,'event-1',?,'uploading',0,0,0,?,?,'member-1','private')",
      args: [now, now, now],
    });
    const row = await client.execute("select song_id from takes where id = 'take-4'");
    expect(row.rows[0]?.song_id).toBeNull();

    await expect(
      client.execute({
        sql: "insert into takes (id, song_id, event_id, recorded_at, state, keeper_votes, total_votes, rating_score, created_at, updated_at) values ('take-5','song-1',NULL,?,'uploading',0,0,0,?,?)",
        args: [now, now, now],
      }),
    ).rejects.toThrow();

    client.close();
  });
});
