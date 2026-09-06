import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as assets from "./assets.js";
import * as events from "./events.js";
import * as instruments from "./instruments.js";
import * as songs from "./songs.js";
import * as takes from "./takes.js";

async function seedTake(db: Db) {
  const now = Date.now();
  const song = await songs.create(db, {
    title: "Asset Test Song",
    slug: "asset-test-song",
    createdAt: now,
    updatedAt: now,
  });
  const event = await events.create(db, {
    kind: "rehearsal",
    heldAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return takes.create(db, {
    songId: song.id,
    eventId: event.id,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

describe("assets.takeHasLossless", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("is false with only lossy assets", async () => {
    const take = await seedTake(db);
    await assets.createMany(db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossy",
        format: "opus",
        storageKey: `${take.id}/master.opus`,
        contentType: "audio/opus",
        bytes: 1000,
        status: "ready",
        createdAt: Date.now(),
      },
    ]);

    expect(await assets.takeHasLossless(db, take.id)).toBe(false);
  });

  it("is false when a lossless asset exists but is still status='pending'", async () => {
    const take = await seedTake(db);
    await assets.createMany(db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossless",
        format: "flac",
        storageKey: `${take.id}/master.flac`,
        contentType: "audio/flac",
        bytes: 5000,
        status: "pending",
        createdAt: Date.now(),
      },
    ]);

    expect(await assets.takeHasLossless(db, take.id)).toBe(false);
  });

  it("is true once the lossless asset is status='ready'", async () => {
    const take = await seedTake(db);
    const [asset] = await assets.createMany(db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossless",
        format: "flac",
        storageKey: `${take.id}/master.flac`,
        contentType: "audio/flac",
        bytes: 5000,
        status: "pending",
        createdAt: Date.now(),
      },
    ]);
    if (!asset) {
      throw new Error("expected createMany to return the inserted asset");
    }

    expect(await assets.takeHasLossless(db, take.id)).toBe(false);

    await assets.markReady(db, asset.id, Date.now());

    expect(await assets.takeHasLossless(db, take.id)).toBe(true);
  });
});

describe("assets slot unique index", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("rejects a duplicate (takeId, kind, instrumentId, tier, format) slot", async () => {
    const take = await seedTake(db);
    const slot = {
      takeId: take.id,
      kind: "master" as const,
      tier: "lossy" as const,
      format: "opus" as const,
      contentType: "audio/opus",
      bytes: 1000,
      createdAt: Date.now(),
    };

    await assets.createMany(db, [{ ...slot, storageKey: `${take.id}/a.opus` }]);

    await expect(
      assets.createMany(db, [{ ...slot, storageKey: `${take.id}/b.opus` }]),
    ).rejects.toThrow();
  });

  it("rejects a duplicate stem slot (non-null instrumentId)", async () => {
    const take = await seedTake(db);
    const bassId = (await instruments.create(db, { slug: "bass", label: "Bass" })).id;
    const slot = {
      takeId: take.id,
      kind: "stem" as const,
      instrumentId: bassId,
      tier: "lossy" as const,
      format: "opus" as const,
      contentType: "audio/opus",
      bytes: 1000,
      createdAt: Date.now(),
    };

    await assets.createMany(db, [{ ...slot, storageKey: `${take.id}/stems/bass-a.opus` }]);

    await expect(
      assets.createMany(db, [{ ...slot, storageKey: `${take.id}/stems/bass-b.opus` }]),
    ).rejects.toThrow();
  });

  it("accepts two distinct stem slots on the same take (coalesce does not over-collapse)", async () => {
    const take = await seedTake(db);
    const bassId = (await instruments.create(db, { slug: "bass", label: "Bass" })).id;
    const drumsId = (await instruments.create(db, { slug: "drums", label: "Drums" })).id;
    const baseSlot = {
      takeId: take.id,
      kind: "stem" as const,
      tier: "lossy" as const,
      format: "opus" as const,
      contentType: "audio/opus",
      bytes: 1000,
      createdAt: Date.now(),
    };

    const created = await assets.createMany(db, [
      { ...baseSlot, instrumentId: bassId, storageKey: `${take.id}/stems/bass.opus` },
      { ...baseSlot, instrumentId: drumsId, storageKey: `${take.id}/stems/drums.opus` },
    ]);

    expect(created).toHaveLength(2);
    expect(created.map((a) => a.instrumentId).sort()).toEqual([bassId, drumsId].sort());
  });
});
