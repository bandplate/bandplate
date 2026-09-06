import { normalizeTitle } from "@bandlib/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as songs from "./songs.js";

describe("songs repo", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("stores titleNorm produced by normalizeTitle", async () => {
    const song = await songs.create(db, {
      title: "Přítel (take 3)",
      slug: "pritel",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(song.titleNorm).toBe(normalizeTitle("Přítel (take 3)"));
    expect(song.titleNorm).toBe("pritel");
  });

  it("findByTitleNorm resolves the song", async () => {
    const song = await songs.create(db, {
      title: "Žár",
      slug: "zar",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const found = await songs.findByTitleNorm(db, "zar");
    expect(found?.id).toBe(song.id);
  });

  it("addAlias + findByAlias resolves the song via a normalized alias", async () => {
    const song = await songs.create(db, {
      title: "Original Title",
      slug: "original-title",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await songs.addAlias(db, song.id, "Alternate Name (take 2)", "manual");

    const found = await songs.findByAlias(db, normalizeTitle("Alternate Name (take 2)"));
    expect(found?.id).toBe(song.id);
  });

  it("aliasNorm is unique across the whole table", async () => {
    const songA = await songs.create(db, {
      title: "Song A",
      slug: "song-a",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const songB = await songs.create(db, {
      title: "Song B",
      slug: "song-b",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await songs.addAlias(db, songA.id, "Shared Alias", "manual");
    await expect(songs.addAlias(db, songB.id, "Shared Alias", "manual")).rejects.toThrow();
  });

  it("getBySlug returns undefined for an unknown slug", async () => {
    const found = await songs.getBySlug(db, "does-not-exist");
    expect(found).toBeUndefined();
  });
});
