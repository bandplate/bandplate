// The stash over HTTP: creating a private take from a cookie session, and the
// rule that nobody but its owner can reach one — not by id, not through the
// audio routes, not by voting or pinning it.
import { createServiceToken } from "@bandplate/core";
import { assetsRepo, eventsRepo, membersRepo, songsRepo, takesRepo } from "@bandplate/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildTestApp,
  extractLoginToken,
  extractSessionCookieValue,
  isWorkerdRuntime,
  TEST_APP_ORIGIN,
  type TestApp,
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

function stashBody(songId: string | null, memberId: string, over: Record<string, unknown> = {}) {
  return {
    clientRef: "0192f5b8-local-recording",
    memberId,
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

    const res = await post(testApp, "/stash/takes", cookie, stashBody(song.id, memberId));
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
    const { cookie, memberId } = await signIn(testApp, "robin");
    const first = await (
      await post(testApp, "/stash/takes", cookie, stashBody(song.id, memberId))
    ).json();
    const retry = await post(testApp, "/stash/takes", cookie, stashBody(song.id, memberId));
    expect(retry.status).toBe(200);
    const body = await retry.json();
    expect(body.takeId).toBe(first.takeId);
    expect(body.created).toBe(false);
  });

  it("reports masterReady once the recording has landed", async () => {
    const testApp = await build();
    const song = await seedSong(testApp);
    const { cookie, memberId } = await signIn(testApp, "robin");
    const first = await (
      await post(testApp, "/stash/takes", cookie, stashBody(song.id, memberId))
    ).json();
    await readyMaster(testApp, first.takeId);
    const retry = await (
      await post(testApp, "/stash/takes", cookie, stashBody(song.id, memberId))
    ).json();
    expect(retry.masterReady).toBe(true);
  });

  it("files a recording that has no song yet", async () => {
    // "Zatím bez písně": the song is chosen when the recording is added to
    // the band, so the create must take `songId` absent, not just null.
    const testApp = await build();
    const { cookie, memberId } = await signIn(testApp, "robin");

    const body = stashBody(null, memberId);
    body.songId = undefined as unknown as string;
    const res = await post(testApp, "/stash/takes", cookie, body);
    expect(res.status).toBe(201);

    const take = await takesRepo.getById(testApp.db, (await res.json()).takeId);
    expect(take?.songId).toBeNull();
    expect(take?.visibility).toBe("private");
    expect(take?.ownerMemberId).toBe(memberId);
    // It still gets its personal event, same as any other stash recording.
    const event = take ? await eventsRepo.getById(testApp.db, take.eventId) : undefined;
    expect(event?.kind).toBe("personal");
  });

  it("takes an explicit null song the same way", async () => {
    const testApp = await build();
    const { cookie, memberId } = await signIn(testApp, "robin");
    const res = await post(testApp, "/stash/takes", cookie, stashBody(null, memberId));
    expect(res.status).toBe(201);
    const take = await takesRepo.getById(testApp.db, (await res.json()).takeId);
    expect(take?.songId).toBeNull();
  });

  it("404s a song that does not exist", async () => {
    const testApp = await build();
    const { cookie, memberId } = await signIn(testApp, "robin");
    const res = await post(testApp, "/stash/takes", cookie, stashBody("nope", memberId));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("song_not_found");
  });

  it("409s a clientRef another member already used", async () => {
    const testApp = await build();
    const song = await seedSong(testApp);
    const robin = await signIn(testApp, "robin");
    const sam = await signIn(testApp, "sam");
    await post(testApp, "/stash/takes", robin.cookie, stashBody(song.id, robin.memberId));
    const res = await post(testApp, "/stash/takes", sam.cookie, stashBody(song.id, sam.memberId));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("client_ref_taken");
  });

  it("403s a create whose queued memberId does not match the signed-in member", async () => {
    // The exact bug this task is for: a recording made under A, still queued
    // when the browser's session cookie now names B (A signed out, B signed
    // in, in another tab). The server is the one guarantee that matters —
    // whatever the client believes, this must never create B's take from A's
    // recording.
    const testApp = await build();
    const song = await seedSong(testApp);
    const robin = await signIn(testApp, "robin");
    const sam = await signIn(testApp, "sam");
    const res = await post(
      testApp,
      "/stash/takes",
      // sam's cookie (the session this request actually authenticates as)…
      sam.cookie,
      // …but the recording is tagged as robin's.
      stashBody(song.id, robin.memberId),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("member_mismatch");
    // Never created — not under sam, and not under robin either.
    expect(
      await takesRepo.getByClientRef(testApp.db, "stash:0192f5b8-local-recording"),
    ).toBeUndefined();
  });

  it("files a create with no memberId under the session, same as before this field existed", async () => {
    // A tab still running the bundle from BEFORE this task, across a deploy:
    // its queued item has no `memberId` field at all. Rejecting it (422) would
    // make the client's own `classifyFailure` give up and mark the recording
    // `failed` forever — worse than the bug this task fixes. The field is a
    // backstop for a race this session can observe; an old client that never
    // knew of it files exactly as it always did, under the session's own
    // member.
    const testApp = await build();
    const song = await seedSong(testApp);
    const { cookie, memberId } = await signIn(testApp, "robin");
    const body = stashBody(song.id, "irrelevant") as Record<string, unknown>;
    delete body.memberId;
    const res = await post(testApp, "/stash/takes", cookie, body);
    expect(res.status).toBe(201);
    const take = await takesRepo.getByClientRef(testApp.db, "stash:0192f5b8-local-recording");
    expect(take?.ownerMemberId).toBe(memberId);
  });

  it("422s a body missing what it still needs", async () => {
    // No song is fine since the stash migration; no clientRef and no recordedAt never are —
    // one is the idempotency key, the other is when it happened.
    const testApp = await build();
    const { cookie } = await signIn(testApp, "robin");
    expect((await post(testApp, "/stash/takes", cookie, { recordedAt: 1 })).status).toBe(422);
    expect(
      (await post(testApp, "/stash/takes", cookie, { clientRef: "0192f5b8-local" })).status,
    ).toBe(422);
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
      body: JSON.stringify(stashBody(song.id, "irrelevant")),
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
      await post(testApp, "/stash/takes", robin.cookie, stashBody(song.id, robin.memberId))
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

  it("another member cannot verify its file; the owner can", async () => {
    const testApp = await build();
    const { robin, sam, takeId } = await stashed(testApp);
    const ready = await readyMaster(testApp, takeId);
    // Already ready, so the owner's verify answers without touching a bucket.
    expect((await post(testApp, `/assets/${ready.id}/verify`, sam.cookie, {})).status).toBe(404);
    expect((await post(testApp, `/assets/${ready.id}/verify`, robin.cookie, {})).status).toBe(200);

    const [pending] = await assetsRepo.createMany(testApp.db, [
      {
        takeId,
        kind: "stem",
        instrumentId: null,
        tier: "lossy",
        format: "webm",
        storageKey: `takes/${takeId}/stem/lossy.webm`,
        contentType: "audio/webm",
        bytes: 12,
        status: "pending",
        createdAt: testApp.clock.now(),
      },
    ]);
    if (!pending) throw new Error("no asset");
    expect((await post(testApp, `/assets/${pending.id}/verify`, sam.cookie, {})).status).toBe(404);
    expect((await assetsRepo.getById(testApp.db, pending.id))?.status).toBe("pending");
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
    });

    it("peaks 404 for another member even where the owner has a waveform", async () => {
      const testApp = await build();
      const { robin, sam, takeId } = await stashed(testApp);
      const asset = await readyMaster(testApp, takeId);
      // A ready waveform for the master, so the owner's answer is a real
      // redirect: the stranger's 404 is then the access check, not the
      // "no waveform yet" 404 every take without peaks gives.
      await assetsRepo.createMany(testApp.db, [
        {
          takeId,
          kind: "peaks",
          tier: "lossy",
          format: "json",
          storageKey: `takes/${takeId}/peaks.json`,
          contentType: "application/json",
          bytes: 1000,
          status: "ready",
          createdAt: testApp.clock.now(),
          readyAt: testApp.clock.now(),
        },
      ]);
      const peaks = (cookie: string) =>
        testApp.app.request(`/assets/${asset.id}/peaks`, {
          headers: { cookie },
          redirect: "manual",
        });
      // The route answers a found waveform with a redirect to the signed URL.
      expect((await peaks(robin.cookie)).status).toBe(302);
      expect((await peaks(sam.cookie)).status).toBe(404);
    });
  });
});
