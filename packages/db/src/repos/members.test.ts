import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
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

  it("setRole changes the role", async () => {
    const created = await members.create(db, {
      displayName: "Robin",
      slug: "robin",
      email: "robin@example.com",
      createdAt: Date.now(),
    });

    await members.setRole(db, created.id, "admin");

    const found = await members.getById(db, created.id);
    expect(found?.role).toBe("admin");
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
});
