import { membersRepo } from "@bandlib/db";
import { describe, expect, it } from "vitest";
import {
  TEST_APP_ORIGIN,
  buildTestApp,
  extractLoginToken,
  extractSessionCookieValue,
} from "./test-helpers.js";

const jsonHeaders = { "content-type": "application/json", origin: TEST_APP_ORIGIN };

async function loginAsAdmin(testApp: Awaited<ReturnType<typeof buildTestApp>>): Promise<string> {
  await membersRepo.create(testApp.db, {
    displayName: "Admin",
    slug: "admin",
    email: "admin@example.com",
    role: "admin",
    status: "active",
    createdAt: testApp.clock.now(),
  });
  await testApp.app.request("/auth/login", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: "admin@example.com" }),
  });
  const token = extractLoginToken(testApp.mailer);
  const res = await testApp.app.request(`/auth/login/${token}`, {
    method: "POST",
    headers: { origin: TEST_APP_ORIGIN },
  });
  return extractSessionCookieValue(res.headers.get("set-cookie"));
}

describe("admin members routes", () => {
  it("creates, lists, patches status/role, and revokes sessions for a member", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);
    const authedHeaders = { ...jsonHeaders, cookie: `bl_session=${cookie}` };

    const createRes = await testApp.app.request("/admin/members", {
      method: "POST",
      headers: authedHeaders,
      body: JSON.stringify({ displayName: "New Member", email: "new@example.com" }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.member.status).toBe("invited");
    expect(created.member.role).toBe("member");

    const listRes = await testApp.app.request("/admin/members", {
      headers: { cookie: `bl_session=${cookie}` },
    });
    const list = await listRes.json();
    expect(list.members).toHaveLength(2); // admin + new member

    const patchRes = await testApp.app.request(`/admin/members/${created.member.id}`, {
      method: "PATCH",
      headers: authedHeaders,
      body: JSON.stringify({ role: "admin", status: "active" }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.member.role).toBe("admin");
    expect(patched.member.status).toBe("active");

    const revokeRes = await testApp.app.request(
      `/admin/members/${created.member.id}/revoke-sessions`,
      {
        method: "POST",
        headers: authedHeaders,
      },
    );
    expect(revokeRes.status).toBe(200);
  });

  it("refuses to create a member with a duplicate email", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);
    const authedHeaders = { ...jsonHeaders, cookie: `bl_session=${cookie}` };

    const res = await testApp.app.request("/admin/members", {
      method: "POST",
      headers: authedHeaders,
      body: JSON.stringify({ displayName: "Dupe", email: "admin@example.com" }),
    });

    expect(res.status).toBe(409);
  });

  it("404s patching an unknown member id", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);

    const res = await testApp.app.request("/admin/members/does-not-exist", {
      method: "PATCH",
      headers: { ...jsonHeaders, cookie: `bl_session=${cookie}` },
      body: JSON.stringify({ status: "disabled" }),
    });

    expect(res.status).toBe(404);
  });
});

describe("admin instruments routes", () => {
  it("creates, lists, and patches an instrument", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);
    const authedHeaders = { ...jsonHeaders, cookie: `bl_session=${cookie}` };

    const createRes = await testApp.app.request("/admin/instruments", {
      method: "POST",
      headers: authedHeaders,
      body: JSON.stringify({ slug: "bass", label: "Bass" }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const patchRes = await testApp.app.request(`/admin/instruments/${created.instrument.id}`, {
      method: "PATCH",
      headers: authedHeaders,
      body: JSON.stringify({ label: "Bass Guitar", archived: true }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.instrument.label).toBe("Bass Guitar");
    expect(patched.instrument.archivedAt).not.toBeNull();

    const listRes = await testApp.app.request("/admin/instruments", {
      headers: { cookie: `bl_session=${cookie}` },
    });
    const list = await listRes.json();
    expect(list.instruments.some((i: { id: string }) => i.id === created.instrument.id)).toBe(true);
  });
});

describe("admin tokens routes", () => {
  it("creates a token, returns the raw secret once, then never again", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);
    const authedHeaders = { ...jsonHeaders, cookie: `bl_session=${cookie}` };

    const createRes = await testApp.app.request("/admin/tokens", {
      method: "POST",
      headers: authedHeaders,
      body: JSON.stringify({ label: "ingest bot", scopes: ["ingest:write"] }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.token.rawToken).toMatch(/^blk_/);

    const listRes = await testApp.app.request("/admin/tokens", {
      headers: { cookie: `bl_session=${cookie}` },
    });
    const list = await listRes.json();
    const listedToken = list.tokens.find((t: { id: string }) => t.id === created.token.id);
    expect(listedToken).toBeDefined();
    expect(listedToken.rawToken).toBeUndefined();
    expect(listedToken.tokenHash).toBeUndefined();

    const authWithNewToken = await testApp.app.request("/health", {
      headers: { authorization: `Bearer ${created.token.rawToken}` },
    });
    expect(authWithNewToken.status).toBe(200);
  });

  it("rejects an unknown scope on creation", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);

    const res = await testApp.app.request("/admin/tokens", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bl_session=${cookie}` },
      body: JSON.stringify({ label: "bad", scopes: ["not-a-real-scope"] }),
    });

    expect(res.status).toBe(400);
  });

  it("patches scopes and revokes a token", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);
    const authedHeaders = { ...jsonHeaders, cookie: `bl_session=${cookie}` };

    const createRes = await testApp.app.request("/admin/tokens", {
      method: "POST",
      headers: authedHeaders,
      body: JSON.stringify({ label: "ingest bot", scopes: ["ingest:write"] }),
    });
    const created = await createRes.json();

    const patchRes = await testApp.app.request(`/admin/tokens/${created.token.id}`, {
      method: "PATCH",
      headers: authedHeaders,
      body: JSON.stringify({ scopes: ["ingest:write", "takes:read"] }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.token.scopes.sort()).toEqual(["ingest:write", "takes:read"].sort());

    const deleteRes = await testApp.app.request(`/admin/tokens/${created.token.id}`, {
      method: "DELETE",
      headers: authedHeaders,
    });
    expect(deleteRes.status).toBe(200);

    const afterRevoke = await testApp.app.request("/health", {
      headers: { authorization: `Bearer ${created.token.rawToken}` },
    });
    // Revoked bearer resolves to no principal; /health is public so still 200,
    // but /auth/me should now show unauthenticated.
    expect(afterRevoke.status).toBe(200);
    const meRes = await testApp.app.request("/auth/me", {
      headers: { authorization: `Bearer ${created.token.rawToken}` },
    });
    expect(meRes.status).toBe(401);
  });
});
