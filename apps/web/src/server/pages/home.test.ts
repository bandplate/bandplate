// `/` composition logic — the three home sections (favorites, recent
// events with their takes, needs-your-vote), exercised against a real test
// database (not over HTTP — `home-search-me-takes.route.test.ts` covers
// the actual route). Same split as `songs.test.ts`/`events.test.ts`.
import type { Db } from "@bandplate/db";
import {
  assetsRepo,
  eventsRepo,
  favoritesRepo,
  instrumentsRepo,
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

  it("returns empty favorites, no recent events, and no unvoted takes on a fresh database", async () => {
    const data = await getHomeData(db, memberId);
    expect(data.favorites.songs).toEqual([]);
    expect(data.favorites.takes).toEqual([]);
    expect(data.favorites.events).toEqual([]);
    expect(data.recentEvents).toEqual([]);
    expect(data.unvotedTakes).toEqual([]);
  });

  it("includes a favorited event in favorites.events — the brief's DoD requires it on / and /me", async () => {
    const event = await eventsRepo.create(db, {
      kind: "concert",
      heldAt: Date.now(),
      venue: "Favorited Venue",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await favoritesRepo.add(db, {
      memberId,
      targetType: "event",
      targetId: event.id,
      createdAt: Date.now(),
    });

    const data = await getHomeData(db, memberId);
    expect(data.favorites.events.map((e) => e.id)).toEqual([event.id]);
  });

  it("splits favorites into songs and takes, preserving newest-first order, and ignores a favorited event", async () => {
    const now = Date.now();
    const songA = await songsRepo.create(db, {
      title: "Older Favorite Song",
      slug: "older-favorite-song",
      createdAt: now,
      updatedAt: now,
    });
    const songB = await songsRepo.create(db, {
      title: "Newer Favorite Song",
      slug: "newer-favorite-song",
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
      songId: songA.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await favoritesRepo.add(db, {
      memberId,
      targetType: "song",
      targetId: songA.id,
      createdAt: 1000,
    });
    await favoritesRepo.add(db, {
      memberId,
      targetType: "song",
      targetId: songB.id,
      createdAt: 2000,
    });
    await favoritesRepo.add(db, {
      memberId,
      targetType: "take",
      targetId: take.id,
      createdAt: 3000,
    });
    // A favorited EVENT is deliberately not surfaced on home (brief scopes
    // the section to "pinned songs and takes") — this proves it's ignored,
    // not merely untested.
    await favoritesRepo.add(db, {
      memberId,
      targetType: "event",
      targetId: event.id,
      createdAt: 4000,
    });

    const data = await getHomeData(db, memberId);

    // Newest favorite first, per favoritesRepo.listByMember's own ordering.
    expect(data.favorites.songs.map((s) => s.slug)).toEqual([
      "newer-favorite-song",
      "older-favorite-song",
    ]);
    expect(data.favorites.takes.map((t) => t.id)).toEqual([take.id]);
    expect(data.favorites.takes[0]?.song?.slug).toBe("older-favorite-song");
    expect(data.favorites.takes[0]?.event?.id).toBe(event.id);
  });

  it("recent events come with their takes, song, and instruments attached", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Recent Event Song",
      slug: "recent-event-song",
      createdAt: now,
      updatedAt: now,
    });
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const event = await eventsRepo.create(db, {
      kind: "concert",
      heldAt: now,
      venue: "Test Venue",
      createdAt: now,
      updatedAt: now,
    });
    const take = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bass.id],
    });

    const data = await getHomeData(db, memberId);

    expect(data.recentEvents).toHaveLength(1);
    expect(data.recentEvents[0]?.event.id).toBe(event.id);
    expect(data.recentEvents[0]?.event.takeCount).toBe(1);
    expect(data.recentEvents[0]?.takes.map((t) => t.id)).toEqual([take.id]);
    expect(data.recentEvents[0]?.takes[0]?.song?.slug).toBe("recent-event-song");
    expect(data.recentEvents[0]?.takes[0]?.instruments.map((i) => i.slug)).toEqual(["bass"]);
    // No assets created for this take — no play control.
    expect(data.recentEvents[0]?.takes[0]?.playableAssetId).toBeUndefined();
  });

  it("recent events' takes get playableAssetId when a ready master exists", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Playable Recent Song",
      slug: "playable-recent-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "concert",
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
    const [masterAsset] = await assetsRepo.createMany(db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossy",
        format: "mp3",
        storageKey: `takes/${take.id}/master/lossy.mp3`,
        contentType: "audio/mpeg",
        bytes: 1000,
        status: "ready",
        createdAt: now,
        readyAt: now,
      },
    ]);

    const data = await getHomeData(db, memberId);
    expect(data.recentEvents[0]?.takes[0]?.playableAssetId).toBe(masterAsset?.id);
  });

  it("an event with zero takes still appears, with an empty takes array (a real empty state, not an omission)", async () => {
    const now = Date.now();
    await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const data = await getHomeData(db, memberId);
    expect(data.recentEvents).toHaveLength(1);
    expect(data.recentEvents[0]?.takes).toEqual([]);
  });

  it("needs-your-vote includes a published take this member hasn't voted on", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Unvoted Song",
      slug: "unvoted-song-home",
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
      state: "published",
    });

    const data = await getHomeData(db, memberId);
    expect(data.unvotedTakes.map((t) => t.id)).toEqual([take.id]);
    expect(data.unvotedTakes[0]?.song?.slug).toBe("unvoted-song-home");
  });

  // F4 (review round 1): the gold favorite marker is per-row, real
  // information — a take can be BOTH "needs your vote"/"recent events" AND
  // a favorite at once (this is also the exact shape F1's duplicate
  // `view-transition-name` bug needed — see index.astro's `claimTakeTransition`).
  it("marks a take as favorited in recentEvents/unvotedTakes when it's also one of this member's favorites, and not otherwise", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Doubly Listed Song",
      slug: "doubly-listed-song",
      createdAt: now,
      updatedAt: now,
    });
    const otherSong = await songsRepo.create(db, {
      title: "Not Favorited Song",
      slug: "not-favorited-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const favoritedUnvoted = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      state: "published",
    });
    const plainUnvoted = await takesRepo.create(db, {
      songId: otherSong.id,
      eventId: event.id,
      recordedAt: now - 1,
      createdAt: now - 1,
      updatedAt: now - 1,
      state: "published",
    });
    await favoritesRepo.add(db, {
      memberId,
      targetType: "take",
      targetId: favoritedUnvoted.id,
      createdAt: now,
    });

    const data = await getHomeData(db, memberId);

    const favoritedRow = data.unvotedTakes.find((t) => t.id === favoritedUnvoted.id);
    const plainRow = data.unvotedTakes.find((t) => t.id === plainUnvoted.id);
    expect(favoritedRow?.favorited).toBe(true);
    expect(plainRow?.favorited).toBe(false);

    // Same take, same favorited status, in the "recent events" section too
    // — it's the same event's take list.
    const recentTakes = data.recentEvents[0]?.takes ?? [];
    expect(recentTakes.find((t) => t.id === favoritedUnvoted.id)?.favorited).toBe(true);
    expect(recentTakes.find((t) => t.id === plainUnvoted.id)?.favorited).toBe(false);
  });
});
