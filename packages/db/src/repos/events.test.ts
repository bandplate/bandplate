import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as events from "./events.js";

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
});
