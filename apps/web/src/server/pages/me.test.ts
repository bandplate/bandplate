// `/me` composition logic: the member, their sessions (with the current
// one marked), favorites, and votes so far — against a real test database.
import { hashToken } from "@bandplate/core";
import type { Db } from "@bandplate/db";
import {
  authSessionsRepo,
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
import { getMeData } from "./me.js";

describe("getMeData", () => {
  let db: Db;
  let memberId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const member = await membersRepo.create(db, {
      displayName: "Me Test Member",
      slug: "me-test-member",
      email: "me-test-member@example.com",
      createdAt: Date.now(),
    });
    memberId = member.id;
  });

  it("returns undefined for an unknown member id", async () => {
    const result = await getMeData(db, "00000000-0000-0000-0000-000000000000", undefined);
    expect(result).toBeUndefined();
  });

  it("empty favorites and empty votes on a fresh member — real empty states, not omissions", async () => {
    const data = await getMeData(db, memberId, undefined);
    expect(data?.favorites.songs).toEqual([]);
    expect(data?.favorites.takes).toEqual([]);
    expect(data?.votes).toEqual([]);
    expect(data?.sessions).toEqual([]);
  });

  it("marks the session matching the supplied cookie as current, and no other", async () => {
    const now = Date.now();
    const otherToken = "other-raw-session-token";
    const currentToken = "current-raw-session-token";
    await authSessionsRepo.create(db, {
      memberId,
      tokenHash: await hashToken(otherToken),
      createdAt: now,
      expiresAt: now + 100_000,
    });
    await authSessionsRepo.create(db, {
      memberId,
      tokenHash: await hashToken(currentToken),
      createdAt: now,
      expiresAt: now + 100_000,
    });

    const expectedSession = await authSessionsRepo.getByHash(db, await hashToken(currentToken));

    const data = await getMeData(db, memberId, currentToken);
    expect(data?.sessions).toHaveLength(2);
    const current = data?.sessions.filter((s) => s.isCurrent);
    expect(current).toHaveLength(1);
    expect(current?.[0]?.id).toBe(expectedSession?.id);
  });

  it("no session is marked current when no cookie is supplied", async () => {
    const now = Date.now();
    await authSessionsRepo.create(db, {
      memberId,
      tokenHash: await hashToken("some-token"),
      createdAt: now,
      expiresAt: now + 100_000,
    });

    const data = await getMeData(db, memberId, undefined);
    expect(data?.sessions.some((s) => s.isCurrent)).toBe(false);
  });

  it("favorites split into songs and takes, same as the home page's", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Me Favorite Song",
      slug: "me-favorite-song",
      createdAt: now,
      updatedAt: now,
    });
    await favoritesRepo.add(db, {
      memberId,
      targetType: "song",
      targetId: song.id,
      createdAt: now,
    });

    const data = await getMeData(db, memberId, undefined);
    expect(data?.favorites.songs.map((s) => s.slug)).toEqual(["me-favorite-song"]);
  });

  it("votes so far pairs each vote with its take (song/event/instruments attached)", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Voted Song",
      slug: "voted-song",
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
    await votesRepo.castVote(db, { takeId: take.id, memberId, keeper: true, comment: "nice", now });

    const data = await getMeData(db, memberId, undefined);
    expect(data?.votes).toHaveLength(1);
    expect(data?.votes[0]?.vote.keeper).toBe(true);
    expect(data?.votes[0]?.vote.comment).toBe("nice");
    expect(data?.votes[0]?.take?.song?.slug).toBe("voted-song");
  });

  // Data-model gap, closed via `memberInstruments` — see its schema comment.
  it("returns the member's instruments, including an archived one", async () => {
    const drums = await instrumentsRepo.create(db, { slug: "drums", label: "Drums" });
    const trombone = await instrumentsRepo.create(db, { slug: "trombone", label: "Trombone" });
    await membersRepo.setInstruments(db, memberId, [drums.id, trombone.id]);
    await instrumentsRepo.archive(db, trombone.id, Date.now());

    const data = await getMeData(db, memberId, undefined);
    expect(data?.instruments.map((i) => i.id)).toEqual([drums.id, trombone.id]);
    expect(data?.instruments.find((i) => i.id === trombone.id)?.archivedAt).not.toBeNull();
  });

  // F4 (review round 1): the gold favorite marker on the votes list is
  // real per-row information — whether the voted-on take is ALSO one of
  // this member's favorites, independent of the vote itself.
  it("marks a voted take as favorited when it is also one of this member's favorites", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Voted And Favorited Song",
      slug: "voted-and-favorited-song",
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
    await votesRepo.castVote(db, { takeId: take.id, memberId, keeper: true, now });
    await favoritesRepo.add(db, {
      memberId,
      targetType: "take",
      targetId: take.id,
      createdAt: now,
    });

    const data = await getMeData(db, memberId, undefined);
    expect(data?.votes[0]?.favorited).toBe(true);
  });

  it("does not mark a voted take as favorited when it isn't one", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Voted Only Song",
      slug: "voted-only-song",
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
    await votesRepo.castVote(db, { takeId: take.id, memberId, keeper: true, now });

    const data = await getMeData(db, memberId, undefined);
    expect(data?.votes[0]?.favorited).toBe(false);
  });
});
