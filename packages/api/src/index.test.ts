import { createInMemoryRateLimiter } from "@bandlib/core";
import type { Db } from "@bandlib/db";
import { createCapturingMailer } from "@bandlib/mail";
import { createInMemoryStorage } from "@bandlib/storage/testing";
import { describe, expect, it } from "vitest";
import { buildRoutedApp } from "./index.js";
import {
  TEST_APP_ORIGIN,
  TEST_BOOTSTRAP_TOKEN,
  buildTestApp,
  createFakeClock,
  resolveTestDb,
} from "./test-helpers.js";

describe("createApp", () => {
  it("GET /health returns 200 with { ok: true }", async () => {
    const { app } = await buildTestApp();
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /health requires no Origin header (not a mutating method)", async () => {
    const { app } = await buildTestApp();
    const res = await app.request("/health", { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(200);
  });

  it("GET on an unregistered path returns the structured 404 shape, not Hono's default plain text", async () => {
    const { app } = await buildTestApp();
    const res = await app.request("/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "Not found." },
    });
  });

  it("an unhandled throw returns a structured 500 without leaking exception text", async () => {
    const realDb = await resolveTestDb();
    const secretDetail = "SENSITIVE_DRIVER_DETAIL_should_never_reach_the_client";
    // Poison `select` specifically — `requestLogin`'s first read
    // (`membersRepo.getByEmail`) uses it — so the route handler throws
    // partway through, exercising the real `app.onError` wiring rather
    // than a hand-rolled stand-in.
    const poisonedDb = new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop === "select") {
          return () => {
            throw new Error(secretDetail);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Db;

    const { storage } = await createInMemoryStorage();
    const { app } = buildRoutedApp({
      db: poisonedDb,
      mailer: createCapturingMailer(),
      clock: createFakeClock(),
      rateLimiter: createInMemoryRateLimiter(createFakeClock()),
      storage,
      config: {
        appOrigin: TEST_APP_ORIGIN,
        bootstrapToken: TEST_BOOTSTRAP_TOKEN,
        cookieSecure: true,
      },
      sleep: async () => {},
    });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_APP_ORIGIN },
      body: JSON.stringify({ email: "alex@example.com" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "internal_error", message: "An unexpected error occurred." },
    });
    expect(JSON.stringify(body)).not.toContain(secretDetail);
  });
});
