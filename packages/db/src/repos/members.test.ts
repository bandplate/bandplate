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
});
