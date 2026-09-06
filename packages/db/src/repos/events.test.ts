import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as events from "./events.js";
import * as songs from "./songs.js";
import * as takes from "./takes.js";

describe("events repo", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("listRecent returns newest first", async () => {
    const older = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const newer = await events.create(db, {
      kind: "concert",
      heldAt: 2000,
      createdAt: 2000,
      updatedAt: 2000,
    });

    const list = await events.listRecent(db);
    expect(list.map((e) => e.id)).toEqual([newer.id, older.id]);
  });

  it("listRecent respects the limit option", async () => {
    for (let i = 0; i < 5; i++) {
      await events.create(db, {
        kind: "rehearsal",
        heldAt: i * 1000,
        createdAt: i * 1000,
        updatedAt: i * 1000,
      });
    }

    const list = await events.listRecent(db, { limit: 2 });
    expect(list.length).toBe(2);
  });

  it("listRecent filters by kind", async () => {
    const rehearsal = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const concert = await events.create(db, {
      kind: "concert",
      heldAt: 2000,
      createdAt: 2000,
      updatedAt: 2000,
    });

    const concertsOnly = await events.listRecent(db, { kind: ["concert"] });
    expect(concertsOnly.map((e) => e.id)).toEqual([concert.id]);

    const both = await events.listRecent(db, { kind: ["concert", "rehearsal"] });
    expect(both.map((e) => e.id)).toEqual([concert.id, rehearsal.id]);
  });

  it("listRecent with no kind filter returns every kind, newest first", async () => {
    await events.create(db, { kind: "rehearsal", heldAt: 1000, createdAt: 1000, updatedAt: 1000 });
    await events.create(db, { kind: "concert", heldAt: 2000, createdAt: 2000, updatedAt: 2000 });

    const all = await events.listRecent(db);
    expect(all).toHaveLength(2);
  });

  it("listRecentWithTakeCounts reports zero for an event with no takes", async () => {
    await events.create(db, { kind: "rehearsal", heldAt: 1000, createdAt: 1000, updatedAt: 1000 });
    const [result] = await events.listRecentWithTakeCounts(db);
    expect(result?.takeCount).toBe(0);
  });

  it("listRecentWithTakeCounts counts the takes recorded at that event", async () => {
    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const song = await songs.create(db, {
      title: "Count Song",
      slug: "count-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    await takes.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    await takes.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: 1100,
      createdAt: 1100,
      updatedAt: 1100,
    });

    const [result] = await events.listRecentWithTakeCounts(db);
    expect(result?.takeCount).toBe(2);
  });
});
