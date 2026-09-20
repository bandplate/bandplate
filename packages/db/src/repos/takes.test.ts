import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "../client.js";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as events from "./events.js";
import * as instruments from "./instruments.js";
import * as members from "./members.js";
import { DEFAULT_PAGE_SIZE } from "./pagination.js";
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
    const { rows: result } = await takes.listByEvent(db, eventId);
    expect(result.map((t) => t.recordedAt)).toEqual([3000, 2000, 1000]);
  });

  it("order: 'asc' returns recorded order — the order the session actually happened", async () => {
    const { rows: result } = await takes.listByEvent(db, eventId, { order: "asc" });
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
    const { rows: result } = await takes.listBySong(db, songId);
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

    const { rows: result } = await takes.listBySong(db, songId);
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

    const { rows: first } = await takes.listBySong(db, songId);
    const { rows: second } = await takes.listBySong(db, songId);
    const tied = first.filter((t) => t.recordedAt === same).map((t) => t.id);
    expect(tied).toEqual(second.filter((t) => t.recordedAt === same).map((t) => t.id));
    expect(tied).toEqual(["zzz-take", "aaa-take"]);
  });
});

describe("takes per-parent paging", () => {
  let db: Db;
  let songId: string;
  let eventId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();
    const song = await songs.create(db, {
      title: "Paged Parent Song",
      slug: "paged-parent-song",
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
    // Every take stamped the SAME instant — a rehearsal's renders come off the
    // bridge in one batch, and a fixture makes it certain. This is the shape a
    // missing `id` tie-break turns into a row shown on two pages.
    for (let i = 0; i < 7; i++) {
      await takes.create(db, {
        songId,
        eventId,
        recordedAt: 4242,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
      });
    }
  });

  it("listBySong returns a page plus the song's true take count", async () => {
    const { rows, total } = await takes.listBySong(db, songId, { page: { limit: 3, offset: 0 } });
    expect(rows).toHaveLength(3);
    expect(total).toBe(7);
  });

  it("listBySong walks all seven exactly once despite identical timestamps", async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 9; offset += 3) {
      const { rows } = await takes.listBySong(db, songId, { page: { limit: 3, offset } });
      seen.push(...rows.map((r) => r.id));
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("listByEvent walks all seven exactly once, in either direction", async () => {
    for (const order of ["asc", "desc"] as const) {
      const seen: string[] = [];
      for (let offset = 0; offset < 9; offset += 3) {
        const { rows } = await takes.listByEvent(db, eventId, {
          order,
          page: { limit: 3, offset },
        });
        seen.push(...rows.map((r) => r.id));
      }
      expect(new Set(seen).size).toBe(7);
    }
  });

  it("listByEvent's asc and desc pages are exact reverses of each other", async () => {
    const asc = await takes.listByEvent(db, eventId, {
      order: "asc",
      page: { limit: 7, offset: 0 },
    });
    const desc = await takes.listByEvent(db, eventId, {
      order: "desc",
      page: { limit: 7, offset: 0 },
    });
    // The tie-break follows the primary key's direction — otherwise takes
    // stamped the same second read backwards relative to the rows around them.
    expect(asc.rows.map((r) => r.id)).toEqual([...desc.rows].reverse().map((r) => r.id));
  });

  it("counts without fetching rows", async () => {
    expect(await takes.countBySong(db, songId)).toBe(7);
    expect(await takes.countByEvent(db, eventId)).toBe(7);
    expect((await takes.countBySongs(db, [songId])).get(songId)).toBe(7);
    expect((await takes.countByEvents(db, [eventId])).get(eventId)).toBe(7);
  });

  it("listAllBySong returns every take, unpaged — the cascade's view", async () => {
    expect(await takes.listAllBySong(db, songId)).toHaveLength(7);
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

    const { rows: result } = await takes.search(db);
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
    const { rows: recent } = await takes.search(db, {}, { sort: "recent" });
    expect(recent.map((t) => t.id)).toEqual([oneOfOne.id, sixOfSeven.id]);

    const { rows: rated } = await takes.search(db, {}, { sort: "rating" });
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

    const { rows: bassAndDrums } = await takes.search(db, { instrumentIds: [bassId, drumsId] });
    expect(bassAndDrums.map((t) => t.id)).toEqual([both.id]);
    expect(bassAndDrums.map((t) => t.id)).not.toContain(bassOnly.id);

    const { rows: bassOnlyFilter } = await takes.search(db, { instrumentIds: [bassId] });
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

    const { rows: inRange } = await takes.search(db, { dateFrom: 1500, dateTo: 2500 });
    expect(inRange.map((t) => t.id)).toEqual([mid.id]);

    const { rows: inclusiveEnds } = await takes.search(db, { dateFrom: 1000, dateTo: 3000 });
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

    const { rows: result } = await takes.search(db, { minRating: 0.5 });
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

    const { rows: result } = await takes.search(db, { states: ["published"] });
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

    const { rows: result } = await takes.search(db, { search: "skyline" });
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

    const { rows: result } = await takes.search(db, { search: "nickname" });
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

    const { rows: result } = await takes.search(db, {
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

    const { rows: result } = await takes.search(db, { search: "no-such-title-exists" });
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

    const { rows: first } = await takes.search(db, { search: "tie break" });
    const { rows: second } = await takes.search(db, { search: "tie break" });
    expect(first.map((t) => t.id)).toEqual(second.map((t) => t.id));
    // Deterministic AND matches the documented tie-break (id, descending).
    expect(first.map((t) => t.id)).toEqual(["zzz-take", "aaa-take"]);
  });

  it("returns one page and the TOTAL matching count, not the page's length", async () => {
    const song = await songs.create(db, {
      title: "Truncation Search Song",
      slug: "truncation-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    for (let i = 0; i < 5; i++) {
      await takes.create(db, {
        songId: song.id,
        eventId,
        recordedAt: 1000 + i,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
      });
    }

    const { rows, total } = await takes.search(db, {}, { page: { limit: 3, offset: 0 } });
    expect(rows).toHaveLength(3);
    // The point of the total: it counts every match, so a caller can say "5"
    // rather than the "3+" a truncation flag forced.
    expect(total).toBe(5);
  });

  it("walks every matching take exactly once across pages, with no overlap", async () => {
    const song = await songs.create(db, {
      title: "Paged Search Song",
      slug: "paged-search-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    for (let i = 0; i < 5; i++) {
      await takes.create(db, {
        songId: song.id,
        eventId,
        // The same instant for every take — the case a missing `id` tie-break
        // turns into a row appearing on two pages and another on none.
        recordedAt: 4242,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
      });
    }

    const first = await takes.search(db, { songId: song.id }, { page: { limit: 2, offset: 0 } });
    const second = await takes.search(db, { songId: song.id }, { page: { limit: 2, offset: 2 } });
    const third = await takes.search(db, { songId: song.id }, { page: { limit: 2, offset: 4 } });

    const seen = [...first.rows, ...second.rows, ...third.rows].map((t) => t.id);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(first.total).toBe(5);
  });

  it("returns an empty page, and the true total, past the end", async () => {
    const song = await songs.create(db, {
      title: "Past The End Song",
      slug: "past-the-end-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    await takes.create(db, {
      songId: song.id,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });

    const { rows, total } = await takes.search(
      db,
      { songId: song.id },
      { page: { limit: 25, offset: 100 } },
    );
    expect(rows).toEqual([]);
    expect(total).toBe(1);
  });

  it("defaults to the FIRST page rather than to everything", async () => {
    const song = await songs.create(db, {
      title: "Default Page Song",
      slug: "default-page-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    for (let i = 0; i < DEFAULT_PAGE_SIZE + 4; i++) {
      await takes.create(db, {
        songId: song.id,
        eventId,
        recordedAt: 1000 + i,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
      });
    }

    const { rows, total } = await takes.search(db, { songId: song.id });
    expect(rows).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(total).toBe(DEFAULT_PAGE_SIZE + 4);
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

describe("takes.countUnvotedByMembers", () => {
  let db: Db;
  let songId: string;
  let eventId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();
    const song = await songs.create(db, {
      title: "Unvoted-By-Members Song",
      slug: "unvoted-by-members-song",
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
  });

  async function createMember(slug: string) {
    return members.create(db, {
      displayName: slug,
      slug,
      email: `${slug}@example.com`,
      createdAt: Date.now(),
    });
  }

  it("counts published takes a member has not voted on", async () => {
    const now = Date.now();
    const member = await createMember("cuv-1");
    await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      state: "published",
    });
    await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      state: "published",
    });

    const result = await takes.countUnvotedByMembers(db, [member.id]);
    expect(result.get(member.id)).toBe(2);
  });

  it("ignores non-published takes", async () => {
    const now = Date.now();
    const member = await createMember("cuv-2");
    await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      state: "new",
    });

    const result = await takes.countUnvotedByMembers(db, [member.id]);
    expect(result.has(member.id)).toBe(false);
  });

  it("excludes takes the member has already voted on", async () => {
    const now = Date.now();
    const member = await createMember("cuv-3");
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      state: "published",
    });
    await votes.castVote(db, { takeId: take.id, memberId: member.id, keeper: true, now });

    const result = await takes.countUnvotedByMembers(db, [member.id]);
    expect(result.has(member.id)).toBe(false);
  });

  it("only includes members with a count greater than zero", async () => {
    const now = Date.now();
    const withUnvoted = await createMember("cuv-4a");
    const fullyVoted = await createMember("cuv-4b");
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      state: "published",
    });
    await votes.castVote(db, { takeId: take.id, memberId: fullyVoted.id, keeper: true, now });

    const result = await takes.countUnvotedByMembers(db, [withUnvoted.id, fullyVoted.id]);
    expect(result.get(withUnvoted.id)).toBe(1);
    expect(result.has(fullyVoted.id)).toBe(false);
  });

  it("returns an empty map for an empty member list", async () => {
    const result = await takes.countUnvotedByMembers(db, []);
    expect(result.size).toBe(0);
  });

  it("counts correctly for a member id near the end of a list over 100 ids (D1 chunking)", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await takes.create(db, {
        songId,
        eventId,
        recordedAt: now,
        createdAt: now,
        updatedAt: now,
        state: "published",
      });
    }

    const memberIds: string[] = [];
    for (let i = 0; i < 150; i++) {
      const m = await createMember(`cuv-many-${i}`);
      memberIds.push(m.id);
    }
    // The interesting one is deliberately the LAST id — proves the second
    // chunk (ids 101-150) is queried too, not just the first 100. Every
    // other member id has the same 5 published takes as this one — nobody
    // voted on anything — so they all count too; the point of this fixture
    // is only that the LAST id's count comes back correctly at all.
    const target = await createMember("cuv-many-target");
    memberIds.push(target.id);

    const result = await takes.countUnvotedByMembers(db, memberIds);
    expect(result.get(target.id)).toBe(5);
    expect(result.size).toBe(memberIds.length);
  });

  // Fix round 1, finding 1: the chunk size (90) was picked assuming
  // `inArray(members.id, ids)` was this query's only bound parameter, but
  // `eq(takes.state, "published")` binds one more — a full 100-id chunk
  // would have shipped 101 params, over D1's cap. Asserts the real, built
  // query's parameter count directly via `.toSQL()` rather than trusting
  // the chunk-size comment again.
  it("a full chunk's query stays at or under D1's 100-parameter limit", () => {
    const ids = Array.from({ length: 90 }, (_, i) => `member-${i}`);
    const query = takes.buildCountUnvotedByMembersChunkQuery(db, ids);
    expect(query.toSQL().params.length).toBeLessThanOrEqual(100);
  });
});

describe("take visibility predicates", () => {
  const band = { visibility: "band" as const, ownerMemberId: null };
  const personal = { visibility: "band" as const, ownerMemberId: "m-1" };
  const stashed = { visibility: "private" as const, ownerMemberId: "m-1" };

  it("a band take is visible to every member and to a caller with no member", () => {
    expect(takes.isVisibleTo(band, "m-2")).toBe(true);
    expect(takes.isVisibleTo(band, undefined)).toBe(true);
    expect(takes.isVisibleTo(personal, "m-2")).toBe(true);
  });

  it("a private take is visible to its owner and nobody else", () => {
    expect(takes.isVisibleTo(stashed, "m-1")).toBe(true);
    expect(takes.isVisibleTo(stashed, "m-2")).toBe(false);
    expect(takes.isVisibleTo(stashed, undefined)).toBe(false);
  });

  it("only a band take with no owner is voted on", () => {
    expect(takes.isVotable(band)).toBe(true);
    expect(takes.isVotable(personal)).toBe(false);
    expect(takes.isVotable(stashed)).toBe(false);
  });
});

describe("takes.create visibility", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("files a take as a band take with no owner unless told otherwise", async () => {
    const song = await songs.create(db, { title: "S", slug: "s", createdAt: 1, updatedAt: 1 });
    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const plain = await takes.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(plain.visibility).toBe("band");
    expect(plain.ownerMemberId).toBeNull();
    expect((await takes.getById(db, plain.id))?.visibility).toBe("band");

    const personalEvent = await events.create(db, {
      kind: "personal",
      ownerMemberId: "m-1",
      heldAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(personalEvent.ownerMemberId).toBe("m-1");
    const stashed = await takes.create(db, {
      songId: song.id,
      eventId: personalEvent.id,
      recordedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      visibility: "private",
      ownerMemberId: "m-1",
    });
    const stored = await takes.getById(db, stashed.id);
    expect(stored?.visibility).toBe("private");
    expect(stored?.ownerMemberId).toBe("m-1");
  });
});

describe("private and personal takes stay out of band views", () => {
  let db: Db;
  let songId: string;
  let bandEventId: string;
  let personalEventId: string;
  let ownerId: string;
  let otherId: string;
  let bandTakeId: string;
  let stashedTakeId: string;
  let personalTakeId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const owner = await members.create(db, {
      displayName: "Owner",
      slug: "owner",
      email: "owner@example.com",
      createdAt: 1,
    });
    const other = await members.create(db, {
      displayName: "Other",
      slug: "other",
      email: "other@example.com",
      createdAt: 1,
    });
    ownerId = owner.id;
    otherId = other.id;
    const song = await songs.create(db, {
      title: "Čoudy",
      slug: "coudy",
      createdAt: 1,
      updatedAt: 1,
    });
    songId = song.id;
    const band = await events.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1,
      updatedAt: 1,
    });
    const personal = await events.create(db, {
      kind: "personal",
      ownerMemberId: ownerId,
      heldAt: 2000,
      createdAt: 1,
      updatedAt: 1,
    });
    bandEventId = band.id;
    personalEventId = personal.id;
    bandTakeId = (
      await takes.create(db, {
        songId,
        eventId: bandEventId,
        recordedAt: 1000,
        state: "published",
        createdAt: 1,
        updatedAt: 1,
      })
    ).id;
    stashedTakeId = (
      await takes.create(db, {
        songId,
        eventId: personalEventId,
        recordedAt: 2000,
        visibility: "private",
        ownerMemberId: ownerId,
        createdAt: 1,
        updatedAt: 1,
      })
    ).id;
    // A stash take after "Přidat k písni": band-visible, still owned.
    personalTakeId = (
      await takes.create(db, {
        songId,
        eventId: personalEventId,
        recordedAt: 3000,
        state: "published",
        ownerMemberId: ownerId,
        createdAt: 1,
        updatedAt: 1,
      })
    ).id;
  });

  it("song and event listings, and their counts, skip a private take — for its owner too", async () => {
    const bySong = await takes.listBySong(db, songId);
    expect(bySong.rows.map((t) => t.id).sort()).toEqual([bandTakeId, personalTakeId].sort());
    expect(bySong.total).toBe(2);
    expect(await takes.countBySong(db, songId)).toBe(2);

    const byEvent = await takes.listByEvent(db, personalEventId);
    expect(byEvent.rows.map((t) => t.id)).toEqual([personalTakeId]);
    expect(await takes.countByEvent(db, personalEventId)).toBe(1);

    const grouped = await takes.listByEvents(db, [personalEventId]);
    expect(grouped.get(personalEventId)?.map((t) => t.id)).toEqual([personalTakeId]);
    expect((await takes.countBySongs(db, [songId])).get(songId)).toBe(2);
    expect((await takes.countByEvents(db, [personalEventId])).get(personalEventId)).toBe(1);
  });

  it("the archive search skips a private take, in the rows and in the total", async () => {
    const result = await takes.search(db);
    expect(result.rows.map((t) => t.id)).not.toContain(stashedTakeId);
    expect(result.total).toBe(2);
  });

  it("nobody is asked to vote on a personal recording", async () => {
    const unvoted = await takes.listUnvotedByMember(db, otherId);
    expect(unvoted.map((t) => t.id)).toEqual([bandTakeId]);

    const filtered = await takes.search(db, { unvotedByMemberId: otherId });
    expect(filtered.rows.map((t) => t.id)).toEqual([bandTakeId]);
    expect(filtered.total).toBe(1);

    expect((await takes.countUnvotedByMembers(db, [otherId, ownerId])).get(otherId)).toBe(1);
  });
});

describe("the stash", () => {
  let db: Db;
  let songId: string;
  let otherSongId: string;
  let eventId: string;

  beforeEach(async () => {
    db = await createTestDb();
    songId = (await songs.create(db, { title: "A", slug: "a", createdAt: 1, updatedAt: 1 })).id;
    otherSongId = (await songs.create(db, { title: "B", slug: "b", createdAt: 1, updatedAt: 1 }))
      .id;
    eventId = (
      await events.create(db, {
        kind: "personal",
        ownerMemberId: "m-1",
        heldAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })
    ).id;
  });

  async function stash(memberId: string, song: string | null, recordedAt: number) {
    return takes.create(db, {
      songId: song,
      eventId,
      recordedAt,
      visibility: "private",
      ownerMemberId: memberId,
      createdAt: 1,
      updatedAt: 1,
    });
  }

  it("lists and counts only my private takes, newest first, optionally for one song", async () => {
    const older = await stash("m-1", songId, 100);
    const newer = await stash("m-1", otherSongId, 200);
    await stash("m-2", songId, 300);
    await takes.create(db, {
      songId,
      eventId,
      recordedAt: 400,
      ownerMemberId: "m-1",
      createdAt: 1,
      updatedAt: 1,
    });

    expect((await takes.listStash(db, "m-1")).map((t) => t.id)).toEqual([newer.id, older.id]);
    expect(await takes.countStash(db, "m-1")).toBe(2);
    expect((await takes.listStash(db, "m-1", { songId })).map((t) => t.id)).toEqual([older.id]);
    expect(await takes.countStash(db, "m-1", { songId })).toBe(1);
    expect(await takes.countStash(db, "m-3")).toBe(0);
  });

  it("publishing flips visibility, publishes, and marks the push as already batched", async () => {
    const take = await stash("m-1", songId, 100);
    expect(await takes.publishFromStash(db, take.id, "m-2", 5_000)).toBe("not_found");
    expect(await takes.publishFromStash(db, take.id, "m-1", 5_000)).toBe("ok");

    const published = await takes.getById(db, take.id);
    expect(published?.visibility).toBe("band");
    expect(published?.ownerMemberId).toBe("m-1");
    expect(published?.state).toBe("published");
    expect(published?.publishedAt).toBe(5_000);
    expect(published?.pushBatchedAt).toBe(5_000);
    // Once out of the stash it is not in it any more, and a second press is a no-op.
    expect(await takes.countStash(db, "m-1")).toBe(0);
    expect(await takes.publishFromStash(db, take.id, "m-1", 6_000)).toBe("not_found");
  });

  // --- the invariant: a band-visible take always has a song ------------------

  it("allows a private take with no song and refuses a band one", async () => {
    const songless = await stash("m-1", null, 100);
    expect(songless.songId).toBeNull();
    expect(await takes.countStash(db, "m-1")).toBe(1);

    await expect(
      takes.create(db, {
        // The union says this at compile time; the cast is how a caller that
        // built its input dynamically would get here, which is what the
        // runtime guard is for.
        ...{ songId: null, visibility: "band" as const },
        eventId,
        recordedAt: 100,
        createdAt: 1,
        updatedAt: 1,
      } as unknown as Parameters<typeof takes.create>[1]),
    ).rejects.toThrow(/needs a song/);
  });

  it("refuses to publish a songless take, and files it under the song it is given", async () => {
    const songless = await stash("m-1", null, 100);
    expect(await takes.publishFromStash(db, songless.id, "m-1", 5_000)).toBe("no_song");
    // Still private, still in the stash: a refusal changes nothing.
    expect((await takes.getById(db, songless.id))?.visibility).toBe("private");
    expect(await takes.countStash(db, "m-1")).toBe(1);

    // A song that is not in the library. Foreign keys are off (to match D1),
    // so nothing but this check stands between a band-visible take and a
    // song id that points at nothing.
    expect(await takes.publishFromStash(db, songless.id, "m-1", 5_500, "no-such-song")).toBe(
      "song_not_found",
    );
    expect((await takes.getById(db, songless.id))?.visibility).toBe("private");
    expect((await takes.getById(db, songless.id))?.songId).toBeNull();
    expect(await takes.countStash(db, "m-1")).toBe(1);

    expect(await takes.publishFromStash(db, songless.id, "m-1", 6_000, otherSongId)).toBe("ok");
    const published = await takes.getById(db, songless.id);
    expect(published?.songId).toBe(otherSongId);
    expect(published?.visibility).toBe("band");
    expect(published?.publishedAt).toBe(6_000);

    // A take that already has a song keeps it, even when a song is offered:
    // the offer is for a recording that has none, never a refiling.
    const filed = await stash("m-1", songId, 300);
    expect(await takes.publishFromStash(db, filed.id, "m-1", 7_000, otherSongId)).toBe("ok");
    expect((await takes.getById(db, filed.id))?.songId).toBe(songId);
  });

  it("no band-facing query ever meets a songless take", async () => {
    const songless = await stash("m-1", null, 100);
    const banded = await takes.create(db, {
      songId,
      eventId,
      recordedAt: 200,
      state: "published",
      createdAt: 1,
      updatedAt: 1,
    });

    expect((await takes.listBySong(db, songId)).rows.map((t) => t.id)).toEqual([banded.id]);
    expect((await takes.listAllBySong(db, songId)).map((t) => t.id)).toEqual([banded.id]);
    expect((await takes.listByEvent(db, eventId)).rows.map((t) => t.id)).toEqual([banded.id]);
    expect(await takes.countBySong(db, songId)).toBe(1);
    expect(await takes.countByEvent(db, eventId)).toBe(1);
    expect([...(await takes.countBySongs(db, [songId])).entries()]).toEqual([[songId, 1]]);
    expect((await takes.search(db, {})).rows.map((t) => t.id)).toEqual([banded.id]);
    // And the songless one is exactly where it belongs.
    expect((await takes.listStash(db, "m-1")).map((t) => t.id)).toEqual([songless.id]);
  });
});
