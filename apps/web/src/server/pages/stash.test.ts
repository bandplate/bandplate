import type { Storage } from "@bandplate/core";
import type { Db } from "@bandplate/db";
import { assetsRepo, eventsRepo, membersRepo, songsRepo, takesRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  RECENT_SONGS_LIMIT,
  applyStashWrite,
  deleteStashTake,
  getStashItem,
  getStashRows,
  getStashView,
  listRecordableSongs,
  publishStashTake,
  renameStashTake,
  resolvePreselectedSong,
} from "./stash.js";

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

describe("the stash pages", () => {
  let db: Db;
  let ownerId: string;
  let otherId: string;
  let songId: string;
  let takeId: string;

  async function readyMaster(id: string) {
    const [asset] = await assetsRepo.createMany(db, [
      {
        takeId: id,
        kind: "master",
        instrumentId: null,
        tier: "lossy",
        format: "m4a",
        storageKey: `takes/${id}/master/lossy.m4a`,
        contentType: "audio/mp4",
        bytes: 10,
        sha256: null,
        durationMs: 1000,
        sampleRate: null,
        channels: null,
        status: "pending",
        createdAt: 1,
      },
    ]);
    if (!asset) throw new Error("no asset");
    await assetsRepo.markReady(db, asset.id, 2, { durationMs: 1000 });
    return asset;
  }

  beforeEach(async () => {
    db = await createTestDb();
    ownerId = (
      await membersRepo.create(db, {
        displayName: "Filip",
        slug: "filip",
        email: "f@example.com",
        createdAt: 1,
      })
    ).id;
    otherId = (
      await membersRepo.create(db, {
        displayName: "Jana",
        slug: "jana",
        email: "j@example.com",
        createdAt: 1,
      })
    ).id;
    songId = (
      await songsRepo.create(db, { title: "Čoudy", slug: "coudy", createdAt: 1, updatedAt: 1 })
    ).id;
    const event = await eventsRepo.findOrCreatePersonal(db, {
      memberId: ownerId,
      dayKey: "2026-09-19",
      heldAt: 1,
      now: 1,
    });
    takeId = (
      await takesRepo.create(db, {
        songId,
        eventId: event.id,
        recordedAt: 1,
        label: "mezihra",
        visibility: "private",
        ownerMemberId: ownerId,
        createdAt: 1,
        updatedAt: 1,
      })
    ).id;
  });

  it("lists my stash with each row's song and play control, and nobody else's", async () => {
    const asset = await readyMaster(takeId);
    const mine = await getStashRows(db, ownerId);
    expect(mine.map((r) => [r.id, r.song?.title, r.playableAssetId])).toEqual([
      [takeId, "Čoudy", asset.id],
    ]);
    expect(await getStashRows(db, otherId)).toEqual([]);
  });

  it("the item page is the owner's, and only while it is in the stash", async () => {
    const item = await getStashItem(db, takeId, ownerId);
    expect(item?.owner?.displayName).toBe("Filip");
    expect(item?.event?.kind).toBe("personal");
    expect(item?.playableAsset).toBeUndefined();
    expect(await getStashItem(db, takeId, otherId)).toBeUndefined();
  });

  it("publishing waits for the file, then moves it to the band", async () => {
    expect((await publishStashTake(db, 5, takeId, ownerId)).kind).toBe("nothing_to_play");
    await readyMaster(takeId);
    expect((await publishStashTake(db, 5, takeId, otherId)).kind).toBe("not_found");
    expect((await publishStashTake(db, 5, takeId, ownerId)).kind).toBe("ok");
    expect(await getStashItem(db, takeId, ownerId)).toBeUndefined();
    expect((await takesRepo.getById(db, takeId))?.visibility).toBe("band");
  });

  it("a songless recording picks its song on the way out, and cannot go without one", async () => {
    const event = await eventsRepo.findOrCreatePersonal(db, {
      memberId: ownerId,
      dayKey: "2026-09-20",
      heldAt: 2,
      now: 2,
    });
    const songless = await takesRepo.create(db, {
      songId: null,
      eventId: event.id,
      recordedAt: 2,
      label: "nápad na mezihru",
      visibility: "private",
      ownerMemberId: ownerId,
      createdAt: 2,
      updatedAt: 2,
    });
    await readyMaster(songless.id);

    // It shows up in the stash, named by its own label, with no song.
    const row = (await getStashRows(db, ownerId)).find((r) => r.id === songless.id);
    expect(row?.songId).toBeNull();
    expect(row?.song).toBeUndefined();
    expect((await getStashItem(db, songless.id, ownerId))?.song).toBeUndefined();

    // Nothing offered: refused, and still in the stash.
    expect((await publishStashTake(db, 5, songless.id, ownerId)).kind).toBe("no_song");
    expect((await publishStashTake(db, 5, songless.id, ownerId, "  ")).kind).toBe("no_song");
    expect((await takesRepo.getById(db, songless.id))?.visibility).toBe("private");

    // A song that is not in the library: also refused, and named as such.
    expect((await publishStashTake(db, 5, songless.id, ownerId, "nope")).kind).toBe(
      "song_not_found",
    );
    expect((await takesRepo.getById(db, songless.id))?.visibility).toBe("private");

    // The song it is given is set in the same write that publishes it.
    expect((await publishStashTake(db, 6, songless.id, ownerId, songId)).kind).toBe("ok");
    const published = await takesRepo.getById(db, songless.id);
    expect(published?.songId).toBe(songId);
    expect(published?.visibility).toBe("band");
    expect(published?.publishedAt).toBe(6);
  });

  it("a recording that already has a song ignores one offered with the press", async () => {
    const other = await songsRepo.create(db, {
      title: "Jiná",
      slug: "jina",
      createdAt: 1,
      updatedAt: 1,
    });
    await readyMaster(takeId);
    expect((await publishStashTake(db, 5, takeId, ownerId, other.id)).kind).toBe("ok");
    expect((await takesRepo.getById(db, takeId))?.songId).toBe(songId);
  });

  it("renames, clears, and refuses a label that will not fit", async () => {
    const form = (label: string) => {
      const f = new FormData();
      f.set("label", label);
      return f;
    };
    expect((await renameStashTake(db, 5, takeId, otherId, form("x"))).kind).toBe("not_found");
    expect((await renameStashTake(db, 5, takeId, ownerId, form("  sloka  "))).kind).toBe("ok");
    expect((await takesRepo.getById(db, takeId))?.label).toBe("sloka");
    expect((await renameStashTake(db, 6, takeId, ownerId, form(""))).kind).toBe("ok");
    expect((await takesRepo.getById(db, takeId))?.label).toBeNull();
    expect((await renameStashTake(db, 7, takeId, ownerId, form("a".repeat(201)))).kind).toBe(
      "invalid",
    );
  });

  it("deletes the owner's own stash take and its file, and nobody else's", async () => {
    await readyMaster(takeId);
    const deleted: string[] = [];
    const storage = {
      delete: async (keys: string[]) => {
        deleted.push(...keys);
      },
    } as unknown as Storage;
    expect((await deleteStashTake(db, storage, takeId, otherId)).kind).toBe("not_found");
    expect((await deleteStashTake(db, storage, takeId, ownerId)).kind).toBe("ok");
    expect(await takesRepo.getById(db, takeId)).toBeUndefined();
    expect(deleted).toEqual([`takes/${takeId}/master/lossy.m4a`]);
  });
  it("gives the stash view the row, who recorded it, and a picker only when one is needed", async () => {
    await readyMaster(takeId);
    const filed = await getStashView(db, ownerId);
    expect(filed.rows.map((row) => [row.id, row.song?.title, row.event?.kind])).toEqual([
      [takeId, "Čoudy", "personal"],
    ]);
    expect(filed.owner?.displayName).toBe("Filip");
    // Every row has its song already: nothing to choose from, so the library
    // is not read at all.
    expect(filed.songChoices).toEqual([]);

    const event = await eventsRepo.findOrCreatePersonal(db, {
      memberId: ownerId,
      dayKey: "2026-09-20",
      heldAt: 2,
      now: 2,
    });
    await takesRepo.create(db, {
      songId: null,
      eventId: event.id,
      recordedAt: 2,
      label: "nápad",
      visibility: "private",
      ownerMemberId: ownerId,
      createdAt: 2,
      updatedAt: 2,
    });
    const songless = await getStashView(db, ownerId);
    expect(songless.songChoices.map((choice) => choice.title)).toEqual(["Čoudy"]);
  });
});

// The sheet names the take in the form rather than in the route, so this is
// where "only the owner writes" has to hold. A hand-built POST is exactly a
// call to this function with somebody else's take id.
describe("a write from a recording's sheet", () => {
  let db: Db;
  let ownerId: string;
  let strangerId: string;
  let songId: string;
  let takeId: string;

  /** A recording whose file has landed — publishing needs one. */
  async function readyMaster(id: string): Promise<void> {
    const [asset] = await assetsRepo.createMany(db, [
      {
        takeId: id,
        kind: "master",
        instrumentId: null,
        tier: "lossy",
        format: "m4a",
        storageKey: `takes/${id}/master/lossy.m4a`,
        contentType: "audio/mp4",
        bytes: 10,
        sha256: null,
        durationMs: 1000,
        sampleRate: null,
        channels: null,
        status: "pending",
        createdAt: 1,
      },
    ]);
    if (!asset) throw new Error("no asset");
    await assetsRepo.markReady(db, asset.id, 2, { durationMs: 1000 });
  }

  function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      data.set(key, value);
    }
    return data;
  }

  beforeEach(async () => {
    db = await createTestDb();
    ownerId = (
      await membersRepo.create(db, {
        displayName: "Filip",
        slug: "filip",
        email: "f@example.com",
        createdAt: 1,
      })
    ).id;
    strangerId = (
      await membersRepo.create(db, {
        displayName: "Jana",
        slug: "jana",
        email: "j@example.com",
        createdAt: 1,
      })
    ).id;
    songId = (
      await songsRepo.create(db, { title: "Čoudy", slug: "coudy", createdAt: 1, updatedAt: 1 })
    ).id;
    const event = await eventsRepo.findOrCreatePersonal(db, {
      memberId: ownerId,
      dayKey: "2026-09-19",
      heldAt: 1,
      now: 1,
    });
    takeId = (
      await takesRepo.create(db, {
        songId,
        eventId: event.id,
        recordedAt: 1,
        label: "mezihra",
        visibility: "private",
        ownerMemberId: ownerId,
        createdAt: 1,
        updatedAt: 1,
      })
    ).id;
    await readyMaster(takeId);
  });

  it("renames and publishes the owner's own recording", async () => {
    expect(
      await applyStashWrite(db, 5, ownerId, form({ intent: "rename", takeId, label: "sloka" })),
    ).toEqual({
      kind: "renamed",
      takeId,
    });
    expect((await takesRepo.getById(db, takeId))?.label).toBe("sloka");
    expect(await applyStashWrite(db, 6, ownerId, form({ intent: "publish", takeId }))).toEqual({
      kind: "published",
      takeId,
    });
    expect((await takesRepo.getById(db, takeId))?.visibility).toBe("band");
  });

  it("answers a stranger's hand-built POST as if the recording did not exist, and changes nothing", async () => {
    expect(
      await applyStashWrite(db, 5, strangerId, form({ intent: "rename", takeId, label: "moje" })),
    ).toEqual({ kind: "not_found" });
    expect(await applyStashWrite(db, 5, strangerId, form({ intent: "publish", takeId }))).toEqual({
      kind: "not_found",
    });
    const take = await takesRepo.getById(db, takeId);
    expect(take?.label).toBe("mezihra");
    expect(take?.visibility).toBe("private");
  });

  it("reports what the member can fix, naming the recording it happened to", async () => {
    expect(
      await applyStashWrite(
        db,
        5,
        ownerId,
        form({ intent: "rename", takeId, label: "a".repeat(201) }),
      ),
    ).toEqual({ kind: "error", takeId, error: "label_too_long" });
    const songless = await takesRepo.create(db, {
      songId: null,
      eventId: (await takesRepo.getById(db, takeId))?.eventId ?? "",
      recordedAt: 2,
      label: "nápad",
      visibility: "private",
      ownerMemberId: ownerId,
      createdAt: 2,
      updatedAt: 2,
    });
    await readyMaster(songless.id);
    expect(
      await applyStashWrite(db, 5, ownerId, form({ intent: "publish", takeId: songless.id })),
    ).toEqual({ kind: "error", takeId: songless.id, error: "no_song" });
    expect(
      await applyStashWrite(
        db,
        5,
        ownerId,
        form({ intent: "publish", takeId: songless.id, songId: "s-gone" }),
      ),
    ).toEqual({ kind: "error", takeId: songless.id, error: "song_not_found" });
  });

  it("does nothing at all for a form that names no take or no intent it knows", async () => {
    expect(await applyStashWrite(db, 5, ownerId, form({ intent: "publish" }))).toEqual({
      kind: "ignored",
    });
    expect(await applyStashWrite(db, 5, ownerId, form({ intent: "delete", takeId }))).toEqual({
      kind: "ignored",
    });
    expect((await takesRepo.getById(db, takeId))?.visibility).toBe("private");
  });
});
