// Exercises migration 0011 itself, the way `migration-0010-stash.test.ts` does
// for 0010. This one has more to prove than a column addition: making
// `takes.song_id` nullable rebuilds the whole table, so "the migration ran" is
// not the question — "did every row, every value and every index come out the
// other side" is.
//
// Specifically: `takes_push_pending_idx` is a raw partial index hand-added in
// 0009 that drizzle-kit does not know about, so a generated rebuild drops it
// and never puts it back. That is the regression this file exists to catch.
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = new URL("../../migrations/sqlite", import.meta.url).pathname;

const BEFORE_0011 = [
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
  "0010",
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
  for (const tag of BEFORE_0011) {
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
  // A published band take with a client_ref and a full row of values, and a
  // private stash take. Both must come out unchanged.
  await client.execute({
    sql: "insert into takes (id, song_id, event_id, label, recorded_at, duration_ms, state, keeper_votes, total_votes, rating_score, client_ref, notes, created_at, updated_at, published_at, push_batched_at, owner_member_id, visibility) values ('take-1','song-1','event-1','Bridge idea',?,90000,'keeper',3,4,0.75,'bridge:1','a note',?,?,?,?,NULL,'band')",
    args: [now, now, now, now, now],
  });
  await client.execute({
    sql: "insert into takes (id, song_id, event_id, recorded_at, state, keeper_votes, total_votes, rating_score, created_at, updated_at, owner_member_id, visibility) values ('take-2','song-1','event-1',?,'published',0,0,0,?,?,'member-1','private')",
    args: [now + 1, now, now],
  });
  // A take with a pending push (published, never batched) — the row the
  // partial index exists for.
  await client.execute({
    sql: "insert into takes (id, song_id, event_id, recorded_at, state, keeper_votes, total_votes, rating_score, created_at, updated_at, published_at, push_batched_at, visibility) values ('take-3','song-1','event-1',?,'published',0,0,0,?,?,?,NULL,'band')",
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

describe("migration 0011 (song_id optional)", () => {
  it("keeps every take row, value for value, and its dependent rows", async () => {
    const client = await populatedDb();
    const before = await client.execute("select * from takes order by id");

    for (const statement of statementsOf("0011")) {
      await client.execute(statement);
    }

    const after = await client.execute("select * from takes order by id");
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

    for (const statement of statementsOf("0011")) {
      await client.execute(statement);
    }

    expect(await indexNames(client)).toEqual(before);

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
    for (const statement of statementsOf("0011")) {
      await client.execute(statement);
    }

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
