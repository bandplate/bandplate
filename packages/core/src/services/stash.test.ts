import { type Db, assetsRepo, eventsRepo, songsRepo, takesRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { STASH_CLIENT_REF_PREFIX, createStashTake } from "./stash.js";

describe("createStashTake", () => {
  let db: Db;
  let songId: string;

  beforeEach(async () => {
    db = await createTestDb();
    songId = (
      await songsRepo.create(db, { title: "Čoudy", slug: "coudy", createdAt: 1, updatedAt: 1 })
    ).id;
  });

  const input = (over: Partial<Parameters<typeof createStashTake>[3]> = {}) => ({
    clientRef: "local-1",
    songId,
    label: "bridge idea",
    // 22:30 UTC on the 18th is 00:30 on the 19th in Prague.
    recordedAt: Date.parse("2026-09-18T22:30:00Z"),
    durationMs: 42_000,
    ...over,
  });

  it("files a private take in the member's personal event for that Prague day", async () => {
    const result = await createStashTake(db, 5_000, "m-1", input());
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.created).toBe(true);
    expect(result.masterReady).toBe(false);
    expect(result.take.visibility).toBe("private");
    expect(result.take.ownerMemberId).toBe("m-1");
    expect(result.take.state).toBe("uploading");
    expect(result.take.clientRef).toBe(`${STASH_CLIENT_REF_PREFIX}local-1`);
    expect(result.take.label).toBe("bridge idea");
    expect(result.take.durationMs).toBe(42_000);

    const event = await eventsRepo.getById(db, result.take.eventId);
    expect(event?.kind).toBe("personal");
    expect(event?.ownerMemberId).toBe("m-1");
    expect(event?.clientRef).toBe(eventsRepo.personalEventClientRef("m-1", "2026-09-19"));

    // Later the same Prague day: same event.
    const second = await createStashTake(
      db,
      6_000,
      "m-1",
      input({ clientRef: "local-2", recordedAt: Date.parse("2026-09-19T10:00:00Z") }),
    );
    if (second.kind !== "ok") throw new Error(second.kind);
    expect(second.take.eventId).toBe(result.take.eventId);
  });

  it("is idempotent on clientRef — a retry after a lost response gets the same take", async () => {
    const first = await createStashTake(db, 5_000, "m-1", input());
    const retry = await createStashTake(db, 9_000, "m-1", input());
    if (first.kind !== "ok" || retry.kind !== "ok") throw new Error("expected ok");
    expect(retry.created).toBe(false);
    expect(retry.take.id).toBe(first.take.id);
    expect(await takesRepo.countStash(db, "m-1")).toBe(1);
  });

  it("refuses a clientRef another member already used", async () => {
    await createStashTake(db, 5_000, "m-1", input());
    expect((await createStashTake(db, 5_000, "m-2", input())).kind).toBe("conflict");
  });

  it("refuses a song that does not exist, and creates no event", async () => {
    expect((await createStashTake(db, 5_000, "m-1", input({ songId: "nope" }))).kind).toBe(
      "song_not_found",
    );
    expect(
      await eventsRepo.getByClientRef(db, eventsRepo.personalEventClientRef("m-1", "2026-09-19")),
    ).toBeUndefined();
  });

  it("reports masterReady on a retry once the recording has landed", async () => {
    const first = await createStashTake(db, 5_000, "m-1", input());
    if (first.kind !== "ok") throw new Error(first.kind);
    const [asset] = await assetsRepo.createMany(db, [
      {
        takeId: first.take.id,
        kind: "master",
        instrumentId: null,
        tier: "lossy",
        format: "webm",
        storageKey: `takes/${first.take.id}/master/lossy.webm`,
        contentType: "audio/webm",
        bytes: 10,
        sha256: null,
        durationMs: 42_000,
        sampleRate: null,
        channels: null,
        status: "pending",
        createdAt: 5_000,
      },
    ]);
    if (!asset) throw new Error("no asset");
    await assetsRepo.markReady(db, asset.id, 6_000, { durationMs: 42_000 });

    const retry = await createStashTake(db, 7_000, "m-1", input());
    if (retry.kind !== "ok") throw new Error(retry.kind);
    expect(retry.masterReady).toBe(true);
  });
});
