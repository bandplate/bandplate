import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as instruments from "./instruments.js";
import * as members from "./members.js";

describe("members repo", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("stores email normalized (lowercased, trimmed)", async () => {
    const created = await members.create(db, {
      displayName: "Alex",
      slug: "alex",
      email: "  Alex@Example.COM  ",
      createdAt: Date.now(),
    });
    expect(created.email).toBe("alex@example.com");
  });

  it("getByEmail normalizes the lookup input the same way", async () => {
    await members.create(db, {
      displayName: "Alex",
      slug: "alex",
      email: "alex@example.com",
      createdAt: Date.now(),
    });

    const found = await members.getByEmail(db, "  ALEX@example.com  ");
    expect(found?.slug).toBe("alex");
  });

  it("defaults role to member and status to invited", async () => {
    const created = await members.create(db, {
      displayName: "Jamie",
      slug: "jamie",
      email: "jamie@example.com",
      createdAt: Date.now(),
    });
    expect(created.role).toBe("member");
    expect(created.status).toBe("invited");
  });

  it("setStatus transitions a member without deleting the row", async () => {
    const created = await members.create(db, {
      displayName: "Sam",
      slug: "sam",
      email: "sam@example.com",
      createdAt: Date.now(),
    });

    await members.setStatus(db, created.id, "disabled");

    const found = await members.getById(db, created.id);
    expect(found).toBeDefined();
    expect(found?.status).toBe("disabled");
  });

  describe("update", () => {
    it("updates status and role together in one statement", async () => {
      const created = await members.create(db, {
        displayName: "Robin",
        slug: "robin",
        email: "robin@example.com",
        createdAt: Date.now(),
      });

      await members.update(db, created.id, { status: "active", role: "admin" });

      const found = await members.getById(db, created.id);
      expect(found?.status).toBe("active");
      expect(found?.role).toBe("admin");
    });

    it("updates only the provided field, leaving the other untouched", async () => {
      const created = await members.create(db, {
        displayName: "Sam",
        slug: "sam",
        email: "sam2@example.com",
        role: "admin",
        createdAt: Date.now(),
      });

      await members.update(db, created.id, { status: "active" });

      const found = await members.getById(db, created.id);
      expect(found?.status).toBe("active");
      expect(found?.role).toBe("admin");
    });

    it("is a no-op when given an empty input", async () => {
      const created = await members.create(db, {
        displayName: "Sam",
        slug: "sam",
        email: "sam3@example.com",
        createdAt: Date.now(),
      });

      await members.update(db, created.id, {});

      const found = await members.getById(db, created.id);
      expect(found?.status).toBe("invited");
      expect(found?.role).toBe("member");
    });
  });

  it("count reflects the number of rows", async () => {
    expect(await members.count(db)).toBe(0);

    await members.create(db, {
      displayName: "Robin",
      slug: "robin",
      email: "robin@example.com",
      createdAt: Date.now(),
    });

    expect(await members.count(db)).toBe(1);
  });

  describe("createIfEmpty", () => {
    it("creates an admin/active member with a normalized email when the table is empty", async () => {
      const created = await members.createIfEmpty(db, {
        displayName: "Root Admin",
        slug: "root-admin",
        email: "  Admin@Example.COM  ",
        createdAt: 1_000,
        emailVerifiedAt: 1_000,
      });

      expect(created).toBeDefined();
      expect(created?.role).toBe("admin");
      expect(created?.status).toBe("active");
      expect(created?.email).toBe("admin@example.com");
    });

    it("refuses when a member already exists", async () => {
      await members.create(db, {
        displayName: "Existing",
        slug: "existing",
        email: "existing@example.com",
        createdAt: 1_000,
      });

      const second = await members.createIfEmpty(db, {
        displayName: "Root Admin",
        slug: "root-admin",
        email: "admin@example.com",
        createdAt: 2_000,
      });

      expect(second).toBeUndefined();
      expect(await members.count(db)).toBe(1);
    });
  });

  // Task 6 review round 1's "data-model gap": member<->instrument. See
  // `schema/sqlite/index.ts`'s `memberInstruments` comment for why this is
  // a join table.
  describe("instruments", () => {
    it("listInstrumentsForMember returns nothing for a member with none set", async () => {
      const member = await members.create(db, {
        displayName: "Robin",
        slug: "robin-instruments-none",
        email: "robin-instruments-none@example.com",
        createdAt: Date.now(),
      });

      expect(await members.listInstrumentsForMember(db, member.id)).toEqual([]);
    });

    it("setInstruments then listInstrumentsForMember round-trips, ordered by sortOrder", async () => {
      const member = await members.create(db, {
        displayName: "Robin",
        slug: "robin-instruments-roundtrip",
        email: "robin-instruments-roundtrip@example.com",
        createdAt: Date.now(),
      });
      const drums = await instruments.create(db, {
        slug: "drums-rt",
        label: "Drums",
        sortOrder: 0,
      });
      const bass = await instruments.create(db, { slug: "bass-rt", label: "Bass", sortOrder: 1 });

      // Deliberately passed out of sortOrder to prove the read side orders
      // them, not the write side.
      await members.setInstruments(db, member.id, [bass.id, drums.id]);

      const result = await members.listInstrumentsForMember(db, member.id);
      expect(result.map((i) => i.id)).toEqual([drums.id, bass.id]);
    });

    it("setInstruments replaces the previous set rather than adding to it", async () => {
      const member = await members.create(db, {
        displayName: "Robin",
        slug: "robin-instruments-replace",
        email: "robin-instruments-replace@example.com",
        createdAt: Date.now(),
      });
      const drums = await instruments.create(db, {
        slug: "drums-replace",
        label: "Drums",
      });
      const bass = await instruments.create(db, { slug: "bass-replace", label: "Bass" });

      await members.setInstruments(db, member.id, [drums.id]);
      await members.setInstruments(db, member.id, [bass.id]);

      const result = await members.listInstrumentsForMember(db, member.id);
      expect(result.map((i) => i.id)).toEqual([bass.id]);
    });

    it("setInstruments with an empty array clears every instrument", async () => {
      const member = await members.create(db, {
        displayName: "Robin",
        slug: "robin-instruments-clear",
        email: "robin-instruments-clear@example.com",
        createdAt: Date.now(),
      });
      const drums = await instruments.create(db, { slug: "drums-clear", label: "Drums" });
      await members.setInstruments(db, member.id, [drums.id]);

      await members.setInstruments(db, member.id, []);

      expect(await members.listInstrumentsForMember(db, member.id)).toEqual([]);
    });

    it("keeps rendering an instrument the band has since archived", async () => {
      const member = await members.create(db, {
        displayName: "Dee",
        slug: "dee-archived-instrument",
        email: "dee-archived-instrument@example.com",
        createdAt: Date.now(),
      });
      const trombone = await instruments.create(db, {
        slug: "trombone-archived",
        label: "Trombone",
      });
      await members.setInstruments(db, member.id, [trombone.id]);

      await instruments.archive(db, trombone.id, Date.now());

      const result = await members.listInstrumentsForMember(db, member.id);
      expect(result.map((i) => i.id)).toContain(trombone.id);
      expect(result.find((i) => i.id === trombone.id)?.archivedAt).not.toBeNull();
    });

    it("listInstrumentsForMembers batches every member's instruments in one call", async () => {
      const a = await members.create(db, {
        displayName: "A",
        slug: "batch-member-a",
        email: "batch-member-a@example.com",
        createdAt: Date.now(),
      });
      const b = await members.create(db, {
        displayName: "B",
        slug: "batch-member-b",
        email: "batch-member-b@example.com",
        createdAt: Date.now(),
      });
      const drums = await instruments.create(db, { slug: "drums-batch", label: "Drums" });
      const bass = await instruments.create(db, { slug: "bass-batch", label: "Bass" });
      await members.setInstruments(db, a.id, [drums.id]);
      await members.setInstruments(db, b.id, [bass.id]);

      const result = await members.listInstrumentsForMembers(db, [a.id, b.id]);
      expect(result.get(a.id)?.map((i) => i.id)).toEqual([drums.id]);
      expect(result.get(b.id)?.map((i) => i.id)).toEqual([bass.id]);
    });

    it("listInstrumentsForMembers returns an empty map for an empty id list", async () => {
      expect(await members.listInstrumentsForMembers(db, [])).toEqual(new Map());
    });
  });
});

describe("members.getByIds", () => {
  it("returns only the requested members, and nothing for an empty list", async () => {
    const db = await createTestDb();
    const a = await members.create(db, {
      displayName: "A",
      slug: "a",
      email: "a@example.com",
      createdAt: 1,
    });
    await members.create(db, { displayName: "B", slug: "b", email: "b@example.com", createdAt: 1 });
    expect((await members.getByIds(db, [a.id])).map((m) => m.displayName)).toEqual(["A"]);
    expect(await members.getByIds(db, [])).toEqual([]);
  });
});
