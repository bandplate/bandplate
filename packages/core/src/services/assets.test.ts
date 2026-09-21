import {
  assetsRepo,
  type Db,
  eventsRepo,
  instrumentsRepo,
  songsRepo,
  takesRepo,
} from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import type { Storage, StoredObject } from "../ports/index.js";
import {
  assetStorageKey,
  canPublish,
  contentTypeForFormat,
  type DeclaredAsset,
  hexSha256ToBase64,
  playableSources,
  resolveSlotForUpload,
} from "./assets.js";

/**
 * Only `delete` matters to `resolveSlotForUpload`, and what matters about it
 * is WHETHER it was called and with what — so this records rather than
 * simulating a bucket. Everything else throws, so a test that accidentally
 * depends on real storage behaviour fails loudly instead of passing for the
 * wrong reason.
 */
function recordingStorage(): { storage: Storage; deleted: string[][] } {
  const deleted: string[][] = [];
  const storage: Storage = {
    signedUploadUrl: async (key) => `https://bucket.example/${key}?signed`,
    signedDownloadUrl: async () => {
      throw new Error("not used");
    },
    head: async (): Promise<StoredObject | null> => {
      throw new Error("not used");
    },
    delete: async (keys) => {
      deleted.push(keys);
    },
    put: async () => {
      throw new Error("not used");
    },
  };
  return { storage, deleted };
}

let counter = 0;

async function seedTake(db: Db): Promise<string> {
  counter += 1;
  const now = 1000;
  const song = await songsRepo.create(db, {
    title: `Slot Song ${counter}`,
    slug: `slot-song-${counter}`,
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
  return take.id;
}

function master(overrides: Partial<DeclaredAsset> = {}): DeclaredAsset {
  return {
    kind: "master",
    instrumentId: null,
    instrumentSlug: null,
    tier: "lossy",
    format: "mp3",
    bytes: 1000,
    ...overrides,
  };
}

describe("assetStorageKey", () => {
  it("mirrors the three key builders", () => {
    expect(assetStorageKey("t1", "master", null, "lossy", "mp3")).toBe("takes/t1/master/lossy.mp3");
    expect(assetStorageKey("t1", "stem", "bass", "lossless", "flac")).toBe(
      "takes/t1/stems/bass/lossless.flac",
    );
    expect(assetStorageKey("t1", "peaks", null, "lossy", "json")).toBe(
      "takes/t1/peaks/master.json",
    );
  });

  it("keys a stem's waveform to that stem, not to the master", () => {
    // Every peaks asset used to land on the master's key, so a take could
    // hold only one waveform and soloing a stem drew the master's shape.
    expect(assetStorageKey("t1", "peaks", "bass", "lossy", "json")).toBe(
      "takes/t1/peaks/stems/bass.json",
    );
    expect(assetStorageKey("t1", "peaks", "bass", "lossy", "json")).not.toBe(
      assetStorageKey("t1", "peaks", null, "lossy", "json"),
    );
  });

  it("refuses a stem with no instrument slug rather than writing a broken key", () => {
    expect(() => assetStorageKey("t1", "stem", null, "lossy", "mp3")).toThrow(
      /needs an instrument slug/,
    );
  });
});

describe("contentTypeForFormat / hexSha256ToBase64", () => {
  it("maps every format", () => {
    expect(contentTypeForFormat("opus")).toBe("audio/ogg");
    expect(contentTypeForFormat("mp3")).toBe("audio/mpeg");
    expect(contentTypeForFormat("flac")).toBe("audio/flac");
    expect(contentTypeForFormat("wav")).toBe("audio/wav");
    expect(contentTypeForFormat("json")).toBe("application/json");
    expect(contentTypeForFormat("webm")).toBe("audio/webm");
    // MediaRecorder on iOS Safari writes AAC in an MP4 container. `audio/mp4` is
    // the type every browser's <audio> accepts for it; `audio/x-m4a` is not.
    expect(contentTypeForFormat("m4a")).toBe("audio/mp4");
  });

  it("encodes a hex digest as standard base64, not base64url", () => {
    // A digest chosen to produce both `+` and `/` — the two characters that
    // would come back as `-` and `_` from a base64url encoder, which is the
    // mistake this function's doc comment warns about.
    const hex = "fb".repeat(32);
    const encoded = hexSha256ToBase64(hex);
    expect(encoded).toBe(btoa("û".repeat(32)));
    expect(encoded).toContain("+");
  });

  it("rejects anything that is not a 64-char hex digest", () => {
    expect(() => hexSha256ToBase64("nope")).toThrow(/not a 64-char hex string/);
  });
});

describe("resolveSlotForUpload", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("creates a pending row when the slot is empty", async () => {
    const takeId = await seedTake(db);
    const { storage, deleted } = recordingStorage();

    const result = await resolveSlotForUpload(db, storage, 2000, takeId, master(), {
      replace: true,
    });

    expect(result.outcome).toBe("created");
    expect(result.asset.status).toBe("pending");
    expect(result.asset.storageKey).toBe(`takes/${takeId}/master/lossy.mp3`);
    expect(result.asset.contentType).toBe("audio/mpeg");
    expect(deleted).toEqual([]);
  });

  it("reports the slot occupied, and writes nothing, when replace is false", async () => {
    const takeId = await seedTake(db);
    const { storage, deleted } = recordingStorage();
    const first = await resolveSlotForUpload(db, storage, 2000, takeId, master(), {
      replace: true,
    });

    const second = await resolveSlotForUpload(
      db,
      storage,
      3000,
      takeId,
      master({ format: "opus", bytes: 9999 }),
      { replace: false },
    );

    expect(second.outcome).toBe("occupied");
    // The EXISTING row comes back untouched — that is what lets the UI say
    // "this take already has a lossy master (mp3, 1000 bytes)".
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.format).toBe("mp3");
    expect(second.asset.bytes).toBe(1000);
    expect(deleted).toEqual([]);
    const rows = await assetsRepo.listByTake(db, takeId);
    expect(rows).toHaveLength(1);
  });

  it("leaves a ready row alone when the declaration matches it", async () => {
    const takeId = await seedTake(db);
    const { storage, deleted } = recordingStorage();
    const created = await resolveSlotForUpload(
      db,
      storage,
      2000,
      takeId,
      master({ sha256: "a".repeat(64) }),
      { replace: true },
    );
    await assetsRepo.markReady(db, created.asset.id, 2500);

    const again = await resolveSlotForUpload(
      db,
      storage,
      3000,
      takeId,
      master({ sha256: "a".repeat(64) }),
      { replace: true },
    );

    expect(again.outcome).toBe("unchanged");
    expect(again.asset.status).toBe("ready");
    expect(deleted).toEqual([]);
  });

  it("resets the row without deleting anything when the key does not move", async () => {
    const takeId = await seedTake(db);
    const { storage, deleted } = recordingStorage();
    const created = await resolveSlotForUpload(
      db,
      storage,
      2000,
      takeId,
      master({ sha256: "a".repeat(64) }),
      { replace: true },
    );
    await assetsRepo.markReady(db, created.asset.id, 2500);

    // Same slot, same format — so the same storage key. A new hash means the
    // object is being overwritten in place; there is nothing to clean up.
    const result = await resolveSlotForUpload(
      db,
      storage,
      3000,
      takeId,
      master({ sha256: "b".repeat(64), bytes: 2000 }),
      { replace: true },
    );

    expect(result.outcome).toBe("reset");
    expect(result.asset.status).toBe("pending");
    expect(result.asset.readyAt).toBeNull();
    expect(result.asset.bytes).toBe(2000);
    expect(result.asset.storageKey).toBe(created.asset.storageKey);
    expect(deleted).toEqual([]);

    const stored = await assetsRepo.getById(db, created.asset.id);
    expect(stored?.status).toBe("pending");
    expect(stored?.bytes).toBe(2000);
  });

  it("deletes the superseded object when the format moves the key", async () => {
    const takeId = await seedTake(db);
    const { storage, deleted } = recordingStorage();
    const created = await resolveSlotForUpload(db, storage, 2000, takeId, master(), {
      replace: true,
    });
    await assetsRepo.markReady(db, created.asset.id, 2500);

    const result = await resolveSlotForUpload(
      db,
      storage,
      3000,
      takeId,
      master({ format: "opus" }),
      { replace: true },
    );

    expect(result.outcome).toBe("reset");
    expect(result.asset.storageKey).toBe(`takes/${takeId}/master/lossy.opus`);
    // The old object would otherwise sit in the bucket forever, since the row
    // no longer names it.
    expect(deleted).toEqual([[`takes/${takeId}/master/lossy.mp3`]]);
    // Still ONE row: a format change is the same slot, not a second master.
    expect(await assetsRepo.listByTake(db, takeId)).toHaveLength(1);
  });

  it("treats a different tier as a different slot, not a collision", async () => {
    const takeId = await seedTake(db);
    const { storage } = recordingStorage();

    await resolveSlotForUpload(db, storage, 2000, takeId, master(), { replace: true });
    const lossless = await resolveSlotForUpload(
      db,
      storage,
      3000,
      takeId,
      master({ tier: "lossless", format: "flac" }),
      { replace: false },
    );

    expect(lossless.outcome).toBe("created");
    expect(await assetsRepo.listByTake(db, takeId)).toHaveLength(2);
  });

  it("treats each instrument's stem as its own slot", async () => {
    const takeId = await seedTake(db);
    const { storage } = recordingStorage();
    // Real instrument rows: `createTestDb` enforces foreign keys, which the
    // app runtime deliberately does not (it stays off for D1 parity), so this
    // suite is the stricter of the two.
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const drumKit = await instrumentsRepo.create(db, { slug: "drums", label: "Drums" });
    const stem = (id: string, slug: string): DeclaredAsset => ({
      kind: "stem",
      instrumentId: id,
      instrumentSlug: slug,
      tier: "lossy",
      format: "mp3",
      bytes: 500,
    });

    await resolveSlotForUpload(db, storage, 2000, takeId, stem(bass.id, "bass"), {
      replace: false,
    });
    const drums = await resolveSlotForUpload(db, storage, 3000, takeId, stem(drumKit.id, "drums"), {
      replace: false,
    });

    expect(drums.outcome).toBe("created");
    expect(await assetsRepo.listByTake(db, takeId)).toHaveLength(2);
  });

  it("reports a stem slot occupied when that instrument already has one", async () => {
    const takeId = await seedTake(db);
    const { storage } = recordingStorage();
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const declared: DeclaredAsset = {
      kind: "stem",
      instrumentId: bass.id,
      instrumentSlug: "bass",
      tier: "lossy",
      format: "mp3",
      bytes: 500,
    };

    await resolveSlotForUpload(db, storage, 2000, takeId, declared, { replace: false });
    const again = await resolveSlotForUpload(db, storage, 3000, takeId, declared, {
      replace: false,
    });

    expect(again.outcome).toBe("occupied");
    expect(await assetsRepo.listByTake(db, takeId)).toHaveLength(1);
  });
});

describe("canPublish", () => {
  const row = (over: Partial<assetsRepo.Asset>): assetsRepo.Asset =>
    ({ kind: "master", status: "ready", ...over }) as assetsRepo.Asset;

  it("is false for a take with nothing in it", () => {
    expect(canPublish([])).toBe(false);
  });

  it("is false while the only file is still uploading", () => {
    expect(canPublish([row({ status: "pending" })])).toBe(false);
  });

  it("is true for a ready master", () => {
    expect(canPublish([row({})])).toBe(true);
  });

  it("is true for a ready stem with no master — a stem is a recording", () => {
    expect(canPublish([row({ kind: "stem" })])).toBe(true);
  });

  it("is false for peaks alone — a waveform is not something to listen to", () => {
    expect(canPublish([row({ kind: "peaks" })])).toBe(false);
  });
});

describe("playableSources", () => {
  const row = (over: Partial<assetsRepo.Asset>): assetsRepo.Asset =>
    ({
      id: "a-1",
      kind: "master",
      status: "ready",
      tier: "lossy",
      instrumentId: null,
      ...over,
    }) as assetsRepo.Asset;

  it("is empty for a take with nothing on it", () => {
    expect(playableSources([])).toEqual([]);
  });

  it("skips anything not yet ready — half an upload is not a source", () => {
    expect(playableSources([row({ status: "pending" })])).toEqual([]);
  });

  it("skips peaks, which describe a source rather than being one", () => {
    expect(playableSources([row({ kind: "peaks" })])).toEqual([]);
  });

  it("collapses a take's two masters into ONE source, preferring the lossy", () => {
    // The lossy row wins because that is what `/assets/:id/audio` streams.
    // Listing both would offer the same performance twice under two names.
    const sources = playableSources([
      row({ id: "lossless", tier: "lossless", format: "flac" }),
      row({ id: "lossy", tier: "lossy", format: "mp3" }),
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.assetId).toBe("lossy");
  });

  it("prefers the lossy whichever order the rows arrive in", () => {
    const sources = playableSources([
      row({ id: "lossy", tier: "lossy" }),
      row({ id: "lossless", tier: "lossless" }),
    ]);
    expect(sources[0]?.assetId).toBe("lossy");
  });

  it("keeps a lossless-only source — one file you can play beats none", () => {
    const sources = playableSources([row({ id: "flac", tier: "lossless" })]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.assetId).toBe("flac");
  });

  it("treats two instruments as two sources, not one collapsed stem", () => {
    const sources = playableSources([
      row({ id: "bass", kind: "stem", instrumentId: "i-bass" }),
      row({ id: "gtr", kind: "stem", instrumentId: "i-gtr" }),
    ]);
    expect(sources.map((s) => s.assetId).sort()).toEqual(["bass", "gtr"]);
  });

  it("collapses the same instrument's two tiers into one source", () => {
    const sources = playableSources([
      row({ id: "bass-flac", kind: "stem", instrumentId: "i-bass", tier: "lossless" }),
      row({ id: "bass-mp3", kind: "stem", instrumentId: "i-bass", tier: "lossy" }),
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.assetId).toBe("bass-mp3");
  });

  it("puts the master first, so the order is stable for a caller that re-sorts", () => {
    const sources = playableSources([
      row({ id: "gtr", kind: "stem", instrumentId: "i-gtr" }),
      row({ id: "master" }),
      row({ id: "bass", kind: "stem", instrumentId: "i-bass" }),
    ]);
    expect(sources.map((s) => s.assetId)).toEqual(["master", "gtr", "bass"]);
  });

  it("carries the instrument id through, which is what names a stem later", () => {
    const sources = playableSources([row({ kind: "stem", instrumentId: "i-bass" })]);
    expect(sources[0]).toMatchObject({ kind: "stem", instrumentId: "i-bass", tier: "lossy" });
  });
});
