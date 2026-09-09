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

  // This — not listRecent — is the archive page's actual backing query, so
  // the kind filter and the ordering are pinned here, not just on the
  // simpler function nothing in production calls anymore.
  it("listRecentWithTakeCounts filters by kind", async () => {
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

    const concertsOnly = await events.listRecentWithTakeCounts(db, { kind: ["concert"] });
    expect(concertsOnly.map((e) => e.id)).toEqual([concert.id]);

    const both = await events.listRecentWithTakeCounts(db, { kind: ["concert", "rehearsal"] });
    expect(both.map((e) => e.id)).toEqual([concert.id, rehearsal.id]);
  });

  it("listRecentWithTakeCounts returns newest first", async () => {
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

    const list = await events.listRecentWithTakeCounts(db);
    expect(list.map((e) => e.id)).toEqual([newer.id, older.id]);
  });

  // --- M8: manual editing and archiving ------------------------------------

  it("update writes only the keys it is given", async () => {
    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      venue: "The Attic",
      notes: "went long",
      createdAt: 1000,
      updatedAt: 1000,
    });

    await events.update(db, event.id, { venue: "The Cellar", updatedAt: 2000 });

    const after = await events.getById(db, event.id);
    expect(after?.venue).toBe("The Cellar");
    expect(after?.notes).toBe("went long");
    expect(after?.kind).toBe("rehearsal");
    expect(after?.updatedAt).toBe(2000);
  });

  it("update archives and unarchives via archivedAt", async () => {
    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });

    await events.update(db, event.id, { archivedAt: 5000, updatedAt: 5000 });
    expect((await events.getById(db, event.id))?.archivedAt).toBe(5000);

    await events.update(db, event.id, { archivedAt: null, updatedAt: 6000 });
    expect((await events.getById(db, event.id))?.archivedAt).toBeNull();
  });

  it("listings exclude archived events, lookups still return them", async () => {
    const live = await events.create(db, {
      kind: "rehearsal",
      heldAt: 2000,
      createdAt: 2000,
      updatedAt: 2000,
    });
    const retired = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      clientRef: "seed-retired",
      createdAt: 1000,
      updatedAt: 1000,
    });
    await events.update(db, retired.id, { archivedAt: 3000, updatedAt: 3000 });

    expect((await events.listRecent(db)).map((e) => e.id)).toEqual([live.id]);
    expect((await events.listRecentWithTakeCounts(db)).map((e) => e.id)).toEqual([live.id]);

    // The listings-filter/lookups-don't rule: a take row pointing at an
    // archived event must still be able to name it.
    expect((await events.getById(db, retired.id))?.id).toBe(retired.id);
    expect((await events.getByIds(db, [retired.id])).map((e) => e.id)).toEqual([retired.id]);
    expect((await events.getByClientRef(db, "seed-retired"))?.id).toBe(retired.id);
  });

  it("includeArchived brings archived events back into the listings", async () => {
    const retired = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    await events.update(db, retired.id, { archivedAt: 3000, updatedAt: 3000 });

    expect((await events.listRecent(db, { includeArchived: true })).map((e) => e.id)).toEqual([
      retired.id,
    ]);
    expect(
      (await events.listRecentWithTakeCounts(db, { includeArchived: true })).map((e) => e.id),
    ).toEqual([retired.id]);
  });

  it("listRecentWithTakeCounts combines the kind and archived filters", async () => {
    const rehearsal = await events.create(db, {
      kind: "rehearsal",
      heldAt: 3000,
      createdAt: 3000,
      updatedAt: 3000,
    });
    await events.create(db, { kind: "concert", heldAt: 2000, createdAt: 2000, updatedAt: 2000 });
    const archivedRehearsal = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    await events.update(db, archivedRehearsal.id, { archivedAt: 4000, updatedAt: 4000 });

    const list = await events.listRecentWithTakeCounts(db, { kind: ["rehearsal"] });
    expect(list.map((e) => e.id)).toEqual([rehearsal.id]);
  });

  it("adoptClientRef hands a manual event the bridge's idempotency key", async () => {
    const manual = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(manual.clientRef).toBeNull();

    await events.adoptClientRef(db, manual.id, "reaper-abc", 2000);

    const found = await events.getByClientRef(db, "reaper-abc");
    expect(found?.id).toBe(manual.id);
    expect(found?.updatedAt).toBe(2000);
  });
});
