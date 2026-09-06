import { normalizeTitle } from "@bandlib/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as events from "./events.js";
import * as instruments from "./instruments.js";
import * as songs from "./songs.js";
import * as takes from "./takes.js";

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

  it("list() orders alphabetically by normalized title, not insertion order", async () => {
    await songs.create(db, {
      title: "Zebra",
      slug: "zebra",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await songs.create(db, {
      title: "Apple",
      slug: "apple",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const list = await songs.list(db);
    expect(list.map((s) => s.slug)).toEqual(["apple", "zebra"]);
  });

  it("listAliases returns every alias of a song", async () => {
    const song = await songs.create(db, {
      title: "Many Aliases",
      slug: "many-aliases",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await songs.addAlias(db, song.id, "First Alias", "manual");
    await songs.addAlias(db, song.id, "reaper:region-guid:abc123", "ingest");

    const aliases = await songs.listAliases(db, song.id);
    expect(aliases.map((a) => a.aliasNorm).sort()).toEqual(
      ["first alias", "reaper:region-guid:abc123"].sort(),
    );
  });

  it("listAliases returns an empty array for a song with no aliases", async () => {
    const song = await songs.create(db, {
      title: "No Aliases",
      slug: "no-aliases",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(await songs.listAliases(db, song.id)).toEqual([]);
  });

  it("setInstrumentNote upserts, and listInstrumentNotes orders by instrument sort order", async () => {
    const song = await songs.create(db, {
      title: "Notes Song",
      slug: "notes-song",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const bass = await instruments.create(db, { slug: "bass", label: "Bass", sortOrder: 1 });
    const drums = await instruments.create(db, { slug: "drums", label: "Drums", sortOrder: 0 });

    await songs.setInstrumentNote(db, song.id, bass.id, "Walk the bridge in half time.", 1000);
    await songs.setInstrumentNote(db, song.id, drums.id, "Count in on the hi-hat.", 1000);
    // Upsert: same song+instrument pair updates the body, not a second row.
    await songs.setInstrumentNote(db, song.id, bass.id, "Walk the bridge, revised.", 2000);

    const notes = await songs.listInstrumentNotes(db, song.id);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.instrumentLabel)).toEqual(["Drums", "Bass"]);
    expect(notes[1]?.body).toBe("Walk the bridge, revised.");
  });

  describe("listWithStats", () => {
    let songId: string;
    let eventId: string;
    let bassId: string;
    let drumsId: string;

    beforeEach(async () => {
      const now = Date.now();
      const song = await songs.create(db, {
        title: "Stats Song",
        slug: "stats-song",
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
    });

    it("reports zero takes and a null lastPlayedAt for a song with none", async () => {
      const [result] = await songs.listWithStats(db);
      expect(result?.takeCount).toBe(0);
      expect(result?.lastPlayedAt).toBeNull();
    });

    it("counts takes and reports the most recent recordedAt", async () => {
      await takes.create(db, {
        songId,
        eventId,
        recordedAt: 1000,
        createdAt: 1000,
        updatedAt: 1000,
      });
      await takes.create(db, {
        songId,
        eventId,
        recordedAt: 5000,
        createdAt: 5000,
        updatedAt: 5000,
      });

      const [result] = await songs.listWithStats(db);
      expect(result?.takeCount).toBe(2);
      expect(result?.lastPlayedAt).toBe(5000);
    });

    it("search matches a diacritic/case-insensitive substring of the title", async () => {
      const results = await songs.listWithStats(db, { search: "STATS" });
      expect(results.map((s) => s.slug)).toEqual(["stats-song"]);

      const noMatch = await songs.listWithStats(db, { search: "nonexistent" });
      expect(noMatch).toEqual([]);
    });

    // SQLite's LIKE treats `%`/`_` as wildcards unless escaped — an
    // unescaped search term turns a literal `%` or `_` into "match
    // anything"/"match any one character", which is wrong (not an
    // injection risk, since the value is parameterized either way).
    it("a literal '%' in the search term does not match every song", async () => {
      await songs.create(db, {
        title: "Another Song",
        slug: "another-song",
        createdAt: 1,
        updatedAt: 1,
      });

      const results = await songs.listWithStats(db, { search: "%" });
      expect(results).toEqual([]);
    });

    it("a literal '_' in the search term matches only a title that actually contains one, not every song", async () => {
      await songs.create(db, {
        title: "Under_score",
        slug: "under-score",
        createdAt: 1,
        updatedAt: 1,
      });
      await songs.create(db, {
        title: "Another Song",
        slug: "another-song",
        createdAt: 1,
        updatedAt: 1,
      });

      const results = await songs.listWithStats(db, { search: "_" });
      expect(results.map((s) => s.slug)).toEqual(["under-score"]);
    });

    it("instrumentIds filter requires ALL instruments on the SAME take (AND semantics)", async () => {
      await takes.create(db, {
        songId,
        eventId,
        recordedAt: 1000,
        createdAt: 1000,
        updatedAt: 1000,
        instrumentIds: [bassId],
      });

      const bassOnly = await songs.listWithStats(db, { instrumentIds: [bassId] });
      expect(bassOnly.map((s) => s.slug)).toContain("stats-song");

      // No take has both bass AND drums together, so the AND-filtered query
      // must exclude this song even though it has a take with bass alone.
      const bassAndDrums = await songs.listWithStats(db, { instrumentIds: [bassId, drumsId] });
      expect(bassAndDrums.map((s) => s.slug)).not.toContain("stats-song");
    });

    it("instrumentIds filter returns an empty array when nothing matches", async () => {
      const results = await songs.listWithStats(db, { instrumentIds: [bassId] });
      expect(results).toEqual([]);
    });

    it("sort: 'recent' orders by lastPlayedAt descending, unplayed songs last", async () => {
      const other = await songs.create(db, {
        title: "Other Song",
        slug: "other-song",
        createdAt: 1,
        updatedAt: 1,
      });
      await takes.create(db, {
        songId: other.id,
        eventId,
        recordedAt: 9000,
        createdAt: 9000,
        updatedAt: 9000,
      });

      const results = await songs.listWithStats(db, { sort: "recent" });
      // "other-song" was played (9000); "stats-song" has never been played.
      expect(results.map((s) => s.slug)).toEqual(["other-song", "stats-song"]);
    });

    it("sort: 'takes' orders by take count descending", async () => {
      await takes.create(db, { songId, eventId, recordedAt: 1, createdAt: 1, updatedAt: 1 });
      const quiet = await songs.create(db, {
        title: "Quiet Song",
        slug: "quiet-song",
        createdAt: 1,
        updatedAt: 1,
      });

      const results = await songs.listWithStats(db, { sort: "takes" });
      const quietIndex = results.findIndex((s) => s.slug === "quiet-song");
      const statsIndex = results.findIndex((s) => s.slug === "stats-song");
      expect(quiet.slug).toBe("quiet-song");
      expect(statsIndex).toBeLessThan(quietIndex);
    });

    // Both non-title sorts have a primary key that ties constantly (several
    // songs with the same take count, or several never-played songs sharing
    // a null lastPlayedAt) — without a secondary key, tied rows come back in
    // whatever order SQLite's GROUP BY happens to produce, which is not
    // contractual. `titleNorm` ascending is the deterministic tie-break, so
    // three songs tied on the primary key must still come back alphabetical.
    it("sort: 'takes' breaks a tie between equal take counts by title", async () => {
      await songs.create(db, {
        title: "Zebra Song",
        slug: "zebra-song",
        createdAt: 1,
        updatedAt: 1,
      });
      await songs.create(db, {
        title: "Apple Song",
        slug: "apple-song",
        createdAt: 1,
        updatedAt: 1,
      });
      await songs.create(db, {
        title: "Mango Song",
        slug: "mango-song",
        createdAt: 1,
        updatedAt: 1,
      });
      // "stats-song" (from beforeEach) also has zero takes, so all four songs
      // tie at takeCount === 0.

      const results = await songs.listWithStats(db, { sort: "takes" });
      expect(results.map((s) => s.slug)).toEqual([
        "apple-song",
        "mango-song",
        "stats-song",
        "zebra-song",
      ]);
    });

    it("sort: 'recent' breaks a tie between never-played songs by title", async () => {
      await songs.create(db, {
        title: "Zebra Song",
        slug: "zebra-song",
        createdAt: 1,
        updatedAt: 1,
      });
      await songs.create(db, {
        title: "Apple Song",
        slug: "apple-song",
        createdAt: 1,
        updatedAt: 1,
      });
      // "stats-song" (from beforeEach) is also never played — all three tie
      // on a null lastPlayedAt.

      const results = await songs.listWithStats(db, { sort: "recent" });
      expect(results.map((s) => s.slug)).toEqual(["apple-song", "stats-song", "zebra-song"]);
    });
  });
});
