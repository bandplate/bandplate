import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as instruments from "./instruments.js";

describe("instruments repo", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("list() excludes archived instruments by default", async () => {
    const kept = await instruments.create(db, { slug: "kept", label: "Kept" });
    const archived = await instruments.create(db, { slug: "archived", label: "Archived" });
    await instruments.archive(db, archived.id, Date.now());

    const listed = await instruments.list(db);
    const ids = listed.map((i) => i.id);
    expect(ids).toContain(kept.id);
    expect(ids).not.toContain(archived.id);
  });

  it("list({ includeArchived: true }) includes archived instruments", async () => {
    const archived = await instruments.create(db, { slug: "archived-2", label: "Archived 2" });
    await instruments.archive(db, archived.id, Date.now());

    const listed = await instruments.list(db, { includeArchived: true });
    expect(listed.map((i) => i.id)).toContain(archived.id);
  });

  it("archive does not delete the row (historical takes keep resolving it)", async () => {
    const created = await instruments.create(db, { slug: "vintage-synth", label: "Vintage Synth" });
    await instruments.archive(db, created.id, Date.now());

    const all = await instruments.list(db, { includeArchived: true });
    const found = all.find((i) => i.id === created.id);
    expect(found).toBeDefined();
    expect(found?.archivedAt).not.toBeNull();
  });
});
