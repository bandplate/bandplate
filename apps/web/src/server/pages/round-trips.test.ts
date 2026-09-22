// What home, `/me` and `/takes` cost in database ROUND TRIPS.
//
// On Workers every D1 call is a network hop, and production showed home at
// 150–350 ms of wall time on 20–50 ms of CPU: the page was waiting on hops,
// not working. Home made 25 of them, eight deep, on the seeded band below; it
// now makes three batches plus the visit write that runs beside the second.
// These tests pin the new numbers, so a change that slips in one more
// sequential read fails here rather than in a production tail.
//
// Before → after, on `seedBusyBand` (round trips / longest chain of waits):
//
//   home                 25 / 8  →  4 / 3   (3 read batches + the visit write)
//   /me                  12 / 4  →  2 / 2   (+1 more before when push is on)
//   /me, re-asked        18 / 6  →  3 / 3
//   /takes               12 / 2  →  2 / 2
//   /takes, re-asked     15 / 3  →  3 / 3
//   /takes?stash=1       10 / 3  →  2 / 2
//
// "Re-asked" is a URL whose first guess at the window was wrong, so
// `loadList` runs the listing's query a second time.
import { membersRepo } from "@bandplate/db";
import { describe, expect, it } from "vitest";
import { loadList } from "../pagination.js";
import { seedBusyBand } from "../testing/busy-band.js";
import { countRoundTrips, type RoundTrips } from "../testing/round-trips.js";
import { getHomeData } from "./home.js";
import { getMeData, VOTES_PER_PAGE } from "./me.js";
import { getTakesPageData, parseSearchQuery } from "./search.js";

/** Every statement also stays inside D1's 100 bound parameters. */
function expectWithin(roundTrips: RoundTrips, limit: { total: number; depth: number }) {
  const shape = roundTrips.trips.map((t) => `${t.kind}:${t.statements}@${t.level}`).join(" ");
  expect(roundTrips.total, shape).toBeLessThanOrEqual(limit.total);
  expect(roundTrips.depth, shape).toBeLessThanOrEqual(limit.depth);
  expect(roundTrips.maxParams).toBeLessThanOrEqual(100);
}

function takesPage(href: string) {
  const url = new URL(href, "http://band.test");
  return {
    url,
    query: parseSearchQuery(url.searchParams),
    viewingStash: url.searchParams.get("stash") === "1",
  };
}

describe("home", () => {
  it("reads in three batches, with the visit write beside the second", async () => {
    const band = await seedBusyBand();
    const { result, roundTrips } = await countRoundTrips(band.db, () =>
      getHomeData(band.db, band.memberId, band.now),
    );
    expectWithin(roundTrips, { total: 4, depth: 3 });
    expect(roundTrips.trips.filter((t) => t.kind === "batch")).toHaveLength(3);

    // The seed reaches every section, so a cheap page is not an empty one.
    expect(result.onTheStand?.takes).toHaveLength(4);
    expect(result.onTheStand?.unvotedCount).toBe(2);
    expect(result.pinned.map((p) => p.kind)).toEqual([
      "song",
      "take",
      "event",
      "take",
      "event",
      "take",
      "song",
    ]);
    expect(result.recentEvents.length).toBeGreaterThan(0);
    expect(result.stash?.count).toBe(2);

    // And the write still landed: the next load measures from this one.
    const member = await membersRepo.getById(band.db, band.memberId);
    expect(member?.homeLastSeenAt).toBe(band.now);
  });

  it("costs no more for a member with nothing pinned, new or stashed", async () => {
    const band = await seedBusyBand();
    const newcomer = await membersRepo.create(band.db, {
      displayName: "Nový",
      slug: "novy",
      email: "novy@example.com",
      createdAt: band.now,
    });
    const { result, roundTrips } = await countRoundTrips(band.db, () =>
      getHomeData(band.db, newcomer.id, band.now),
    );
    expectWithin(roundTrips, { total: 4, depth: 3 });
    expect(result.pinned).toEqual([]);
    expect(result.stash).toBeUndefined();
  });
});

describe("/me", () => {
  const load = (band: Awaited<ReturnType<typeof seedBusyBand>>, href: string) =>
    loadList(
      new URL(href, "http://band.test"),
      VOTES_PER_PAGE,
      (page) => getMeData(band.db, band.memberId, page, { withNotificationPrefs: true }),
      (found) => found?.voteTotal ?? 0,
    );

  it("reads in two batches, the push toggles included", async () => {
    const band = await seedBusyBand();
    const { result, roundTrips } = await countRoundTrips(band.db, () => load(band, "/me"));
    expectWithin(roundTrips, { total: 2, depth: 2 });
    expect(result.result?.votes).toHaveLength(12);
    expect(result.result?.votes.every((v) => v.take !== undefined)).toBe(true);
    expect(result.result?.notificationPrefs).toBeDefined();
  });

  it("stays within four when the list has to be asked for again", async () => {
    const band = await seedBusyBand();
    const { roundTrips } = await countRoundTrips(band.db, () => load(band, "/me?page=2"));
    expectWithin(roundTrips, { total: 4, depth: 4 });
  });
});

describe("/takes", () => {
  it("reads in two batches", async () => {
    const band = await seedBusyBand();
    const { result, roundTrips } = await countRoundTrips(band.db, () =>
      getTakesPageData(band.db, { ...takesPage("/takes"), memberId: band.memberId, now: band.now }),
    );
    expectWithin(roundTrips, { total: 2, depth: 2 });
    expect(result.search.total).toBe(17);
    expect(result.instruments).toHaveLength(3);
    expect(result.stashCount).toBe(2);
  });

  it("stays within four when the list has to be asked for again", async () => {
    const band = await seedBusyBand();
    const { result, roundTrips } = await countRoundTrips(band.db, () =>
      getTakesPageData(band.db, {
        ...takesPage("/takes?page=2&sort=rating"),
        memberId: band.memberId,
        now: band.now,
      }),
    );
    expectWithin(roundTrips, { total: 4, depth: 4 });
    expect(result.search.results).toHaveLength(17);
  });

  it("reads the stash view in two batches", async () => {
    const band = await seedBusyBand();
    const { result, roundTrips } = await countRoundTrips(band.db, () =>
      getTakesPageData(band.db, {
        ...takesPage("/takes?stash=1"),
        memberId: band.memberId,
        now: band.now,
      }),
    );
    expectWithin(roundTrips, { total: 2, depth: 2 });
    expect(result.stash.rows).toHaveLength(2);
    // One recording has no song yet, so the view offers songs to file it under.
    expect(result.stash.songChoices.length).toBeGreaterThan(0);
  });

  it("keeps a fully grown page to two batches, chunks and all", async () => {
    // 147 takes on one page: every lookup keyed by take ids splits into two
    // statements, and both go out in the same batch.
    const band = await seedBusyBand({ extraTakes: 130 });
    const { result, roundTrips } = await countRoundTrips(band.db, () =>
      getTakesPageData(band.db, {
        ...takesPage("/takes?shown=200"),
        memberId: band.memberId,
        now: band.now,
      }),
    );
    expectWithin(roundTrips, { total: 2, depth: 2 });
    expect(result.search.results).toHaveLength(147);
    // 130 extra takes and half of the band's 16 have a player; the personal one does not.
    expect(result.search.results.filter((take) => take.playableAssetId)).toHaveLength(138);
    expect(result.search.results.filter((take) => take.instruments.length > 0)).toHaveLength(147);
  });
});
