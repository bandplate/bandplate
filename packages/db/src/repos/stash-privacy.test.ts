import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as assetsRepo from "./assets.js";
import * as eventsRepo from "./events.js";
import * as instrumentsRepo from "./instruments.js";
import * as membersRepo from "./members.js";
import * as notificationsRepo from "./notifications.js";
import * as songsRepo from "./songs.js";
import * as takeVisibility from "./take-visibility.js";
import * as takesRepo from "./takes.js";
import * as votesRepo from "./votes.js";

/**
 * A private take is one member's stash recording. Nobody else may learn it
 * exists: not as a row, not as a count, not as a search hit, not as the
 * `lastPlayedAt` of a song, and not through the personal event it sits in.
 *
 * This file calls every exported read of every repo that touches the `takes`
 * table (or `take_instruments`) against a fixture where member B has stashed
 * recordings in the worst places for them to be: under a song the band also
 * plays, under a song only B has, inside a BAND event, with no song at all,
 * and published with a pending push stamp. Member A must see none of it, and
 * B must see it only through the stash's own functions.
 *
 * The guard at the bottom is the reason this file exists: it fails the moment
 * one of these repos gains an exported function that is in neither the table
 * of checks nor the allowlist. A new listing has to be classified before it
 * can ship, which is how a missed filter stops being the kind of bug nobody
 * notices until a stash turns up on someone else's screen.
 */

const HOUR = 60 * 60 * 1000;
const BAND_DAY = Date.UTC(2026, 8, 20, 18, 0, 0);
// B's personal day is held LATER than the band's event, and B's recordings
// are recorded later than the band take: any query that let them in would
// pick them as "newest" or as a song's `lastPlayedAt`, so a leak changes the
// answer instead of hiding in a set.
const STASH_DAY = BAND_DAY + 2 * HOUR;

interface Fixture {
  db: Db;
  memberA: string;
  memberB: string;
  bass: string;
  sharedSong: string;
  stashOnlySong: string;
  bandEvent: string;
  personalEvent: string;
  bandTake: takesRepo.Take;
  stashIds: string[];
  /** B's stash take filed under the shared song — `listStash`'s `songId` case. */
  stashOnShared: string;
}

async function seed(): Promise<Fixture> {
  const db = await createTestDb();
  const now = BAND_DAY;

  const a = await membersRepo.create(db, {
    displayName: "Anna",
    slug: "anna",
    email: "anna@example.com",
    createdAt: now,
  });
  const b = await membersRepo.create(db, {
    displayName: "Bára",
    slug: "bara",
    email: "bara@example.com",
    createdAt: now,
  });
  const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });

  const shared = await songsRepo.create(db, {
    title: "Shared Song",
    slug: "shared-song",
    createdAt: now,
    updatedAt: now,
  });
  const stashOnly = await songsRepo.create(db, {
    title: "Stash Idea",
    slug: "stash-idea",
    createdAt: now,
    updatedAt: now,
  });

  const bandEvent = await eventsRepo.create(db, {
    kind: "rehearsal",
    heldAt: BAND_DAY,
    createdAt: now,
    updatedAt: now,
  });
  const personal = await eventsRepo.findOrCreatePersonal(db, {
    memberId: b.id,
    dayKey: "2026-09-20",
    heldAt: STASH_DAY,
    now,
  });

  const bandTake = await takesRepo.create(db, {
    songId: shared.id,
    eventId: bandEvent.id,
    recordedAt: BAND_DAY,
    instrumentIds: [bass.id],
    createdAt: now,
    updatedAt: now,
  });
  await takesRepo.setStateWithPublishedAt(db, bandTake.id, "published", now, now);

  const stash = (songId: string | null, eventId: string, recordedAt: number) =>
    takesRepo.create(db, {
      visibility: "private",
      ownerMemberId: b.id,
      songId,
      eventId,
      recordedAt,
      instrumentIds: [bass.id],
      createdAt: now,
      updatedAt: now,
    });
  const onShared = await stash(shared.id, personal.id, STASH_DAY);
  const onStashOnly = await stash(stashOnly.id, bandEvent.id, STASH_DAY + 1);
  const songless = await stash(null, personal.id, STASH_DAY + 2);
  // Published, with `push_batched_at` still NULL: the state the push tick and
  // "Na pultu" read. `publishFromStash` would also have flipped visibility, so
  // this is a private take no code path should produce, and exactly the one
  // a query leaning on `state` instead of `visibility` would let through.
  for (const take of [onShared, onStashOnly, songless]) {
    await takesRepo.setStateWithPublishedAt(db, take.id, "published", now + 1, now + 1);
  }

  const bandTakeRow = await takesRepo.getById(db, bandTake.id);
  if (!bandTakeRow) {
    throw new Error("band take vanished");
  }

  return {
    db,
    memberA: a.id,
    memberB: b.id,
    bass: bass.id,
    sharedSong: shared.id,
    stashOnlySong: stashOnly.id,
    bandEvent: bandEvent.id,
    personalEvent: personal.id,
    bandTake: bandTakeRow,
    stashIds: [onShared.id, onStashOnly.id, songless.id],
    stashOnShared: onShared.id,
  };
}

let f: Fixture;

beforeAll(async () => {
  f = await seed();
});

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

/** Only the band take: never a stash id, whichever member is asking. */
function expectBandOnly(rows: { id: string }[]) {
  expect(ids(rows)).toEqual([f.bandTake.id]);
}

type Check = () => Promise<void>;
type ChecksFor<M> = Partial<Record<keyof M, Check>>;
type AllowFor<M> = Partial<Record<keyof M, string>>;

// ---------------------------------------------------------------------------
// the reads, one check per exported function
// ---------------------------------------------------------------------------

const takesChecks: ChecksFor<typeof takesRepo> = {
  listBySong: async () => {
    const shared = await takesRepo.listBySong(f.db, f.sharedSong);
    expectBandOnly(shared.rows);
    expect(shared.total).toBe(1);
    const stashOnly = await takesRepo.listBySong(f.db, f.stashOnlySong);
    expect(stashOnly).toEqual({ rows: [], total: 0 });
  },
  listByEvent: async () => {
    const band = await takesRepo.listByEvent(f.db, f.bandEvent);
    expectBandOnly(band.rows);
    expect(band.total).toBe(1);
    const asc = await takesRepo.listByEvent(f.db, f.bandEvent, { order: "asc" });
    expectBandOnly(asc.rows);
    expect(await takesRepo.listByEvent(f.db, f.personalEvent)).toEqual({ rows: [], total: 0 });
  },
  listByEvents: async () => {
    const byEvent = await takesRepo.listByEvents(f.db, [f.bandEvent, f.personalEvent]);
    expect([...byEvent.keys()]).toEqual([f.bandEvent]);
    expectBandOnly(byEvent.get(f.bandEvent) ?? []);
  },
  listByInstruments: async () => {
    expectBandOnly(await takesRepo.listByInstruments(f.db, [f.bass]));
  },
  listUnvotedByMember: async () => {
    expectBandOnly(await takesRepo.listUnvotedByMember(f.db, f.memberA));
    // Not even the owner is asked to judge a stash recording.
    expectBandOnly(await takesRepo.listUnvotedByMember(f.db, f.memberB));
  },
  search: async () => {
    // `matchesBand: true` cases are built to match the band take (same
    // song/instrument/state/rating floor as the seeded fixture, or no
    // filter at all) — asserting `expectBandOnly` on them is what stops
    // this check from passing on a `search` that silently returns nothing
    // for everyone: without it, a leak-only assertion is satisfied just as
    // well by a broken filter that matches zero rows as by a correct one.
    // `matchesBand: false` cases are built to match NEITHER take (a
    // stash-only song, a date floor only the stash recordings clear) —
    // there the empty result is the whole point, not a gap in coverage.
    const cases: { filters: takesRepo.SearchFilters; matchesBand: boolean }[] = [
      { filters: {}, matchesBand: true },
      { filters: { search: "stash idea" }, matchesBand: false },
      { filters: { search: "shared" }, matchesBand: true },
      { filters: { songId: f.stashOnlySong }, matchesBand: false },
      { filters: { songId: f.sharedSong }, matchesBand: true },
      { filters: { instrumentIds: [f.bass] }, matchesBand: true },
      { filters: { states: ["published"] }, matchesBand: true },
      { filters: { dateFrom: STASH_DAY }, matchesBand: false },
      { filters: { minRating: 0 }, matchesBand: true },
      { filters: { unvotedByMemberId: f.memberA }, matchesBand: true },
      { filters: { unvotedByMemberId: f.memberB }, matchesBand: true },
    ];
    for (const { filters, matchesBand } of cases) {
      for (const sort of ["recent", "rating"] as const) {
        const result = await takesRepo.search(f.db, filters, { sort });
        const leaked = result.rows.filter((row) => f.stashIds.includes(row.id));
        expect(leaked, JSON.stringify(filters)).toEqual([]);
        expect(result.total, JSON.stringify(filters)).toBe(result.rows.length);
        if (matchesBand) {
          expectBandOnly(result.rows);
        } else {
          expect(result.rows, JSON.stringify(filters)).toEqual([]);
        }
      }
    }
  },
  countBySong: async () => {
    expect(await takesRepo.countBySong(f.db, f.sharedSong)).toBe(1);
    expect(await takesRepo.countBySong(f.db, f.stashOnlySong)).toBe(0);
  },
  countByEvent: async () => {
    expect(await takesRepo.countByEvent(f.db, f.bandEvent)).toBe(1);
    expect(await takesRepo.countByEvent(f.db, f.personalEvent)).toBe(0);
  },
  countBySongs: async () => {
    const counts = await takesRepo.countBySongs(f.db, [f.sharedSong, f.stashOnlySong]);
    expect([...counts]).toEqual([[f.sharedSong, 1]]);
  },
  countByEvents: async () => {
    const counts = await takesRepo.countByEvents(f.db, [f.bandEvent, f.personalEvent]);
    expect([...counts]).toEqual([[f.bandEvent, 1]]);
  },
  countUnvotedByMembers: async () => {
    const counts = await takesRepo.countUnvotedByMembers(f.db, [f.memberA, f.memberB]);
    expect(counts.get(f.memberA)).toBe(1);
    expect(counts.get(f.memberB)).toBe(1);
  },
  // The chunk builders behind the batch reads above: the same filter, one
  // chunk at a time, so they get the same check.
  buildListByEventsChunkQuery: async () => {
    const rows = await takesRepo.buildListByEventsChunkQuery(f.db, [f.bandEvent, f.personalEvent]);
    expectBandOnly(rows);
  },
  buildCountBySongsChunkQuery: async () => {
    const rows = await takesRepo.buildCountBySongsChunkQuery(f.db, [f.sharedSong, f.stashOnlySong]);
    expect(rows).toEqual([{ songId: f.sharedSong, value: 1 }]);
  },
  buildCountByEventsChunkQuery: async () => {
    const rows = await takesRepo.buildCountByEventsChunkQuery(f.db, [f.bandEvent, f.personalEvent]);
    expect(rows).toEqual([{ eventId: f.bandEvent, value: 1 }]);
  },
  buildCountUnvotedByMembersChunkQuery: async () => {
    const rows = await takesRepo.buildCountUnvotedByMembersChunkQuery(f.db, [f.memberA]);
    expect(rows).toEqual([{ memberId: f.memberA, value: 1 }]);
  },
  newestEventWithTakesPublishedSince: async () => {
    // The personal day is held later, and holds published private takes.
    expect(await takesRepo.newestEventWithTakesPublishedSince(f.db, 0)).toBe(f.bandEvent);
  },
  listPublishedSinceInEvent: async () => {
    expectBandOnly(await takesRepo.listPublishedSinceInEvent(f.db, f.bandEvent, 0));
    expect(await takesRepo.listPublishedSinceInEvent(f.db, f.personalEvent, 0)).toEqual([]);
  },
  countPublishedSinceInEvent: async () => {
    expect(await takesRepo.countPublishedSinceInEvent(f.db, f.bandEvent, 0)).toBe(1);
    expect(await takesRepo.countPublishedSinceInEvent(f.db, f.personalEvent, 0)).toBe(0);
  },
  countUnvotedPublishedSinceInEvent: async () => {
    for (const member of [f.memberA, f.memberB]) {
      expect(await takesRepo.countUnvotedPublishedSinceInEvent(f.db, member, f.bandEvent, 0)).toBe(
        1,
      );
      expect(
        await takesRepo.countUnvotedPublishedSinceInEvent(f.db, member, f.personalEvent, 0),
      ).toBe(0);
    }
  },
  // The stash's own reads: the owner sees all of it, anyone else none.
  listStash: async () => {
    expect(await takesRepo.listStash(f.db, f.memberA)).toEqual([]);
    expect(ids(await takesRepo.listStash(f.db, f.memberB))).toEqual([...f.stashIds].sort());
    expect(ids(await takesRepo.listStash(f.db, f.memberB, { songId: f.sharedSong }))).toEqual([
      f.stashOnShared,
    ]);
    expect(await takesRepo.listStash(f.db, f.memberA, { songId: f.sharedSong })).toEqual([]);
  },
  countStash: async () => {
    expect(await takesRepo.countStash(f.db, f.memberA)).toBe(0);
    expect(await takesRepo.countStash(f.db, f.memberB)).toBe(3);
    expect(await takesRepo.countStash(f.db, f.memberA, { songId: f.sharedSong })).toBe(0);
    expect(await takesRepo.countStash(f.db, f.memberB, { songId: f.sharedSong })).toBe(1);
  },
  latestStash: async () => {
    expect(await takesRepo.latestStash(f.db, f.memberA)).toBeUndefined();
    const latest = await takesRepo.latestStash(f.db, f.memberB);
    expect(f.stashIds).toContain(latest?.id);
  },
};

const songsChecks: ChecksFor<typeof songsRepo> = {
  listWithStats: async () => {
    for (const sort of ["title", "recent", "takes"] as const) {
      const { rows, total } = await songsRepo.listWithStats(f.db, { sort });
      expect(total).toBe(2);
      const shared = rows.find((row) => row.id === f.sharedSong);
      const stashOnly = rows.find((row) => row.id === f.stashOnlySong);
      expect(shared?.takeCount).toBe(1);
      // B recorded this song later; the band last played it at BAND_DAY.
      expect(shared?.lastPlayedAt).toBe(f.bandTake.recordedAt);
      expect(stashOnly?.takeCount).toBe(0);
      expect(stashOnly?.lastPlayedAt).toBeNull();
    }
    // "Songs with a bass take": the stash-only song has one, but only in B's stash.
    const withBass = await songsRepo.listWithStats(f.db, { instrumentIds: [f.bass] });
    expect(ids(withBass.rows)).toEqual([f.sharedSong]);
    expect(withBass.total).toBe(1);
  },
  count: async () => {
    expect(await songsRepo.count(f.db, { instrumentIds: [f.bass] })).toBe(1);
  },
};

const eventsChecks: ChecksFor<typeof eventsRepo> = {
  listRecent: async () => {
    expect(ids(await eventsRepo.listRecent(f.db))).toEqual([f.bandEvent]);
    expect(ids(await eventsRepo.listRecent(f.db, { includeArchived: true }))).toEqual([
      f.bandEvent,
    ]);
  },
  listRecentWithTakeCounts: async () => {
    const all = await eventsRepo.listRecentWithTakeCounts(f.db);
    expect(all.rows.map((row) => [row.id, row.takeCount])).toEqual([[f.bandEvent, 1]]);
    expect(all.total).toBe(1);
    const personalOnly = await eventsRepo.listRecentWithTakeCounts(f.db, { kind: ["personal"] });
    expect(personalOnly).toEqual({ rows: [], total: 0 });
  },
  count: async () => {
    expect(await eventsRepo.count(f.db)).toBe(1);
    expect(await eventsRepo.count(f.db, { kind: ["personal"] })).toBe(0);
    expect(await eventsRepo.count(f.db, { includeArchived: true })).toBe(1);
  },
  listOnDay: async () => {
    // Callers only ever name a band kind: the event form's enum has no
    // `personal`, and `findSameDayEvents` returns before asking for one.
    const dayStart = Date.UTC(2026, 8, 20);
    for (const kind of ["rehearsal", "concert", "session"] as const) {
      const rows = await eventsRepo.listOnDay(f.db, kind, dayStart, { includeArchived: true });
      expect(rows.map((row) => row.id)).not.toContain(f.personalEvent);
    }
  },
};

const notificationsChecks: ChecksFor<typeof notificationsRepo> = {
  listPendingTakeBatches: async () => {
    const batches = await notificationsRepo.listPendingTakeBatches(f.db);
    // One pending take in the band event — B's private take filed there is not
    // announced — and nothing at all for B's personal day.
    expect(batches.map((batch) => [batch.eventId, batch.count])).toEqual([[f.bandEvent, 1]]);
  },
};

// ---------------------------------------------------------------------------
// the allowlist: exported functions that are not band-facing reads of takes
// ---------------------------------------------------------------------------

const LOOKUP =
  "lookup by id: returns the row it is asked for; the route authorizes it with takesRepo.isVisibleTo";
const WRITE = "write, not a read";

const takesAllowed: AllowFor<typeof takesRepo> = {
  isVisibleTo: "pure predicate: the by-id half of this same rule",
  isVotable: "pure predicate over one take",
  songIdsOf: "pure projection over rows the caller already has",
  hasAllInstruments: "SQL condition builder, exercised through listByInstruments/search/songs",
  create: WRITE,
  update: WRITE,
  addInstrument: WRITE,
  moveAllToEvent: WRITE,
  setStateWithPublishedAt: WRITE,
  setState: WRITE,
  remove: WRITE,
  publishFromStash: "write: the stash's own publish, pinned by takes.test",
  getById: LOOKUP,
  getByIds: LOOKUP,
  buildGetByIdsChunkQuery: LOOKUP,
  buildListInstrumentsForTakesChunkQuery: "lookup by take ids the caller already holds",
  getByClientRef: "ingest idempotency lookup by the bridge's key; stash refs are reserved",
  listInstrumentsForTakes: "lookup by take ids the caller already holds",
  listAllBySong:
    "cascade only (song delete walks every take for storage keys); must include private takes",
};

const songsAllowed: AllowFor<typeof songsRepo> = {
  create: WRITE,
  createWithAlias: WRITE,
  buildCreateStatement: WRITE,
  buildUpdateStatement: WRITE,
  update: WRITE,
  getBySlug: "reads songs only",
  getById: "reads songs only",
  getByIds: "reads songs only",
  buildGetByIdsChunkQuery: "reads songs only",
  findByTitleNorm: "reads songs only",
  findByAlias: "reads songs only",
  list: "reads songs only",
  listAliases: "reads song aliases only",
  listInstrumentNotes: "reads song notes only",
  setInstrumentNote: WRITE,
  addAlias: WRITE,
  remove: WRITE,
  removeWithTakes: WRITE,
  removeAlias: WRITE,
};

const eventsAllowed: AllowFor<typeof eventsRepo> = {
  create: WRITE,
  update: WRITE,
  setClientRef: WRITE,
  findOrCreatePersonal: "the owner's own find-or-create of their personal day",
  personalEventClientRef: "pure key builder",
  getById: "lookup by id; the event page hides a personal day with no band take",
  getByIds: "lookup by the event ids of takes the caller already holds",
  buildGetByIdsChunkQuery: "lookup by the event ids of takes the caller already holds",
  getByClientRef: "ingest idempotency lookup; the personal prefix is refused at the API",
};

const notificationsAllowed: AllowFor<typeof notificationsRepo> = {
  claimTakeBatch: "write (claims the batch); its owner filter is pinned by notifications.test",
  listPendingSongChanges: "reads song chart changes only",
  claimSongNotification: WRITE,
  listSongChangesInWindow: "reads song chart changes only",
  buildRecordChartChange: WRITE,
  claimKey: WRITE,
  prune: WRITE,
};

const assetsAllowed: AllowFor<typeof assetsRepo> = {
  createMany: WRITE,
  listByTake: LOOKUP,
  getById: LOOKUP,
  markReady: WRITE,
  remove: WRITE,
  getBySlot: LOOKUP,
  resetForReupload: WRITE,
  updateAudioMeta: WRITE,
  listPlayableMastersByTakeIds: "lookup by take ids the caller already holds",
  buildListPlayableMastersChunkQuery: "lookup by take ids the caller already holds",
  takeHasLossless: LOOKUP,
  tallyBySong:
    "admin's delete confirm: must count every file a song delete destroys, private ones included",
  tallyByTake: LOOKUP,
  getByIdWithTakeAccess: "returns the visibility facts the audio route hands to isVisibleTo",
};

const instrumentsAllowed: AllowFor<typeof instrumentsRepo> = {
  create: WRITE,
  list: "reads instruments only",
  archive: WRITE,
  update: WRITE,
  getById: "reads instruments only",
  isUnused: "pure predicate",
  usageByInstrument:
    "admin's delete guard: must count every row a delete would orphan, private takes included",
  remove: WRITE,
  listAliases: "reads instrument aliases only",
  listAllAliases: "reads instrument aliases only",
  findBySlug: "reads instruments only",
  addAlias: WRITE,
  removeAlias: WRITE,
  planMerge:
    "admin's merge plan: must count every row a merge moves or loses, private takes included",
  mergeInto: WRITE,
};

const votesAllowed: AllowFor<typeof votesRepo> = {
  buildAggregateUpdate: WRITE,
  castVote: WRITE,
  removeVote: WRITE,
  listByTake: LOOKUP,
  listByMember: "the member's own votes; a private take is never votable (isVotable)",
  countByMember: "the member's own votes",
  votingRecord: "aggregates the member's own votes; a private take is never votable",
  listByMemberForTakes: "lookup by take ids the caller already holds",
  buildListByMemberForTakesChunkQuery: "lookup by take ids the caller already holds",
};

const MODULES = [
  { name: "takes", module: takesRepo, checks: takesChecks, allowed: takesAllowed },
  { name: "songs", module: songsRepo, checks: songsChecks, allowed: songsAllowed },
  { name: "events", module: eventsRepo, checks: eventsChecks, allowed: eventsAllowed },
  {
    name: "notifications",
    module: notificationsRepo,
    checks: notificationsChecks,
    allowed: notificationsAllowed,
  },
  { name: "assets", module: assetsRepo, checks: {}, allowed: assetsAllowed },
  { name: "instruments", module: instrumentsRepo, checks: {}, allowed: instrumentsAllowed },
  { name: "votes", module: votesRepo, checks: {}, allowed: votesAllowed },
] as const;

for (const { name, checks } of MODULES) {
  if (Object.keys(checks).length === 0) {
    continue;
  }
  describe(`stash privacy: ${name}Repo`, () => {
    for (const [fn, check] of Object.entries(checks as Record<string, Check>)) {
      it(`${fn} shows no one else's stash`, check);
    }
  });
}

describe("stash privacy: every exported function is classified", () => {
  it("take-visibility holds the two conditions and nothing else", () => {
    // A third way to see takes is a decision, not a helper: it belongs here,
    // with its reason, rather than next to the query that wanted it.
    expect(Object.keys(takeVisibility).sort()).toEqual(["bandTakeCondition", "stashTakeCondition"]);
  });

  for (const { name, module, checks, allowed } of MODULES) {
    it(`${name}Repo`, () => {
      const exported = Object.entries(module)
        .filter(([, value]) => typeof value === "function")
        .map(([key]) => key)
        .sort();
      const checked = Object.keys(checks);
      const allow = Object.keys(allowed);
      // A function may not be both: an allowlisted read is one nobody checks.
      expect(checked.filter((key) => allow.includes(key))).toEqual([]);
      // Equal, not a subset: a new export fails until it is classified, and a
      // removed one fails until its stale entry goes.
      expect([...checked, ...allow].sort()).toEqual(exported);
    });
  }
});
