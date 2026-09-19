// The stash over HTTP: creating a private take from a cookie session, and the
// rule that nobody but its owner can reach one — not by id, not through the
// audio routes, not by voting or pinning it.
import { createServiceToken } from "@bandplate/core";
import { assetsRepo, eventsRepo, membersRepo, songsRepo, takesRepo } from "@bandplate/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  TEST_APP_ORIGIN,
  type TestApp,
  buildTestApp,
  extractLoginToken,
  extractSessionCookieValue,
  isWorkerdRuntime,
} from "./test-helpers.js";

const jsonHeaders = { "content-type": "application/json" };

let openApps: TestApp[] = [];

afterEach(async () => {
  for (const app of openApps) {
    await app.closeStorage();
  }
  openApps = [];
});

async function build(): Promise<TestApp> {
  const testApp = await buildTestApp();
  openApps.push(testApp);
  return testApp;
}

async function signIn(
  testApp: TestApp,
  slug: string,
): Promise<{ cookie: string; memberId: string }> {
  const email = `${slug}@example.com`;
  const member = await membersRepo.create(testApp.db, {
    displayName: slug,
    slug,
    email,
    status: "active",
    createdAt: testApp.clock.now(),
  });
  await testApp.app.request("/auth/login", {
    method: "POST",
    headers: { ...jsonHeaders, origin: TEST_APP_ORIGIN },
    body: JSON.stringify({ email }),
  });
  const token = extractLoginToken(testApp.mailer);
  const res = await testApp.app.request(`/auth/login/${token}`, {
    method: "POST",
    headers: { origin: TEST_APP_ORIGIN },
  });
  return {
    cookie: `bp_session=${extractSessionCookieValue(res.headers.get("set-cookie"))}`,
    memberId: member.id,
  };
}

function post(testApp: TestApp, path: string, cookie: string, body: unknown) {
  return testApp.app.request(path, {
    method: "POST",
    headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
    body: JSON.stringify(body),
  });
}

async function seedSong(testApp: TestApp) {
  const now = testApp.clock.now();
  return songsRepo.create(testApp.db, {
    title: "Neon Skyline",
    slug: "neon-skyline",
    createdAt: now,
    updatedAt: now,
  });
}

function stashBody(songId: string, over: Record<string, unknown> = {}) {
  return {
    clientRef: "0192f5b8-local-recording",
    songId,
    label: "bridge idea",
    recordedAt: 1_700_000_000_000,
    durationMs: 42_000,
    ...over,
  };
}

/** A ready webm master on a take, written straight to the repo. */
async function readyMaster(testApp: TestApp, takeId: string) {
  const [asset] = await assetsRepo.createMany(testApp.db, [
    {
      takeId,
      kind: "master",
      instrumentId: null,
      tier: "lossy",
      format: "webm",
      storageKey: `takes/${takeId}/master/lossy.webm`,
      contentType: "audio/webm",
      bytes: 12,
      sha256: null,
      durationMs: 42_000,
      sampleRate: null,
      channels: null,
      status: "pending",
      createdAt: testApp.clock.now(),
    },
  ]);
  if (!asset) throw new Error("no asset");
  await assetsRepo.markReady(testApp.db, asset.id, testApp.clock.now(), { durationMs: 42_000 });
  return asset;
}

describe("POST /stash/takes", () => {
  it("files a private take in the member's personal event", async () => {
    const testApp = await build();
    const song = await seedSong(testApp);
    const { cookie, memberId } = await signIn(testApp, "robin");

    const res = await post(testApp, "/stash/takes", cookie, stashBody(song.id));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.masterReady).toBe(false);

    const take = await takesRepo.getById(testApp.db, body.takeId);
    expect(take?.visibility).toBe("private");
    expect(take?.ownerMemberId).toBe(memberId);
    const event = take ? await eventsRepo.getById(testApp.db, take.eventId) : undefined;
    expect(event?.kind).toBe("personal");
    expect(event?.ownerMemberId).toBe(memberId);
  });

  it("answers a retry with the same take, 200 instead of 201", async () => {
    const testApp = await build();
    const song = await seedSong(testApp);
    const { cookie } = await signIn(testApp, "robin");
    const first = await (await post(testApp, "/stash/takes", cookie, stashBody(song.id))).json();
    const retry = await post(testApp, "/stash/takes", cookie, stashBody(song.id));
    expect(retry.status).toBe(200);
    const body = await retry.json();
    expect(body.takeId).toBe(first.takeId);
    expect(body.created).toBe(false);
  });

  it("reports masterReady once the recording has landed", async () => {
    const testApp = await build();
    const song = await seedSong(testApp);
    const { cookie } = await signIn(testApp, "robin");
    const first = await (await post(testApp, "/stash/takes", cookie, stashBody(song.id))).json();
    await readyMaster(testApp, first.takeId);
    const retry = await (await post(testApp, "/stash/takes", cookie, stashBody(song.id))).json();
    expect(retry.masterReady).toBe(true);
  });

  it("404s a song that does not exist", async () => {
    const testApp = await build();
    const { cookie } = await signIn(testApp, "robin");
    const res = await post(testApp, "/stash/takes", cookie, stashBody("nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("song_not_found");
  });

  it("409s a clientRef another member already used", async () => {
    const testApp = await build();
    const song = await seedSong(testApp);
    const robin = await signIn(testApp, "robin");
    const sam = await signIn(testApp, "sam");
    await post(testApp, "/stash/takes", robin.cookie, stashBody(song.id));
    const res = await post(testApp, "/stash/takes", sam.cookie, stashBody(song.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("client_ref_taken");
  });

  it("422s a body with no song", async () => {
    const testApp = await build();
    const { cookie } = await signIn(testApp, "robin");
    const res = await post(testApp, "/stash/takes", cookie, {
      clientRef: "0192f5b8-local",
      recordedAt: 1,
    });
    expect(res.status).toBe(422);
  });

  it("403s a service token, even one holding takes:write — only a member has a stash", async () => {
    const testApp = await build();
    const song = await seedSong(testApp);
    const created = await createServiceToken(
      { db: testApp.db, mailer: testApp.mailer, clock: testApp.clock },
      { label: "bridge", scopes: ["takes:write"] },
    );
    const res = await testApp.app.request("/stash/takes", {
      method: "POST",
      headers: { ...jsonHeaders, authorization: `Bearer ${created.rawToken}` },
      body: JSON.stringify(stashBody(song.id)),
    });
    expect(res.status).toBe(403);
  });
});

describe("a private take is its owner's alone", () => {
  async function stashed(testApp: TestApp) {
    const song = await seedSong(testApp);
    const robin = await signIn(testApp, "robin");
    const sam = await signIn(testApp, "sam");
    const { takeId } = await (
      await post(testApp, "/stash/takes", robin.cookie, stashBody(song.id))
    ).json();
    return { robin, sam, takeId: takeId as string };
  }

  it("another member cannot declare a file on it", async () => {
    const testApp = await build();
    const { sam, takeId } = await stashed(testApp);
    const res = await post(testApp, `/takes/${takeId}/assets`, sam.cookie, {
      kind: "master",
      tier: "lossy",
      format: "webm",
      bytes: 12,
    });
    expect(res.status).toBe(404);
  });

  it("another member gets 404 from sources; the owner gets the list", async () => {
    const testApp = await build();
    const { robin, sam, takeId } = await stashed(testApp);
    await readyMaster(testApp, takeId);
    expect(
      (await testApp.app.request(`/takes/${takeId}/sources`, { headers: { cookie: sam.cookie } }))
        .status,
    ).toBe(404);
    expect(
      (await testApp.app.request(`/takes/${takeId}/sources`, { headers: { cookie: robin.cookie } }))
        .status,
    ).toBe(200);
  });

  it("nobody else can vote on it or pin it, and nobody votes on it once it is published", async () => {
    const testApp = await build();
    const { robin, sam, takeId } = await stashed(testApp);
    expect((await post(testApp, "/votes", sam.cookie, { takeId, keeper: true })).status).toBe(404);
    expect(
      (await post(testApp, "/favorites", sam.cookie, { targetType: "take", targetId: takeId }))
        .status,
    ).toBe(404);

    await takesRepo.publishFromStash(testApp.db, takeId, robin.memberId, testApp.clock.now());
    const vote = await post(testApp, "/votes", sam.cookie, { takeId, keeper: true });
    expect(vote.status).toBe(409);
    expect((await vote.json()).error.code).toBe("not_votable");
  });

  describe.skipIf(isWorkerdRuntime)("against a real bucket", () => {
    it("the owner uploads a webm master: declare, PUT, verify", async () => {
      const testApp = await build();
      const { robin, takeId } = await stashed(testApp);
      const declared = await post(testApp, `/takes/${takeId}/assets`, robin.cookie, {
        kind: "master",
        tier: "lossy",
        format: "webm",
        bytes: 12,
        durationMs: 42_000,
        replace: true,
      });
      expect(declared.status).toBe(200);
      const slot = await declared.json();
      expect(slot.headers["Content-Type"]).toBe("audio/webm");
      const put = await fetch(slot.url, {
        method: "PUT",
        headers: slot.headers,
        body: new Uint8Array(12).fill(7),
      });
      expect(put.status).toBe(200);
      const verified = await post(testApp, `/assets/${slot.assetId}/verify`, robin.cookie, {
        durationMs: 42_000,
      });
      expect(verified.status).toBe(200);
      expect((await assetsRepo.getById(testApp.db, slot.assetId))?.status).toBe("ready");
    });

    it("audio, peaks and download 404 for another member and redirect for the owner", async () => {
      const testApp = await build();
      const { robin, sam, takeId } = await stashed(testApp);
      const asset = await readyMaster(testApp, takeId);
      for (const path of [`/assets/${asset.id}/audio`, `/assets/${asset.id}/download`]) {
        expect((await testApp.app.request(path, { headers: { cookie: sam.cookie } })).status).toBe(
          404,
        );
        expect(
          (
            await testApp.app.request(path, {
              headers: { cookie: robin.cookie },
              redirect: "manual",
            })
          ).status,
        ).toBe(302);
      }
      // No peaks exist for a stash take; what matters is that a stranger gets
      // the same 404 whether or not they do.
      expect(
        (
          await testApp.app.request(`/assets/${asset.id}/peaks`, {
            headers: { cookie: sam.cookie },
          })
        ).status,
      ).toBe(404);
    });
  });
});
