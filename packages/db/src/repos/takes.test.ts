import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "../client.js";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as events from "./events.js";
import * as instruments from "./instruments.js";
import * as members from "./members.js";
import * as songs from "./songs.js";
import * as takes from "./takes.js";
import * as votes from "./votes.js";

describe("takes.listByInstruments", () => {
  let db: Db;
  let songId: string;
  let eventId: string;
  let bassId: string;
  let drumsId: string;
  let guitarId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();

    const song = await songs.create(db, {
      title: "AND Semantics Song",
      slug: "and-semantics-song",
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
    guitarId = (await instruments.create(db, { slug: "guitar", label: "Guitar" })).id;
  });

  it("matches a take with {bass, drums} when querying for {bass} alone", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId, drumsId],
    });

    const result = await takes.listByInstruments(db, [bassId]);
    expect(result.map((t) => t.id)).toContain(take.id);
  });

  it("matches a take with {bass, drums} when querying for {bass, drums}", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId, drumsId],
    });

    const result = await takes.listByInstruments(db, [bassId, drumsId]);
    expect(result.map((t) => t.id)).toContain(take.id);
  });

  it("does NOT match a take with only {bass} when querying for {bass, drums} (AND, not OR)", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId],
    });

    const result = await takes.listByInstruments(db, [bassId, drumsId]);
    expect(result.map((t) => t.id)).not.toContain(take.id);
  });

  it("does not match on an unrelated instrument", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId, drumsId],
    });

    const result = await takes.listByInstruments(db, [guitarId]);
    expect(result.map((t) => t.id)).not.toContain(take.id);
  });

  it("returns an empty array for an empty instrument list", async () => {
    const result = await takes.listByInstruments(db, []);
    expect(result).toEqual([]);
  });
});

describe("takes.listByEvent ordering", () => {
  let db: Db;
  let songId: string;
  let eventId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();
    const song = await songs.create(db, {
      title: "Ordering Song",
      slug: "ordering-song",
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

    await takes.create(db, { songId, eventId, recordedAt: 1000, createdAt: 1000, updatedAt: 1000 });
    await takes.create(db, { songId, eventId, recordedAt: 3000, createdAt: 3000, updatedAt: 3000 });
    await takes.create(db, { songId, eventId, recordedAt: 2000, createdAt: 2000, updatedAt: 2000 });
  });

  it("defaults to newest first (desc)", async () => {
    const result = await takes.listByEvent(db, eventId);
    expect(result.map((t) => t.recordedAt)).toEqual([3000, 2000, 1000]);
  });

  it("order: 'asc' returns recorded order — the order the session actually happened", async () => {
    const result = await takes.listByEvent(db, eventId, { order: "asc" });
    expect(result.map((t) => t.recordedAt)).toEqual([1000, 2000, 3000]);
  });
});

// `getSongDetail` (server/pages/songs.ts) advertises "every take newest
// first" for the song page — pinned here at the repo level, not just
// exercised incidentally by a page test, so removing this function's
// `ORDER BY` fails a test by itself. Rows are inserted out of
// chronological order (like `takes.listByEvent ordering` above) so SQLite's
// un-ordered row-scan order (insertion/rowid order) would NOT happen to
// match the expected result — a real assertion on the ORDER BY, not an
// accident of insert order.
describe("takes.listBySong ordering", () => {
  let db: Db;
  let songId: string;
  let eventId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();
    const song = await songs.create(db, {
      title: "Song Ordering Song",
      slug: "song-ordering-song",
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

    await takes.create(db, { songId, eventId, recordedAt: 1000, createdAt: 1000, updatedAt: 1000 });
    await takes.create(db, { songId, eventId, recordedAt: 3000, createdAt: 3000, updatedAt: 3000 });
    await takes.create(db, { songId, eventId, recordedAt: 2000, createdAt: 2000, updatedAt: 2000 });
  });

  it("returns every take of a song newest first", async () => {
    const result = await takes.listBySong(db, songId);
    expect(result.map((t) => t.recordedAt)).toEqual([3000, 2000, 1000]);
  });

  it("does not include takes of a different song", async () => {
    const now = Date.now();
    const otherSong = await songs.create(db, {
      title: "Other Song",
      slug: "other-song",
      createdAt: now,
      updatedAt: now,
    });
    await takes.create(db, {
      songId: otherSong.id,
      eventId,
      recordedAt: 4000,
      createdAt: 4000,
      updatedAt: 4000,
    });

    const result = await takes.listBySong(db, songId);
    expect(result.map((t) => t.recordedAt)).toEqual([3000, 2000, 1000]);
  });
});

describe("takes.listInstrumentsForTakes", () => {
  let db: Db;
  let songId: string;
  let eventId: string;
  let bassId: string;
  let drumsId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();
    const song = await songs.create(db, {
      title: "Instruments Song",
      slug: "instruments-song",
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
    bassId = (await instruments.create(db, { slug: "bass", label: "Bass", sortOrder: 1 })).id;
    drumsId = (await instruments.create(db, { slug: "drums", label: "Drums", sortOrder: 0 })).id;
  });

  it("batches instruments for multiple takes into one map, ordered by sort order", async () => {
    const now = Date.now();
    const take1 = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId, drumsId],
    });
    const take2 = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId],
    });

    const map = await takes.listInstrumentsForTakes(db, [take1.id, take2.id]);
    expect(map.get(take1.id)?.map((i) => i.slug)).toEqual(["drums", "bass"]);
    expect(map.get(take2.id)?.map((i) => i.slug)).toEqual(["bass"]);
  });

  it("returns an empty map for an empty takeIds list", async () => {
    const map = await takes.listInstrumentsForTakes(db, []);
    expect(map.size).toBe(0);
  });

  it("a take with no instruments has no entry in the map", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const map = await takes.listInstrumentsForTakes(db, [take.id]);
    expect(map.has(take.id)).toBe(false);
  });
});

describe("takes.create atomicity", () => {
  let db: Db;
  let songId: string;
  let eventId: string;
  let bassId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();

    const song = await songs.create(db, {
      title: "Atomicity Song",
      slug: "atomicity-song",
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
  });

  it("produces the take and all its take_instruments rows together", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId],
    });

    const persisted = await takes.getById(db, take.id);
    expect(persisted).toBeDefined();

    const linked = await takes.listByInstruments(db, [bassId]);
    expect(linked.map((t) => t.id)).toContain(take.id);
  });

  /**
   * Proves the batch is atomic in the way that matters: a take insert paired
   * with a take_instruments insert that violates a foreign key must leave
   * BOTH statements rolled back, never a take with zero take_instruments
   * rows. If takes.create still issued two separate round trips (insert
   * take, then insert take_instruments), the take row from the first
   * statement would survive here even though the second one failed — which
   * is exactly the silent-orphan bug the fix eliminates.
   */
  it("rolls back the take insert too when the take_instruments insert fails", async () => {
    const now = Date.now();
    const clientRef = "atomic-rollback-probe";

    await expect(
      takes.create(db, {
        songId,
        eventId,
        recordedAt: now,
        createdAt: now,
        updatedAt: now,
        clientRef,
        instrumentIds: ["nonexistent-instrument-id"],
      }),
    ).rejects.toThrow();

    const rows = await db.select().from(schema.takes).where(eq(schema.takes.clientRef, clientRef));
    expect(rows).toEqual([]);
  });
});

describe("takes.getByIds", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("returns only the requested takes, in no particular guaranteed order", async () => {
    const now = Date.now();
    const song = await songs.create(db, {
      title: "GetByIds Song",
      slug: "getbyids-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const a = await takes.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const b = await takes.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await takes.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const result = await takes.getByIds(db, [a.id, b.id]);
    expect(result.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("returns an empty array for an empty id list", async () => {
    expect(await takes.getByIds(db, [])).toEqual([]);
  });
});

describe("takes.listByEvents", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("groups takes by event and orders each group newest-first by default", async () => {
    const now = Date.now();
    const song = await songs.create(db, {
      title: "ListByEvents Song",
      slug: "listbyevents-song",
      createdAt: now,
      updatedAt: now,
    });
    const eventA = await events.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const eventB = await events.create(db, {
      kind: "concert",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await takes.create(db, {
      songId: song.id,
      eventId: eventA.id,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    await takes.create(db, {
      songId: song.id,
      eventId: eventA.id,
      recordedAt: 3000,
      createdAt: 3000,
      updatedAt: 3000,
    });
    await takes.create(db, {
      songId: song.id,
      eventId: eventB.id,
      recordedAt: 2000,
      createdAt: 2000,
      updatedAt: 2000,
    });

    const result = await takes.listByEvents(db, [eventA.id, eventB.id]);
    expect(result.get(eventA.id)?.map((t) => t.recordedAt)).toEqual([3000, 1000]);
    expect(result.get(eventB.id)?.map((t) => t.recordedAt)).toEqual([2000]);
  });

  it("returns an empty map for an empty eventIds list", async () => {
    const result = await takes.listByEvents(db, []);
    expect(result.size).toBe(0);
  });

  it("an event with no takes has no entry in the map", async () => {
    const now = Date.now();
    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const result = await takes.listByEvents(db, [event.id]);
    expect(result.has(event.id)).toBe(false);
  });
});

describe("takes.listUnvotedByMember", () => {
  let db: Db;
  let songId: string;
  let eventId: string;
  let memberId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();
    const song = await songs.create(db, {
      title: "Unvoted Song",
      slug: "unvoted-song",
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
    const member = await members.create(db, {
      displayName: "Voter",
      slug: "voter",
      email: "voter@example.com",
      createdAt: now,
    });
    memberId = member.id;
  });

  it("includes a published take the member has never voted on", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      state: "published",
    });

    const result = await takes.listUnvotedByMember(db, memberId);
    expect(result.map((t) => t.id)).toContain(take.id);
  });

  it("excludes a published take the member has already voted on", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      state: "published",
    });
    await votes.castVote(db, { takeId: take.id, memberId, keeper: true, now });

    const result = await takes.listUnvotedByMember(db, memberId);
    expect(result.map((t) => t.id)).not.toContain(take.id);
  });

  it("does not include an unpublished (new) take, even if unvoted", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      state: "new",
    });

    const result = await takes.listUnvotedByMember(db, memberId);
    expect(result.map((t) => t.id)).not.toContain(take.id);
  });

  it("does not exclude a take another member voted on", async () => {
    const now = Date.now();
    const other = await members.create(db, {
      displayName: "Other Voter",
      slug: "other-voter",
      email: "other-voter@example.com",
      createdAt: now,
    });
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      state: "published",
    });
    await votes.castVote(db, { takeId: take.id, memberId: other.id, keeper: true, now });

    const result = await takes.listUnvotedByMember(db, memberId);
    expect(result.map((t) => t.id)).toContain(take.id);
  });

  it("returns an empty array when everything published has been voted on", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      state: "published",
    });
    await votes.castVote(db, { takeId: take.id, memberId, keeper: true, now });

    const result = await takes.listUnvotedByMember(db, memberId);
    expect(result).toEqual([]);
  });
});

describe("takes.search", () => {
  let db: Db;
  let eventId: string;
  let bassId: string;
  let drumsId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();
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

  it("with no filters, returns every take newest first", async () => {
    const song = await songs.create(db, {
      title: "Search Song",
      slug: "search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const older = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const newer = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 2000,
      createdAt: 2000,
      updatedAt: 2000,
    });

    const result = await takes.search(db);
    expect(result.map((t) => t.id)).toEqual([newer.id, older.id]);
  });

  it("filters by instrument AND semantics — a take with only bass does not match {bass, drums}", async () => {
    const song = await songs.create(db, {
      title: "Instrument Search Song",
      slug: "instrument-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const bassOnly = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      instrumentIds: [bassId],
    });
    const both = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      instrumentIds: [bassId, drumsId],
    });

    const bassAndDrums = await takes.search(db, { instrumentIds: [bassId, drumsId] });
    expect(bassAndDrums.map((t) => t.id)).toEqual([both.id]);
    expect(bassAndDrums.map((t) => t.id)).not.toContain(bassOnly.id);

    const bassOnlyFilter = await takes.search(db, { instrumentIds: [bassId] });
    expect(bassOnlyFilter.map((t) => t.id).sort()).toEqual([bassOnly.id, both.id].sort());
  });

  it("filters by date range, inclusive on both ends", async () => {
    const song = await songs.create(db, {
      title: "Date Search Song",
      slug: "date-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const early = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const mid = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 2000,
      createdAt: 2000,
      updatedAt: 2000,
    });
    const late = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 3000,
      createdAt: 3000,
      updatedAt: 3000,
    });

    const inRange = await takes.search(db, { dateFrom: 1500, dateTo: 2500 });
    expect(inRange.map((t) => t.id)).toEqual([mid.id]);

    const inclusiveEnds = await takes.search(db, { dateFrom: 1000, dateTo: 3000 });
    expect(inclusiveEnds.map((t) => t.id).sort()).toEqual([early.id, mid.id, late.id].sort());
  });

  it("filters by minimum rating", async () => {
    const song = await songs.create(db, {
      title: "Rating Search Song",
      slug: "rating-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const member = await members.create(db, {
      displayName: "Rater",
      slug: "rater",
      email: "rater@example.com",
      createdAt: 1000,
    });
    const highRated = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const unrated = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    await votes.castVote(db, {
      takeId: highRated.id,
      memberId: member.id,
      keeper: true,
      now: 1000,
    });

    const result = await takes.search(db, { minRating: 0.5 });
    expect(result.map((t) => t.id)).toEqual([highRated.id]);
    expect(result.map((t) => t.id)).not.toContain(unrated.id);
  });

  it("filters by state", async () => {
    const song = await songs.create(db, {
      title: "State Search Song",
      slug: "state-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const published = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      state: "published",
    });
    const rejected = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      state: "rejected",
    });

    const result = await takes.search(db, { states: ["published"] });
    expect(result.map((t) => t.id)).toEqual([published.id]);
    expect(result.map((t) => t.id)).not.toContain(rejected.id);
  });

  it("free-text search matches the song title", async () => {
    const song = await songs.create(db, {
      title: "Neon Skyline",
      slug: "neon-skyline-search",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const other = await songs.create(db, {
      title: "Wildfire",
      slug: "wildfire-search",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const match = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const noMatch = await takes.create(db, {
      songId: other.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });

    const result = await takes.search(db, { search: "skyline" });
    expect(result.map((t) => t.id)).toEqual([match.id]);
    expect(result.map((t) => t.id)).not.toContain(noMatch.id);
  });

  it("free-text search matches a song alias, not just its title", async () => {
    const song = await songs.create(db, {
      title: "Official Title",
      slug: "alias-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    await songs.addAlias(db, song.id, "Nickname Version", "manual");
    const take = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });

    const result = await takes.search(db, { search: "nickname" });
    expect(result.map((t) => t.id)).toEqual([take.id]);
  });

  it("combines filters with AND — instrument plus state, neither alone is enough", async () => {
    const song = await songs.create(db, {
      title: "Combined Search Song",
      slug: "combined-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const matches = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      state: "published",
      instrumentIds: [bassId],
    });
    // Right instrument, wrong state.
    await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      state: "rejected",
      instrumentIds: [bassId],
    });
    // Right state, wrong instrument.
    await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      state: "published",
      instrumentIds: [drumsId],
    });

    const result = await takes.search(db, { instrumentIds: [bassId], states: ["published"] });
    expect(result.map((t) => t.id)).toEqual([matches.id]);
  });

  it("returns an empty array, not an error, when nothing matches", async () => {
    await songs.create(db, {
      title: "Unrelated Song",
      slug: "unrelated-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });

    const result = await takes.search(db, { search: "no-such-title-exists" });
    expect(result).toEqual([]);
  });
});
