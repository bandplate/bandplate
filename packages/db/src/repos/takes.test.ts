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
import type { TakeState } from "./takes.js";
import * as votes from "./votes.js";

/**
 * Inserts a take with a caller-chosen id, bypassing `takes.create`'s own
 * uuidv7 generation. uuidv7 ids rise monotonically with insertion order, so
 * a fixture built with `takes.create` alone can never tell a real
 * `ORDER BY ..., id DESC` apart from SQLite's incidental tie order — both
 * happen to agree when ids are assigned in insertion order. The three
 * `desc(takes.id)` tie-break tests below need id lexical order to run
 * OPPOSITE insertion order (a row inserted first gets the lexically LARGER
 * id) so only the real tie-break can produce the asserted order — see each
 * test's own comment for the discriminating fixture this proves.
 */
async function insertTakeWithId(
  db: Db,
  id: string,
  input: {
    songId: string;
    eventId: string;
    recordedAt: number;
    state?: TakeState;
  },
): Promise<void> {
  const now = input.recordedAt;
  await db.insert(schema.takes).values({
    id,
    songId: input.songId,
    eventId: input.eventId,
    label: null,
    recordedAt: input.recordedAt,
    durationMs: null,
    state: input.state ?? "uploading",
    keeperVotes: 0,
    totalVotes: 0,
    ratingScore: 0,
    clientRef: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    purgedAt: null,
  });
}

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

  // F6 (review round 1): no deterministic tie-break for takes sharing a
  // `recordedAt`.
  //
  // Fix round 2, item 1: `takes.create`'s uuidv7 ids rise monotonically
  // with insertion order, so a fixture built with it can't distinguish the
  // real `desc(takes.id)` tie-break from SQLite's incidental tie order —
  // both agree when ids are assigned in insertion order, so the old
  // `[a.id, b.id].sort().reverse()` assertion passed even with
  // `desc(takes.id)` deleted from `listBySong`. Here `"zzz-take"` is
  // inserted FIRST and `"aaa-take"` SECOND — id lexical order is the
  // reverse of insertion order — so only the real `ORDER BY ..., id DESC`
  // can produce `["zzz-take", "aaa-take"]`; the incidental tie order (rows
  // sharing an indexed `recordedAt`, no secondary key) does not. Confirmed
  // by temporarily stripping `desc(takes.id)` from `listBySong`'s query:
  // this test goes red (actual order becomes `["aaa-take", "zzz-take"]`),
  // then passes again once restored.
  it("breaks a tie on recordedAt deterministically (by id, descending)", async () => {
    const same = 9000;
    await insertTakeWithId(db, "zzz-take", { songId, eventId, recordedAt: same });
    await insertTakeWithId(db, "aaa-take", { songId, eventId, recordedAt: same });

    const first = await takes.listBySong(db, songId);
    const second = await takes.listBySong(db, songId);
    const tied = first.filter((t) => t.recordedAt === same).map((t) => t.id);
    expect(tied).toEqual(second.filter((t) => t.recordedAt === same).map((t) => t.id));
    expect(tied).toEqual(["zzz-take", "aaa-take"]);
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

  // F6 (review round 1): no deterministic tie-break for takes sharing a
  // `recordedAt`.
  //
  // Fix round 2, item 1: see `listBySong`'s identical comment above — a
  // `takes.create`-only fixture can't distinguish the real tie-break from
  // SQLite's incidental order. `"zzz-take"` inserted first, `"aaa-take"`
  // second (id lexical order reversed from insertion order). Confirmed by
  // temporarily stripping `desc(takes.id)` from `listUnvotedByMember`'s
  // query: this test goes red, then passes again once restored.
  it("breaks a tie on recordedAt deterministically (by id, descending)", async () => {
    const same = 9000;
    await insertTakeWithId(db, "zzz-take", {
      songId,
      eventId,
      recordedAt: same,
      state: "published",
    });
    await insertTakeWithId(db, "aaa-take", {
      songId,
      eventId,
      recordedAt: same,
      state: "published",
    });

    const first = await takes.listUnvotedByMember(db, memberId);
    const second = await takes.listUnvotedByMember(db, memberId);
    expect(first.map((t) => t.id)).toEqual(second.map((t) => t.id));
    expect(first.map((t) => t.id)).toEqual(["zzz-take", "aaa-take"]);
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

    const { results: result } = await takes.search(db);
    expect(result.map((t) => t.id)).toEqual([newer.id, older.id]);
  });

  it("sort: 'rating' ranks by keeperVotes DESC first — a 6-of-7 outranks a 1-of-1 despite its lower ratingScore", async () => {
    const song = await songs.create(db, {
      title: "Rating Sort Song",
      slug: "rating-sort-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    // Older, but recorded FIRST in `takes.create` order to prove this isn't
    // just recency sneaking the answer in — recordedAt is set OPPOSITE of
    // what a recency sort would produce (the 1-of-1 is the newer take).
    const sixOfSeven = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const oneOfOne = await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 2000,
      createdAt: 2000,
      updatedAt: 2000,
    });

    const membersList = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        members.create(db, {
          displayName: `Rating Voter ${i}`,
          slug: `rating-voter-${i}`,
          email: `rating-voter-${i}@example.com`,
          createdAt: 1000,
        }),
      ),
    );
    for (const [i, member] of membersList.entries()) {
      await votes.castVote(db, {
        takeId: sixOfSeven.id,
        memberId: member.id,
        keeper: i < 6,
        now: 1000,
      });
    }
    await votes.castVote(db, {
      takeId: oneOfOne.id,
      memberId: membersList[0]?.id ?? "",
      keeper: true,
      now: 2000,
    });

    const sixRow = await takes.getById(db, sixOfSeven.id);
    const oneRow = await takes.getById(db, oneOfOne.id);
    expect(sixRow?.keeperVotes).toBe(6);
    expect(sixRow?.ratingScore).toBeCloseTo(6 / 7);
    expect(oneRow?.keeperVotes).toBe(1);
    expect(oneRow?.ratingScore).toBe(1);

    // A plain recency (default) sort would put the newer 1-of-1 first —
    // proving the "rating" sort actually changes the order, not just
    // agreeing with recency by coincidence.
    const { results: recent } = await takes.search(db, {}, { sort: "recent" });
    expect(recent.map((t) => t.id)).toEqual([oneOfOne.id, sixOfSeven.id]);

    const { results: rated } = await takes.search(db, {}, { sort: "rating" });
    expect(rated.map((t) => t.id)).toEqual([sixOfSeven.id, oneOfOne.id]);
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

    const { results: bassAndDrums } = await takes.search(db, { instrumentIds: [bassId, drumsId] });
    expect(bassAndDrums.map((t) => t.id)).toEqual([both.id]);
    expect(bassAndDrums.map((t) => t.id)).not.toContain(bassOnly.id);

    const { results: bassOnlyFilter } = await takes.search(db, { instrumentIds: [bassId] });
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

    const { results: inRange } = await takes.search(db, { dateFrom: 1500, dateTo: 2500 });
    expect(inRange.map((t) => t.id)).toEqual([mid.id]);

    const { results: inclusiveEnds } = await takes.search(db, { dateFrom: 1000, dateTo: 3000 });
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

    const { results: result } = await takes.search(db, { minRating: 0.5 });
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

    const { results: result } = await takes.search(db, { states: ["published"] });
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

    const { results: result } = await takes.search(db, { search: "skyline" });
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

    const { results: result } = await takes.search(db, { search: "nickname" });
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

    const { results: result } = await takes.search(db, {
      instrumentIds: [bassId],
      states: ["published"],
    });
    expect(result.map((t) => t.id)).toEqual([matches.id]);
  });

  it("returns an empty array, not an error, when nothing matches", async () => {
    await songs.create(db, {
      title: "Unrelated Song",
      slug: "unrelated-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });

    const { results: result } = await takes.search(db, { search: "no-such-title-exists" });
    expect(result).toEqual([]);
  });

  // F6 (review round 1): no LIMIT and no secondary sort key.
  //
  // Fix round 2, item 1: see `listBySong`'s identical comment above — a
  // `takes.create`-only fixture can't distinguish the real tie-break from
  // SQLite's incidental order. `"zzz-take"` inserted first, `"aaa-take"`
  // second (id lexical order reversed from insertion order). Confirmed by
  // temporarily stripping `desc(takes.id)` from `search`'s query: this test
  // goes red, then passes again once restored.
  it("breaks a tie on recordedAt deterministically (by id, descending) rather than leaving it undefined", async () => {
    const song = await songs.create(db, {
      title: "Tie Break Search Song",
      slug: "tie-break-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const same = 5000;
    await insertTakeWithId(db, "zzz-take", { songId: song.id, eventId, recordedAt: same });
    await insertTakeWithId(db, "aaa-take", { songId: song.id, eventId, recordedAt: same });

    const { results: first } = await takes.search(db, { search: "tie break" });
    const { results: second } = await takes.search(db, { search: "tie break" });
    expect(first.map((t) => t.id)).toEqual(second.map((t) => t.id));
    // Deterministic AND matches the documented tie-break (id, descending).
    expect(first.map((t) => t.id)).toEqual(["zzz-take", "aaa-take"]);
  });

  it("truncates at SEARCH_LIMIT and reports truncated: true when more takes match", async () => {
    const song = await songs.create(db, {
      title: "Truncation Search Song",
      slug: "truncation-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const limit = 3;
    for (let i = 0; i < limit + 2; i++) {
      await takes.create(db, {
        songId: song.id,
        eventId,
        recordedAt: 1000 + i,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
      });
    }

    const { results, truncated } = await takes.search(db, {}, { limit });
    expect(results).toHaveLength(limit);
    expect(truncated).toBe(true);
  });

  it("reports truncated: false when the result count is exactly at the limit", async () => {
    const song = await songs.create(db, {
      title: "Exact Limit Search Song",
      slug: "exact-limit-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const limit = 3;
    for (let i = 0; i < limit; i++) {
      await takes.create(db, {
        songId: song.id,
        eventId,
        recordedAt: 1000 + i,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
      });
    }

    const { results, truncated } = await takes.search(db, {}, { limit });
    expect(results).toHaveLength(limit);
    expect(truncated).toBe(false);
  });
});

// --- M8: manual editing -----------------------------------------------------

describe("takes.update", () => {
  let db: Db;
  let songId: string;
  let otherSongId: string;
  let eventId: string;
  let bassId: string;
  let drumsId: string;
  let guitarId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();
    songId = (
      await songs.create(db, {
        title: "Update A",
        slug: "update-a",
        createdAt: now,
        updatedAt: now,
      })
    ).id;
    otherSongId = (
      await songs.create(db, {
        title: "Update B",
        slug: "update-b",
        createdAt: now,
        updatedAt: now,
      })
    ).id;
    eventId = (
      await events.create(db, { kind: "rehearsal", heldAt: now, createdAt: now, updatedAt: now })
    ).id;
    bassId = (await instruments.create(db, { slug: "bass", label: "Bass" })).id;
    drumsId = (await instruments.create(db, { slug: "drums", label: "Drums" })).id;
    guitarId = (await instruments.create(db, { slug: "guitar", label: "Guitar" })).id;
  });

  async function seed(instrumentIds?: string[]) {
    return takes.create(db, {
      songId,
      eventId,
      label: "first pass",
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      instrumentIds,
    });
  }

  async function instrumentIdsOf(takeId: string): Promise<string[]> {
    const rows = await db
      .select()
      .from(schema.takeInstruments)
      .where(eq(schema.takeInstruments.takeId, takeId));
    return rows.map((r) => r.instrumentId).sort();
  }

  it("writes only the keys it is given", async () => {
    const take = await seed();

    await takes.update(db, take.id, { notes: "muddy", updatedAt: 2000 });

    const after = await takes.getById(db, take.id);
    expect(after?.notes).toBe("muddy");
    expect(after?.label).toBe("first pass");
    expect(after?.recordedAt).toBe(1000);
    expect(after?.updatedAt).toBe(2000);
  });

  it("writes durationMs — the only setter for it", async () => {
    const take = await seed();
    expect(take.durationMs).toBeNull();

    await takes.update(db, take.id, { durationMs: 214_000, updatedAt: 2000 });

    expect((await takes.getById(db, take.id))?.durationMs).toBe(214_000);
  });

  it("moves a take to a different song", async () => {
    const take = await seed();

    await takes.update(db, take.id, { songId: otherSongId, updatedAt: 2000 });

    expect((await takes.getById(db, take.id))?.songId).toBe(otherSongId);
  });

  it("leaves the instrument set alone when instrumentIds is omitted", async () => {
    const take = await seed([bassId, drumsId]);

    await takes.update(db, take.id, { label: "second pass", updatedAt: 2000 });

    expect(await instrumentIdsOf(take.id)).toEqual([bassId, drumsId].sort());
  });

  it("replaces the instrument set when instrumentIds is given", async () => {
    const take = await seed([bassId, drumsId]);

    await takes.update(db, take.id, { updatedAt: 2000 }, [drumsId, guitarId]);

    expect(await instrumentIdsOf(take.id)).toEqual([drumsId, guitarId].sort());
  });

  it("clears the instrument set when instrumentIds is empty", async () => {
    const take = await seed([bassId, drumsId]);

    await takes.update(db, take.id, { updatedAt: 2000 }, []);

    expect(await instrumentIdsOf(take.id)).toEqual([]);
  });

  it("dedupes instrumentIds rather than colliding on the composite PK", async () => {
    const take = await seed();

    await takes.update(db, take.id, { updatedAt: 2000 }, [bassId, bassId, drumsId]);

    expect(await instrumentIdsOf(take.id)).toEqual([bassId, drumsId].sort());
  });

  it("addInstrument is idempotent and leaves the rest of the set alone", async () => {
    const take = await seed([bassId]);

    await takes.addInstrument(db, take.id, drumsId);
    await takes.addInstrument(db, take.id, drumsId);

    expect(await instrumentIdsOf(take.id)).toEqual([bassId, drumsId].sort());
  });
});
