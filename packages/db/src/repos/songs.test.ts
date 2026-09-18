import { normalizeTitle } from "@bandplate/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as events from "./events.js";
import * as favorites from "./favorites.js";
import * as instruments from "./instruments.js";
import * as members from "./members.js";
import * as notifications from "./notifications.js";
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
      const [result] = (await songs.listWithStats(db)).rows;
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

      const [result] = (await songs.listWithStats(db)).rows;
      expect(result?.takeCount).toBe(2);
      expect(result?.lastPlayedAt).toBe(5000);
    });

    it("search matches a diacritic/case-insensitive substring of the title", async () => {
      const { rows: results } = await songs.listWithStats(db, { search: "STATS" });
      expect(results.map((s) => s.slug)).toEqual(["stats-song"]);

      const { rows: noMatch } = await songs.listWithStats(db, { search: "nonexistent" });
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

      const { rows: results } = await songs.listWithStats(db, { search: "%" });
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

      const { rows: results } = await songs.listWithStats(db, { search: "_" });
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

      const { rows: bassOnly } = await songs.listWithStats(db, { instrumentIds: [bassId] });
      expect(bassOnly.map((s) => s.slug)).toContain("stats-song");

      // No take has both bass AND drums together, so the AND-filtered query
      // must exclude this song even though it has a take with bass alone.
      const { rows: bassAndDrums } = await songs.listWithStats(db, {
        instrumentIds: [bassId, drumsId],
      });
      expect(bassAndDrums.map((s) => s.slug)).not.toContain("stats-song");
    });

    it("instrumentIds filter returns an empty array when nothing matches", async () => {
      const { rows: results } = await songs.listWithStats(db, { instrumentIds: [bassId] });
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

      const { rows: results } = await songs.listWithStats(db, { sort: "recent" });
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

      const { rows: results } = await songs.listWithStats(db, { sort: "takes" });
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

      const { rows: results } = await songs.listWithStats(db, { sort: "takes" });
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

      const { rows: results } = await songs.listWithStats(db, { sort: "recent" });
      expect(results.map((s) => s.slug)).toEqual(["apple-song", "stats-song", "zebra-song"]);
    });

    describe("paging", () => {
      beforeEach(async () => {
        // Ten more, so there is something to page. `titleNorm` is uniquely
        // indexed, so the default `title` sort is already a total order —
        // which is what makes this query safe to page at all.
        for (let i = 0; i < 10; i++) {
          await songs.create(db, {
            title: `Paged Song ${String(i).padStart(2, "0")}`,
            slug: `paged-song-${i}`,
            createdAt: 1,
            updatedAt: 1,
          });
        }
      });

      it("returns a page and the whole library's count", async () => {
        const { rows, total } = await songs.listWithStats(db, { page: { limit: 4, offset: 0 } });
        expect(rows).toHaveLength(4);
        expect(total).toBe(11);
      });

      it("walks every song exactly once across pages", async () => {
        const seen: string[] = [];
        for (let offset = 0; offset < 12; offset += 4) {
          const { rows } = await songs.listWithStats(db, { page: { limit: 4, offset } });
          seen.push(...rows.map((r) => r.id));
        }
        expect(seen).toHaveLength(11);
        expect(new Set(seen).size).toBe(11);
      });

      it("counts what the search matches, not the whole library", async () => {
        const { rows, total } = await songs.listWithStats(db, {
          search: "Paged",
          page: { limit: 3, offset: 0 },
        });
        expect(rows).toHaveLength(3);
        expect(total).toBe(10);
        expect(await songs.count(db, { search: "Paged" })).toBe(10);
      });

      // The instrument filter is a subquery now, not a pre-pass that pulled
      // every matching id into an `inArray` — so it composes with the count.
      it("counts an instrument-filtered library correctly", async () => {
        const filtered = { instrumentIds: [bassId] };
        const { rows, total } = await songs.listWithStats(db, {
          ...filtered,
          page: { limit: 5, offset: 0 },
        });
        expect(total).toBe(rows.length);
        expect(await songs.count(db, filtered)).toBe(total);
      });

      it("onlyArchived returns the archive rather than both sets", async () => {
        await songs.update(db, songId, { archivedAt: 5000, updatedAt: 5000 });
        const live = await songs.listWithStats(db);
        const archived = await songs.listWithStats(db, { onlyArchived: true });
        expect(live.total).toBe(10);
        expect(archived.total).toBe(1);
        expect(archived.rows.map((r) => r.id)).toEqual([songId]);
      });
    });
  });

  // --- M8: manual editing and archiving ------------------------------------

  it("update recomputes titleNorm but never touches the slug", async () => {
    const song = await songs.create(db, {
      title: "Pritel",
      slug: "pritel",
      createdAt: 1000,
      updatedAt: 1000,
    });

    await songs.update(db, song.id, { title: "Přítel o cestách", updatedAt: 2000 });

    const after = await songs.getById(db, song.id);
    expect(after?.title).toBe("Přítel o cestách");
    expect(after?.titleNorm).toBe(normalizeTitle("Přítel o cestách"));
    // The URL is the slug, and it stays put — see `update`'s doc comment.
    expect(after?.slug).toBe("pritel");
    expect(after?.updatedAt).toBe(2000);
  });

  it("update writes only the keys it is given", async () => {
    const song = await songs.create(db, {
      title: "Nightbus",
      slug: "nightbus",
      lyrics: "the whole first verse",
      musicalKey: "Am",
      createdAt: 1000,
      updatedAt: 1000,
    });

    await songs.update(db, song.id, { musicalKey: "Dm", updatedAt: 2000 });

    const after = await songs.getById(db, song.id);
    expect(after?.musicalKey).toBe("Dm");
    expect(after?.lyrics).toBe("the whole first verse");
    expect(after?.title).toBe("Nightbus");
  });

  it("update rejects a rename onto another song's normalized title", async () => {
    await songs.create(db, {
      title: "Žár",
      slug: "zar",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const other = await songs.create(db, {
      title: "Nightbus",
      slug: "nightbus",
      createdAt: 1000,
      updatedAt: 1000,
    });

    // `titleNorm` is UNIQUE, so the collision surfaces as a constraint error
    // the service layer pre-checks for and catches as the race fallback.
    await expect(songs.update(db, other.id, { title: "Zar", updatedAt: 2000 })).rejects.toThrow();
  });

  it("listings exclude archived songs, lookups still return them", async () => {
    const live = await songs.create(db, {
      title: "Alpha",
      slug: "alpha",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const retired = await songs.create(db, {
      title: "Beta",
      slug: "beta",
      createdAt: 1000,
      updatedAt: 1000,
    });
    await songs.update(db, retired.id, { archivedAt: 3000, updatedAt: 3000 });

    expect((await songs.list(db)).map((r) => r.id)).toEqual([live.id]);
    expect((await songs.listWithStats(db)).rows.map((r) => r.id)).toEqual([live.id]);

    // A take of an archived song still links to /songs/beta, so the lookups
    // must keep resolving it.
    expect((await songs.getBySlug(db, "beta"))?.id).toBe(retired.id);
    expect((await songs.getById(db, retired.id))?.id).toBe(retired.id);
    expect((await songs.getByIds(db, [retired.id])).map((r) => r.id)).toEqual([retired.id]);
    expect((await songs.findByTitleNorm(db, "beta"))?.id).toBe(retired.id);
  });

  it("includeArchived brings archived songs back into the listings", async () => {
    const retired = await songs.create(db, {
      title: "Beta",
      slug: "beta",
      createdAt: 1000,
      updatedAt: 1000,
    });
    await songs.update(db, retired.id, { archivedAt: 3000, updatedAt: 3000 });

    expect((await songs.list(db, { includeArchived: true })).map((r) => r.id)).toEqual([
      retired.id,
    ]);
    expect(
      (await songs.listWithStats(db, { includeArchived: true })).rows.map((r) => r.id),
    ).toEqual([retired.id]);
  });

  it("listWithStats combines the search and archived filters", async () => {
    const live = await songs.create(db, {
      title: "Neon Skyline",
      slug: "neon-skyline",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const retired = await songs.create(db, {
      title: "Neon Dust",
      slug: "neon-dust",
      createdAt: 1000,
      updatedAt: 1000,
    });
    await songs.update(db, retired.id, { archivedAt: 3000, updatedAt: 3000 });

    const { rows: found } = await songs.listWithStats(db, { search: "neon" });
    expect(found.map((r) => r.id)).toEqual([live.id]);
  });

  it("update unarchives via a null archivedAt", async () => {
    const song = await songs.create(db, {
      title: "Alpha",
      slug: "alpha",
      createdAt: 1000,
      updatedAt: 1000,
    });
    await songs.update(db, song.id, { archivedAt: 3000, updatedAt: 3000 });
    await songs.update(db, song.id, { archivedAt: null, updatedAt: 4000 });

    expect((await songs.getById(db, song.id))?.archivedAt).toBeNull();
    expect((await songs.list(db)).map((r) => r.id)).toEqual([song.id]);
  });

  it("removeAlias drops one alias and leaves the others", async () => {
    const song = await songs.create(db, {
      title: "Nightbus",
      slug: "nightbus",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const manual = await songs.addAlias(db, song.id, "Night Bus", "manual");
    await songs.addAlias(db, song.id, "reaper:region-guid:abc", "ingest");

    await songs.removeAlias(db, manual.id);

    const left = await songs.listAliases(db, song.id);
    expect(left.map((a) => a.source)).toEqual(["ingest"]);
    expect(await songs.findByAlias(db, normalizeTitle("Night Bus"))).toBeUndefined();
  });

  it("remove deletes the song's aliases, favorites, and chart-change history along with it", async () => {
    const author = await members.create(db, {
      displayName: "Chart Author",
      slug: "chart-author-remove",
      email: "chart-author-remove@example.com",
      createdAt: 1000,
    });
    const song = await songs.create(db, {
      title: "Vanishing Point",
      slug: "vanishing-point",
      createdAt: 1000,
      updatedAt: 1000,
    });
    await songs.addAlias(db, song.id, "Vanish", "manual");
    await favorites.add(db, {
      memberId: author.id,
      targetType: "song",
      targetId: song.id,
      createdAt: 1000,
    });
    await db.batch([
      notifications.buildRecordChartChange(db, {
        songId: song.id,
        memberId: author.id,
        kind: "created",
        changedAt: 1000,
      }),
    ]);

    // All three exist before the delete — otherwise the assertions after
    // `remove` would pass trivially by never having anything to clean up.
    expect(await songs.listAliases(db, song.id)).toHaveLength(1);
    expect(await favorites.listTargetIdsByMember(db, author.id, "song")).toEqual(
      new Set([song.id]),
    );
    expect(await notifications.listSongChangesInWindow(db, song.id, 0, 1000)).toHaveLength(1);

    await songs.remove(db, song.id);

    expect(await songs.getById(db, song.id)).toBeUndefined();
    expect(await songs.listAliases(db, song.id)).toEqual([]);
    expect(await favorites.listTargetIdsByMember(db, author.id, "song")).toEqual(new Set());
    expect(await notifications.listSongChangesInWindow(db, song.id, 0, 1000)).toEqual([]);
  });
});
