import { eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "../schema/sqlite/index.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as assetsRepo from "./assets.js";
import * as eventsRepo from "./events.js";
import * as instrumentsRepo from "./instruments.js";
import * as membersRepo from "./members.js";
import * as notificationsRepo from "./notifications.js";
import * as songsRepo from "./songs.js";
import * as takesRepo from "./takes.js";
import * as votesRepo from "./votes.js";

/**
 * Foreign keys are never enforced here (`PRAGMA foreign_keys` stays off, to
 * match Cloudflare D1), so `onDelete: cascade` in the schema is documentation
 * only — nothing stops a repo `remove` from forgetting one of the tables that
 * points at the row it just deleted. `songsRepo.remove`, `takesRepo.remove`
 * and `instrumentsRepo.mergeInto` all carry doc comments saying exactly this,
 * and all three already delete their dependents explicitly; this file is what
 * keeps that true after the next column, the next table, or the next repo
 * forgets to.
 *
 * Two halves, the same shape as `stash-privacy.test.ts`'s own guard:
 *
 *   1. Every FK, enumerated straight from the schema (`getTableConfig`,
 *      grouped by the table each FK points AT), must be classified: either it
 *      has a mapped delete entry point (`ENTRY_POINTS`) whose seeded-graph
 *      test proves no orphan survives it, or it is on `ALLOWLIST` with a
 *      one-line reason nothing ever hard-deletes that parent. A referenced
 *      table in neither fails the guard test below — new FK, not yet
 *      classified.
 *   2. One seeded-graph test per mapped entry point: a parent row, plus a
 *      child row in every table that references it (grandchildren too, where
 *      a cascade chain exists — a song's take, that take's asset), the real
 *      delete called, and a query per child table for rows still pointing at
 *      the deleted id.
 */

// ---------------------------------------------------------------------------
// Step 1: enumerate every FK, grouped by the parent (referenced) table.
// ---------------------------------------------------------------------------

interface FkEdge {
  /** The table whose column holds the FK. */
  child: string;
  /** The table that column points at. */
  parent: string;
}

function allForeignKeys(): FkEdge[] {
  const edges: FkEdge[] = [];
  for (const table of Object.values(schema)) {
    const config = getTableConfig(table);
    for (const fk of config.foreignKeys) {
      const parentConfig = getTableConfig(fk.reference().foreignTable);
      edges.push({ child: config.name, parent: parentConfig.name });
    }
  }
  return edges;
}

const EDGES = allForeignKeys();
const PARENT_TABLES = [...new Set(EDGES.map((edge) => edge.parent))].sort();

/**
 * Parent table -> the real delete entry point that must leave no orphan
 * behind, one-line description of what it is and what it covers.
 */
const ENTRY_POINTS: Record<string, string> = {
  takes:
    "takesRepo.remove — deletes take_instruments, assets and votes (and favorites, not an FK) before the take itself",
  songs:
    "the DB half of apps/web's deleteSong: takesRepo.remove for every take on the song (which also takes each take's own dependents), then songsRepo.remove for song_instrument_notes/song_aliases/song_chart_changes and the song row. deleteSong itself lives in apps/web (it also purges object storage), so this test calls the same two repo functions in the same order rather than importing across the package boundary.",
  instruments:
    "instrumentsRepo.mergeInto — the entry point that actually removes an instrument row with other rows still pointing at it (moving or dropping every one across member_instruments, instrument_aliases, song_instrument_notes, take_instruments and assets). instrumentsRepo.remove is a second, narrower entry point for an UNUSED instrument (its own doc comment: nothing may point at it), which callers only reach after usageByInstrument confirms zero references — so it is not the function a seeded-with-dependents graph should be driven through.",
};

/** Parent table -> why nothing here ever needs a matching entry point. */
const ALLOWLIST: Record<string, string> = {
  members:
    "members are revoked via membersRepo.setStatus, never hard-deleted — no repo function drops a members row",
  events:
    "events are archived via eventsRepo.update({ archivedAt }), never hard-deleted — no repo function drops an events row",
};

describe("orphans: every FK parent table is classified", () => {
  it("has exactly one of a delete entry point or an allowlist reason, for every referenced table", () => {
    for (const parent of PARENT_TABLES) {
      const hasEntry = parent in ENTRY_POINTS;
      const hasAllow = parent in ALLOWLIST;
      expect([hasEntry, hasAllow], `"${parent}" must be classified exactly once`).toEqual([
        !hasAllow,
        !hasEntry,
      ]);
      expect(
        hasEntry || hasAllow,
        `"${parent}" is an FK parent with no entry point and no allowlist reason`,
      ).toBe(true);
    }
    // Equal, not a subset in either direction: a table that stops being an FK
    // parent (or one that gains a new referencing FK) should fail here until
    // its entry is added or removed, the same "equal, not subset" shape
    // stash-privacy.test.ts uses for its own classification guard.
    expect([...Object.keys(ENTRY_POINTS), ...Object.keys(ALLOWLIST)].sort()).toEqual(PARENT_TABLES);
  });
});

// ---------------------------------------------------------------------------
// Step 2: one seeded-graph test per mapped entry point.
// ---------------------------------------------------------------------------

describe("orphans: takes", () => {
  it("takesRepo.remove leaves no orphan take_instruments, assets or votes", async () => {
    const db = await createTestDb();
    const now = Date.now();

    const member = await membersRepo.create(db, {
      displayName: "Anna",
      slug: "anna",
      email: "anna@example.com",
      createdAt: now,
    });
    const instrument = await instrumentsRepo.create(db, { slug: "guitar", label: "Guitar" });
    const song = await songsRepo.create(db, {
      title: "Song",
      slug: "song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const take = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      instrumentIds: [instrument.id],
      createdAt: now,
      updatedAt: now,
    });
    await assetsRepo.createMany(db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossy",
        format: "opus",
        storageKey: "orphans/take-master",
        contentType: "audio/opus",
        bytes: 1024,
        createdAt: now,
      },
    ]);
    await votesRepo.castVote(db, { takeId: take.id, memberId: member.id, keeper: true, now });

    await takesRepo.remove(db, take.id);

    expect(
      await db
        .select()
        .from(schema.takeInstruments)
        .where(eq(schema.takeInstruments.takeId, take.id)),
    ).toEqual([]);
    expect(await db.select().from(schema.assets).where(eq(schema.assets.takeId, take.id))).toEqual(
      [],
    );
    expect(await db.select().from(schema.votes).where(eq(schema.votes.takeId, take.id))).toEqual(
      [],
    );
  });
});

describe("orphans: songs", () => {
  it("deleting every take then the song leaves no orphan at any depth of the chain", async () => {
    const db = await createTestDb();
    const now = Date.now();

    const member = await membersRepo.create(db, {
      displayName: "Bára",
      slug: "bara",
      email: "bara@example.com",
      createdAt: now,
    });
    const instrument = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const song = await songsRepo.create(db, {
      title: "Chart",
      slug: "chart",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Direct children of `songs`.
    await songsRepo.setInstrumentNote(db, song.id, instrument.id, "capo 2", now);
    await songsRepo.addAlias(db, song.id, "chart alias", "manual");
    await notificationsRepo.buildRecordChartChange(db, {
      songId: song.id,
      memberId: member.id,
      kind: "created",
      changedAt: now,
    });

    // A take on the song, and that take's own dependents — the grandchild
    // half of the chain (song -> take -> take_instruments/assets/votes).
    const take = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      instrumentIds: [instrument.id],
      createdAt: now,
      updatedAt: now,
    });
    await assetsRepo.createMany(db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossy",
        format: "opus",
        storageKey: "orphans/song-take-master",
        contentType: "audio/opus",
        bytes: 2048,
        createdAt: now,
      },
    ]);
    await votesRepo.castVote(db, { takeId: take.id, memberId: member.id, keeper: false, now });

    // The real entry point: apps/web's `deleteSong` walks every take on the
    // song through `takesRepo.remove` first (each of which cleans its own
    // dependents), then calls `songsRepo.remove` — see that function's own
    // doc comment. Mirrored here rather than imported: `deleteSong` lives in
    // apps/web and also purges object storage, out of scope for a
    // packages/db repo test.
    for (const row of await takesRepo.listAllBySong(db, song.id)) {
      await takesRepo.remove(db, row.id);
    }
    await songsRepo.remove(db, song.id);

    expect(
      await db
        .select()
        .from(schema.songInstrumentNotes)
        .where(eq(schema.songInstrumentNotes.songId, song.id)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.songAliases).where(eq(schema.songAliases.songId, song.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.songChartChanges)
        .where(eq(schema.songChartChanges.songId, song.id)),
    ).toEqual([]);
    expect(await db.select().from(schema.takes).where(eq(schema.takes.songId, song.id))).toEqual(
      [],
    );
    // The grandchildren: the take is gone, so nothing should still point at it.
    expect(
      await db
        .select()
        .from(schema.takeInstruments)
        .where(eq(schema.takeInstruments.takeId, take.id)),
    ).toEqual([]);
    expect(await db.select().from(schema.assets).where(eq(schema.assets.takeId, take.id))).toEqual(
      [],
    );
    expect(await db.select().from(schema.votes).where(eq(schema.votes.takeId, take.id))).toEqual(
      [],
    );
  });
});

describe("orphans: instruments", () => {
  it("instrumentsRepo.mergeInto leaves no row still pointing at the merged-away instrument", async () => {
    const db = await createTestDb();
    const now = Date.now();

    const member = await membersRepo.create(db, {
      displayName: "Cyril",
      slug: "cyril",
      email: "cyril@example.com",
      createdAt: now,
    });
    const source = await instrumentsRepo.create(db, { slug: "guitar-2", label: "Guitar 2" });
    const target = await instrumentsRepo.create(db, { slug: "guitar", label: "Guitar" });
    const song = await songsRepo.create(db, {
      title: "Merge Song",
      slug: "merge-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const take = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      instrumentIds: [source.id],
      createdAt: now,
      updatedAt: now,
    });

    await membersRepo.setInstruments(db, member.id, [source.id]);
    await instrumentsRepo.addAlias(db, {
      instrumentId: source.id,
      slug: "gtr2-alias",
      source: "manual",
    });
    await songsRepo.setInstrumentNote(db, song.id, source.id, "drop D", now);
    await assetsRepo.createMany(db, [
      {
        takeId: take.id,
        kind: "stem",
        instrumentId: source.id,
        tier: "lossy",
        format: "wav",
        storageKey: "orphans/instrument-stem",
        contentType: "audio/wav",
        bytes: 4096,
        createdAt: now,
      },
    ]);

    const plan = await instrumentsRepo.planMerge(db, source.id, target.id);
    await instrumentsRepo.mergeInto(db, source.id, target.id, plan);

    expect(await instrumentsRepo.getById(db, source.id)).toBeUndefined();
    expect(
      await db
        .select()
        .from(schema.memberInstruments)
        .where(eq(schema.memberInstruments.instrumentId, source.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.instrumentAliases)
        .where(eq(schema.instrumentAliases.instrumentId, source.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.songInstrumentNotes)
        .where(eq(schema.songInstrumentNotes.instrumentId, source.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.takeInstruments)
        .where(eq(schema.takeInstruments.instrumentId, source.id)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.assets).where(eq(schema.assets.instrumentId, source.id)),
    ).toEqual([]);
  });
});
