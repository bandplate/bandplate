// `POST /favorites` — see `routes/favorites.ts`'s header comment. Mirrors
// `votes.test.ts`'s coverage: scope gating, a forged `memberId` being
// structurally impossible, a disabled member's session already gone, and a
// service token rejected regardless of scope.
import { createServiceToken } from "@bandplate/core";
import { favoritesRepo, membersRepo, songsRepo } from "@bandplate/db";
import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  extractLoginToken,
  extractSessionCookieValue,
  TEST_APP_ORIGIN,
  type TestApp,
} from "./test-helpers.js";

const jsonHeaders = { "content-type": "application/json", origin: TEST_APP_ORIGIN };

async function loginAsMember(
  testApp: TestApp,
  input: { email: string; displayName: string },
): Promise<{ cookie: string; memberId: string }> {
  const member = await membersRepo.create(testApp.db, {
    displayName: input.displayName,
    slug: input.displayName.toLowerCase().replace(/\s+/g, "-"),
    email: input.email,
    role: "member",
    status: "active",
    createdAt: testApp.clock.now(),
  });
  await testApp.app.request("/auth/login", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: input.email }),
  });
  const token = extractLoginToken(testApp.mailer);
  const res = await testApp.app.request(`/auth/login/${token}`, {
    method: "POST",
    headers: { origin: TEST_APP_ORIGIN },
  });
  return { cookie: extractSessionCookieValue(res.headers.get("set-cookie")), memberId: member.id };
}

async function seedSong(testApp: TestApp): Promise<string> {
  const now = testApp.clock.now();
  const song = await songsRepo.create(testApp.db, {
    title: "Favorite Route Test Song",
    slug: "favorite-route-test-song",
    createdAt: now,
    updatedAt: now,
  });
  return song.id;
}

describe("POST /favorites", () => {
  it("a signed-in member can toggle a favorite on and back off", async () => {
    const testApp = await buildTestApp();
    const songId = await seedSong(testApp);
    const { cookie, memberId } = await loginAsMember(testApp, {
      email: "favoriter@example.com",
      displayName: "Favoriter",
    });

    const first = await testApp.app.request("/favorites", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ targetType: "song", targetId: songId }),
    });
    expect(first.status).toBe(200);
    expect((await first.json()).favorited).toBe(true);
    expect(await favoritesRepo.isFavorited(testApp.db, memberId, "song", songId)).toBe(true);

    const second = await testApp.app.request("/favorites", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ targetType: "song", targetId: songId }),
    });
    expect(second.status).toBe(200);
    expect((await second.json()).favorited).toBe(false);
    expect(await favoritesRepo.isFavorited(testApp.db, memberId, "song", songId)).toBe(false);
  });

  it("an anonymous caller gets 403, not a favorite", async () => {
    const testApp = await buildTestApp();
    const songId = await seedSong(testApp);

    const res = await testApp.app.request("/favorites", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ targetType: "song", targetId: songId }),
    });

    expect(res.status).toBe(403);
  });

  it("MUTATION CHECK: a forged memberId in the body cannot favorite on member A's behalf — the favorite is always attributed to the session's own principal", async () => {
    const testApp = await buildTestApp();
    const songId = await seedSong(testApp);
    const { memberId: memberAId } = await loginAsMember(testApp, {
      email: "fav-a@example.com",
      displayName: "Fav A",
    });
    const { cookie: cookieB, memberId: memberBId } = await loginAsMember(testApp, {
      email: "fav-b@example.com",
      displayName: "Fav B",
    });

    const res = await testApp.app.request("/favorites", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookieB}` },
      body: JSON.stringify({ targetType: "song", targetId: songId, memberId: memberAId }),
    });
    expect(res.status).toBe(200);

    expect(await favoritesRepo.isFavorited(testApp.db, memberBId, "song", songId)).toBe(true);
    expect(await favoritesRepo.isFavorited(testApp.db, memberAId, "song", songId)).toBe(false);
  });

  it("a disabled member's stale session cannot favorite (resolveSession rejects it before this route ever runs)", async () => {
    const testApp = await buildTestApp();
    const songId = await seedSong(testApp);
    const { cookie, memberId } = await loginAsMember(testApp, {
      email: "fav-disabled@example.com",
      displayName: "Fav Disabled",
    });

    await membersRepo.setStatus(testApp.db, memberId, "disabled");

    const res = await testApp.app.request("/favorites", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ targetType: "song", targetId: songId }),
    });

    expect(res.status).toBe(403);
    expect(await favoritesRepo.isFavorited(testApp.db, memberId, "song", songId)).toBe(false);
  });

  it("a service token, even one holding favorites:write, is rejected — favoriting needs a real member identity", async () => {
    const testApp = await buildTestApp();
    const songId = await seedSong(testApp);
    const created = await createServiceToken(
      { db: testApp.db, mailer: testApp.mailer, clock: testApp.clock },
      { label: "bot", scopes: ["favorites:write"] },
    );

    const res = await testApp.app.request("/favorites", {
      method: "POST",
      headers: { ...jsonHeaders, authorization: `Bearer ${created.rawToken}` },
      body: JSON.stringify({ targetType: "song", targetId: songId }),
    });

    expect(res.status).toBe(403);
  });

  it("MUTATION CHECK: POST /favorites is declared with favorites:write specifically, not some other scope", async () => {
    // Every real member gets both `votes:write` and `favorites:write` via
    // `scopesForRole`, and a service token is rejected outright before
    // scopes are even consulted (`principal?.kind !== "member"` above) —
    // so no request-level probe (an out-of-scope service token, a
    // deliberately mis-scoped member session) can distinguish "requires
    // favorites:write" from "requires votes:write" or any other scope:
    // every such request 403s the same way for a different reason. That
    // made the previous version of this test (hitting the route with a
    // votes:write-only service token and asserting 403) vacuous: it still
    // passed after mutating the route's `requireScopes(...)` call to a
    // wrong scope, or even to `requireScopes("songs:read")`, because the
    // service-token check fires first regardless.
    //
    // Assert the declaration itself, against the same registry
    // `assertEveryRouteIsGuarded` cross-checks against the live Hono app
    // (see route-registry.test.ts) — this is a change to the one thing
    // that actually decides which scope is required.
    const testApp = await buildTestApp();
    const route = testApp.router.registry.find(
      (r) => r.method === "POST" && r.path === "/favorites",
    );
    expect(route).toBeDefined();
    expect(route?.guard).toEqual({ scopes: ["favorites:write"] });
  });

  it("favoriting a nonexistent song is 404, not a silent no-op", async () => {
    const testApp = await buildTestApp();
    const { cookie } = await loginAsMember(testApp, {
      email: "fav-notfound@example.com",
      displayName: "Fav Not Found",
    });

    const res = await testApp.app.request("/favorites", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ targetType: "song", targetId: "not-a-real-song-id" }),
    });

    expect(res.status).toBe(404);
  });

  it("a cross-origin POST (no matching Origin header) is rejected by the origin-check backstop", async () => {
    const testApp = await buildTestApp();
    const songId = await seedSong(testApp);
    const { cookie } = await loginAsMember(testApp, {
      email: "fav-origin@example.com",
      displayName: "Fav Origin",
    });

    const res = await testApp.app.request("/favorites", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `bp_session=${cookie}`,
        origin: "https://evil.example",
      },
      body: JSON.stringify({ targetType: "song", targetId: songId }),
    });

    expect(res.status).toBe(403);
  });
});
