import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { shareLinks } from "../schema/sqlite/index.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as eventsRepo from "./events.js";
import * as shareLinksRepo from "./share-links.js";
import * as songsRepo from "./songs.js";
import * as takesRepo from "./takes.js";

const NOW = 1_700_000_000_000;

describe("shareLinksRepo", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("makes a ten-character code and resolves it back to the target", async () => {
    const code = await shareLinksRepo.getOrCreate(db, "song", "song-1", NOW);
    expect(code).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(await shareLinksRepo.resolve(db, code)).toEqual({
      kind: "song",
      targetId: "song-1",
      publicAt: null,
    });
  });

  it("hands out the same code for the same target every time", async () => {
    const first = await shareLinksRepo.getOrCreate(db, "event", "event-1", NOW);
    const second = await shareLinksRepo.getOrCreate(db, "event", "event-1", NOW + 1);
    expect(second).toBe(first);
    expect(await db.select().from(shareLinks)).toHaveLength(1);
  });

  it("keeps kinds apart: a song and a take with the same id get different codes", async () => {
    const song = await shareLinksRepo.getOrCreate(db, "song", "same-id", NOW);
    const take = await shareLinksRepo.getOrCreate(db, "take", "same-id", NOW);
    expect(song).not.toBe(take);
  });

  it("converges when two requests race to create the same target's code", async () => {
    const codes = await Promise.all([
      shareLinksRepo.getOrCreate(db, "take", "take-1", NOW),
      shareLinksRepo.getOrCreate(db, "take", "take-1", NOW),
      shareLinksRepo.getOrCreate(db, "take", "take-1", NOW),
    ]);
    expect(new Set(codes).size).toBe(1);
    expect(await db.select().from(shareLinks)).toHaveLength(1);
  });

  it("retries with a fresh code when the random one is already taken", async () => {
    await shareLinksRepo.getOrCreate(db, "song", "song-1", NOW, () => "AAAAAAAAAA");
    const codes = ["AAAAAAAAAA", "AAAAAAAAAA", "BBBBBBBBBB"];
    let calls = 0;
    const code = await shareLinksRepo.getOrCreate(db, "song", "song-2", NOW, () => {
      calls++;
      return codes.shift() ?? "CCCCCCCCCC";
    });
    expect(code).toBe("BBBBBBBBBB");
    expect(calls).toBe(3);
    expect(await shareLinksRepo.resolve(db, "AAAAAAAAAA")).toEqual({
      kind: "song",
      targetId: "song-1",
      publicAt: null,
    });
  });

  it("gives up after a bounded number of collisions instead of looping", async () => {
    await shareLinksRepo.getOrCreate(db, "song", "song-1", NOW, () => "AAAAAAAAAA");
    await expect(
      shareLinksRepo.getOrCreate(db, "song", "song-2", NOW, () => "AAAAAAAAAA"),
    ).rejects.toThrow(/no free share code/);
  });

  it("resolves an unknown code to undefined", async () => {
    expect(await shareLinksRepo.resolve(db, "zzzzzzzzzz")).toBeUndefined();
  });

  it("removeForTarget drops only that target's link", async () => {
    const keep = await shareLinksRepo.getOrCreate(db, "song", "song-1", NOW);
    const drop = await shareLinksRepo.getOrCreate(db, "song", "song-2", NOW);
    await shareLinksRepo.removeForTarget(db, "song", "song-2");
    expect(await shareLinksRepo.resolve(db, drop)).toBeUndefined();
    expect(await shareLinksRepo.resolve(db, keep)).toBeDefined();
  });

  describe("public links", () => {
    it("a new link is a members' link", async () => {
      await shareLinksRepo.getOrCreate(db, "take", "take-1", NOW);
      expect((await shareLinksRepo.getByTarget(db, "take", "take-1"))?.publicAt).toBeNull();
    });

    it("setPublic turns a link public and back without changing its code", async () => {
      const code = await shareLinksRepo.getOrCreate(db, "take", "take-1", NOW);
      await shareLinksRepo.setPublic(db, "take", "take-1", NOW + 5);
      expect(await shareLinksRepo.resolve(db, code)).toMatchObject({ publicAt: NOW + 5 });
      await shareLinksRepo.setPublic(db, "take", "take-1", null);
      expect(await shareLinksRepo.getByTarget(db, "take", "take-1")).toEqual({
        code,
        publicAt: null,
      });
    });

    it("setPublic touches only that target's link", async () => {
      await shareLinksRepo.getOrCreate(db, "take", "take-1", NOW);
      const other = await shareLinksRepo.getOrCreate(db, "event", "take-1", NOW);
      await shareLinksRepo.setPublic(db, "take", "take-1", NOW);
      expect(await shareLinksRepo.resolve(db, other)).toMatchObject({ publicAt: null });
    });

    it("setPublic on a target with no link makes none", async () => {
      await shareLinksRepo.setPublic(db, "take", "never-shared", NOW);
      expect(await db.select().from(shareLinks)).toHaveLength(0);
    });

    it("getByTarget is undefined for a target never shared", async () => {
      expect(await shareLinksRepo.getByTarget(db, "event", "nope")).toBeUndefined();
    });
  });

  describe("moveToTarget", () => {
    it("a public link arrives at the survivor as a members' link", async () => {
      // The survivor's own takes were never made public; a merge must not
      // publish them.
      const code = await shareLinksRepo.getOrCreate(db, "event", "old", NOW);
      await shareLinksRepo.setPublic(db, "event", "old", NOW);
      await shareLinksRepo.moveToTarget(db, "event", "old", "new");
      expect(await shareLinksRepo.resolve(db, code)).toEqual({
        kind: "event",
        targetId: "new",
        publicAt: null,
      });
    });

    it("the survivor's own link decides when both had one", async () => {
      const oldCode = await shareLinksRepo.getOrCreate(db, "event", "old", NOW);
      await shareLinksRepo.setPublic(db, "event", "old", NOW);
      await shareLinksRepo.getOrCreate(db, "event", "new", NOW);
      await shareLinksRepo.moveToTarget(db, "event", "old", "new");
      expect(await shareLinksRepo.resolve(db, oldCode)).toBeUndefined();
      expect((await shareLinksRepo.getByTarget(db, "event", "new"))?.publicAt).toBeNull();
    });

    it("re-points the link when the new target has none", async () => {
      const code = await shareLinksRepo.getOrCreate(db, "event", "old", NOW);
      await shareLinksRepo.moveToTarget(db, "event", "old", "new");
      expect(await shareLinksRepo.resolve(db, code)).toEqual({
        kind: "event",
        targetId: "new",
        publicAt: null,
      });
    });

    it("drops the old link when the new target already has one", async () => {
      const oldCode = await shareLinksRepo.getOrCreate(db, "event", "old", NOW);
      const newCode = await shareLinksRepo.getOrCreate(db, "event", "new", NOW);
      await shareLinksRepo.moveToTarget(db, "event", "old", "new");
      expect(await shareLinksRepo.resolve(db, oldCode)).toBeUndefined();
      expect(await shareLinksRepo.resolve(db, newCode)).toEqual({
        kind: "event",
        targetId: "new",
        publicAt: null,
      });
    });

    it("does nothing when there is no link to move", async () => {
      await shareLinksRepo.moveToTarget(db, "event", "old", "new");
      expect(await db.select().from(shareLinks)).toHaveLength(0);
    });
  });

  describe("removal paths", () => {
    async function seedTake() {
      const song = await songsRepo.create(db, {
        title: "Share Song",
        slug: "share-song",
        createdAt: NOW,
        updatedAt: NOW,
      });
      const event = await eventsRepo.create(db, {
        kind: "rehearsal",
        heldAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const take = await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });
      return { song, event, take };
    }

    it("takesRepo.remove deletes the take's link", async () => {
      const { take } = await seedTake();
      const code = await shareLinksRepo.getOrCreate(db, "take", take.id, NOW);
      await takesRepo.remove(db, take.id);
      expect(await shareLinksRepo.resolve(db, code)).toBeUndefined();
    });

    it("songsRepo.removeWithTakes deletes the song's link and its takes' links", async () => {
      const { song, take } = await seedTake();
      const songCode = await shareLinksRepo.getOrCreate(db, "song", song.id, NOW);
      const takeCode = await shareLinksRepo.getOrCreate(db, "take", take.id, NOW);
      const other = await shareLinksRepo.getOrCreate(db, "song", "someone-else", NOW);
      await songsRepo.removeWithTakes(db, song.id);
      expect(await shareLinksRepo.resolve(db, songCode)).toBeUndefined();
      expect(await shareLinksRepo.resolve(db, takeCode)).toBeUndefined();
      expect(await shareLinksRepo.resolve(db, other)).toBeDefined();
      expect(
        await db.select().from(shareLinks).where(eq(shareLinks.targetId, song.id)),
      ).toHaveLength(0);
    });
  });
});
