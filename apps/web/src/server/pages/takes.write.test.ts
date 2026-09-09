// The M8 write half of `server/pages/takes.ts` — a take as a container you
// create empty and fill later.
import type { Storage, StoredObject } from "@bandplate/core";
import type { Db } from "@bandplate/db";
import { assetsRepo, eventsRepo, instrumentsRepo, songsRepo, takesRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { createTake, deleteTake, setTakePublished, updateTake } from "./takes.js";

function formData(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        fd.append(key, v);
      }
    } else {
      fd.set(key, value);
    }
  }
  return fd;
}

function recordingStorage(): { storage: Storage; deleted: string[][] } {
  const deleted: string[][] = [];
  const storage: Storage = {
    signedUploadUrl: async () => "https://bucket.example/signed",
    signedDownloadUrl: async () => "https://bucket.example/signed",
    head: async (): Promise<StoredObject | null> => null,
    delete: async (keys) => {
      deleted.push(keys);
    },
    put: async () => {},
  };
  return { storage, deleted };
}

let db: Db;
let songId: string;
let otherSongId: string;
let eventId: string;
let bassId: string;
let drumsId: string;

beforeEach(async () => {
  db = await createTestDb();
  songId = (
    await songsRepo.create(db, {
      title: "Neon Skyline",
      slug: "neon-skyline",
      createdAt: 1000,
      updatedAt: 1000,
    })
  ).id;
  otherSongId = (
    await songsRepo.create(db, {
      title: "Nightbus",
      slug: "nightbus",
      createdAt: 1000,
      updatedAt: 1000,
    })
  ).id;
  eventId = (
    await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    })
  ).id;
  bassId = (await instrumentsRepo.create(db, { slug: "bass", label: "Bass" })).id;
  drumsId = (await instrumentsRepo.create(db, { slug: "drums", label: "Drums" })).id;
});

function base(over: Record<string, string | string[]> = {}) {
  return formData({
    songId,
    eventId,
    recordedAt: "2026-07-08",
    label: "",
    notes: "",
    ...over,
  });
}

describe("createTake", () => {
  it("creates an EMPTY container in the uploading state", async () => {
    const result = await createTake(db, 2000, base({ label: "take 1" }));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.take.songId).toBe(songId);
    expect(result.take.eventId).toBe(eventId);
    expect(result.take.label).toBe("take 1");
    // Nothing in it yet, and the state says so. Unlike ingest, no asset is
    // required up front — see `createTake`'s doc comment.
    expect(result.take.state).toBe("uploading");
    expect(await assetsRepo.listByTake(db, result.take.id)).toEqual([]);
  });

  it("has no clientRef — that key is the bridge's", async () => {
    const result = await createTake(db, 2000, base());
    if (result.kind !== "ok") return;
    expect(result.take.clientRef).toBeNull();
  });

  it("files the recorded date at LOCAL midnight on the day typed", async () => {
    const result = await createTake(db, 2000, base());
    if (result.kind !== "ok") return;
    const at = new Date(result.take.recordedAt);
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours()]).toEqual([2026, 6, 8, 0]);
  });

  it("attaches the instruments that were ticked", async () => {
    const result = await createTake(db, 2000, base({ instrumentIds: [bassId, drumsId] }));
    if (result.kind !== "ok") return;

    const byTake = await takesRepo.listInstrumentsForTakes(db, [result.take.id]);
    expect((byTake.get(result.take.id) ?? []).map((i) => i.slug).sort()).toEqual(["bass", "drums"]);
  });

  it("drops an instrument id that no longer exists rather than refusing the take", async () => {
    // A form left open across an admin change is a stale page, not an attack,
    // and losing one checkbox beats losing the take.
    const result = await createTake(db, 2000, base({ instrumentIds: [bassId, "gone"] }));
    if (result.kind !== "ok") return;

    const byTake = await takesRepo.listInstrumentsForTakes(db, [result.take.id]);
    expect((byTake.get(result.take.id) ?? []).map((i) => i.slug)).toEqual(["bass"]);
  });

  it("reports an unknown song against the song field", async () => {
    const result = await createTake(db, 2000, base({ songId: "nope" }));
    expect(result).toEqual({ kind: "unknown_parent", field: "songId" });
  });

  it("reports an unknown event against the event field", async () => {
    const result = await createTake(db, 2000, base({ eventId: "nope" }));
    expect(result).toEqual({ kind: "unknown_parent", field: "eventId" });
  });

  it("rejects a missing date", async () => {
    const result = await createTake(db, 2000, base({ recordedAt: "" }));
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.field).toBe("recordedAt");
  });
});

describe("updateTake", () => {
  let takeId: string;

  beforeEach(async () => {
    const created = await createTake(db, 2000, base({ label: "take 1", instrumentIds: [bassId] }));
    if (created.kind !== "ok") throw new Error("seed failed");
    takeId = created.take.id;
  });

  it("moves a take to a different song", async () => {
    const result = await updateTake(db, 3000, takeId, base({ songId: otherSongId }));

    expect(result.kind).toBe("ok");
    expect((await takesRepo.getById(db, takeId))?.songId).toBe(otherSongId);
  });

  it("replaces the instrument set", async () => {
    await updateTake(db, 3000, takeId, base({ instrumentIds: [drumsId] }));

    const byTake = await takesRepo.listInstrumentsForTakes(db, [takeId]);
    expect((byTake.get(takeId) ?? []).map((i) => i.slug)).toEqual(["drums"]);
  });

  it("clears the instrument set when nothing is ticked", async () => {
    await updateTake(db, 3000, takeId, base({}));

    const byTake = await takesRepo.listInstrumentsForTakes(db, [takeId]);
    expect(byTake.get(takeId) ?? []).toEqual([]);
  });

  it("keeps the take on its own event — the sheet does not offer to move it", async () => {
    const elsewhere = await eventsRepo.create(db, {
      kind: "concert",
      heldAt: 9000,
      createdAt: 9000,
      updatedAt: 9000,
    });

    // Even when a hand-built POST names another event.
    await updateTake(db, 3000, takeId, base({ eventId: elsewhere.id }));

    expect((await takesRepo.getById(db, takeId))?.eventId).toBe(eventId);
  });

  it("reports not_found for an id that isn't there", async () => {
    expect(await updateTake(db, 3000, "nope", base())).toEqual({ kind: "not_found" });
  });
});

describe("setTakePublished", () => {
  let takeId: string;

  beforeEach(async () => {
    const created = await createTake(db, 2000, base());
    if (created.kind !== "ok") throw new Error("seed failed");
    takeId = created.take.id;
  });

  async function addAsset(status: assetsRepo.AssetStatus, kind: assetsRepo.AssetKind = "master") {
    await assetsRepo.createMany(db, [
      {
        takeId,
        kind,
        tier: "lossy",
        format: kind === "peaks" ? "json" : "mp3",
        storageKey: `takes/${takeId}/${kind}/lossy.${kind === "peaks" ? "json" : "mp3"}`,
        contentType: "audio/mpeg",
        bytes: 100,
        status,
        createdAt: 2000,
      },
    ]);
  }

  it("refuses to publish a take with nothing on it", async () => {
    expect(await setTakePublished(db, 3000, takeId, true)).toEqual({ kind: "nothing_to_play" });
    expect((await takesRepo.getById(db, takeId))?.state).toBe("uploading");
  });

  it("refuses while the only file is still uploading", async () => {
    await addAsset("pending");
    expect(await setTakePublished(db, 3000, takeId, true)).toEqual({ kind: "nothing_to_play" });
  });

  it("refuses on peaks alone — a waveform is not something to listen to", async () => {
    await addAsset("ready", "peaks");
    expect(await setTakePublished(db, 3000, takeId, true)).toEqual({ kind: "nothing_to_play" });
  });

  it("publishes once something is ready, stamping publishedAt", async () => {
    await addAsset("ready");

    const result = await setTakePublished(db, 3000, takeId, true);

    expect(result.kind).toBe("ok");
    const after = await takesRepo.getById(db, takeId);
    expect(after?.state).toBe("published");
    expect(after?.publishedAt).toBe(3000);
  });

  it("un-publishes back to new, clearing publishedAt", async () => {
    await addAsset("ready");
    await setTakePublished(db, 3000, takeId, true);

    await setTakePublished(db, 4000, takeId, false);

    const after = await takesRepo.getById(db, takeId);
    expect(after?.state).toBe("new");
    expect(after?.publishedAt).toBeNull();
  });

  it("reports not_found for an id that isn't there", async () => {
    expect(await setTakePublished(db, 3000, "nope", true)).toEqual({ kind: "not_found" });
  });
});

describe("deleteTake", () => {
  it("removes the take, its rows, and its objects", async () => {
    const created = await createTake(db, 2000, base({ instrumentIds: [bassId] }));
    if (created.kind !== "ok") throw new Error("seed failed");
    const takeId = created.take.id;
    await assetsRepo.createMany(db, [
      {
        takeId,
        kind: "master",
        tier: "lossy",
        format: "mp3",
        storageKey: `takes/${takeId}/master/lossy.mp3`,
        contentType: "audio/mpeg",
        bytes: 100,
        createdAt: 2000,
      },
    ]);
    const { storage, deleted } = recordingStorage();

    const result = await deleteTake(db, storage, takeId);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.deletedAssets).toBe(1);
    expect(await takesRepo.getById(db, takeId)).toBeUndefined();
    expect(await assetsRepo.listByTake(db, takeId)).toEqual([]);
    expect(deleted).toEqual([[`takes/${takeId}/master/lossy.mp3`]]);
  });

  it("still deletes the row when the bucket refuses", async () => {
    const created = await createTake(db, 2000, base());
    if (created.kind !== "ok") throw new Error("seed failed");
    const takeId = created.take.id;
    await assetsRepo.createMany(db, [
      {
        takeId,
        kind: "master",
        tier: "lossy",
        format: "mp3",
        storageKey: `takes/${takeId}/master/lossy.mp3`,
        contentType: "audio/mpeg",
        bytes: 100,
        createdAt: 2000,
      },
    ]);
    const storage: Storage = {
      ...recordingStorage().storage,
      delete: async () => {
        throw new Error("bucket unreachable");
      },
    };

    // DB first, bucket best-effort: a storage failure leaves a stray object,
    // never a row pointing at nothing.
    const result = await deleteTake(db, storage, takeId);

    expect(result.kind).toBe("ok");
    expect(await takesRepo.getById(db, takeId)).toBeUndefined();
  });

  it("reports not_found for an id that isn't there", async () => {
    const { storage } = recordingStorage();
    expect(await deleteTake(db, storage, "nope")).toEqual({ kind: "not_found" });
  });
});
