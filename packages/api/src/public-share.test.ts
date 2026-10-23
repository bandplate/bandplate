import { peaksStorageKey, stemStorageKey } from "@bandplate/core";
import {
  assetsRepo,
  eventsRepo,
  instrumentsRepo,
  shareLinksRepo,
  songsRepo,
  takesRepo,
} from "@bandplate/db";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "./test-helpers.js";

/** A take with a ready master, a bass stem and the master's waveform, in one event. */
async function seedTake(testApp: TestApp, slug = "public-song", eventId?: string) {
  const now = testApp.clock.now();
  const song = await songsRepo.create(testApp.db, {
    title: `Song ${slug}`,
    slug,
    createdAt: now,
    updatedAt: now,
  });
  const event =
    eventId === undefined
      ? await eventsRepo.create(testApp.db, {
          kind: "rehearsal",
          heldAt: now,
          createdAt: now,
          updatedAt: now,
        })
      : undefined;
  const take = await takesRepo.create(testApp.db, {
    songId: song.id,
    eventId: eventId ?? (event?.id as string),
    state: "published",
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const bass = await instrumentsRepo.create(testApp.db, { slug: `bass-${slug}`, label: "Bass" });
  const ready = { status: "ready" as const, createdAt: now, readyAt: now, bytes: 1000 };
  const [master, stem, peaks] = await assetsRepo.createMany(testApp.db, [
    {
      ...ready,
      takeId: take.id,
      kind: "master",
      tier: "lossy",
      format: "mp3",
      storageKey: `takes/${take.id}/master/lossy.mp3`,
      contentType: "audio/mpeg",
    },
    {
      ...ready,
      takeId: take.id,
      kind: "stem",
      instrumentId: bass.id,
      tier: "lossy",
      format: "mp3",
      storageKey: stemStorageKey(take.id, "bass", "lossy", "mp3"),
      contentType: "audio/mpeg",
    },
    {
      ...ready,
      takeId: take.id,
      kind: "peaks",
      tier: "lossy",
      format: "json",
      storageKey: peaksStorageKey(take.id),
      contentType: "application/json",
    },
  ]);
  if (!master || !stem || !peaks) {
    throw new Error("expected createMany to return the inserted assets");
  }
  return { take, eventId: take.eventId, master, stem, peaks };
}

async function publicLink(
  testApp: TestApp,
  kind: shareLinksRepo.ShareKind,
  targetId: string,
): Promise<string> {
  const now = testApp.clock.now();
  const code = await shareLinksRepo.getOrCreate(testApp.db, kind, targetId, now);
  await shareLinksRepo.setPublic(testApp.db, kind, targetId, now);
  return code;
}

describe("public share routes", () => {
  let testApp: TestApp | undefined;

  afterEach(async () => {
    await testApp?.closeStorage();
    testApp = undefined;
  });

  const get = (path: string) => {
    if (!testApp) {
      throw new Error("no app");
    }
    return testApp.app.request(path, { redirect: "manual" });
  };

  describe("a public take link", () => {
    it("plays the take's master to a signed-out caller", async () => {
      testApp = await buildTestApp();
      const { take, master } = await seedTake(testApp);
      const code = await publicLink(testApp, "take", take.id);

      const res = await get(`/public/${code}/assets/${master.id}/audio`);

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("lossy.mp3");
      expect(res.headers.get("cache-control")).toBe("private, max-age=1800");
    });

    it("draws the master's waveform", async () => {
      testApp = await buildTestApp();
      const { take, master } = await seedTake(testApp);
      const code = await publicLink(testApp, "take", take.id);

      const res = await get(`/public/${code}/assets/${master.id}/peaks`);

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("peaks");
    });

    it("lists the master alone as the take's sources, so no mixer is offered", async () => {
      testApp = await buildTestApp();
      const { take, master } = await seedTake(testApp);
      const code = await publicLink(testApp, "take", take.id);

      const res = await get(`/public/${code}/takes/${take.id}/sources`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        sources: [{ assetId: master.id, kind: "master", label: "Master", icon: null }],
      });
    });

    it("refuses a stem of the same take", async () => {
      testApp = await buildTestApp();
      const { take, stem } = await seedTake(testApp);
      const code = await publicLink(testApp, "take", take.id);

      expect((await get(`/public/${code}/assets/${stem.id}/audio`)).status).toBe(404);
    });

    it("refuses another take's master", async () => {
      testApp = await buildTestApp();
      const { take } = await seedTake(testApp);
      const other = await seedTake(testApp, "other-song");
      const code = await publicLink(testApp, "take", take.id);

      expect((await get(`/public/${code}/assets/${other.master.id}/audio`)).status).toBe(404);
      expect((await get(`/public/${code}/takes/${other.take.id}/sources`)).status).toBe(404);
    });

    it("stops answering the moment the link is a members' link again", async () => {
      testApp = await buildTestApp();
      const { take, master } = await seedTake(testApp);
      const code = await publicLink(testApp, "take", take.id);
      await shareLinksRepo.setPublic(testApp.db, "take", take.id, null);

      expect((await get(`/public/${code}/assets/${master.id}/audio`)).status).toBe(404);
    });

    it("refuses a master that is not ready", async () => {
      testApp = await buildTestApp();
      const { take, master } = await seedTake(testApp);
      const code = await publicLink(testApp, "take", take.id);
      const [pending] = await assetsRepo.createMany(testApp.db, [
        {
          takeId: take.id,
          kind: "master",
          tier: "lossless",
          format: "flac",
          storageKey: `takes/${take.id}/master/lossless.flac`,
          contentType: "audio/flac",
          bytes: 1000,
          status: "pending",
          createdAt: testApp.clock.now(),
        },
      ]);

      expect((await get(`/public/${code}/assets/${pending?.id}/audio`)).status).toBe(404);
      expect((await get(`/public/${code}/assets/${master.id}/audio`)).status).toBe(302);
    });

    it("never opens a private take, even with a public row pointing at it", async () => {
      testApp = await buildTestApp();
      const { eventId } = await seedTake(testApp);
      const now = testApp.clock.now();
      const stash = await takesRepo.create(testApp.db, {
        visibility: "private",
        ownerMemberId: "member-1",
        eventId,
        recordedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const [master] = await assetsRepo.createMany(testApp.db, [
        {
          takeId: stash.id,
          kind: "master",
          tier: "lossy",
          format: "mp3",
          storageKey: `takes/${stash.id}/master/lossy.mp3`,
          contentType: "audio/mpeg",
          bytes: 1000,
          status: "ready",
          createdAt: now,
          readyAt: now,
        },
      ]);
      const takeCode = await publicLink(testApp, "take", stash.id);
      const eventCode = await publicLink(testApp, "event", eventId);

      expect((await get(`/public/${takeCode}/assets/${master?.id}/audio`)).status).toBe(404);
      expect((await get(`/public/${eventCode}/assets/${master?.id}/audio`)).status).toBe(404);
    });
  });

  describe("a public event link", () => {
    it("plays the master of any band take of the event", async () => {
      testApp = await buildTestApp();
      const first = await seedTake(testApp);
      const second = await seedTake(testApp, "second-song", first.eventId);
      const code = await publicLink(testApp, "event", first.eventId);

      expect((await get(`/public/${code}/assets/${first.master.id}/audio`)).status).toBe(302);
      expect((await get(`/public/${code}/assets/${second.master.id}/audio`)).status).toBe(302);
    });

    it("refuses a take of another event", async () => {
      testApp = await buildTestApp();
      const mine = await seedTake(testApp);
      const elsewhere = await seedTake(testApp, "elsewhere");
      const code = await publicLink(testApp, "event", mine.eventId);

      expect((await get(`/public/${code}/assets/${elsewhere.master.id}/audio`)).status).toBe(404);
    });

    it("refuses everything once the event is archived", async () => {
      testApp = await buildTestApp();
      const { eventId, master } = await seedTake(testApp);
      const code = await publicLink(testApp, "event", eventId);
      await eventsRepo.update(testApp.db, eventId, {
        archivedAt: testApp.clock.now(),
        updatedAt: testApp.clock.now(),
      });

      expect((await get(`/public/${code}/assets/${master.id}/audio`)).status).toBe(404);
    });
  });

  it("refuses a draft take, by its own link or its event's", async () => {
    testApp = await buildTestApp();
    const { take, eventId, master } = await seedTake(testApp);
    await takesRepo.setState(testApp.db, take.id, "new", testApp.clock.now());
    const takeCode = await publicLink(testApp, "take", take.id);
    const eventCode = await publicLink(testApp, "event", eventId);

    expect((await get(`/public/${takeCode}/assets/${master.id}/audio`)).status).toBe(404);
    expect((await get(`/public/${eventCode}/assets/${master.id}/audio`)).status).toBe(404);
    expect((await get(`/public/${eventCode}/takes/${take.id}/sources`)).status).toBe(404);
  });

  it("a song link opens nothing here, public or not", async () => {
    testApp = await buildTestApp();
    const { take, master } = await seedTake(testApp);
    const code = await publicLink(testApp, "song", take.songId as string);

    expect((await get(`/public/${code}/assets/${master.id}/audio`)).status).toBe(404);
  });

  it("a members' link, an unknown code and a malformed one all get the same 404", async () => {
    testApp = await buildTestApp();
    const { take, master } = await seedTake(testApp);
    const members = await shareLinksRepo.getOrCreate(testApp.db, "take", take.id, 0);

    for (const code of [members, "zzzzzzzzzz", "nope"]) {
      const res = await get(`/public/${code}/assets/${master.id}/audio`);
      expect(res.status).toBe(404);
    }
  });

  it("declares its routes public, and the member audio route still refuses anyone signed out", async () => {
    testApp = await buildTestApp();
    const routes = testApp.router.registry.filter((r) => r.path.startsWith("/public/"));
    expect(routes.map((r) => r.path).sort()).toEqual([
      "/public/:code/assets/:id/audio",
      "/public/:code/assets/:id/peaks",
      "/public/:code/takes/:id/sources",
    ]);
    expect(routes.every((r) => "public" in r.guard)).toBe(true);

    const { master } = await seedTake(testApp);
    expect((await get(`/assets/${master.id}/audio`)).status).toBe(403);
  });
});
