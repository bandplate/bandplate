import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as events from "./events.js";
import * as favorites from "./favorites.js";
import * as members from "./members.js";
import * as songs from "./songs.js";

describe("favorites repo", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("add + listByMember returns the favorite, newest first", async () => {
    const member = await members.create(db, {
      displayName: "Fav Tester",
      slug: "fav-tester",
      email: "fav@example.com",
      createdAt: Date.now(),
    });
    const song = await songs.create(db, {
      title: "Fav Song",
      slug: "fav-song",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await favorites.add(db, {
      memberId: member.id,
      targetType: "song",
      targetId: song.id,
      createdAt: 1000,
    });
    await favorites.add(db, {
      memberId: member.id,
      targetType: "event",
      targetId: event.id,
      createdAt: 2000,
    });

    const { rows: list } = await favorites.listByMember(db, member.id);
    expect(list.length).toBe(2);
    expect(list[0]?.targetType).toBe("event");
    expect(list[1]?.targetType).toBe("song");
  });

  it("add is idempotent (same composite key does not duplicate)", async () => {
    const member = await members.create(db, {
      displayName: "Fav Tester 2",
      slug: "fav-tester-2",
      email: "fav2@example.com",
      createdAt: Date.now(),
    });
    const song = await songs.create(db, {
      title: "Fav Song 2",
      slug: "fav-song-2",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await favorites.add(db, {
      memberId: member.id,
      targetType: "song",
      targetId: song.id,
      createdAt: 1000,
    });
    await favorites.add(db, {
      memberId: member.id,
      targetType: "song",
      targetId: song.id,
      createdAt: 2000,
    });

    const { rows: list } = await favorites.listByMember(db, member.id);
    expect(list.length).toBe(1);
  });

  it("listTargetIdsByMember returns only ids of the given target type, as a Set", async () => {
    const member = await members.create(db, {
      displayName: "Fav Tester 4",
      slug: "fav-tester-4",
      email: "fav4@example.com",
      createdAt: Date.now(),
    });
    const song = await songs.create(db, {
      title: "Fav Song 4",
      slug: "fav-song-4",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await favorites.add(db, {
      memberId: member.id,
      targetType: "song",
      targetId: song.id,
      createdAt: 1000,
    });
    await favorites.add(db, {
      memberId: member.id,
      targetType: "event",
      targetId: event.id,
      createdAt: 2000,
    });

    const songIds = await favorites.listTargetIdsByMember(db, member.id, "song");
    expect(songIds).toEqual(new Set([song.id]));
    expect(songIds.has(event.id)).toBe(false);
  });

  it("listTargetIdsByMember returns an empty Set for a member with none", async () => {
    const member = await members.create(db, {
      displayName: "Fav Tester 5",
      slug: "fav-tester-5",
      email: "fav5@example.com",
      createdAt: Date.now(),
    });

    const ids = await favorites.listTargetIdsByMember(db, member.id, "take");
    expect(ids).toEqual(new Set());
  });

  it("isFavorited reports true only after add, false after remove", async () => {
    const member = await members.create(db, {
      displayName: "Fav Tester 6",
      slug: "fav-tester-6",
      email: "fav6@example.com",
      createdAt: Date.now(),
    });
    const song = await songs.create(db, {
      title: "Fav Song 6",
      slug: "fav-song-6",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    expect(await favorites.isFavorited(db, member.id, "song", song.id)).toBe(false);
    await favorites.add(db, {
      memberId: member.id,
      targetType: "song",
      targetId: song.id,
      createdAt: 1000,
    });
    expect(await favorites.isFavorited(db, member.id, "song", song.id)).toBe(true);
    await favorites.remove(db, member.id, "song", song.id);
    expect(await favorites.isFavorited(db, member.id, "song", song.id)).toBe(false);
  });

  it("toggle adds when absent and removes when present, reporting the resulting state", async () => {
    const member = await members.create(db, {
      displayName: "Fav Tester 7",
      slug: "fav-tester-7",
      email: "fav7@example.com",
      createdAt: Date.now(),
    });
    const song = await songs.create(db, {
      title: "Fav Song 7",
      slug: "fav-song-7",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const first = await favorites.toggle(db, {
      memberId: member.id,
      targetType: "song",
      targetId: song.id,
      now: 1000,
    });
    expect(first).toEqual({ favorited: true });
    expect(await favorites.isFavorited(db, member.id, "song", song.id)).toBe(true);

    const second = await favorites.toggle(db, {
      memberId: member.id,
      targetType: "song",
      targetId: song.id,
      now: 2000,
    });
    expect(second).toEqual({ favorited: false });
    expect(await favorites.isFavorited(db, member.id, "song", song.id)).toBe(false);
  });

  it("one member's favorite is not another's — per-member isolation", async () => {
    const memberA = await members.create(db, {
      displayName: "Fav Tester 8a",
      slug: "fav-tester-8a",
      email: "fav8a@example.com",
      createdAt: Date.now(),
    });
    const memberB = await members.create(db, {
      displayName: "Fav Tester 8b",
      slug: "fav-tester-8b",
      email: "fav8b@example.com",
      createdAt: Date.now(),
    });
    const song = await songs.create(db, {
      title: "Fav Song 8",
      slug: "fav-song-8",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await favorites.add(db, {
      memberId: memberA.id,
      targetType: "song",
      targetId: song.id,
      createdAt: 1000,
    });

    expect(await favorites.isFavorited(db, memberA.id, "song", song.id)).toBe(true);
    expect(await favorites.isFavorited(db, memberB.id, "song", song.id)).toBe(false);
    expect((await favorites.listByMember(db, memberB.id)).total).toBe(0);
    expect((await favorites.listByMember(db, memberA.id)).total).toBe(1);

    // memberB removing a favorite they never had must not disturb memberA's.
    await favorites.remove(db, memberB.id, "song", song.id);
    expect(await favorites.isFavorited(db, memberA.id, "song", song.id)).toBe(true);
  });

  it("remove deletes the favorite", async () => {
    const member = await members.create(db, {
      displayName: "Fav Tester 3",
      slug: "fav-tester-3",
      email: "fav3@example.com",
      createdAt: Date.now(),
    });
    const song = await songs.create(db, {
      title: "Fav Song 3",
      slug: "fav-song-3",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await favorites.add(db, {
      memberId: member.id,
      targetType: "song",
      targetId: song.id,
      createdAt: 1000,
    });
    await favorites.remove(db, member.id, "song", song.id);

    const { rows: list } = await favorites.listByMember(db, member.id);
    expect(list.length).toBe(0);
  });
});
