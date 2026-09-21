import { createInMemoryRateLimiter, type Mailer } from "@bandplate/core";
import { membersRepo } from "@bandplate/db";
import { createInMemoryStorage } from "@bandplate/storage/testing";
import { describe, expect, it } from "vitest";
import { buildRoutedApp } from "./index.js";
import {
  buildTestApp,
  createFakeClock,
  resolveTestDb,
  TEST_APP_ORIGIN,
  TEST_BOOTSTRAP_TOKEN,
} from "./test-helpers.js";

const jsonHeaders = { "content-type": "application/json", origin: TEST_APP_ORIGIN };

describe("GET /setup", () => {
  it("reports bootstrap available on an empty database", async () => {
    const { app } = await buildTestApp();
    const res = await app.request("/setup");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bootstrapAvailable: true });
  });

  it("404s once a member exists", async () => {
    const { app, db, clock } = await buildTestApp();
    await membersRepo.create(db, {
      displayName: "Existing",
      slug: "existing",
      email: "existing@example.com",
      createdAt: clock.now(),
    });

    const res = await app.request("/setup");
    expect(res.status).toBe(404);
  });
});

describe("POST /setup", () => {
  const bootstrapBody = JSON.stringify({
    bootstrapToken: TEST_BOOTSTRAP_TOKEN,
    displayName: "Root Admin",
    email: "root@example.com",
  });

  it("bootstraps the first admin on an empty database and sets a session cookie", async () => {
    const { app } = await buildTestApp();

    const res = await app.request("/setup", {
      method: "POST",
      headers: jsonHeaders,
      body: bootstrapBody,
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toMatch(/^bp_session=/);
    const body = await res.json();
    expect(body.testEmailSent).toBe(true);
  });

  it("404s on a second bootstrap attempt", async () => {
    const { app } = await buildTestApp();
    await app.request("/setup", { method: "POST", headers: jsonHeaders, body: bootstrapBody });

    const second = await app.request("/setup", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        bootstrapToken: TEST_BOOTSTRAP_TOKEN,
        displayName: "Someone Else",
        email: "someone@example.com",
      }),
    });

    expect(second.status).toBe(404);
  });

  it("fails with a wrong bootstrap token and creates no member", async () => {
    const { app, db } = await buildTestApp();

    const res = await app.request("/setup", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        bootstrapToken: "wrong-token",
        displayName: "Root",
        email: "root@example.com",
      }),
    });

    expect(res.status).toBe(401);
    expect(await membersRepo.count(db)).toBe(0);
  });

  it("succeeds even when the test email fails to send", async () => {
    const db = await resolveTestDb();
    const clock = createFakeClock();
    const rateLimiter = createInMemoryRateLimiter(clock);
    const failingMailer: Mailer = {
      async sendLoginLink() {},
      async send() {
        throw new Error("smtp is down");
      },
    };

    const { storage } = await createInMemoryStorage();
    const { app } = buildRoutedApp({
      db,
      mailer: failingMailer,
      clock,
      rateLimiter,
      storage,
      config: {
        appOrigin: TEST_APP_ORIGIN,
        bootstrapToken: TEST_BOOTSTRAP_TOKEN,
        cookieSecure: true,
      },
    });

    const res = await app.request("/setup", {
      method: "POST",
      headers: jsonHeaders,
      body: bootstrapBody,
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.testEmailSent).toBe(false);
  });
});
