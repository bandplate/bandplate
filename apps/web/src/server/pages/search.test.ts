// `/search` composition logic: query-string parsing (`parseSearchQuery`)
// and the composed search (`searchTakes`) against a real test database.
// `takes.search` itself (every filter combination, AND semantics, date
// bounds) is already proven at the repo level in
// `packages/db/src/repos/takes.test.ts` — this covers the page-specific
// parsing/wiring layer instead of re-deriving that coverage.
import type { Db } from "@bandplate/db";
import {
  eventsRepo,
  favoritesRepo,
  instrumentsRepo,
  membersRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { hasAnyFilter, parseSearchQuery, searchTakes } from "./search.js";

describe("parseSearchQuery", () => {
  it("defaults to no filters for an empty query string", () => {
    const query = parseSearchQuery(new URLSearchParams());
    expect(query).toEqual({
      songId: undefined,
      instrumentIds: [],
      dateFrom: undefined,
      dateTo: undefined,
      sort: "recent",
      unvotedOnly: false,
    });
  });

  it("parses song, repeated instrument/state params, dates, and rating", () => {
    const params = new URLSearchParams(
      "song=song-1&instrument=abc&instrument=def&dateFrom=2026-01-01&dateTo=2026-02-01",
    );
    expect(parseSearchQuery(params)).toEqual({
      songId: "song-1",
      instrumentIds: ["abc", "def"],
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      sort: "recent",
      unvotedOnly: false,
    });
  });

  it("parses sort=rating, defaults anything else to 'recent'", () => {
    expect(parseSearchQuery(new URLSearchParams("sort=rating")).sort).toBe("rating");
    expect(parseSearchQuery(new URLSearchParams("sort=nonsense")).sort).toBe("recent");
    expect(parseSearchQuery(new URLSearchParams()).sort).toBe("recent");
  });

  it("dedupes repeated instrument ids — takes.search's AND filter returns nothing for duplicates", () => {
    const params = new URLSearchParams("instrument=abc&instrument=abc");
    expect(parseSearchQuery(params).instrumentIds).toEqual(["abc"]);
  });

  it("ignores a rating param — the archive has no rating filter", () => {
    // "75% keeper or better" asked a member to think in percentages about a
    // tally of at most seven votes. A stale bookmark must not keep applying it.
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams("rating=75")))).toBe(false);
  });

  it("ignores a state param — the archive has no state filter", () => {
    // Six checkboxes for a lifecycle only ingest and the admin surfaces care
    // about. A stale bookmark must not keep hiding takes by a rule the page
    // shows no control for.
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams("state=published")))).toBe(false);
  });

  it("drops a malformed date string", () => {
    expect(parseSearchQuery(new URLSearchParams("dateFrom=not-a-date")).dateFrom).toBeUndefined();
  });

  it("drops a syntactically-plausible but non-existent calendar date", () => {
    // 2024-02-30 (no such day) — Date.parse would otherwise silently roll
    // this into a different, unrelated date rather than rejecting it.
    expect(parseSearchQuery(new URLSearchParams("dateFrom=2024-02-30")).dateFrom).toBeUndefined();
  });

  it("treats a blank song param as no song filter", () => {
    expect(parseSearchQuery(new URLSearchParams("song=  ")).songId).toBeUndefined();
  });

  it("ignores a free-text q — the song filter is a picker now, not a title match", () => {
    // The old field matched titles and aliases with LIKE. A stale bookmark
    // must not keep applying a filter the page no longer shows a control for.
    expect(parseSearchQuery(new URLSearchParams("q=skyline"))).toEqual({
      songId: undefined,
      instrumentIds: [],
      dateFrom: undefined,
      dateTo: undefined,
      sort: "recent",
      unvotedOnly: false,
    });
  });
});

describe("hasAnyFilter", () => {
  it("is false for an all-empty query", () => {
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams()))).toBe(false);
  });

  it("is true when any single filter is set", () => {
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams("song=s-1")))).toBe(true);
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams("instrument=a")))).toBe(true);
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams("dateFrom=2026-01-01")))).toBe(true);
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams("unvoted=1")))).toBe(true);
  });
});

describe("searchTakes", () => {
  let db: Db;
  let memberId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const member = await membersRepo.create(db, {
      displayName: "Search Test Member",
      slug: "search-test-member",
      email: "search-test-member@example.com",
      createdAt: Date.now(),
    });
    memberId = member.id;
  });

  it("returns an empty array, not a throw, on a fresh database", async () => {
    const { results, truncated } = await searchTakes(
      db,
      parseSearchQuery(new URLSearchParams()),
      memberId,
    );
    expect(results).toEqual([]);
    expect(truncated).toBe(false);
  });

  it("attaches song, event, and instruments to each result", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Search Composition Song",
      slug: "search-composition-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const take = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bass.id],
    });

    const { results } = await searchTakes(db, parseSearchQuery(new URLSearchParams()), memberId);
    expect(results.map((t) => t.id)).toEqual([take.id]);
    expect(results[0]?.song?.slug).toBe("search-composition-song");
    expect(results[0]?.event?.id).toBe(event.id);
    expect(results[0]?.instruments.map((i) => i.slug)).toEqual(["bass"]);
    expect(results[0]?.favorited).toBe(false);
  });

  it("marks a result as favorited when the requesting member has favorited it", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Search Favorited Song",
      slug: "search-favorited-song",
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
      createdAt: now,
      updatedAt: now,
    });
    await favoritesRepo.add(db, {
      memberId,
      targetType: "take",
      targetId: take.id,
      createdAt: now,
    });

    const { results } = await searchTakes(db, parseSearchQuery(new URLSearchParams()), memberId);
    expect(results.find((t) => t.id === take.id)?.favorited).toBe(true);
  });

  it("applies the date-range filter end to end (query string -> ms boundaries -> real results)", async () => {
    const song = await songsRepo.create(db, {
      title: "Date Range Song",
      slug: "date-range-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const inRange = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: Date.parse("2026-01-15T12:00:00.000Z"),
      createdAt: 1000,
      updatedAt: 1000,
    });
    const outOfRange = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: Date.parse("2026-03-01T00:00:00.000Z"),
      createdAt: 1000,
      updatedAt: 1000,
    });

    const query = parseSearchQuery(new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-31"));
    const { results } = await searchTakes(db, query, memberId);

    expect(results.map((t) => t.id)).toContain(inRange.id);
    expect(results.map((t) => t.id)).not.toContain(outOfRange.id);
  });

  it("dateTo is inclusive through the end of that day, not midnight", async () => {
    const song = await songsRepo.create(db, {
      title: "End Of Day Song",
      slug: "end-of-day-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const lateInDay = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: Date.parse("2026-01-31T23:30:00.000Z"),
      createdAt: 1000,
      updatedAt: 1000,
    });

    const query = parseSearchQuery(new URLSearchParams("dateTo=2026-01-31"));
    const { results } = await searchTakes(db, query, memberId);

    expect(results.map((t) => t.id)).toContain(lateInDay.id);
  });
});

describe("the unvoted filter", () => {
  let db: Db;
  let memberId: string;
  let otherMemberId: string;
  let songId: string;
  let eventId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();
    const member = await membersRepo.create(db, {
      displayName: "Unvoted Test",
      slug: "unvoted-test",
      email: "unvoted-test@example.com",
      createdAt: now,
    });
    memberId = member.id;
    const other = await membersRepo.create(db, {
      displayName: "Someone Else",
      slug: "someone-else",
      email: "someone-else@example.com",
      createdAt: now,
    });
    otherMemberId = other.id;
    const song = await songsRepo.create(db, {
      title: "Unvoted Filter Song",
      slug: "unvoted-filter-song",
      createdAt: now,
      updatedAt: now,
    });
    songId = song.id;
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    eventId = event.id;
  });

  async function publishedTake(offset: number) {
    const now = Date.now();
    return takesRepo.create(db, {
      songId,
      eventId,
      recordedAt: now + offset,
      state: "published",
      createdAt: now,
      updatedAt: now,
    });
  }

  it("returns only takes THIS member has not voted on", async () => {
    const voted = await publishedTake(0);
    const unvoted = await publishedTake(1);
    await votesRepo.castVote(db, {
      takeId: voted.id,
      memberId,
      keeper: true,
      comment: null,
      now: Date.now(),
    });

    const query = parseSearchQuery(new URLSearchParams("unvoted=1"));
    const { results } = await searchTakes(db, query, memberId);
    expect(results.map((r) => r.id)).toEqual([unvoted.id]);
  });

  it("ignores other members' votes — it is MY ear that hasn't heard it", async () => {
    const take = await publishedTake(0);
    await votesRepo.castVote(db, {
      takeId: take.id,
      memberId: otherMemberId,
      keeper: true,
      comment: null,
      now: Date.now(),
    });

    const query = parseSearchQuery(new URLSearchParams("unvoted=1"));
    const { results } = await searchTakes(db, query, memberId);
    expect(results.map((r) => r.id)).toEqual([take.id]);
  });

  it("excludes takes that are not published — nobody is being asked to judge an upload in flight", async () => {
    const now = Date.now();
    await takesRepo.create(db, {
      songId,
      eventId,
      recordedAt: now,
      state: "uploading",
      createdAt: now,
      updatedAt: now,
    });

    const query = parseSearchQuery(new URLSearchParams("unvoted=1"));
    const { results } = await searchTakes(db, query, memberId);
    expect(results).toEqual([]);
  });

  it("composes with the other filters rather than replacing them", async () => {
    // The reason this is a filter and not a page: "what haven't I judged from
    // this event / with these horns" is one query. A date range that excludes
    // the unvoted take must still exclude it.
    const take = await publishedTake(0);
    const query = parseSearchQuery(
      new URLSearchParams(`unvoted=1&dateFrom=1990-01-01&dateTo=1990-12-31`),
    );
    const { results } = await searchTakes(db, query, memberId);
    expect(results).toEqual([]);

    const wide = parseSearchQuery(new URLSearchParams("unvoted=1&dateFrom=1990-01-01"));
    expect((await searchTakes(db, wide, memberId)).results.map((r) => r.id)).toEqual([take.id]);
  });

  it("is off unless asked for, and counts as a filter when it is on", async () => {
    expect(parseSearchQuery(new URLSearchParams()).unvotedOnly).toBe(false);
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams()))).toBe(false);
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams("unvoted=1")))).toBe(true);
  });
});
