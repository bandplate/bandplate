import type { Db } from "@bandplate/db";
import {
  assetsRepo,
  eventsRepo,
  instrumentsRepo,
  membersRepo,
  songsRepo,
  takesRepo,
} from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { getSongDetail, listSongsForLibrary, parseSongsListQuery } from "./songs.js";

describe("parseSongsListQuery", () => {
  it("parses q and sort", () => {
    const params = new URLSearchParams("q=neon&sort=recent");
    expect(parseSongsListQuery(params)).toEqual({ search: "neon", sort: "recent" });
  });

  it("ignores an instrument param — that filter belongs to /search, which filters takes", () => {
    // A stale bookmark or a hand-edited URL must not resurrect the filter as a
    // silent, unshown restriction on the list.
    const params = new URLSearchParams("q=neon&instrument=abc&instrument=def");
    expect(parseSongsListQuery(params)).toEqual({ search: "neon", sort: undefined });
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
    });
  });
});

describe("listSongsForLibrary / getSongDetail", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("returns an empty song list, not a throw, on a fresh database", async () => {
    const { rows: result } = await listSongsForLibrary(db, {}, { limit: 25, offset: 0 });
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
});

describe("getSongDetail and the stash", () => {
  it("counts this member's private takes of the song, and nobody else's", async () => {
    const db = await createTestDb();
    const me = await membersRepo.create(db, {
      displayName: "Me",
      slug: "me",
      email: "me@example.com",
      createdAt: 1,
    });
    const them = await membersRepo.create(db, {
      displayName: "Them",
      slug: "them",
      email: "them@example.com",
      createdAt: 1,
    });
    const song = await songsRepo.create(db, {
      title: "Čoudy",
      slug: "coudy",
      createdAt: 1,
      updatedAt: 1,
    });
    const event = await eventsRepo.findOrCreatePersonal(db, {
      memberId: me.id,
      dayKey: "2026-09-19",
      heldAt: 1,
      now: 1,
    });
    for (const recordedAt of [1, 2]) {
      await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt,
        visibility: "private",
        ownerMemberId: me.id,
        createdAt: 1,
        updatedAt: 1,
      });
    }
    const mine = await getSongDetail(db, "coudy", me.id);
    expect(mine?.stashRows).toHaveLength(2);
    expect(mine?.takeTotal).toBe(0);
    expect((await getSongDetail(db, "coudy", them.id))?.stashRows).toEqual([]);
  });

  it("the song page's own stash section carries only the viewer's rows — another member sees none of it", async () => {
    const db = await createTestDb();
    const me = await membersRepo.create(db, {
      displayName: "Filip",
      slug: "filip",
      email: "filip@example.com",
      createdAt: 1,
    });
    const them = await membersRepo.create(db, {
      displayName: "Jana",
      slug: "jana",
      email: "jana@example.com",
      createdAt: 1,
    });
    const song = await songsRepo.create(db, {
      title: "Čoudy",
      slug: "coudy",
      createdAt: 1,
      updatedAt: 1,
    });
    const myEvent = await eventsRepo.findOrCreatePersonal(db, {
      memberId: me.id,
      dayKey: "2026-09-19",
      heldAt: 1,
      now: 1,
    });
    const myTake = await takesRepo.create(db, {
      songId: song.id,
      eventId: myEvent.id,
      recordedAt: 2,
      visibility: "private",
      ownerMemberId: me.id,
      label: "bridge idea",
      createdAt: 2,
      updatedAt: 2,
    });

    // The owner sees their own row, by id, with their own name attached for
    // the item sheet's "Kdo nahrál".
    const mine = await getSongDetail(db, "coudy", me.id);
    expect(mine?.stashRows.map((row) => row.id)).toEqual([myTake.id]);
    expect(mine?.stashOwnerName).toBe("Filip");

    // A different member of the band gets no row at all —
    // `takesRepo.listStash` scopes by owner AND `visibility='private'`, and
    // this is the loader test proving the song page's own query never leaks
    // around that.
    const theirs = await getSongDetail(db, "coudy", them.id);
    expect(theirs?.stashRows).toEqual([]);
  });
});
