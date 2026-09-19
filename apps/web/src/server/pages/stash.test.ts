import type { Db } from "@bandplate/db";
import { eventsRepo, songsRepo, takesRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { RECENT_SONGS_LIMIT, listRecordableSongs, resolvePreselectedSong } from "./stash.js";

describe("the recorder's song list", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("lists the library by title, and names the recently played apart, most recent first", async () => {
    const quiet = await songsRepo.create(db, {
      title: "Aardvark",
      slug: "aardvark",
      createdAt: 1,
      updatedAt: 1,
    });
    const busy = await songsRepo.create(db, {
      title: "Zebra",
      slug: "zebra",
      createdAt: 1,
      updatedAt: 1,
    });
    const older = await songsRepo.create(db, {
      title: "Mango",
      slug: "mango",
      createdAt: 1,
      updatedAt: 1,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 5,
      createdAt: 1,
      updatedAt: 1,
    });
    await takesRepo.create(db, {
      songId: busy.id,
      eventId: event.id,
      recordedAt: 5,
      createdAt: 1,
      updatedAt: 1,
    });
    await takesRepo.create(db, {
      songId: older.id,
      eventId: event.id,
      recordedAt: 3,
      createdAt: 1,
      updatedAt: 1,
    });

    expect(await listRecordableSongs(db)).toEqual({
      songs: [
        { id: quiet.id, title: "Aardvark", slug: "aardvark" },
        { id: older.id, title: "Mango", slug: "mango" },
        { id: busy.id, title: "Zebra", slug: "zebra" },
      ],
      recentIds: [busy.id, older.id],
    });
  });

  it("keeps the recent group short", async () => {
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 5,
      createdAt: 1,
      updatedAt: 1,
    });
    for (let i = 0; i < RECENT_SONGS_LIMIT + 2; i++) {
      const song = await songsRepo.create(db, {
        title: `Song ${i}`,
        slug: `song-${i}`,
        createdAt: 1,
        updatedAt: 1,
      });
      await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: i + 1,
        createdAt: 1,
        updatedAt: 1,
      });
    }
    const { songs, recentIds } = await listRecordableSongs(db);
    expect(songs).toHaveLength(RECENT_SONGS_LIMIT + 2);
    expect(recentIds).toHaveLength(RECENT_SONGS_LIMIT);
  });

  it("resolves ?song= by slug or by id, and nothing for junk or no param", async () => {
    const song = await songsRepo.create(db, {
      title: "Čoudy",
      slug: "coudy",
      createdAt: 1,
      updatedAt: 1,
    });
    const expected = { id: song.id, title: "Čoudy", slug: "coudy" };
    expect(await resolvePreselectedSong(db, "coudy")).toEqual(expected);
    expect(await resolvePreselectedSong(db, song.id)).toEqual(expected);
    expect(await resolvePreselectedSong(db, "nope")).toBeUndefined();
    expect(await resolvePreselectedSong(db, null)).toBeUndefined();
  });
});
