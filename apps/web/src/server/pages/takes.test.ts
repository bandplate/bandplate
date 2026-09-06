// `/takes/[id]` composition logic — the song, event, instruments, assets,
// and derived lossless flag, exercised against a real test database.
import type { Db } from "@bandlib/db";
import { assetsRepo, eventsRepo, instrumentsRepo, songsRepo, takesRepo } from "@bandlib/db";
import { createTestDb } from "@bandlib/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { getTakeDetail } from "./takes.js";

describe("getTakeDetail", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("returns undefined for an unknown id (a 404, not a throw)", async () => {
    const result = await getTakeDetail(db, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeUndefined();
  });

  it("returns the song, event, and instruments alongside the take", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Detail Take Song",
      slug: "detail-take-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "concert",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const take = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bass.id],
    });

    const detail = await getTakeDetail(db, take.id);
    expect(detail?.song?.slug).toBe("detail-take-song");
    expect(detail?.event?.id).toBe(event.id);
    expect(detail?.instruments.map((i) => i.slug)).toEqual(["bass"]);
  });

  it("a take with no assets: empty assets array and hasLossless false — a real empty state", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "No Assets Song",
      slug: "no-assets-song",
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

    const detail = await getTakeDetail(db, take.id);
    expect(detail?.assets).toEqual([]);
    expect(detail?.hasLossless).toBe(false);
  });

  it("hasLossless is true only once a ready lossless master asset exists", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Lossless Song",
      slug: "lossless-song",
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
    await assetsRepo.createMany(db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossy",
        format: "opus",
        storageKey: `test/${take.id}/master.opus`,
        contentType: "audio/opus",
        bytes: 1000,
        status: "ready",
        createdAt: now,
      },
    ]);

    const lossyOnly = await getTakeDetail(db, take.id);
    expect(lossyOnly?.hasLossless).toBe(false);
    expect(lossyOnly?.assets).toHaveLength(1);

    await assetsRepo.createMany(db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossless",
        format: "flac",
        storageKey: `test/${take.id}/master.flac`,
        contentType: "audio/flac",
        bytes: 9000,
        status: "ready",
        createdAt: now,
      },
    ]);

    const withLossless = await getTakeDetail(db, take.id);
    expect(withLossless?.hasLossless).toBe(true);
    expect(withLossless?.assets).toHaveLength(2);
  });

  it("a pending (not-yet-ready) lossless asset does not count as available", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Pending Lossless Song",
      slug: "pending-lossless-song",
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
    await assetsRepo.createMany(db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossless",
        format: "flac",
        storageKey: `test/${take.id}/pending.flac`,
        contentType: "audio/flac",
        bytes: 9000,
        status: "pending",
        createdAt: now,
      },
    ]);

    const detail = await getTakeDetail(db, take.id);
    expect(detail?.hasLossless).toBe(false);
  });
});
