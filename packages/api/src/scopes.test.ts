import { createServiceToken } from "@bandplate/core";
import { membersRepo } from "@bandplate/db";
import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  extractLoginToken,
  extractSessionCookieValue,
  TEST_APP_ORIGIN,
} from "./test-helpers.js";

const jsonHeaders = { "content-type": "application/json", origin: TEST_APP_ORIGIN };

async function loginAs(
  testApp: Awaited<ReturnType<typeof buildTestApp>>,
  input: { email: string; displayName: string; role: "member" | "admin" },
): Promise<string> {
  await membersRepo.create(testApp.db, {
    displayName: input.displayName,
    slug: input.displayName.toLowerCase(),
    email: input.email,
    role: input.role,
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
  return extractSessionCookieValue(res.headers.get("set-cookie"));
}

describe("scope enforcement", () => {
  it("a service token holding only ingest:write gets 403 on members:admin and tokens:admin routes", async () => {
    const testApp = await buildTestApp();
    const created = await createServiceToken(
      { db: testApp.db, mailer: testApp.mailer, clock: testApp.clock },
      { label: "ingest bot", scopes: ["ingest:write"] },
    );
    const authHeader = { authorization: `Bearer ${created.rawToken}` };

    const membersRes = await testApp.app.request("/admin/members", { headers: authHeader });
    const tokensRes = await testApp.app.request("/admin/tokens", { headers: authHeader });

    expect(membersRes.status).toBe(403);
    expect(tokensRes.status).toBe(403);
  });

  it("a member (non-admin) cannot reach members:admin routes", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAs(testApp, {
      email: "member@example.com",
      displayName: "Member",
      role: "member",
    });

    const res = await testApp.app.request("/admin/members", {
      headers: { cookie: `bp_session=${cookie}` },
    });
    expect(res.status).toBe(403);
  });

  it("an admin can reach members:admin routes", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAs(testApp, {
      email: "admin@example.com",
      displayName: "Admin",
      role: "admin",
    });

    const res = await testApp.app.request("/admin/members", {
      headers: { cookie: `bp_session=${cookie}` },
    });
    expect(res.status).toBe(200);
  });

  it("an admin can reach tokens:admin routes", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAs(testApp, {
      email: "admin@example.com",
      displayName: "Admin",
      role: "admin",
    });

    const res = await testApp.app.request("/admin/tokens", {
      headers: { cookie: `bp_session=${cookie}` },
    });
    expect(res.status).toBe(200);
  });

  it("a member cannot reach tokens:admin routes", async () => {
    const testApp = await buildTestApp();
    const cookie = await loginAs(testApp, {
      email: "member@example.com",
      displayName: "Member",
      role: "member",
    });

    const res = await testApp.app.request("/admin/tokens", {
      headers: { cookie: `bp_session=${cookie}` },
    });
    expect(res.status).toBe(403);
  });

  it("an anonymous caller gets 403 (not 500) from a scoped route", async () => {
    const testApp = await buildTestApp();
    const res = await testApp.app.request("/admin/members");
    expect(res.status).toBe(403);
  });
});
