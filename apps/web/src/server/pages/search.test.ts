// `/search` composition logic: query-string parsing (`parseSearchQuery`)
// and the composed search (`searchTakes`) against a real test database.
// `takes.search` itself (every filter combination, AND semantics, date
// bounds) is already proven at the repo level in
// `packages/db/src/repos/takes.test.ts` — this covers the page-specific
// parsing/wiring layer instead of re-deriving that coverage.
import type { Db } from "@bandlib/db";
import { eventsRepo, instrumentsRepo, songsRepo, takesRepo } from "@bandlib/db";
import { createTestDb } from "@bandlib/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { hasAnyFilter, parseSearchQuery, searchTakes } from "./search.js";

describe("parseSearchQuery", () => {
  it("defaults to no filters for an empty query string", () => {
    const query = parseSearchQuery(new URLSearchParams());
    expect(query).toEqual({
      search: undefined,
      instrumentIds: [],
      dateFrom: undefined,
      dateTo: undefined,
      rating: undefined,
      states: [],
    });
  });

  it("parses q, repeated instrument/state params, dates, and rating", () => {
    const params = new URLSearchParams(
      "q=skyline&instrument=abc&instrument=def&dateFrom=2026-01-01&dateTo=2026-02-01&rating=75&state=published&state=keeper",
    );
    expect(parseSearchQuery(params)).toEqual({
      search: "skyline",
      instrumentIds: ["abc", "def"],
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      rating: "75",
      states: ["published", "keeper"],
    });
  });

  it("dedupes repeated instrument ids — takes.search's AND filter returns nothing for duplicates", () => {
    const params = new URLSearchParams("instrument=abc&instrument=abc");
    expect(parseSearchQuery(params).instrumentIds).toEqual(["abc"]);
  });

  it("drops an invalid rating value rather than passing it through", () => {
    expect(parseSearchQuery(new URLSearchParams("rating=nonsense")).rating).toBeUndefined();
  });

  it("drops an invalid state value rather than passing it through", () => {
    const query = parseSearchQuery(new URLSearchParams("state=nonsense&state=published"));
    expect(query.states).toEqual(["published"]);
  });

  it("drops a malformed date string", () => {
    expect(parseSearchQuery(new URLSearchParams("dateFrom=not-a-date")).dateFrom).toBeUndefined();
  });

  it("drops a syntactically-plausible but non-existent calendar date", () => {
    // 2024-02-30 (no such day) — Date.parse would otherwise silently roll
    // this into a different, unrelated date rather than rejecting it.
    expect(parseSearchQuery(new URLSearchParams("dateFrom=2024-02-30")).dateFrom).toBeUndefined();
  });

  it("treats a blank q as no search", () => {
    expect(parseSearchQuery(new URLSearchParams("q=  ")).search).toBeUndefined();
  });
});

describe("hasAnyFilter", () => {
  it("is false for an all-empty query", () => {
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams()))).toBe(false);
  });

  it("is true when any single filter is set", () => {
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams("q=x")))).toBe(true);
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams("instrument=a")))).toBe(true);
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams("dateFrom=2026-01-01")))).toBe(true);
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams("rating=50")))).toBe(true);
    expect(hasAnyFilter(parseSearchQuery(new URLSearchParams("state=new")))).toBe(true);
  });
});

describe("searchTakes", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("returns an empty array, not a throw, on a fresh database", async () => {
    const result = await searchTakes(db, parseSearchQuery(new URLSearchParams()));
    expect(result).toEqual([]);
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

    const result = await searchTakes(db, parseSearchQuery(new URLSearchParams()));
    expect(result.map((t) => t.id)).toEqual([take.id]);
    expect(result[0]?.song?.slug).toBe("search-composition-song");
    expect(result[0]?.event?.id).toBe(event.id);
    expect(result[0]?.instruments.map((i) => i.slug)).toEqual(["bass"]);
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
    const result = await searchTakes(db, query);

    expect(result.map((t) => t.id)).toContain(inRange.id);
    expect(result.map((t) => t.id)).not.toContain(outOfRange.id);
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
    const result = await searchTakes(db, query);

    expect(result.map((t) => t.id)).toContain(lateInDay.id);
  });
});
