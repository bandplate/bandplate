// `/` composition logic — the three home sections (what is new, the pinned
// list with the stash, and the event ledger), exercised against a real test
// database (not over HTTP —
// `home-search-me-takes.route.test.ts` covers the actual route). Same split
// as `songs.test.ts`/`events.test.ts`.
//
// The old "needs your vote" third section is gone from home (its count lives
// on `/me` now), and recent events no longer carry their takes, so the tests
// that covered both went with them.
import type { Db } from "@bandplate/db";
import {
  assetsRepo,
  eventsRepo,
  favoritesRepo,
  membersRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { getHomeData } from "./home.js";

describe("getHomeData", () => {
  let db: Db;
  let memberId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const member = await membersRepo.create(db, {
      displayName: "Home Test Member",
      slug: "home-test-member",
      email: "home-test-member@example.com",
      createdAt: Date.now(),
    });
    memberId = member.id;
  });

  it("returns nothing pinned and no events on a fresh database", async () => {
    const data = await getHomeData(db, memberId);
    expect(data.pinned).toEqual([]);
    expect(data.recentEvents).toEqual([]);
  });

  it("merges all three kinds of favorite into ONE newest-pinned-first list", async () => {
    // The whole point of the merge: a member's pins are a working set, not
    // three taxonomies. Pinned in a deliberate order — song, then event, then
    // take — so "newest first" has to invert it rather than happening to
    // match whatever order the per-kind lookups return in.
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Pinned Song",
      slug: "pinned-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "concert",
      heldAt: now,
      venue: "Pinned Venue",
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
      targetType: "song",
      targetId: song.id,
      createdAt: now,
    });
    await favoritesRepo.add(db, {
      memberId,
      targetType: "event",
      targetId: event.id,
      createdAt: now + 1,
    });
    await favoritesRepo.add(db, {
      memberId,
      targetType: "take",
      targetId: take.id,
      createdAt: now + 2,
    });

    const data = await getHomeData(db, memberId);
    expect(data.pinned.map((p) => p.kind)).toEqual(["take", "event", "song"]);
    expect(data.pinned.map((p) => p.id)).toEqual([take.id, event.id, song.id]);
  });

  it("a pinned take carries the song and event it needs to name itself", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Neon Skyline",
      slug: "neon-skyline",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "concert",
      heldAt: now,
      venue: "The Attic",
      title: "Live at The Attic",
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

    const [pinned] = (await getHomeData(db, memberId)).pinned;
    expect(pinned?.kind).toBe("take");
    if (pinned?.kind !== "take") {
      throw new Error("expected a pinned take");
    }
    // A take has no name of its own — the plate borrows its song's, and the
    // caption names the event. Both have to be here or the plate is blank.
    expect(pinned.song?.title).toBe("Neon Skyline");
    expect(pinned.event?.title).toBe("Live at The Attic");
  });

  it("a pinned take gets playableAssetId only when a ready master exists", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Playable",
      slug: "playable",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const withAsset = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const withoutAsset = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await assetsRepo.createMany(db, [
      {
        takeId: withAsset.id,
        kind: "master",
        tier: "lossy",
        format: "opus",
        storageKey: `takes/${withAsset.id}/master/lossy.opus`,
        contentType: "audio/opus",
        bytes: 1000,
        status: "ready",
        createdAt: now,
        readyAt: now,
      },
    ]);
    await favoritesRepo.add(db, {
      memberId,
      targetType: "take",
      targetId: withAsset.id,
      createdAt: now,
    });
    await favoritesRepo.add(db, {
      memberId,
      targetType: "take",
      targetId: withoutAsset.id,
      createdAt: now + 1,
    });

    const byId = new Map(
      (await getHomeData(db, memberId)).pinned.map((p) => [
        p.id,
        p.kind === "take" ? p.playableAssetId : undefined,
      ]),
    );
    expect(byId.get(withAsset.id)).toBeDefined();
    // Not "disabled" — undefined, which is what makes the plate render no play
    // affordance at all rather than a dead one.
    expect(byId.get(withoutAsset.id)).toBeUndefined();
  });

  it("counts takes for a pinned song and a pinned event — that count is the plate's caption", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Counted",
      slug: "counted",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    for (let i = 0; i < 3; i++) {
      await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: now + i,
        createdAt: now,
        updatedAt: now,
      });
    }
    await favoritesRepo.add(db, {
      memberId,
      targetType: "song",
      targetId: song.id,
      createdAt: now,
    });
    await favoritesRepo.add(db, {
      memberId,
      targetType: "event",
      targetId: event.id,
      createdAt: now + 1,
    });

    const pinned = (await getHomeData(db, memberId)).pinned;
    const songEntry = pinned.find((p) => p.kind === "song");
    const eventEntry = pinned.find((p) => p.kind === "event");
    expect(songEntry?.kind === "song" && songEntry.takeCount).toBe(3);
    expect(eventEntry?.kind === "event" && eventEntry.takeCount).toBe(3);
  });

  it("drops a pinned row whose target no longer exists rather than rendering a blank plate", async () => {
    // `favorites` has no foreign key to its polymorphic target, so a pin can
    // outlive what it points at. The page must skip it, not crash and not draw
    // a plate with no name on it.
    await favoritesRepo.add(db, {
      memberId,
      targetType: "take",
      targetId: "01a00000-0000-7000-8000-000000000000",
      createdAt: Date.now(),
    });
    expect((await getHomeData(db, memberId)).pinned).toEqual([]);
  });

  it("lists recent events newest-first with their take counts, and no takes attached", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Ledger Song",
      slug: "ledger-song",
      createdAt: now,
      updatedAt: now,
    });
    const older = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now - 86_400_000,
      createdAt: now,
      updatedAt: now,
    });
    const newer = await eventsRepo.create(db, {
      kind: "concert",
      heldAt: now,
      venue: "Newer Venue",
      createdAt: now,
      updatedAt: now,
    });
    await takesRepo.create(db, {
      songId: song.id,
      eventId: newer.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const { recentEvents } = await getHomeData(db, memberId);
    expect(recentEvents.map((e) => e.id)).toEqual([newer.id, older.id]);
    expect(recentEvents[0]?.takeCount).toBe(1);
    // The ledger says an event happened and how much is in it; opening the
    // event is how you reach the takes. Fetching them here cost four queries
    // per page load for a list nobody was reading.
    expect(recentEvents[0]).not.toHaveProperty("takes");
  });

  it("an event with zero takes still appears — a real empty rehearsal, not an omission", async () => {
    const now = Date.now();
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const { recentEvents } = await getHomeData(db, memberId);
    expect(recentEvents.map((e) => e.id)).toEqual([event.id]);
    expect(recentEvents[0]?.takeCount).toBe(0);
  });

  describe("the stash card", () => {
    async function stashTake(ownerId: string, recordedAt: number, label: string | null = null) {
      const event = await eventsRepo.findOrCreatePersonal(db, {
        memberId: ownerId,
        dayKey: `2026-09-${String(10 + (recordedAt % 10)).padStart(2, "0")}`,
        heldAt: recordedAt,
        now: recordedAt,
      });
      return takesRepo.create(db, {
        eventId: event.id,
        recordedAt,
        durationMs: 47_000,
        label,
        visibility: "private",
        ownerMemberId: ownerId,
        createdAt: recordedAt,
        updatedAt: recordedAt,
      });
    }

    it("is absent while the stash is empty", async () => {
      expect((await getHomeData(db, memberId)).stash).toBeUndefined();
    });

    it("counts this member's recordings and names the latest", async () => {
      await stashTake(memberId, 1, "První");
      const latest = await stashTake(memberId, 2, "Nápad do mezihry");
      const data = await getHomeData(db, memberId);
      expect(data.stash?.count).toBe(2);
      expect(data.stash?.latest.id).toBe(latest.id);
      // The personal day it sits in is not a recent event either.
      expect(data.recentEvents).toEqual([]);
    });

    it("never counts or shows another member's stash", async () => {
      const other = await membersRepo.create(db, {
        displayName: "Filip",
        slug: "filip-stash",
        email: "filip-stash@example.com",
        createdAt: 1,
      });
      await stashTake(other.id, 5, "Filipův nápad");
      expect((await getHomeData(db, memberId)).stash).toBeUndefined();

      const mine = await stashTake(memberId, 3, "Můj");
      const data = await getHomeData(db, memberId);
      expect(data.stash?.count).toBe(1);
      // Filip's is newer, and still not the one named.
      expect(data.stash?.latest.id).toBe(mine.id);
    });
  });

  describe("Na pultu: new since your last visit", () => {
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const NOW = Date.UTC(2026, 8, 21, 18, 0, 0);

    let songId: string;

    beforeEach(async () => {
      // A member who joined long ago, so the first visit's floor is the
      // 14-day window rather than their joining.
      const member = await membersRepo.create(db, {
        displayName: "Stand Member",
        slug: "stand-member",
        email: "stand-member@example.com",
        createdAt: NOW - 400 * DAY,
      });
      memberId = member.id;
      const song = await songsRepo.create(db, {
        title: "Neon Skyline",
        slug: "neon-skyline-stand",
        createdAt: NOW - 400 * DAY,
        updatedAt: NOW - 400 * DAY,
      });
      songId = song.id;
    });

    async function bandEvent(
      heldAt: number,
      extra: { title?: string; kind?: "rehearsal" | "concert" } = {},
    ) {
      return eventsRepo.create(db, {
        kind: extra.kind ?? "rehearsal",
        heldAt,
        title: extra.title,
        createdAt: heldAt,
        updatedAt: heldAt,
      });
    }

    async function publishedTake(
      eventId: string,
      publishedAt: number,
      extra: { ownerMemberId?: string } = {},
    ) {
      const take = await takesRepo.create(db, {
        songId,
        eventId,
        recordedAt: publishedAt - HOUR,
        createdAt: publishedAt - HOUR,
        updatedAt: publishedAt - HOUR,
        ownerMemberId: extra.ownerMemberId ?? null,
      });
      await takesRepo.setStateWithPublishedAt(db, take.id, "published", publishedAt, publishedAt);
      return take;
    }

    it("is absent when nothing was published since the last visit", async () => {
      const event = await bandEvent(NOW - 30 * DAY);
      await publishedTake(event.id, NOW - 20 * DAY);
      expect((await getHomeData(db, memberId, NOW)).onTheStand).toBeUndefined();
    });

    it("leads with the newest band event, counting its new takes and the unvoted among them", async () => {
      const older = await bandEvent(NOW - 5 * DAY);
      await publishedTake(older.id, NOW - 4 * DAY);
      const newest = await bandEvent(NOW - 2 * DAY, { title: "Zkouška na Attic" });
      const a = await publishedTake(newest.id, NOW - DAY);
      await publishedTake(newest.id, NOW - DAY + 1);
      await publishedTake(newest.id, NOW - DAY + 2);
      await votesRepo.castVote(db, { takeId: a.id, memberId, keeper: true, now: NOW - HOUR });

      const { onTheStand } = await getHomeData(db, memberId, NOW);
      expect(onTheStand?.event.id).toBe(newest.id);
      expect(onTheStand?.takes).toHaveLength(3);
      expect(onTheStand?.unvotedCount).toBe(2);
    });

    it("stays up for the whole visit, and goes once the next visit starts", async () => {
      const event = await bandEvent(NOW - 2 * DAY);
      await publishedTake(event.id, NOW - DAY);

      expect((await getHomeData(db, memberId, NOW)).onTheStand?.event.id).toBe(event.id);
      // A reload twenty minutes later is the same visit: still new.
      expect((await getHomeData(db, memberId, NOW + 20 * 60 * 1000)).onTheStand?.event.id).toBe(
        event.id,
      );
      // An hour later a new visit starts, measured from the first one's start,
      // and the take was published before that.
      expect((await getHomeData(db, memberId, NOW + HOUR)).onTheStand).toBeUndefined();
    });

    it("shows what was published between two visits", async () => {
      await getHomeData(db, memberId, NOW);
      const event = await bandEvent(NOW + 2 * HOUR);
      await publishedTake(event.id, NOW + 3 * HOUR);
      expect((await getHomeData(db, memberId, NOW + 5 * HOUR)).onTheStand?.event.id).toBe(event.id);
    });

    it("never leads with a personal day, even one newer than every band event", async () => {
      const band = await bandEvent(NOW - 3 * DAY);
      await publishedTake(band.id, NOW - 2 * DAY);
      const filip = await membersRepo.create(db, {
        displayName: "Filip",
        slug: "filip-stand",
        email: "filip-stand@example.com",
        createdAt: 1,
      });
      const personal = await eventsRepo.findOrCreatePersonal(db, {
        memberId: filip.id,
        dayKey: "2026-09-21",
        heldAt: NOW - HOUR,
        now: NOW - HOUR,
      });
      // Added to its song, so it is band-visible and published.
      await publishedTake(personal.id, NOW - 30 * 60 * 1000, { ownerMemberId: filip.id });

      const { onTheStand } = await getHomeData(db, memberId, NOW);
      expect(onTheStand?.event.id).toBe(band.id);
    });

    it("ignores private takes, and does not ask for a vote on a personal recording", async () => {
      const event = await bandEvent(NOW - 2 * DAY);
      await publishedTake(event.id, NOW - DAY);
      // A personal recording published into a band event: counted as new,
      // never votable.
      const filip = await membersRepo.create(db, {
        displayName: "Filip",
        slug: "filip-votable",
        email: "filip-votable@example.com",
        createdAt: 1,
      });
      await publishedTake(event.id, NOW - DAY + 1, { ownerMemberId: filip.id });
      // A stash take in the same event: invisible, and not counted.
      const hidden = await takesRepo.create(db, {
        eventId: event.id,
        recordedAt: NOW - DAY,
        visibility: "private",
        ownerMemberId: filip.id,
        createdAt: NOW - DAY,
        updatedAt: NOW - DAY,
      });
      await takesRepo.setStateWithPublishedAt(db, hidden.id, "published", NOW - DAY + 2, NOW);

      const { onTheStand } = await getHomeData(db, memberId, NOW);
      expect(onTheStand?.takes).toHaveLength(2);
      expect(onTheStand?.unvotedCount).toBe(1);
    });
  });

  describe("a personal recording names whose it is", () => {
    async function personalDay() {
      const now = Date.now();
      const filip = await membersRepo.create(db, {
        displayName: "Filip",
        slug: "filip",
        email: "filip@example.com",
        createdAt: now,
      });
      const song = await songsRepo.create(db, {
        title: "Čoudy",
        slug: "coudy",
        createdAt: now,
        updatedAt: now,
      });
      const event = await eventsRepo.findOrCreatePersonal(db, {
        memberId: filip.id,
        dayKey: "2026-09-19",
        heldAt: now,
        now,
      });
      // Added to its song, so the band can see the day at all.
      const take = await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: now,
        createdAt: now,
        updatedAt: now,
        ownerMemberId: filip.id,
        visibility: "band",
      });
      return { now, event, take };
    }

    it("on a pinned take and a pinned personal event", async () => {
      const { now, event, take } = await personalDay();
      await favoritesRepo.add(db, {
        memberId,
        targetType: "take",
        targetId: take.id,
        createdAt: now,
      });
      await favoritesRepo.add(db, {
        memberId,
        targetType: "event",
        targetId: event.id,
        createdAt: now + 1,
      });

      const { pinned } = await getHomeData(db, memberId);
      const pinnedEvent = pinned.find((p) => p.kind === "event");
      const pinnedTake = pinned.find((p) => p.kind === "take");
      expect(pinnedEvent?.kind === "event" && pinnedEvent.ownerName).toBe("Filip");
      expect(pinnedTake?.kind === "take" && pinnedTake.ownerName).toBe("Filip");
    });

    it("in the ledger, and leaves a band event's owner empty", async () => {
      const { now, event } = await personalDay();
      const band = await eventsRepo.create(db, {
        kind: "rehearsal",
        heldAt: now - 1000,
        createdAt: now,
        updatedAt: now,
      });

      const { recentEvents } = await getHomeData(db, memberId);
      expect(recentEvents.find((e) => e.id === event.id)?.ownerName).toBe("Filip");
      expect(recentEvents.find((e) => e.id === band.id)?.ownerName).toBeNull();
    });
  });
});
