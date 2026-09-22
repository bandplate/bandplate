import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "./client.js";
import { combineReads, mapRead, readAll, readOne, readValue, runRead, runReads } from "./read.js";
import * as membersRepo from "./repos/members.js";
import { members, takes, votes } from "./schema/sqlite/index.js";
import { createTestDb } from "./testing/create-test-db.js";

/** How many times the client was called while `run` ran: what crosses the wire. */
async function callsDuring(db: Db, run: () => Promise<unknown>) {
  const client = (db as unknown as { $client: Record<string, (...a: unknown[]) => unknown> })
    .$client;
  const original = { execute: client.execute, batch: client.batch };
  const calls = { execute: 0, batch: 0 };
  client.execute = function (this: unknown, ...args: unknown[]) {
    calls.execute += 1;
    return original.execute?.apply(this, args);
  };
  client.batch = function (this: unknown, ...args: unknown[]) {
    calls.batch += 1;
    return original.batch?.apply(this, args);
  };
  try {
    await run();
  } finally {
    client.execute = original.execute as (...a: unknown[]) => unknown;
    client.batch = original.batch as (...a: unknown[]) => unknown;
  }
  return calls;
}

async function seed() {
  const db = await createTestDb();
  const names = ["Anna", "Bára", "Cyril"];
  const created = [];
  for (const [i, name] of names.entries()) {
    created.push(
      await membersRepo.create(db, {
        displayName: name,
        slug: name.toLowerCase(),
        email: `${i}@example.com`,
        createdAt: i,
      }),
    );
  }
  return { db, ids: created.map((m) => m.id) };
}

const countMembers = (db: Db) =>
  readOne(db.select({ value: sql<number>`count(*)` }).from(members), (rows) => rows[0]?.value);

describe("runRead", () => {
  it("asks nothing for a read with no statements", async () => {
    const { db } = await seed();
    const calls = await callsDuring(db, () => runRead(db, readValue("known")));
    expect(calls).toEqual({ execute: 0, batch: 0 });
    expect(await runRead(db, readValue("known"))).toBe("known");
  });

  it("runs one statement on its own, not as a batch", async () => {
    const { db } = await seed();
    const calls = await callsDuring(db, () => runRead(db, countMembers(db)));
    expect(calls).toEqual({ execute: 1, batch: 0 });
    expect(await runRead(db, countMembers(db))).toBe(3);
  });

  it("sends several statements as ONE batch and hands each chunk its own rows", async () => {
    const { db, ids } = await seed();
    const read = readAll(
      ids.map((id) => db.select().from(members).where(eq(members.id, id))),
      (parts) => parts.map((rows) => rows.map((m) => m.displayName)),
    );
    const calls = await callsDuring(db, () => runRead(db, read));
    expect(calls).toEqual({ execute: 0, batch: 1 });
    expect(await runRead(db, read)).toEqual([["Anna"], ["Bára"], ["Cyril"]]);
  });
});

describe("runReads", () => {
  it("answers every read by its key from one batch, whatever sits between them", async () => {
    const { db, ids } = await seed();
    const reads = {
      none: readValue<string[]>([]),
      count: countMembers(db),
      names: mapRead(membersRepo.buildGetByIdsRead(db, ids.slice(0, 2)), (found) =>
        found.map((m) => m.displayName).sort(),
      ),
      nested: combineReads({
        also: readValue(1),
        one: membersRepo.buildGetByIdRead(db, ids[2] as string),
      }),
    };
    const calls = await callsDuring(db, () => runReads(db, reads));
    expect(calls).toEqual({ execute: 0, batch: 1 });
    const answer = await runReads(db, reads);
    expect(answer.none).toEqual([]);
    expect(answer.count).toBe(3);
    expect(answer.names).toEqual(["Anna", "Bára"]);
    expect(answer.nested.also).toBe(1);
    expect(answer.nested.one?.displayName).toBe("Cyril");
  });
});

describe("the test client holds batches to D1's column rule", () => {
  it("refuses a batch statement whose result repeats a column name", async () => {
    // `votes` and `takes` both have `created_at` and `updated_at`. D1 would
    // hand this row back as an object and lose one of each.
    const { db } = await seed();
    const joined = db.select().from(votes).innerJoin(takes, eq(takes.id, votes.takeId));
    await expect(
      runRead(
        db,
        readAll([joined, joined], (parts) => parts),
      ),
    ).rejects.toThrow(/two columns named "created_at"/);
  });
});
