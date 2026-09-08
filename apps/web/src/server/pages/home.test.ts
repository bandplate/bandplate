// `/` composition logic — the two home sections (the pinned list and the
// event ledger), exercised against a real test database (not over HTTP —
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
});
