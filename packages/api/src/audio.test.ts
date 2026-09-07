import { assetsRepo, eventsRepo, membersRepo, songsRepo, takesRepo } from "@bandlib/db";
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

async function seedReadyAsset(testApp: TestApp): Promise<assetsRepo.Asset> {
  const now = testApp.clock.now();
  const song = await songsRepo.create(testApp.db, {
    title: "Audio Route Test Song",
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
      headers: { cookie: `bl_session=${cookie}` },
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
      headers: { cookie: `bl_session=${cookie}` },
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
      headers: { cookie: `bl_session=${cookie}` },
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
      headers: { cookie: `bl_session=${cookie}` },
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
        headers: { cookie: `bl_session=${cookie}` },
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
