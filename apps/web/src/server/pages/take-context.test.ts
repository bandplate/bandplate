// `attachFullContext` over a whole grown list page (200 takes, the ceiling in
// `server/pagination.ts`). D1 refuses a statement with more than 100 bound
// parameters and the local libSQL does not, so this watches the parameters
// every statement actually binds rather than trusting that a green run means
// production would agree. See docs/frontend-traps.md.
import type { Db } from "@bandplate/db";
import {
  assetsRepo,
  eventsRepo,
  instrumentsRepo,
  membersRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { describe, expect, it } from "vitest";
import { MAX_SHOWN } from "../pagination.js";
import { attachFullContext } from "./take-context.js";

type Args = { args?: unknown[] } | string;

/** The most bound parameters any single statement carried while `run` ran. */
async function maxParamsDuring(db: Db, run: () => Promise<unknown>): Promise<number> {
  const client = (db as unknown as { $client: Record<string, (...a: unknown[]) => unknown> })
    .$client;
  let max = 0;
  const count = (stmt: Args) => {
    if (typeof stmt !== "string") {
      max = Math.max(max, stmt.args?.length ?? 0);
    }
  };
  const original = { execute: client.execute, batch: client.batch };
  client.execute = function (this: unknown, stmt: unknown, ...rest: unknown[]) {
    count(stmt as Args);
    return original.execute?.call(this, stmt, ...rest);
  };
  client.batch = function (this: unknown, stmts: unknown, ...rest: unknown[]) {
    for (const stmt of stmts as Args[]) count(stmt);
    return original.batch?.call(this, stmts, ...rest);
  };
  try {
    await run();
  } finally {
    client.execute = original.execute as (...a: unknown[]) => unknown;
    client.batch = original.batch as (...a: unknown[]) => unknown;
  }
  return max;
}

describe("attachFullContext over a full grown page", () => {
  it("attaches everything to all 200 takes without a statement over 100 parameters", async () => {
    const db = await createTestDb();
    const now = Date.now();
    const member = await membersRepo.create(db, {
      displayName: "Owner",
      slug: "owner",
      email: "owner@example.com",
      createdAt: now,
    });
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });

    const takes: takesRepo.Take[] = [];
    for (let i = 0; i < MAX_SHOWN; i += 1) {
      // A song and an event per take, so those lookups are 200 ids long too.
      const song = await songsRepo.create(db, {
        title: `Song ${i}`,
        slug: `song-${i}`,
        createdAt: now,
        updatedAt: now,
      });
      const event = await eventsRepo.create(db, {
        kind: "rehearsal",
        heldAt: now - i,
        createdAt: now,
        updatedAt: now,
      });
      const take = await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: now - i,
        state: "published",
        createdAt: now,
        updatedAt: now,
      });
      await takesRepo.addInstrument(db, take.id, bass.id);
      await assetsRepo.createMany(db, [
        {
          takeId: take.id,
          kind: "master",
          tier: "lossy",
          format: "mp3",
          storageKey: `k-${i}`,
          contentType: "audio/mpeg",
          bytes: 1,
          status: "ready",
          createdAt: now,
        },
      ]);
      await votesRepo.castVote(db, {
        takeId: take.id,
        memberId: member.id,
        keeper: i % 2 === 0,
        now,
      });
      takes.push(take);
    }

    let result: Awaited<ReturnType<typeof attachFullContext>> = [];
    const max = await maxParamsDuring(db, async () => {
      result = await attachFullContext(db, takes, member.id);
    });

    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(100);
    // The watch itself sees an oversized statement: the same lookup unchunked.
    const unchunked = await maxParamsDuring(db, () =>
      takesRepo.buildGetByIdsChunkQuery(
        db,
        takes.map((t) => t.id),
      ),
    );
    expect(unchunked).toBe(MAX_SHOWN);
    expect(result).toHaveLength(MAX_SHOWN);
    // The LAST take is in the last chunk of every lookup: it must have it all.
    for (const row of [result[0], result.at(-1)]) {
      expect(row?.song).toBeDefined();
      expect(row?.event).toBeDefined();
      expect(row?.instruments.map((i) => i.slug)).toEqual(["bass"]);
      expect(row?.playableAssetId).toBeDefined();
      expect(row?.myVote).toBeTypeOf("boolean");
    }
  });
});
