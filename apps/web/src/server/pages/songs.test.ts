import type { Db } from "@bandlib/db";
import { assetsRepo, eventsRepo, instrumentsRepo, songsRepo, takesRepo } from "@bandlib/db";
import { createTestDb } from "@bandlib/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { getSongDetail, listSongsForLibrary, parseSongsListQuery } from "./songs.js";

describe("parseSongsListQuery", () => {
  it("parses q, sort, and repeated instrument params", () => {
    const params = new URLSearchParams("q=neon&sort=recent&instrument=abc&instrument=def");
    expect(parseSongsListQuery(params)).toEqual({
      search: "neon",
      sort: "recent",
      instrumentIds: ["abc", "def"],
    });
  });

  it("dedupes repeated instrument ids — listByInstruments returns nothing for duplicates", () => {
    const params = new URLSearchParams("instrument=abc&instrument=abc");
    expect(parseSongsListQuery(params).instrumentIds).toEqual(["abc"]);
  });

  it("ignores an invalid sort value rather than passing it through", () => {
    const params = new URLSearchParams("sort=nonsense");
    expect(parseSongsListQuery(params).sort).toBeUndefined();
  });

  it("treats a blank q as no search", () => {
    const params = new URLSearchParams("q=   ");
    expect(parseSongsListQuery(params).search).toBeUndefined();
  });

  it("defaults to an empty query for no params at all", () => {
    expect(parseSongsListQuery(new URLSearchParams())).toEqual({
      search: undefined,
      sort: undefined,
      instrumentIds: [],
    });
  });
});

describe("listSongsForLibrary / getSongDetail", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("returns an empty song list, not a throw, on a fresh database", async () => {
    const result = await listSongsForLibrary(db, { instrumentIds: [] });
    expect(result).toEqual([]);
  });

  it("getSongDetail returns undefined for an unknown slug (a 404, not a throw)", async () => {
    const result = await getSongDetail(db, "does-not-exist", "member-1");
    expect(result).toBeUndefined();
  });

  it("getSongDetail renders a real empty state's data: a song with zero takes", async () => {
    const now = Date.now();
    await songsRepo.create(db, {
      title: "Stub Song",
      slug: "stub-song",
      isStub: true,
      createdAt: now,
      updatedAt: now,
    });

    const detail = await getSongDetail(db, "stub-song", "member-1");
    expect(detail?.takes).toEqual([]);
    expect(detail?.song.isStub).toBe(true);
  });

  it("getSongDetail returns takes newest first, each with its instruments and event", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Detail Song",
      slug: "detail-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });

    const older = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      instrumentIds: [bass.id],
    });
    const newer = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: 5000,
      createdAt: 5000,
      updatedAt: 5000,
      instrumentIds: [bass.id],
    });

    const detail = await getSongDetail(db, "detail-song", "member-1");
    expect(detail?.takes.map((t) => t.id)).toEqual([newer.id, older.id]);
    expect(detail?.takes[0]?.instruments.map((i) => i.slug)).toEqual(["bass"]);
    expect(detail?.takes[0]?.event?.id).toBe(event.id);
  });

  it("getSongDetail attaches playableAssetId for a take with a ready master, and leaves it undefined otherwise", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Playable Song",
      slug: "playable-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const playable = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const [masterAsset] = await assetsRepo.createMany(db, [
      {
        takeId: playable.id,
        kind: "master",
        tier: "lossy",
        format: "mp3",
        storageKey: `takes/${playable.id}/master/lossy.mp3`,
        contentType: "audio/mpeg",
        bytes: 1000,
        status: "ready",
        createdAt: now,
        readyAt: now,
      },
    ]);

    const silent = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const detail = await getSongDetail(db, "playable-song", "member-1");
    const playableTake = detail?.takes.find((t) => t.id === playable.id);
    const silentTake = detail?.takes.find((t) => t.id === silent.id);
    expect(playableTake?.playableAssetId).toBe(masterAsset?.id);
    expect(silentTake?.playableAssetId).toBeUndefined();
  });

  it("listSongsForLibrary applies the instrument AND filter through to real results", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Filtered Song",
      slug: "filtered-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const drums = await instrumentsRepo.create(db, { slug: "drums", label: "Drums" });
    await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bass.id],
    });

    const matches = await listSongsForLibrary(db, { instrumentIds: [bass.id] });
    expect(matches.map((s) => s.slug)).toEqual(["filtered-song"]);

    const noMatches = await listSongsForLibrary(db, { instrumentIds: [bass.id, drums.id] });
    expect(noMatches).toEqual([]);
  });
});
