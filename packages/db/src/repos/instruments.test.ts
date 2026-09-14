import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as assetsRepo from "./assets.js";
import * as eventsRepo from "./events.js";
import * as instruments from "./instruments.js";
import * as membersRepo from "./members.js";
import * as songsRepo from "./songs.js";
import * as takesRepo from "./takes.js";

describe("instruments repo", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("list() excludes archived instruments by default", async () => {
    const kept = await instruments.create(db, { slug: "kept", label: "Kept" });
    const archived = await instruments.create(db, { slug: "archived", label: "Archived" });
    await instruments.archive(db, archived.id, Date.now());

    const listed = await instruments.list(db);
    const ids = listed.map((i) => i.id);
    expect(ids).toContain(kept.id);
    expect(ids).not.toContain(archived.id);
  });

  it("list({ includeArchived: true }) includes archived instruments", async () => {
    const archived = await instruments.create(db, { slug: "archived-2", label: "Archived 2" });
    await instruments.archive(db, archived.id, Date.now());

    const listed = await instruments.list(db, { includeArchived: true });
    expect(listed.map((i) => i.id)).toContain(archived.id);
  });

  it("archive does not delete the row (historical takes keep resolving it)", async () => {
    const created = await instruments.create(db, { slug: "vintage-synth", label: "Vintage Synth" });
    await instruments.archive(db, created.id, Date.now());

    const all = await instruments.list(db, { includeArchived: true });
    const found = all.find((i) => i.id === created.id);
    expect(found).toBeDefined();
    expect(found?.archivedAt).not.toBeNull();
  });

  describe("merge", () => {
    /** A song, an event and a take — the scaffolding every collision needs. */
    async function scaffold(db: Db, instrumentIds?: string[]) {
      const song = await songsRepo.create(db, {
        title: "Song",
        slug: "song",
        createdAt: 1,
        updatedAt: 1,
      });
      const event = await eventsRepo.create(db, {
        kind: "rehearsal",
        heldAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const take = await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        instrumentIds,
      });
      return { song, event, take };
    }

    it("moves everything across and leaves the source's slug behind as an alias", async () => {
      // The alias is the point. Without it the next ingest run meets the old
      // slug, finds nothing, and re-creates what was just merged away.
      const src = await instruments.create(db, { slug: "gtr2", label: "Gtr2" });
      const tgt = await instruments.create(db, { slug: "gtr", label: "Guitar" });
      await scaffold(db, [src.id]);

      const plan = await instruments.planMerge(db, src.id, tgt.id);
      expect(plan.collidingAssetIds).toEqual([]);
      expect(plan.chartSongIds).toEqual([]);
      expect(plan.movedTakes).toBe(1);

      await instruments.mergeInto(db, src.id, tgt.id, plan);

      expect(await instruments.getById(db, src.id)).toBeUndefined();
      expect((await instruments.findBySlug(db, "gtr2"))?.id).toBe(tgt.id);
      const usage = await instruments.usageByInstrument(db);
      expect(usage.get(tgt.id)?.takes).toBe(1);
    });

    it("drops a duplicate join row rather than colliding on its primary key", async () => {
      // A member who plays both, or a take that lists both. Nothing is lost —
      // "plays bass" was already true — so this needs no decision from anyone.
      const src = await instruments.create(db, { slug: "b2", label: "B2" });
      const tgt = await instruments.create(db, { slug: "bass", label: "Bass" });
      await scaffold(db, [src.id, tgt.id]);

      const member = await membersRepo.create(db, {
        displayName: "P",
        slug: "p",
        email: "p@example.test",
        createdAt: 1,
      });
      await membersRepo.setInstruments(db, member.id, [src.id, tgt.id]);

      const plan = await instruments.planMerge(db, src.id, tgt.id);
      expect(plan.movedTakes).toBe(0);
      expect(plan.movedMembers).toBe(0);

      await instruments.mergeInto(db, src.id, tgt.id, plan);

      const usage = await instruments.usageByInstrument(db);
      expect(usage.get(tgt.id)?.takes).toBe(1);
      expect(usage.get(tgt.id)?.members).toBe(1);
    });

    it("reports a stem that cannot survive, and the merge deletes exactly that row", async () => {
      // Two stems for what becomes one instrument on one take: the slot index
      // holds one, so an AUDIO FILE has to go. The plan names it first so a
      // human can refuse.
      const src = await instruments.create(db, { slug: "kick2", label: "Kick2" });
      const tgt = await instruments.create(db, { slug: "kick", label: "Kick" });
      const { take } = await scaffold(db);
      const [srcAsset, tgtAsset] = await assetsRepo.createMany(db, [
        {
          takeId: take.id,
          kind: "stem",
          instrumentId: src.id,
          tier: "lossy",
          format: "mp3",
          storageKey: "k/src.mp3",
          contentType: "audio/mpeg",
          bytes: 1,
          createdAt: 1,
        },
        {
          takeId: take.id,
          kind: "stem",
          instrumentId: tgt.id,
          tier: "lossy",
          format: "mp3",
          storageKey: "k/tgt.mp3",
          contentType: "audio/mpeg",
          bytes: 1,
          createdAt: 1,
        },
      ]);
      if (!srcAsset || !tgtAsset) throw new Error("expected both assets");

      const plan = await instruments.planMerge(db, src.id, tgt.id);
      expect(plan.collidingAssetIds).toEqual([srcAsset.id]);

      await instruments.mergeInto(db, src.id, tgt.id, plan);

      // The source's file is gone; the target's is untouched.
      expect(await assetsRepo.getById(db, srcAsset.id)).toBeUndefined();
      expect((await assetsRepo.getById(db, tgtAsset.id))?.instrumentId).toBe(tgt.id);
    });

    it("moves a stem across when the slot is free", async () => {
      // Same take, DIFFERENT tier — not a collision, so nothing is destroyed.
      const src = await instruments.create(db, { slug: "kick2", label: "Kick2" });
      const tgt = await instruments.create(db, { slug: "kick", label: "Kick" });
      const { take } = await scaffold(db);
      const [srcAsset] = await assetsRepo.createMany(db, [
        {
          takeId: take.id,
          kind: "stem",
          instrumentId: src.id,
          tier: "lossless",
          format: "flac",
          storageKey: "k/src.flac",
          contentType: "audio/flac",
          bytes: 1,
          createdAt: 1,
        },
        {
          takeId: take.id,
          kind: "stem",
          instrumentId: tgt.id,
          tier: "lossy",
          format: "mp3",
          storageKey: "k/tgt.mp3",
          contentType: "audio/mpeg",
          bytes: 1,
          createdAt: 1,
        },
      ]);
      if (!srcAsset) throw new Error("expected the asset");

      const plan = await instruments.planMerge(db, src.id, tgt.id);
      expect(plan.collidingAssetIds).toEqual([]);
      expect(plan.movedAssets).toBe(1);

      await instruments.mergeInto(db, src.id, tgt.id, plan);
      expect((await assetsRepo.getById(db, srcAsset.id))?.instrumentId).toBe(tgt.id);
    });

    it("carries the source's own aliases over before deleting it", async () => {
      // They belong to the source row, which is about to go, and
      // `remove`-style cascade would take them with it.
      const src = await instruments.create(db, { slug: "gtr2", label: "Gtr2" });
      const tgt = await instruments.create(db, { slug: "gtr", label: "Guitar" });
      await instruments.addAlias(db, { instrumentId: src.id, slug: "gtr-di", source: "ingest" });

      const plan = await instruments.planMerge(db, src.id, tgt.id);
      await instruments.mergeInto(db, src.id, tgt.id, plan);

      expect((await instruments.findBySlug(db, "gtr-di"))?.id).toBe(tgt.id);
      expect((await instruments.listAliases(db, tgt.id)).map((a) => a.slug).sort()).toEqual([
        "gtr-di",
        "gtr2",
      ]);
    });
  });
});
