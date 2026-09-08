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

const jsonHeaders = { "content-type": "application/json", origin: TEST_APP_ORIGIN };

async function loginAsMember(testApp: TestApp): Promise<string> {
  await membersRepo.create(testApp.db, {
    displayName: "Member",
    slug: "member",
    email: "member@example.com",
    role: "member",
    status: "active",
    createdAt: testApp.clock.now(),
  });
  await testApp.app.request("/auth/login", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: "member@example.com" }),
  });
  const token = extractLoginToken(testApp.mailer);
  const res = await testApp.app.request(`/auth/login/${token}`, {
    method: "POST",
    headers: { origin: TEST_APP_ORIGIN },
  });
  return extractSessionCookieValue(res.headers.get("set-cookie"));
}

async function seedReadyAsset(
  testApp: TestApp,
  songTitle = "Audio Route Test Song",
): Promise<assetsRepo.Asset> {
  const now = testApp.clock.now();
  const song = await songsRepo.create(testApp.db, {
    title: songTitle,
    slug: "audio-route-test-song",
    createdAt: now,
    updatedAt: now,
  });
  const event = await eventsRepo.create(testApp.db, {
    kind: "rehearsal",
    heldAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const take = await takesRepo.create(testApp.db, {
    songId: song.id,
    eventId: event.id,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const [asset] = await assetsRepo.createMany(testApp.db, [
    {
      takeId: take.id,
      kind: "master",
      tier: "lossy",
      format: "mp3",
      storageKey: `takes/${take.id}/master/lossy.mp3`,
      contentType: "audio/mpeg",
      bytes: 1000,
      status: "ready",
      createdAt: now,
      readyAt: now,
    },
  ]);
  if (!asset) {
    throw new Error("expected createMany to return the inserted asset");
  }
  return asset;
}

describe("GET /assets/:id/audio", () => {
  let testApp: TestApp | undefined;

  afterEach(async () => {
    await testApp?.closeStorage();
    testApp = undefined;
  });

  it("redirects an authenticated member to a presigned URL with a Cache-Control header", async () => {
    testApp = await buildTestApp();
    const cookie = await loginAsMember(testApp);
    const asset = await seedReadyAsset(testApp);

    const res = await testApp.app.request(`/assets/${asset.id}/audio`, {
      headers: { cookie: `bp_session=${cookie}` },
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toContain("lossy.mp3");
    expect(res.headers.get("cache-control")).toBe("private, max-age=1800");
  });

  it("rejects an anonymous caller", async () => {
    testApp = await buildTestApp();
    const asset = await seedReadyAsset(testApp);

    const res = await testApp.app.request(`/assets/${asset.id}/audio`, { redirect: "manual" });

    expect(res.status).toBe(403);
  });

  it("MUTATION CHECK: GET /assets/:id/audio is declared with takes:read specifically, not some other scope", async () => {
    // Every real member gets `takes:read` via `scopesForRole` (like every
    // other read scope), so — same trap `favorites.test.ts`'s identically
    // named check documents — no request-level probe with a member
    // session can distinguish "requires takes:read" from "requires any
    // other scope every member also holds": a route guarded by the wrong
    // read scope would still 302 for a logged-in member and still 403 for
    // an anonymous one, exactly like the tests above already pass. This
    // was flagged (increment 7 fix round, I4) as coverage that was never
    // actually extended to this route despite the vitest-pool-workers run
    // re-executing this whole file. Assert the declaration itself,
    // against the same registry `assertEveryRouteIsGuarded` cross-checks
    // against the live Hono app (see route-registry.test.ts) — this is
    // the one thing that actually decides which scope is required.
    testApp = await buildTestApp();
    const route = testApp.router.registry.find(
      (r) => r.method === "GET" && r.path === "/assets/:id/audio",
    );
    expect(route).toBeDefined();
    expect(route?.guard).toEqual({ scopes: ["takes:read"] });
  });

  it("404s for an asset that does not exist", async () => {
    testApp = await buildTestApp();
    const cookie = await loginAsMember(testApp);

    const res = await testApp.app.request("/assets/does-not-exist/audio", {
      headers: { cookie: `bp_session=${cookie}` },
      redirect: "manual",
    });

    expect(res.status).toBe(404);
  });

  it("404s for an asset that exists but is not status='ready'", async () => {
    testApp = await buildTestApp();
    const cookie = await loginAsMember(testApp);
    const now = testApp.clock.now();
    const song = await songsRepo.create(testApp.db, {
      title: "Pending Asset Song",
      slug: "pending-asset-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(testApp.db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const take = await takesRepo.create(testApp.db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const [pendingAsset] = await assetsRepo.createMany(testApp.db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossy",
        format: "mp3",
        storageKey: `takes/${take.id}/master/lossy.mp3`,
        contentType: "audio/mpeg",
        bytes: 1000,
        status: "pending",
        createdAt: now,
      },
    ]);
    if (!pendingAsset) {
      throw new Error("expected createMany to return the inserted asset");
    }

    const res = await testApp.app.request(`/assets/${pendingAsset.id}/audio`, {
      headers: { cookie: `bp_session=${cookie}` },
      redirect: "manual",
    });

    expect(res.status).toBe(404);
  });

  it("404s for a ready 'peaks' asset — waveform data, never audio (fix round 1, item 5)", async () => {
    // The pre-existing coverage never actually exercised the
    // `kind !== "master" && kind !== "stem"` guard: every fixture used is
    // a 'master'. Mutating that guard to `if (false)` (i.e. removing it
    // entirely) survived the whole suite — a 'peaks' asset would then
    // happily presign as if it were audio. This seeds a real 'peaks' row,
    // status='ready' (so it's NOT caught by the earlier status check
    // instead), and asserts the guard itself is what 404s it.
    testApp = await buildTestApp();
    const cookie = await loginAsMember(testApp);
    const now = testApp.clock.now();
    const song = await songsRepo.create(testApp.db, {
      title: "Peaks Asset Song",
      slug: "peaks-asset-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(testApp.db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const take = await takesRepo.create(testApp.db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const [peaksAsset] = await assetsRepo.createMany(testApp.db, [
      {
        takeId: take.id,
        kind: "peaks",
        tier: "lossy",
        format: "json",
        storageKey: `takes/${take.id}/peaks.json`,
        contentType: "application/json",
        bytes: 1000,
        status: "ready",
        createdAt: now,
        readyAt: now,
      },
    ]);
    if (!peaksAsset) {
      throw new Error("expected createMany to return the inserted asset");
    }

    const res = await testApp.app.request(`/assets/${peaksAsset.id}/audio`, {
      headers: { cookie: `bp_session=${cookie}` },
      redirect: "manual",
    });

    expect(res.status).toBe(404);
  });

  it.skipIf(isWorkerdRuntime)(
    "the redirected-to URL actually serves the asset's bytes",
    async () => {
      testApp = await buildTestApp();
      const cookie = await loginAsMember(testApp);
      const asset = await seedReadyAsset(testApp);
      await testApp.storage.put(
        asset.storageKey,
        new TextEncoder().encode("fake mp3 bytes"),
        "audio/mpeg",
      );

      const res = await testApp.app.request(`/assets/${asset.id}/audio`, {
        headers: { cookie: `bp_session=${cookie}` },
        redirect: "manual",
      });
      const location = res.headers.get("location");
      if (!location) {
        throw new Error("expected a Location header");
      }

      const fetched = await fetch(location);
      expect(fetched.status).toBe(200);
      expect(await fetched.text()).toBe("fake mp3 bytes");
    },
  );
});

describe("GET /assets/:id/download", () => {
  let testApp: TestApp | undefined;

  afterEach(async () => {
    await testApp?.closeStorage();
    testApp = undefined;
  });

  it("presigns the object to arrive as an attachment named after the take", async () => {
    testApp = await buildTestApp();
    const cookie = await loginAsMember(testApp);
    const asset = await seedReadyAsset(testApp);

    const res = await testApp.app.request(`/assets/${asset.id}/download`, {
      headers: { cookie: `bp_session=${cookie}` },
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    // The disposition rides in the presigned query string, so the redirect
    // target itself is what has to carry it — a header on this 302 would be
    // dropped the moment the browser follows it to the bucket.
    const disposition = new URL(location ?? "").searchParams.get("response-content-disposition");
    expect(disposition).toContain("attachment;");
    expect(disposition).toContain("full mix.mp3");
  });

  it("keeps a Czech title readable — both the ASCII fallback and the UTF-8 form", async () => {
    testApp = await buildTestApp();
    const cookie = await loginAsMember(testApp);
    const asset = await seedReadyAsset(testApp, "Píseň o cestách");

    const res = await testApp.app.request(`/assets/${asset.id}/download`, {
      headers: { cookie: `bp_session=${cookie}` },
      redirect: "manual",
    });

    const disposition =
      new URL(res.headers.get("location") ?? "").searchParams.get("response-content-disposition") ??
      "";
    // The bare `filename` is what an old client reads, and it must survive
    // being stripped to ASCII rather than collapsing to nothing.
    expect(disposition).toContain('filename="Pisen o cestach');
    // `filename*` is what every current browser actually uses, so the
    // diacritics have to be in there percent-encoded.
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent("Píseň o cestách")}`);
  });

  it("rejects an anonymous caller", async () => {
    testApp = await buildTestApp();
    const asset = await seedReadyAsset(testApp);

    const res = await testApp.app.request(`/assets/${asset.id}/download`, { redirect: "manual" });

    expect(res.status).toBe(403);
  });

  it("MUTATION CHECK: declared with takes:read specifically, not some other scope", async () => {
    // Same reasoning as the identically named check on `/audio` above: every
    // member holds every read scope, so no request-level probe can tell which
    // one this route actually declares. Assert the declaration.
    testApp = await buildTestApp();
    const route = testApp.router.registry.find(
      (r) => r.method === "GET" && r.path === "/assets/:id/download",
    );
    expect(route).toBeDefined();
    expect(route?.guard).toEqual({ scopes: ["takes:read"] });
  });

  it("404s for a peaks asset — waveform JSON is not a file anyone downloads", async () => {
    testApp = await buildTestApp();
    const cookie = await loginAsMember(testApp);
    const master = await seedReadyAsset(testApp);
    const now = testApp.clock.now();
    const [peaks] = await assetsRepo.createMany(testApp.db, [
      {
        takeId: master.takeId,
        kind: "peaks",
        tier: "lossy",
        format: "json",
        storageKey: `takes/${master.takeId}/peaks.json`,
        contentType: "application/json",
        bytes: 100,
        status: "ready",
        createdAt: now,
        readyAt: now,
      },
    ]);

    const res = await testApp.app.request(`/assets/${peaks?.id}/download`, {
      headers: { cookie: `bp_session=${cookie}` },
      redirect: "manual",
    });

    expect(res.status).toBe(404);
  });
});
