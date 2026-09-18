// `/push/subscriptions` and `/push/prefs` — see `routes/push.ts`'s header
// comment. Mirrors `favorites.test.ts`/`votes.test.ts`'s coverage (scope
// gating, service-token rejection) plus what's specific to this surface:
// the 10-subscription cap and its "already this member's endpoint" escape
// hatch, a foreign endpoint's delete being a silent no-op, base64url key
// validation, and the whole surface 404ing when push isn't configured.
import { createServiceToken } from "@bandplate/core";
import { membersRepo, notificationPrefsRepo, pushSubscriptionsRepo } from "@bandplate/db";
import { describe, expect, it } from "vitest";
import {
  TEST_APP_ORIGIN,
  type TestApp,
  buildTestApp,
  extractLoginToken,
  extractSessionCookieValue,
} from "./test-helpers.js";

const jsonHeaders = { "content-type": "application/json", origin: TEST_APP_ORIGIN };

const PUSH_CONFIG = { publicKey: "test-vapid-public-key", keyId: "test-vapid-p" };

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

/** Base64url-encode `byteLength` fresh random bytes — Workers-safe (no `Buffer`). */
function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function validKeys(): { p256dh: string; auth: string } {
  return { p256dh: randomBase64Url(65), auth: randomBase64Url(16) };
}

function subscribeBody(
  overrides: { endpoint?: string; keys?: { p256dh: string; auth: string } } = {},
) {
  return {
    endpoint: overrides.endpoint ?? `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,
    keys: overrides.keys ?? validKeys(),
  };
}

describe("POST /push/subscriptions", () => {
  it("a signed-in member can subscribe a device", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie, memberId } = await loginAsMember(testApp, {
      email: "sub-1@example.com",
      displayName: "Sub One",
    });
    const body = subscribeBody();

    const res = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(204);
    expect(await pushSubscriptionsRepo.countForMember(testApp.db, memberId)).toBe(1);
    const stored = await pushSubscriptionsRepo.getByEndpoint(testApp.db, body.endpoint);
    expect(stored?.memberId).toBe(memberId);
    expect(stored?.vapidKeyId).toBe(PUSH_CONFIG.keyId);
    expect(stored?.p256dh).toBe(body.keys.p256dh);
    expect(stored?.auth).toBe(body.keys.auth);
  });

  it("re-subscribing the same endpoint updates in place and does not count twice against the cap", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie, memberId } = await loginAsMember(testApp, {
      email: "sub-resub@example.com",
      displayName: "Sub Resub",
    });
    const endpoint = "https://fcm.googleapis.com/fcm/send/resub";

    const first = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify(subscribeBody({ endpoint })),
    });
    expect(first.status).toBe(204);

    const second = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify(subscribeBody({ endpoint })),
    });
    expect(second.status).toBe(204);

    expect(await pushSubscriptionsRepo.countForMember(testApp.db, memberId)).toBe(1);
  });

  it("a member already at 10 subscriptions gets 409 for an 11th new endpoint", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie } = await loginAsMember(testApp, {
      email: "sub-cap@example.com",
      displayName: "Sub Cap",
    });

    for (let i = 0; i < 10; i++) {
      const res = await testApp.app.request("/push/subscriptions", {
        method: "POST",
        headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
        body: JSON.stringify(
          subscribeBody({ endpoint: `https://fcm.googleapis.com/fcm/send/cap-${i}` }),
        ),
      });
      expect(res.status).toBe(204);
    }

    const eleventh = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify(
        subscribeBody({ endpoint: "https://fcm.googleapis.com/fcm/send/cap-10" }),
      ),
    });
    expect(eleventh.status).toBe(409);
  });

  it("a member at 10 subscriptions can still re-subscribe an endpoint that's already theirs", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie } = await loginAsMember(testApp, {
      email: "sub-cap-resub@example.com",
      displayName: "Sub Cap Resub",
    });

    for (let i = 0; i < 10; i++) {
      const res = await testApp.app.request("/push/subscriptions", {
        method: "POST",
        headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
        body: JSON.stringify(
          subscribeBody({ endpoint: `https://fcm.googleapis.com/fcm/send/cr-${i}` }),
        ),
      });
      expect(res.status).toBe(204);
    }

    const resub = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify(subscribeBody({ endpoint: "https://fcm.googleapis.com/fcm/send/cr-0" })),
    });
    expect(resub.status).toBe(204);
  });

  it("rejects an endpoint that isn't a recognized push service", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie } = await loginAsMember(testApp, {
      email: "sub-bad-endpoint@example.com",
      displayName: "Sub Bad Endpoint",
    });

    const res = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify(subscribeBody({ endpoint: "https://evil.example/collect" })),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a p256dh that doesn't decode to 65 bytes", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie } = await loginAsMember(testApp, {
      email: "sub-bad-p256dh@example.com",
      displayName: "Sub Bad P256dh",
    });

    const res = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify(
        subscribeBody({ keys: { p256dh: randomBase64Url(64), auth: randomBase64Url(16) } }),
      ),
    });

    expect(res.status).toBe(400);
  });

  it("rejects an auth that doesn't decode to 16 bytes", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie } = await loginAsMember(testApp, {
      email: "sub-bad-auth@example.com",
      displayName: "Sub Bad Auth",
    });

    const res = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify(
        subscribeBody({ keys: { p256dh: randomBase64Url(65), auth: randomBase64Url(15) } }),
      ),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a body missing keys entirely", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie } = await loginAsMember(testApp, {
      email: "sub-missing-keys@example.com",
      displayName: "Sub Missing Keys",
    });

    const res = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/no-keys" }),
    });

    expect(res.status).toBe(400);
  });

  it("an anonymous caller gets 403, not a subscription", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });

    const res = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(subscribeBody()),
    });

    expect(res.status).toBe(403);
  });

  it("a service token, even one holding notifications:write, is rejected", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const created = await createServiceToken(
      { db: testApp.db, mailer: testApp.mailer, clock: testApp.clock },
      { label: "bot", scopes: ["notifications:write"] },
    );

    const res = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, authorization: `Bearer ${created.rawToken}` },
      body: JSON.stringify(subscribeBody()),
    });

    expect(res.status).toBe(403);
  });

  it("404s when push notifications are not configured", async () => {
    const testApp = await buildTestApp();
    const { cookie } = await loginAsMember(testApp, {
      email: "sub-push-off@example.com",
      displayName: "Sub Push Off",
    });

    const res = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify(subscribeBody()),
    });

    expect(res.status).toBe(404);
  });

  it("a cross-origin POST is rejected by the origin-check backstop", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie } = await loginAsMember(testApp, {
      email: "sub-origin@example.com",
      displayName: "Sub Origin",
    });

    const res = await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `bp_session=${cookie}`,
        origin: "https://evil.example",
      },
      body: JSON.stringify(subscribeBody()),
    });

    expect(res.status).toBe(403);
  });

  it("MUTATION CHECK: POST /push/subscriptions is declared with notifications:write specifically", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const route = testApp.router.registry.find(
      (r) => r.method === "POST" && r.path === "/push/subscriptions",
    );
    expect(route).toBeDefined();
    expect(route?.guard).toEqual({ scopes: ["notifications:write"] });
  });
});

describe("DELETE /push/subscriptions", () => {
  it("a member can unsubscribe their own device", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie, memberId } = await loginAsMember(testApp, {
      email: "unsub-1@example.com",
      displayName: "Unsub One",
    });
    const endpoint = "https://fcm.googleapis.com/fcm/send/unsub-1";
    await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify(subscribeBody({ endpoint })),
    });
    expect(await pushSubscriptionsRepo.countForMember(testApp.db, memberId)).toBe(1);

    const res = await testApp.app.request("/push/subscriptions", {
      method: "DELETE",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ endpoint }),
    });

    expect(res.status).toBe(204);
    expect(await pushSubscriptionsRepo.countForMember(testApp.db, memberId)).toBe(0);
  });

  it("deleting another member's endpoint is a silent no-op, not an error", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie: cookieA, memberId: memberAId } = await loginAsMember(testApp, {
      email: "unsub-a@example.com",
      displayName: "Unsub A",
    });
    const { cookie: cookieB } = await loginAsMember(testApp, {
      email: "unsub-b@example.com",
      displayName: "Unsub B",
    });
    const endpoint = "https://fcm.googleapis.com/fcm/send/unsub-foreign";
    await testApp.app.request("/push/subscriptions", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookieA}` },
      body: JSON.stringify(subscribeBody({ endpoint })),
    });

    const res = await testApp.app.request("/push/subscriptions", {
      method: "DELETE",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookieB}` },
      body: JSON.stringify({ endpoint }),
    });

    expect(res.status).toBe(204);
    expect(await pushSubscriptionsRepo.countForMember(testApp.db, memberAId)).toBe(1);
  });

  it("rejects a body missing endpoint", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie } = await loginAsMember(testApp, {
      email: "unsub-missing@example.com",
      displayName: "Unsub Missing",
    });

    const res = await testApp.app.request("/push/subscriptions", {
      method: "DELETE",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("an anonymous caller gets 403", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });

    const res = await testApp.app.request("/push/subscriptions", {
      method: "DELETE",
      headers: jsonHeaders,
      body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/anon" }),
    });

    expect(res.status).toBe(403);
  });

  it("a service token is rejected even holding notifications:write", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const created = await createServiceToken(
      { db: testApp.db, mailer: testApp.mailer, clock: testApp.clock },
      { label: "bot", scopes: ["notifications:write"] },
    );

    const res = await testApp.app.request("/push/subscriptions", {
      method: "DELETE",
      headers: { ...jsonHeaders, authorization: `Bearer ${created.rawToken}` },
      body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/svc" }),
    });

    expect(res.status).toBe(403);
  });

  it("404s when push notifications are not configured", async () => {
    const testApp = await buildTestApp();
    const { cookie } = await loginAsMember(testApp, {
      email: "unsub-push-off@example.com",
      displayName: "Unsub Push Off",
    });

    const res = await testApp.app.request("/push/subscriptions", {
      method: "DELETE",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/off" }),
    });

    expect(res.status).toBe(404);
  });
});

describe("GET /push/prefs", () => {
  it("returns the defaults (all on) for a member who never set prefs", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie } = await loginAsMember(testApp, {
      email: "prefs-get-default@example.com",
      displayName: "Prefs Default",
    });

    const res = await testApp.app.request("/push/prefs", {
      headers: { cookie: `bp_session=${cookie}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ newTakes: true, weeklyUnvoted: true, songChanges: true });
  });

  it("an anonymous caller gets 403", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });

    const res = await testApp.app.request("/push/prefs");

    expect(res.status).toBe(403);
  });

  it("a service token is rejected even holding notifications:write", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const created = await createServiceToken(
      { db: testApp.db, mailer: testApp.mailer, clock: testApp.clock },
      { label: "bot", scopes: ["notifications:write"] },
    );

    const res = await testApp.app.request("/push/prefs", {
      headers: { authorization: `Bearer ${created.rawToken}` },
    });

    expect(res.status).toBe(403);
  });

  it("404s when push notifications are not configured", async () => {
    const testApp = await buildTestApp();
    const { cookie } = await loginAsMember(testApp, {
      email: "prefs-get-off@example.com",
      displayName: "Prefs Get Off",
    });

    const res = await testApp.app.request("/push/prefs", {
      headers: { cookie: `bp_session=${cookie}` },
    });

    expect(res.status).toBe(404);
  });
});

describe("PUT /push/prefs", () => {
  it("a member can update their prefs and GET reflects it", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie, memberId } = await loginAsMember(testApp, {
      email: "prefs-put-1@example.com",
      displayName: "Prefs Put One",
    });
    const newPrefs = { newTakes: false, weeklyUnvoted: true, songChanges: false };

    const putRes = await testApp.app.request("/push/prefs", {
      method: "PUT",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify(newPrefs),
    });
    expect(putRes.status).toBe(204);

    expect(await notificationPrefsRepo.get(testApp.db, memberId)).toEqual(newPrefs);

    const getRes = await testApp.app.request("/push/prefs", {
      headers: { cookie: `bp_session=${cookie}` },
    });
    expect(await getRes.json()).toEqual(newPrefs);
  });

  it("rejects a body with a non-boolean field", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie } = await loginAsMember(testApp, {
      email: "prefs-put-bad@example.com",
      displayName: "Prefs Put Bad",
    });

    const res = await testApp.app.request("/push/prefs", {
      method: "PUT",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ newTakes: "yes", weeklyUnvoted: true, songChanges: true }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a body missing a field", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie } = await loginAsMember(testApp, {
      email: "prefs-put-missing@example.com",
      displayName: "Prefs Put Missing",
    });

    const res = await testApp.app.request("/push/prefs", {
      method: "PUT",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ newTakes: true, weeklyUnvoted: true }),
    });

    expect(res.status).toBe(400);
  });

  it("an anonymous caller gets 403", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });

    const res = await testApp.app.request("/push/prefs", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ newTakes: true, weeklyUnvoted: true, songChanges: true }),
    });

    expect(res.status).toBe(403);
  });

  it("a service token is rejected even holding notifications:write", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const created = await createServiceToken(
      { db: testApp.db, mailer: testApp.mailer, clock: testApp.clock },
      { label: "bot", scopes: ["notifications:write"] },
    );

    const res = await testApp.app.request("/push/prefs", {
      method: "PUT",
      headers: { ...jsonHeaders, authorization: `Bearer ${created.rawToken}` },
      body: JSON.stringify({ newTakes: true, weeklyUnvoted: true, songChanges: true }),
    });

    expect(res.status).toBe(403);
  });

  it("404s when push notifications are not configured", async () => {
    const testApp = await buildTestApp();
    const { cookie } = await loginAsMember(testApp, {
      email: "prefs-put-off@example.com",
      displayName: "Prefs Put Off",
    });

    const res = await testApp.app.request("/push/prefs", {
      method: "PUT",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ newTakes: true, weeklyUnvoted: true, songChanges: true }),
    });

    expect(res.status).toBe(404);
  });

  it("a cross-origin PUT is rejected by the origin-check backstop", async () => {
    const testApp = await buildTestApp({ push: PUSH_CONFIG });
    const { cookie } = await loginAsMember(testApp, {
      email: "prefs-put-origin@example.com",
      displayName: "Prefs Put Origin",
    });

    const res = await testApp.app.request("/push/prefs", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: `bp_session=${cookie}`,
        origin: "https://evil.example",
      },
      body: JSON.stringify({ newTakes: true, weeklyUnvoted: true, songChanges: true }),
    });

    expect(res.status).toBe(403);
  });
});
