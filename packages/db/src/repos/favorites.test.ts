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

    const list = await favorites.listByMember(db, member.id);
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

    const list = await favorites.listByMember(db, member.id);
    expect(list.length).toBe(1);
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

    const list = await favorites.listByMember(db, member.id);
    expect(list.length).toBe(0);
  });
});
