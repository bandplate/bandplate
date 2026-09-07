import { createServiceToken } from "@bandplate/core";
import { describe, expect, it } from "vitest";
import { TEST_APP_ORIGIN, buildTestApp } from "./test-helpers.js";

describe("origin check", () => {
  it("rejects a mutating request with a wrong Origin", async () => {
    const { app } = await buildTestApp();
    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a mutating request with no Origin header at all", async () => {
    const { app } = await buildTestApp();
    const res = await app.request("/auth/logout", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("allows a mutating request with the correct Origin", async () => {
    const { app } = await buildTestApp();
    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: { origin: TEST_APP_ORIGIN },
    });
    expect(res.status).toBe(200);
  });

  it("does not check Origin on a non-mutating (GET) request", async () => {
    const { app } = await buildTestApp();
    const res = await app.request("/auth/me", { headers: { origin: "https://evil.example" } });
    // 401 (no session), not 403 (origin) — proves the check is skipped for GET.
    expect(res.status).toBe(401);
  });

  it("exempts service-token (bearer) requests from the Origin check entirely", async () => {
    const { app, db, mailer, clock } = await buildTestApp();
    const created = await createServiceToken(
      { db, mailer, clock },
      { label: "ingest bot", scopes: [] },
    );

    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${created.rawToken}` },
      // Deliberately: no Origin header, no cookie.
    });

    expect(res.status).toBe(200);
  });
});
