// `instrumentsRepo.mergeInto` over an instrument used on 150+ takes, members
// and assets. D1 refuses a statement with more than 100 bound parameters and
// local libSQL does not, so this watches the libSQL client's `batch()` (the
// merge is one `db.batch([...])` — see that function's own comment on why)
// and asserts no single statement in it ever carried more than 100 args,
// exactly as `take-context.test.ts` does for `attachFullContext`. See
// docs/frontend-traps.md.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import * as schema from "../schema/sqlite/index.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as assetsRepo from "./assets.js";
import * as eventsRepo from "./events.js";
import * as instrumentsRepo from "./instruments.js";
import * as membersRepo from "./members.js";
import * as songsRepo from "./songs.js";
import * as takesRepo from "./takes.js";

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

// More than one chunk in every list `mergeInto` chunks (99/100-sized), plus a
// handful of rows that only reference the source, to prove the "everything
// left over moves across" half still works once the colliding half is
// chunked.
const N_COLLIDING = 150;
const N_MOVING = 20;

describe("instrumentsRepo.mergeInto at scale (150+ referencing rows)", () => {
  it("merges a heavily-used instrument without an oversized statement, and with no orphan left behind", async () => {
    const db = await createTestDb();
    const now = Date.now();

    const source = await instrumentsRepo.create(db, { slug: "guitar-2", label: "Guitar 2" });
    const target = await instrumentsRepo.create(db, { slug: "guitar", label: "Guitar" });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // --- members: colliding (plays both) and moving (plays only the source) ---
    const collidingMemberIds: string[] = [];
    for (let i = 0; i < N_COLLIDING; i++) {
      const member = await membersRepo.create(db, {
        displayName: `Colliding Member ${i}`,
        slug: `colliding-member-${i}`,
        email: `colliding-member-${i}@example.com`,
        createdAt: now,
      });
      await membersRepo.setInstruments(db, member.id, [source.id, target.id]);
      collidingMemberIds.push(member.id);
    }
    const movingMemberIds: string[] = [];
    for (let i = 0; i < N_MOVING; i++) {
      const member = await membersRepo.create(db, {
        displayName: `Moving Member ${i}`,
        slug: `moving-member-${i}`,
        email: `moving-member-${i}@example.com`,
        createdAt: now,
      });
      await membersRepo.setInstruments(db, member.id, [source.id]);
      movingMemberIds.push(member.id);
    }

    // --- takes: colliding (both instruments on the take) and moving (source only) ---
    const collidingTakeIds: string[] = [];
    for (let i = 0; i < N_COLLIDING; i++) {
      const song = await songsRepo.create(db, {
        title: `Colliding Song ${i}`,
        slug: `colliding-song-${i}`,
        createdAt: now,
        updatedAt: now,
      });
      const take = await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: now - i,
        instrumentIds: [source.id, target.id],
        createdAt: now,
        updatedAt: now,
      });
      collidingTakeIds.push(take.id);
    }
    const movingTakeIds: string[] = [];
    for (let i = 0; i < N_MOVING; i++) {
      const song = await songsRepo.create(db, {
        title: `Moving Song ${i}`,
        slug: `moving-song-${i}`,
        createdAt: now,
        updatedAt: now,
      });
      const take = await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: now - i,
        instrumentIds: [source.id],
        createdAt: now,
        updatedAt: now,
      });
      movingTakeIds.push(take.id);
    }

    // --- assets: colliding stems (same take/kind/tier for both instruments)
    // and moving stems (source only, on a take with no matching target slot) ---
    const collidingAssetTakeIds: string[] = [];
    const movingAssetTakeIds: string[] = [];
    for (let i = 0; i < N_COLLIDING; i++) {
      const song = await songsRepo.create(db, {
        title: `Asset Colliding Song ${i}`,
        slug: `asset-colliding-song-${i}`,
        createdAt: now,
        updatedAt: now,
      });
      const take = await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: now - i,
        createdAt: now,
        updatedAt: now,
      });
      await assetsRepo.createMany(db, [
        {
          takeId: take.id,
          kind: "stem",
          instrumentId: source.id,
          tier: "lossy",
          format: "wav",
          storageKey: `asset-collide/${i}/source`,
          contentType: "audio/wav",
          bytes: 1,
          createdAt: now,
        },
        {
          takeId: take.id,
          kind: "stem",
          instrumentId: target.id,
          tier: "lossy",
          format: "wav",
          storageKey: `asset-collide/${i}/target`,
          contentType: "audio/wav",
          bytes: 1,
          createdAt: now,
        },
      ]);
      collidingAssetTakeIds.push(take.id);
    }
    for (let i = 0; i < N_MOVING; i++) {
      const song = await songsRepo.create(db, {
        title: `Asset Moving Song ${i}`,
        slug: `asset-moving-song-${i}`,
        createdAt: now,
        updatedAt: now,
      });
      const take = await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: now - i,
        createdAt: now,
        updatedAt: now,
      });
      await assetsRepo.createMany(db, [
        {
          takeId: take.id,
          kind: "stem",
          instrumentId: source.id,
          tier: "lossy",
          format: "wav",
          storageKey: `asset-move/${i}/source`,
          contentType: "audio/wav",
          bytes: 1,
          createdAt: now,
        },
      ]);
      movingAssetTakeIds.push(take.id);
    }

    // --- charts: colliding (both instruments note the same song) and moving
    // (source only) ---
    const collidingChartSongIds: string[] = [];
    for (let i = 0; i < N_COLLIDING; i++) {
      const song = await songsRepo.create(db, {
        title: `Chart Colliding Song ${i}`,
        slug: `chart-colliding-song-${i}`,
        createdAt: now,
        updatedAt: now,
      });
      await songsRepo.setInstrumentNote(db, song.id, source.id, `source note ${i}`, now);
      await songsRepo.setInstrumentNote(db, song.id, target.id, `target note ${i}`, now);
      collidingChartSongIds.push(song.id);
    }
    const movingChartSongIds: string[] = [];
    for (let i = 0; i < N_MOVING; i++) {
      const song = await songsRepo.create(db, {
        title: `Chart Moving Song ${i}`,
        slug: `chart-moving-song-${i}`,
        createdAt: now,
        updatedAt: now,
      });
      await songsRepo.setInstrumentNote(db, song.id, source.id, `moving note ${i}`, now);
      movingChartSongIds.push(song.id);
    }

    const plan = await instrumentsRepo.planMerge(db, source.id, target.id);
    expect(plan.chartSongIds.sort()).toEqual([...collidingChartSongIds].sort());
    expect(plan.movedCharts).toBe(N_MOVING);
    expect(plan.movedMembers).toBe(N_MOVING);
    // Only the take_instruments sets above count here — the asset-only takes
    // carry no take_instruments row at all.
    expect(plan.movedTakes).toBe(N_MOVING);

    let max = 0;
    max = await maxParamsDuring(db, () =>
      instrumentsRepo.mergeInto(db, source.id, target.id, plan),
    );
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(100);

    // The source instrument is gone, and nothing anywhere still points at it —
    // the same shape `orphans.test.ts`'s single-row merge test checks, just at
    // 150+ rows per table instead of one.
    expect(await instrumentsRepo.getById(db, source.id)).toBeUndefined();
    expect(
      await db
        .select()
        .from(schema.memberInstruments)
        .where(eq(schema.memberInstruments.instrumentId, source.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.takeInstruments)
        .where(eq(schema.takeInstruments.instrumentId, source.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.songInstrumentNotes)
        .where(eq(schema.songInstrumentNotes.instrumentId, source.id)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.assets).where(eq(schema.assets.instrumentId, source.id)),
    ).toEqual([]);

    // Every moving row actually landed on the target, not just vanished.
    const targetMembers = await db
      .select()
      .from(schema.memberInstruments)
      .where(eq(schema.memberInstruments.instrumentId, target.id));
    for (const id of movingMemberIds) {
      expect(targetMembers.some((r) => r.memberId === id)).toBe(true);
    }
    const targetTakeInstruments = await db
      .select()
      .from(schema.takeInstruments)
      .where(eq(schema.takeInstruments.instrumentId, target.id));
    for (const id of movingTakeIds) {
      expect(targetTakeInstruments.some((r) => r.takeId === id)).toBe(true);
    }
    const targetCharts = await db
      .select()
      .from(schema.songInstrumentNotes)
      .where(eq(schema.songInstrumentNotes.instrumentId, target.id));
    for (const id of movingChartSongIds) {
      expect(targetCharts.some((r) => r.songId === id)).toBe(true);
    }
    const targetAssets = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.instrumentId, target.id));
    for (const takeId of movingAssetTakeIds) {
      expect(targetAssets.some((r) => r.takeId === takeId)).toBe(true);
    }

    // And every colliding row's SOURCE copy is gone rather than duplicated —
    // the target's own copy (never touched) is still exactly one row.
    for (const songId of collidingChartSongIds) {
      const rows = targetCharts.filter((r) => r.songId === songId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.body).toBe(`target note ${collidingChartSongIds.indexOf(songId)}`);
    }
  }, 60_000);
});
