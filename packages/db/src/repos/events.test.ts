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
    const [result] = (await events.listRecentWithTakeCounts(db)).rows;
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

    const [result] = (await events.listRecentWithTakeCounts(db)).rows;
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

    const { rows: concertsOnly } = await events.listRecentWithTakeCounts(db, { kind: ["concert"] });
    expect(concertsOnly.map((e) => e.id)).toEqual([concert.id]);

    const { rows: both } = await events.listRecentWithTakeCounts(db, {
      kind: ["concert", "rehearsal"],
    });
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

    const { rows: list } = await events.listRecentWithTakeCounts(db);
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
    expect((await events.listRecentWithTakeCounts(db)).rows.map((e) => e.id)).toEqual([live.id]);

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
      (await events.listRecentWithTakeCounts(db, { includeArchived: true })).rows.map((e) => e.id),
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

    const { rows: list } = await events.listRecentWithTakeCounts(db, { kind: ["rehearsal"] });
    expect(list.map((e) => e.id)).toEqual([rehearsal.id]);
  });

  it("setClientRef hands a manual event the bridge's idempotency key, and takes it back", async () => {
    const manual = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(manual.clientRef).toBeNull();

    await events.setClientRef(db, manual.id, "reaper-abc", 2000);

    const found = await events.getByClientRef(db, "reaper-abc");
    expect(found?.id).toBe(manual.id);
    expect(found?.updatedAt).toBe(2000);

    // `client_ref` is UNIQUE, so releasing is what makes handing it to another
    // event possible at all.
    await events.setClientRef(db, manual.id, null, 3000);
    expect(await events.getByClientRef(db, "reaper-abc")).toBeUndefined();
  });

  // --- paging -------------------------------------------------------------

  describe("listRecentWithTakeCounts paging", () => {
    /** Every event on the SAME DAY — the case a missing tie-break breaks. */
    async function seedSameDay(count: number) {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const e = await events.create(db, {
          kind: "rehearsal",
          // One `heldAt` for all of them: `heldAt` is a date, so a band that
          // logs a morning and an evening rehearsal ties on the only sort key.
          heldAt: 1_700_000_000_000,
          createdAt: 1000 + i,
          updatedAt: 1000 + i,
        });
        ids.push(e.id);
      }
      return ids;
    }

    it("returns one page and the total matching count", async () => {
      await seedSameDay(7);
      const { rows, total } = await events.listRecentWithTakeCounts(db, {
        page: { limit: 3, offset: 0 },
      });
      expect(rows).toHaveLength(3);
      expect(total).toBe(7);
    });

    it("walks every event exactly once across pages, all held the same day", async () => {
      const ids = await seedSameDay(7);
      const seen: string[] = [];
      for (let offset = 0; offset < 9; offset += 3) {
        const { rows } = await events.listRecentWithTakeCounts(db, {
          page: { limit: 3, offset },
        });
        seen.push(...rows.map((r) => r.id));
      }
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
      expect(new Set(seen)).toEqual(new Set(ids));
    });

    it("counts what the filter matches, not the whole table", async () => {
      await seedSameDay(4);
      await events.create(db, {
        kind: "concert",
        heldAt: 1_700_000_000_000,
        createdAt: 9000,
        updatedAt: 9000,
      });
      const { total } = await events.listRecentWithTakeCounts(db, { kind: ["concert"] });
      expect(total).toBe(1);
    });

    it("onlyArchived counts and returns the archive, not both sets", async () => {
      const ids = await seedSameDay(3);
      await events.update(db, ids[0] as string, { archivedAt: 5000, updatedAt: 5000 });

      const live = await events.listRecentWithTakeCounts(db);
      const archived = await events.listRecentWithTakeCounts(db, { onlyArchived: true });
      expect(live.total).toBe(2);
      expect(archived.total).toBe(1);
      expect(archived.rows.map((r) => r.id)).toEqual([ids[0]]);
      expect(await events.count(db, { onlyArchived: true })).toBe(1);
    });
  });

  describe("listOnDay", () => {
    it("finds another event of the same kind that day, and not the day either side", async () => {
      const day = new Date(2026, 6, 8).getTime();
      const onIt = await events.create(db, {
        kind: "rehearsal",
        heldAt: day + 3600_000,
        createdAt: 1,
        updatedAt: 1,
      });
      await events.create(db, {
        kind: "rehearsal",
        heldAt: day - 1,
        createdAt: 2,
        updatedAt: 2,
      });
      await events.create(db, {
        kind: "rehearsal",
        heldAt: day + 24 * 3600_000,
        createdAt: 3,
        updatedAt: 3,
      });
      // Same day, different kind — an afternoon rehearsal and an evening gig
      // are not duplicates of each other.
      await events.create(db, {
        kind: "concert",
        heldAt: day + 7200_000,
        createdAt: 4,
        updatedAt: 4,
      });

      const found = await events.listOnDay(db, "rehearsal", day);
      expect(found.map((e) => e.id)).toEqual([onIt.id]);
    });

    it("skips archived events by default and includes them when asked", async () => {
      const day = new Date(2026, 6, 8).getTime();
      const e = await events.create(db, {
        kind: "rehearsal",
        heldAt: day,
        createdAt: 1,
        updatedAt: 1,
      });
      await events.update(db, e.id, { archivedAt: 2000, updatedAt: 2000 });

      expect(await events.listOnDay(db, "rehearsal", day)).toEqual([]);
      // The ingest path needs the archived one: `client_ref` is UNIQUE, so a
      // filtered lookup makes the bridge's insert throw.
      expect(
        (await events.listOnDay(db, "rehearsal", day, { includeArchived: true })).map((x) => x.id),
      ).toEqual([e.id]);
    });
  });
});

describe("personal events", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  async function seed() {
    const song = await songs.create(db, { title: "S", slug: "s", createdAt: 1, updatedAt: 1 });
    const band = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1,
      updatedAt: 1,
    });
    const personal = await events.create(db, {
      kind: "personal",
      ownerMemberId: "m-1",
      heldAt: 2000,
      createdAt: 1,
      updatedAt: 1,
    });
    await takes.create(db, {
      songId: song.id,
      eventId: personal.id,
      recordedAt: 2000,
      visibility: "private",
      ownerMemberId: "m-1",
      createdAt: 1,
      updatedAt: 1,
    });
    return { song, band, personal };
  }

  it("stay out of every listing and count while they hold only private takes", async () => {
    const { band } = await seed();
    const listed = await events.listRecentWithTakeCounts(db);
    expect(listed.rows.map((e) => e.id)).toEqual([band.id]);
    expect(listed.total).toBe(1);
    expect(await events.count(db)).toBe(1);
  });

  it("appear once they hold a band take, counting only that take", async () => {
    const { song, personal } = await seed();
    await takes.create(db, {
      songId: song.id,
      eventId: personal.id,
      recordedAt: 2500,
      ownerMemberId: "m-1",
      createdAt: 1,
      updatedAt: 1,
    });
    const listed = await events.listRecentWithTakeCounts(db);
    const row = listed.rows.find((e) => e.id === personal.id);
    expect(row?.takeCount).toBe(1);
    expect(await events.count(db)).toBe(2);
  });

  it("are never offered by listRecent, the add-take form's event picker", async () => {
    const { band } = await seed();
    expect((await events.listRecent(db)).map((e) => e.id)).toEqual([band.id]);
  });
});

describe("events.findOrCreatePersonal", () => {
  it("returns the same event for one member and one day, and a new one otherwise", async () => {
    const db = await createTestDb();
    const a = await events.findOrCreatePersonal(db, {
      memberId: "m-1",
      dayKey: "2026-09-19",
      heldAt: 10,
      now: 10,
    });
    const again = await events.findOrCreatePersonal(db, {
      memberId: "m-1",
      dayKey: "2026-09-19",
      heldAt: 99,
      now: 99,
    });
    const otherDay = await events.findOrCreatePersonal(db, {
      memberId: "m-1",
      dayKey: "2026-09-20",
      heldAt: 20,
      now: 20,
    });
    const otherMember = await events.findOrCreatePersonal(db, {
      memberId: "m-2",
      dayKey: "2026-09-19",
      heldAt: 10,
      now: 10,
    });

    expect(again.id).toBe(a.id);
    expect(a.kind).toBe("personal");
    expect(a.ownerMemberId).toBe("m-1");
    expect(a.heldAt).toBe(10);
    expect(a.clientRef).toBe(events.personalEventClientRef("m-1", "2026-09-19"));
    expect(new Set([a.id, otherDay.id, otherMember.id]).size).toBe(3);
  });
});
