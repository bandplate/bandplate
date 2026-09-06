import { membersRepo, schema } from "@bandlib/db";
import { describe, expect, it } from "vitest";
import {
  TEST_APP_ORIGIN,
  buildTestApp,
  extractLoginToken,
  extractSessionCookieValue,
} from "./test-helpers.js";

const jsonHeaders = { "content-type": "application/json", origin: TEST_APP_ORIGIN };

async function createActiveMember(
  db: Awaited<ReturnType<typeof buildTestApp>>["db"],
  clock: { now(): number },
) {
  return membersRepo.create(db, {
    displayName: "Alex",
    slug: "alex",
    email: "alex@example.com",
    status: "active",
    createdAt: clock.now(),
  });
}

describe("POST /auth/login", () => {
  it("returns an identical 202 body for an unknown address, a disabled member, and a whitelisted member", async () => {
    const { app, db, mailer, clock } = await buildTestApp();
    await createActiveMember(db, clock);
    await membersRepo.create(db, {
      displayName: "Blocked",
      slug: "blocked",
      email: "blocked@example.com",
      status: "disabled",
      createdAt: clock.now(),
    });

    const post = (email: string) =>
      app.request("/auth/login", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ email }),
      });

    const resUnknown = await post("nobody@example.com");
    const resDisabled = await post("blocked@example.com");
    const resActive = await post("alex@example.com");

    const bodyUnknown = await resUnknown.text();
    const bodyDisabled = await resDisabled.text();
    const bodyActive = await resActive.text();

    expect(resUnknown.status).toBe(202);
    expect(resDisabled.status).toBe(202);
    expect(resActive.status).toBe(202);
    expect(bodyUnknown).toBe(bodyDisabled);
    expect(bodyUnknown).toBe(bodyActive);

    // The only observable difference is server-side: mail was sent once,
    // and only to the whitelisted, active member.
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ kind: "login-link", to: "alex@example.com" });
  });

  it("rejects a malformed body with 400", async () => {
    const { app } = await buildTestApp();
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /auth/login/:token", () => {
  it("does not consume the token: two GETs, then a POST still succeeds", async () => {
    const { app, db, mailer, clock } = await buildTestApp();
    await createActiveMember(db, clock);
    await app.request("/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email: "alex@example.com" }),
    });
    const token = extractLoginToken(mailer);

    const get1 = await app.request(`/auth/login/${token}`);
    const get2 = await app.request(`/auth/login/${token}`);
    expect(get1.status).toBe(200);
    expect(get2.status).toBe(200);
    expect(get1.headers.get("cache-control")).toBe("no-store");

    const post = await app.request(`/auth/login/${token}`, {
      method: "POST",
      headers: { origin: TEST_APP_ORIGIN },
    });
    expect(post.status).toBe(200);
  });

  it("reports an unknown token as invalid without throwing", async () => {
    const { app } = await buildTestApp();
    const res = await app.request("/auth/login/not-a-real-token");
    expect(res.status).toBe(404);
  });
});

describe("POST /auth/login/:token", () => {
  async function issueToken(testApp: Awaited<ReturnType<typeof buildTestApp>>) {
    await createActiveMember(testApp.db, testApp.clock);
    await testApp.app.request("/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email: "alex@example.com" }),
    });
    return extractLoginToken(testApp.mailer);
  }

  it("consumes exactly once — a second POST with the same token fails", async () => {
    const testApp = await buildTestApp();
    const token = await issueToken(testApp);

    const first = await testApp.app.request(`/auth/login/${token}`, {
      method: "POST",
      headers: { origin: TEST_APP_ORIGIN },
    });
    const second = await testApp.app.request(`/auth/login/${token}`, {
      method: "POST",
      headers: { origin: TEST_APP_ORIGIN },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
  });

  it("rejects a token past its 15-minute expiry", async () => {
    const testApp = await buildTestApp();
    const token = await issueToken(testApp);

    testApp.clock.advance(15 * 60 * 1000 + 1);

    const res = await testApp.app.request(`/auth/login/${token}`, {
      method: "POST",
      headers: { origin: TEST_APP_ORIGIN },
    });
    expect(res.status).toBe(404);
  });

  it("sets the bl_session cookie with exactly the required attributes", async () => {
    const testApp = await buildTestApp();
    const token = await issueToken(testApp);

    const res = await testApp.app.request(`/auth/login/${token}`, {
      method: "POST",
      headers: { origin: TEST_APP_ORIGIN },
    });

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toMatch(
      /^bl_session=[A-Za-z0-9_-]+; Max-Age=31536000; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
  });

  it("omits Secure when cookieSecure is configured false (non-TLS local dev)", async () => {
    const testApp = await buildTestApp({ cookieSecure: false });
    const token = await issueToken(testApp);

    const res = await testApp.app.request(`/auth/login/${token}`, {
      method: "POST",
      headers: { origin: TEST_APP_ORIGIN },
    });

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toMatch(
      /^bl_session=[A-Za-z0-9_-]+; Max-Age=31536000; Path=\/; HttpOnly; SameSite=Lax$/,
    );
    expect(setCookie).not.toMatch(/Secure/);
  });
});

describe("session lifecycle", () => {
  async function login(testApp: Awaited<ReturnType<typeof buildTestApp>>): Promise<string> {
    await createActiveMember(testApp.db, testApp.clock);
    await testApp.app.request("/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email: "alex@example.com" }),
    });
    const token = extractLoginToken(testApp.mailer);
    const res = await testApp.app.request(`/auth/login/${token}`, {
      method: "POST",
      headers: { origin: TEST_APP_ORIGIN },
    });
    return extractSessionCookieValue(res.headers.get("set-cookie"));
  }

  it("GET /auth/me returns 401 with no cookie", async () => {
    const testApp = await buildTestApp();
    const res = await testApp.app.request("/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /auth/me returns the member principal with a valid cookie", async () => {
    const testApp = await buildTestApp();
    const cookie = await login(testApp);

    const res = await testApp.app.request("/auth/me", {
      headers: { cookie: `bl_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.principal.kind).toBe("member");
  });

  it("revocation is immediate: after logout, the same cookie is 401", async () => {
    const testApp = await buildTestApp();
    const cookie = await login(testApp);

    const logout = await testApp.app.request("/auth/logout", {
      method: "POST",
      headers: { origin: TEST_APP_ORIGIN, cookie: `bl_session=${cookie}` },
    });
    expect(logout.status).toBe(200);

    const me = await testApp.app.request("/auth/me", {
      headers: { cookie: `bl_session=${cookie}` },
    });
    expect(me.status).toBe(401);
  });

  it("does not extend lastSeenAt for a request under the 24h refresh threshold", async () => {
    const testApp = await buildTestApp();
    const cookie = await login(testApp);
    const loginAt = testApp.clock.now();

    testApp.clock.advance(60 * 60 * 1000); // 1h
    await testApp.app.request("/auth/me", { headers: { cookie: `bl_session=${cookie}` } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const rows = await testApp.db.select().from(schema.authSessions);
    expect(rows[0]?.lastSeenAt).toBe(loginAt);
  });

  it("extends lastSeenAt/expiresAt once the 24h refresh threshold has passed", async () => {
    const testApp = await buildTestApp();
    const cookie = await login(testApp);

    testApp.clock.advance(24 * 60 * 60 * 1000 + 1);
    await testApp.app.request("/auth/me", { headers: { cookie: `bl_session=${cookie}` } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const rows = await testApp.db.select().from(schema.authSessions);
    expect(rows[0]?.lastSeenAt).toBe(testApp.clock.now());
    expect(rows[0]?.expiresAt).toBe(testApp.clock.now() + 365 * 24 * 60 * 60 * 1000);
  });
});

describe("rate limiting", () => {
  it("throttles repeated login requests for the same address", async () => {
    const { app } = await buildTestApp();

    const responses = [];
    for (let i = 0; i < 6; i++) {
      responses.push(
        await app.request("/auth/login", {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ email: "same-address@example.com" }),
        }),
      );
    }

    const statuses = responses.map((r) => r.status);
    expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(statuses[5]).toBe(429);
  });

  it("throttles repeated login requests from the same IP across different addresses", async () => {
    const { app } = await buildTestApp();

    const responses = [];
    for (let i = 0; i < 21; i++) {
      responses.push(
        await app.request("/auth/login", {
          method: "POST",
          headers: { ...jsonHeaders, "x-forwarded-for": "203.0.113.9" },
          body: JSON.stringify({ email: `person-${i}@example.com` }),
        }),
      );
    }

    expect(responses.at(-1)?.status).toBe(429);
  });
});
