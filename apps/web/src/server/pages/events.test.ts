import type { Db } from "@bandplate/db";
import { assetsRepo, eventsRepo, instrumentsRepo, songsRepo, takesRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { getEventDetail, listEventsForArchive, parseEventsListKindFilter } from "./events.js";

describe("parseEventsListKindFilter", () => {
  it("parses repeated kind params", () => {
    const params = new URLSearchParams("kind=concert&kind=session");
    expect(parseEventsListKindFilter(params)).toEqual(["concert", "session"]);
  });

  it("drops an invalid kind value rather than passing it through to the query", () => {
    const params = new URLSearchParams("kind=concert&kind=not-a-real-kind");
    expect(parseEventsListKindFilter(params)).toEqual(["concert"]);
  });

  it("dedupes a repeated kind", () => {
    const params = new URLSearchParams("kind=concert&kind=concert");
    expect(parseEventsListKindFilter(params)).toEqual(["concert"]);
  });

  it("returns an empty array (no filter) for no kind param", () => {
    expect(parseEventsListKindFilter(new URLSearchParams())).toEqual([]);
  });
});

describe("listEventsForArchive / getEventDetail", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("lists rehearsals and concerts together, newest first, with no filter", async () => {
    const rehearsal = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const concert = await eventsRepo.create(db, {
      kind: "concert",
      heldAt: 2000,
      createdAt: 2000,
      updatedAt: 2000,
    });

    const events = await listEventsForArchive(db, []);
    expect(events.map((e) => e.id)).toEqual([concert.id, rehearsal.id]);
  });

  it("filters to only the requested kinds", async () => {
    await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const concert = await eventsRepo.create(db, {
      kind: "concert",
      heldAt: 2000,
      createdAt: 2000,
      updatedAt: 2000,
    });

    const events = await listEventsForArchive(db, ["concert"]);
    expect(events.map((e) => e.id)).toEqual([concert.id]);
  });

  it("getEventDetail returns undefined for an unknown id (a 404, not a throw)", async () => {
    const result = await getEventDetail(db, "00000000-0000-0000-0000-000000000000", "member-1");
    expect(result).toBeUndefined();
  });

  it("getEventDetail renders a real empty state's data: an event with zero takes", async () => {
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });

    const detail = await getEventDetail(db, event.id, "member-1");
    expect(detail?.takes).toEqual([]);
  });

  it("getEventDetail returns takes in RECORDED order (asc), not newest-first, each with its song", async () => {
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const song = await songsRepo.create(db, {
      title: "Session Song",
      slug: "session-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });

    const first = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      instrumentIds: [bass.id],
    });
    const second = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: 2000,
      createdAt: 2000,
      updatedAt: 2000,
    });

    const detail = await getEventDetail(db, event.id, "member-1");
    expect(detail?.takes.map((t) => t.id)).toEqual([first.id, second.id]);
    expect(detail?.takes[0]?.song?.slug).toBe("session-song");
    expect(detail?.takes[0]?.instruments.map((i) => i.slug)).toEqual(["bass"]);
    // `first` has no assets at all — no play control.
    expect(detail?.takes[0]?.playableAssetId).toBeUndefined();
  });

  it("getEventDetail attaches playableAssetId for a take with a ready master", async () => {
    const event = await eventsRepo.create(db, {
      kind: "concert",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const song = await songsRepo.create(db, {
      title: "Concert Song",
      slug: "concert-song",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const take = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const [masterAsset] = await assetsRepo.createMany(db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossy",
        format: "mp3",
        storageKey: `takes/${take.id}/master/lossy.mp3`,
        contentType: "audio/mpeg",
        bytes: 1000,
        status: "ready",
        createdAt: 1000,
        readyAt: 1000,
      },
    ]);

    const detail = await getEventDetail(db, event.id, "member-1");
    expect(detail?.takes[0]?.playableAssetId).toBe(masterAsset?.id);
  });
});
