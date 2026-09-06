import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "../client.js";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as events from "./events.js";
import * as instruments from "./instruments.js";
import * as songs from "./songs.js";
import * as takes from "./takes.js";

describe("takes.listByInstruments", () => {
  let db: Db;
  let songId: string;
  let eventId: string;
  let bassId: string;
  let drumsId: string;
  let guitarId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();

    const song = await songs.create(db, {
      title: "AND Semantics Song",
      slug: "and-semantics-song",
      createdAt: now,
      updatedAt: now,
    });
    songId = song.id;

    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    eventId = event.id;

    bassId = (await instruments.create(db, { slug: "bass", label: "Bass" })).id;
    drumsId = (await instruments.create(db, { slug: "drums", label: "Drums" })).id;
    guitarId = (await instruments.create(db, { slug: "guitar", label: "Guitar" })).id;
  });

  it("matches a take with {bass, drums} when querying for {bass} alone", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId, drumsId],
    });

    const result = await takes.listByInstruments(db, [bassId]);
    expect(result.map((t) => t.id)).toContain(take.id);
  });

  it("matches a take with {bass, drums} when querying for {bass, drums}", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId, drumsId],
    });

    const result = await takes.listByInstruments(db, [bassId, drumsId]);
    expect(result.map((t) => t.id)).toContain(take.id);
  });

  it("does NOT match a take with only {bass} when querying for {bass, drums} (AND, not OR)", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId],
    });

    const result = await takes.listByInstruments(db, [bassId, drumsId]);
    expect(result.map((t) => t.id)).not.toContain(take.id);
  });

  it("does not match on an unrelated instrument", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId, drumsId],
    });

    const result = await takes.listByInstruments(db, [guitarId]);
    expect(result.map((t) => t.id)).not.toContain(take.id);
  });

  it("returns an empty array for an empty instrument list", async () => {
    const result = await takes.listByInstruments(db, []);
    expect(result).toEqual([]);
  });
});

describe("takes.listByEvent ordering", () => {
  let db: Db;
  let songId: string;
  let eventId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();
    const song = await songs.create(db, {
      title: "Ordering Song",
      slug: "ordering-song",
      createdAt: now,
      updatedAt: now,
    });
    songId = song.id;
    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    eventId = event.id;

    await takes.create(db, { songId, eventId, recordedAt: 1000, createdAt: 1000, updatedAt: 1000 });
    await takes.create(db, { songId, eventId, recordedAt: 3000, createdAt: 3000, updatedAt: 3000 });
    await takes.create(db, { songId, eventId, recordedAt: 2000, createdAt: 2000, updatedAt: 2000 });
  });

  it("defaults to newest first (desc)", async () => {
    const result = await takes.listByEvent(db, eventId);
    expect(result.map((t) => t.recordedAt)).toEqual([3000, 2000, 1000]);
  });

  it("order: 'asc' returns recorded order — the order the session actually happened", async () => {
    const result = await takes.listByEvent(db, eventId, { order: "asc" });
    expect(result.map((t) => t.recordedAt)).toEqual([1000, 2000, 3000]);
  });
});

// `getSongDetail` (server/pages/songs.ts) advertises "every take newest
// first" for the song page — pinned here at the repo level, not just
// exercised incidentally by a page test, so removing this function's
// `ORDER BY` fails a test by itself. Rows are inserted out of
// chronological order (like `takes.listByEvent ordering` above) so SQLite's
// un-ordered row-scan order (insertion/rowid order) would NOT happen to
// match the expected result — a real assertion on the ORDER BY, not an
// accident of insert order.
describe("takes.listBySong ordering", () => {
  let db: Db;
  let songId: string;
  let eventId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();
    const song = await songs.create(db, {
      title: "Song Ordering Song",
      slug: "song-ordering-song",
      createdAt: now,
      updatedAt: now,
    });
    songId = song.id;
    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    eventId = event.id;

    await takes.create(db, { songId, eventId, recordedAt: 1000, createdAt: 1000, updatedAt: 1000 });
    await takes.create(db, { songId, eventId, recordedAt: 3000, createdAt: 3000, updatedAt: 3000 });
    await takes.create(db, { songId, eventId, recordedAt: 2000, createdAt: 2000, updatedAt: 2000 });
  });

  it("returns every take of a song newest first", async () => {
    const result = await takes.listBySong(db, songId);
    expect(result.map((t) => t.recordedAt)).toEqual([3000, 2000, 1000]);
  });

  it("does not include takes of a different song", async () => {
    const now = Date.now();
    const otherSong = await songs.create(db, {
      title: "Other Song",
      slug: "other-song",
      createdAt: now,
      updatedAt: now,
    });
    await takes.create(db, {
      songId: otherSong.id,
      eventId,
      recordedAt: 4000,
      createdAt: 4000,
      updatedAt: 4000,
    });

    const result = await takes.listBySong(db, songId);
    expect(result.map((t) => t.recordedAt)).toEqual([3000, 2000, 1000]);
  });
});

describe("takes.listInstrumentsForTakes", () => {
  let db: Db;
  let songId: string;
  let eventId: string;
  let bassId: string;
  let drumsId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();
    const song = await songs.create(db, {
      title: "Instruments Song",
      slug: "instruments-song",
      createdAt: now,
      updatedAt: now,
    });
    songId = song.id;
    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    eventId = event.id;
    bassId = (await instruments.create(db, { slug: "bass", label: "Bass", sortOrder: 1 })).id;
    drumsId = (await instruments.create(db, { slug: "drums", label: "Drums", sortOrder: 0 })).id;
  });

  it("batches instruments for multiple takes into one map, ordered by sort order", async () => {
    const now = Date.now();
    const take1 = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId, drumsId],
    });
    const take2 = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId],
    });

    const map = await takes.listInstrumentsForTakes(db, [take1.id, take2.id]);
    expect(map.get(take1.id)?.map((i) => i.slug)).toEqual(["drums", "bass"]);
    expect(map.get(take2.id)?.map((i) => i.slug)).toEqual(["bass"]);
  });

  it("returns an empty map for an empty takeIds list", async () => {
    const map = await takes.listInstrumentsForTakes(db, []);
    expect(map.size).toBe(0);
  });

  it("a take with no instruments has no entry in the map", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const map = await takes.listInstrumentsForTakes(db, [take.id]);
    expect(map.has(take.id)).toBe(false);
  });
});

describe("takes.create atomicity", () => {
  let db: Db;
  let songId: string;
  let eventId: string;
  let bassId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();

    const song = await songs.create(db, {
      title: "Atomicity Song",
      slug: "atomicity-song",
      createdAt: now,
      updatedAt: now,
    });
    songId = song.id;

    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    eventId = event.id;

    bassId = (await instruments.create(db, { slug: "bass", label: "Bass" })).id;
  });

  it("produces the take and all its take_instruments rows together", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId],
    });

    const persisted = await takes.getById(db, take.id);
    expect(persisted).toBeDefined();

    const linked = await takes.listByInstruments(db, [bassId]);
    expect(linked.map((t) => t.id)).toContain(take.id);
  });

  /**
   * Proves the batch is atomic in the way that matters: a take insert paired
   * with a take_instruments insert that violates a foreign key must leave
   * BOTH statements rolled back, never a take with zero take_instruments
   * rows. If takes.create still issued two separate round trips (insert
   * take, then insert take_instruments), the take row from the first
   * statement would survive here even though the second one failed — which
   * is exactly the silent-orphan bug the fix eliminates.
   */
  it("rolls back the take insert too when the take_instruments insert fails", async () => {
    const now = Date.now();
    const clientRef = "atomic-rollback-probe";

    await expect(
      takes.create(db, {
        songId,
        eventId,
        recordedAt: now,
        createdAt: now,
        updatedAt: now,
        clientRef,
        instrumentIds: ["nonexistent-instrument-id"],
      }),
    ).rejects.toThrow();

    const rows = await db.select().from(schema.takes).where(eq(schema.takes.clientRef, clientRef));
    expect(rows).toEqual([]);
  });
});
