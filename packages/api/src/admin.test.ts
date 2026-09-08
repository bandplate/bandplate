import { membersRepo } from "@bandplate/db";
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
    const authedHeaders = { ...jsonHeaders, cookie: `bp_session=${cookie}` };

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
      headers: { cookie: `bp_session=${cookie}` },
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
    const authedHeaders = { ...jsonHeaders, cookie: `bp_session=${cookie}` };

    const res = await testApp.app.request("/admin/members", {
      method: "POST",
      headers: authedHeaders,
      body: JSON.stringify({ displayName: "Dupe", email: "admin@example.com" }),
    });

    expect(res.status).toBe(409);
  });

  it("refuses to create a member whose email isn't a real address", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);

    const res = await testApp.app.request("/admin/members", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ displayName: "Bailey", email: "not-an-email" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_body");
    expect(await membersRepo.list(testApp.db)).toHaveLength(1); // just the admin
  });

  it("404s patching an unknown member id", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);

    const res = await testApp.app.request("/admin/members/does-not-exist", {
      method: "PATCH",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ status: "disabled" }),
    });

    expect(res.status).toBe(404);
  });

  // Round 2 closes the gap the review found: `updateMember` (the web page
  // logic) rejected these, but `PATCH /admin/members/:id` had no such
  // guard at all — the sole admin could self-demote via one authenticated
  // API request, no browser session shenanigans required. Both cases now
  // go through `@bandplate/core`'s `updateMemberWithGuards`, shared with the
  // web page — see `packages/core/src/services/members.ts`.
  it("rejects an admin demoting or disabling themselves via the API", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);
    const authedHeaders = { ...jsonHeaders, cookie: `bp_session=${cookie}` };

    const listRes = await testApp.app.request("/admin/members", {
      headers: { cookie: `bp_session=${cookie}` },
    });
    const { members } = await listRes.json();
    const self = members.find((m: { email: string }) => m.email === "admin@example.com");

    const res = await testApp.app.request(`/admin/members/${self.id}`, {
      method: "PATCH",
      headers: authedHeaders,
      body: JSON.stringify({ role: "member" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("self_target");

    const after = await membersRepo.getById(testApp.db, self.id);
    expect(after?.role).toBe("admin");
  });

  it("rejects demoting the last admin via the API, even from a service token", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);
    const authedHeaders = { ...jsonHeaders, cookie: `bp_session=${cookie}` };

    const listRes = await testApp.app.request("/admin/members", {
      headers: { cookie: `bp_session=${cookie}` },
    });
    const { members } = await listRes.json();
    const soleAdmin = members.find((m: { email: string }) => m.email === "admin@example.com");

    // A service token has no member id of its own, so it can't hit the
    // "self" guard — this exercises the last-admin guard on its own,
    // independent of the acting principal's kind.
    const tokenRes = await testApp.app.request("/admin/tokens", {
      method: "POST",
      headers: authedHeaders,
      body: JSON.stringify({ label: "member management bot", scopes: ["members:admin"] }),
    });
    const { token } = await tokenRes.json();

    const res = await testApp.app.request(`/admin/members/${soleAdmin.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token.rawToken}` },
      body: JSON.stringify({ role: "member" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("last_admin");

    const after = await membersRepo.getById(testApp.db, soleAdmin.id);
    expect(after?.role).toBe("admin");
  });
});

describe("admin instruments routes", () => {
  it("creates, lists, and patches an instrument", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);
    const authedHeaders = { ...jsonHeaders, cookie: `bp_session=${cookie}` };

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
      headers: { cookie: `bp_session=${cookie}` },
    });
    const list = await listRes.json();
    expect(list.instruments.some((i: { id: string }) => i.id === created.instrument.id)).toBe(true);
  });
});

describe("admin tokens routes", () => {
  it("creates a token, returns the raw secret once, then never again", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);
    const authedHeaders = { ...jsonHeaders, cookie: `bp_session=${cookie}` };

    const createRes = await testApp.app.request("/admin/tokens", {
      method: "POST",
      headers: authedHeaders,
      body: JSON.stringify({ label: "token admin bot", scopes: ["tokens:admin"] }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.token.rawToken).toMatch(/^bpk_/);

    const listRes = await testApp.app.request("/admin/tokens", {
      headers: { cookie: `bp_session=${cookie}` },
    });
    const list = await listRes.json();
    const listedToken = list.tokens.find((t: { id: string }) => t.id === created.token.id);
    expect(listedToken).toBeDefined();
    expect(listedToken.rawToken).toBeUndefined();
    expect(listedToken.tokenHash).toBeUndefined();

    // Proves the freshly issued raw token actually authenticates and
    // carries the granted scope, against a real scope-gated route —
    // `/health` (public) would return 200 for any bearer, valid or
    // garbage, and wouldn't prove anything about this specific token.
    const authWithNewToken = await testApp.app.request("/admin/tokens", {
      headers: { authorization: `Bearer ${created.token.rawToken}` },
    });
    expect(authWithNewToken.status).toBe(200);
    const bodyWithNewToken = await authWithNewToken.json();
    expect(bodyWithNewToken.tokens.some((t: { id: string }) => t.id === created.token.id)).toBe(
      true,
    );
  });

  it("rejects an unknown scope on creation", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);

    const res = await testApp.app.request("/admin/tokens", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ label: "bad", scopes: ["not-a-real-scope"] }),
    });

    expect(res.status).toBe(400);
  });

  it("patches scopes and revokes a token", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAsAdmin(testApp);
    const authedHeaders = { ...jsonHeaders, cookie: `bp_session=${cookie}` };

    const createRes = await testApp.app.request("/admin/tokens", {
      method: "POST",
      headers: authedHeaders,
      body: JSON.stringify({ label: "token admin bot", scopes: ["tokens:admin"] }),
    });
    const created = await createRes.json();
    const tokenHeaders = { authorization: `Bearer ${created.token.rawToken}` };

    // Before the patch: the freshly issued token can reach the
    // scope-gated route it was granted (`tokens:admin`).
    const beforePatch = await testApp.app.request("/admin/tokens", { headers: tokenHeaders });
    expect(beforePatch.status).toBe(200);

    const patchRes = await testApp.app.request(`/admin/tokens/${created.token.id}`, {
      method: "PATCH",
      headers: authedHeaders,
      body: JSON.stringify({ scopes: ["ingest:write", "takes:read"] }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.token.scopes.sort()).toEqual(["ingest:write", "takes:read"].sort());

    // The patch actually changed what the token can do, not just what the
    // response body says: having lost `tokens:admin`, it can no longer
    // reach the very route it could reach a moment ago.
    const afterPatch = await testApp.app.request("/admin/tokens", { headers: tokenHeaders });
    expect(afterPatch.status).toBe(403);

    const deleteRes = await testApp.app.request(`/admin/tokens/${created.token.id}`, {
      method: "DELETE",
      headers: authedHeaders,
    });
    expect(deleteRes.status).toBe(200);

    // Revoked bearer resolves to no principal at all — distinct from "has
    // a principal but lacks the scope" above. /auth/me only ever returns
    // data for a resolved principal, so this can only pass post-revoke if
    // resolution itself now fails.
    const meRes = await testApp.app.request("/auth/me", { headers: tokenHeaders });
    expect(meRes.status).toBe(401);
  });
});
