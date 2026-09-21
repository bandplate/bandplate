// The browser's upload surface. The point of this file is the ROUND TRIP:
// `buildTestApp`'s `InMemoryStorage` is a real `node:http` server that
// enforces content-type, content-length and checksum with a 403 exactly as
// MinIO does, so declare → PUT → verify is exercised for real here rather
// than described. The `apps/web` route tests boot with dummy S3 config and
// deliberately do not attempt it.
import { createServiceToken } from "@bandplate/core";
import {
  assetsRepo,
  eventsRepo,
  instrumentsRepo,
  membersRepo,
  songsRepo,
  takesRepo,
} from "@bandplate/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildTestApp,
  extractLoginToken,
  extractSessionCookieValue,
  isWorkerdRuntime,
  TEST_APP_ORIGIN,
  type TestApp,
} from "./test-helpers.js";

const jsonHeaders = { "content-type": "application/json" };

let openApps: TestApp[] = [];

afterEach(async () => {
  for (const app of openApps) {
    await app.closeStorage();
  }
  openApps = [];
});

async function build(): Promise<TestApp> {
  const testApp = await buildTestApp();
  openApps.push(testApp);
  return testApp;
}

/**
 * A signed-in member's cookie, through the real login flow — the same shape
 * `auth.test.ts` uses. An ORDINARY member, deliberately: since M8 that is who
 * uploads, and a test that logged in as an admin would not prove it.
 */
async function memberCookie(testApp: TestApp): Promise<string> {
  await membersRepo.create(testApp.db, {
    displayName: "Robin",
    slug: "robin",
    email: "robin@example.com",
    status: "active",
    createdAt: testApp.clock.now(),
  });
  await testApp.app.request("/auth/login", {
    method: "POST",
    headers: { ...jsonHeaders, origin: TEST_APP_ORIGIN },
    body: JSON.stringify({ email: "robin@example.com" }),
  });
  const token = extractLoginToken(testApp.mailer);
  const res = await testApp.app.request(`/auth/login/${token}`, {
    method: "POST",
    headers: { origin: TEST_APP_ORIGIN },
  });
  return `bp_session=${extractSessionCookieValue(res.headers.get("set-cookie"))}`;
}

async function seedTake(testApp: TestApp) {
  const now = testApp.clock.now();
  const song = await songsRepo.create(testApp.db, {
    title: "Neon Skyline",
    slug: "neon-skyline",
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
  return take;
}

function declareBody(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    kind: "master",
    tier: "lossy",
    format: "mp3",
    bytes: 12,
    ...over,
  });
}

describe("take assets — the browser's upload surface", () => {
  describe("authorization", () => {
    it("refuses an anonymous request", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const res = await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, origin: TEST_APP_ORIGIN },
        body: declareBody(),
      });
      // 403, not 401 — `requireScopes` has no "who are you" branch (only
      // `requireServiceScopes` does, for the bearer-only ingest routes), so an
      // absent principal simply holds no scopes. That is how every other
      // `requireScopes` route in this package already answers, and this test
      // pins the existing behaviour rather than asking this one route to
      // differ from its neighbours.
      expect(res.status).toBe(403);
    });

    it("403s a service token that holds only ingest:write", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      // Deliberately a SERVICE token, not a member: since M8 every member
      // holds `takes:write`, so a member can no longer demonstrate the
      // missing-scope path.
      const created = await createServiceToken(
        { db: testApp.db, mailer: testApp.mailer, clock: testApp.clock },
        { label: "bridge", scopes: ["ingest:write"] },
      );
      const res = await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, authorization: `Bearer ${created.rawToken}` },
        body: declareBody(),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
    });

    it("403s a cookie request whose Origin doesn't match", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      const res = await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: "https://evil.example" },
        body: declareBody(),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("declaring", () => {
    it("404s for a take that isn't there", async () => {
      const testApp = await build();
      const cookie = await memberCookie(testApp);
      const res = await testApp.app.request("/takes/nope/assets", {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: declareBody(),
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("take_not_found");
    });

    it("422s a master carrying an instrument", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      const bass = await instrumentsRepo.create(testApp.db, { slug: "bass", label: "Bass" });
      const res = await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: declareBody({ instrumentId: bass.id }),
      });
      expect(res.status).toBe(422);
    });

    it("422s a stem carrying none", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      const res = await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: declareBody({ kind: "stem" }),
      });
      expect(res.status).toBe(422);
    });

    it("422s a stem naming an archived instrument, listing the live ones", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      await instrumentsRepo.create(testApp.db, { slug: "bass", label: "Bass" });
      const gone = await instrumentsRepo.create(testApp.db, { slug: "sitar", label: "Sitar" });
      await instrumentsRepo.archive(testApp.db, gone.id, testApp.clock.now());

      const res = await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: declareBody({ kind: "stem", instrumentId: gone.id }),
      });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("unknown_instrument");
      expect(body.error.message).toContain("bass");
    });

    it("adds a stem's instrument to the take — a file is proof it was played", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      const bass = await instrumentsRepo.create(testApp.db, { slug: "bass", label: "Bass" });

      await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: declareBody({
          kind: "stem",
          instrumentId: bass.id,
          format: "flac",
          tier: "lossless",
        }),
      });

      const byTake = await takesRepo.listInstrumentsForTakes(testApp.db, [take.id]);
      expect((byTake.get(take.id) ?? []).map((i) => i.slug)).toEqual(["bass"]);
    });

    it("409s an occupied slot, naming what is in it, and writes nothing", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: declareBody(),
      });

      // A different FORMAT is the same slot — `getBySlot` ignores format.
      const res = await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: declareBody({ format: "opus", bytes: 99 }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("slot_occupied");
      expect(body.error.existing.format).toBe("mp3");
      expect(body.error.existing.bytes).toBe(12);
      expect(await assetsRepo.listByTake(testApp.db, take.id)).toHaveLength(1);
    });

    it("replaces when the caller says so, keeping one row", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: declareBody(),
      });

      const res = await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: declareBody({ format: "opus", bytes: 99, replace: true }),
      });

      expect(res.status).toBe(200);
      expect((await res.json()).outcome).toBe("reset");
      const rows = await assetsRepo.listByTake(testApp.db, take.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.format).toBe("opus");
    });

    it("does not treat a different tier as a collision", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: declareBody(),
      });

      const res = await testApp.app.request(`/takes/${take.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: declareBody({ tier: "lossless", format: "flac" }),
      });

      expect(res.status).toBe(200);
      expect(await assetsRepo.listByTake(testApp.db, take.id)).toHaveLength(2);
    });
  });

  // These bind a real listening socket, which workerd cannot do.
  describe.skipIf(isWorkerdRuntime)("the round trip, against a real bucket", () => {
    async function declare(testApp: TestApp, takeId: string, cookie: string, over = {}) {
      const res = await testApp.app.request(`/takes/${takeId}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: declareBody(over),
      });
      expect(res.status).toBe(200);
      return res.json();
    }

    it("declare, PUT the bytes, verify — and the take learns its duration", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      const bytes = new Uint8Array(12).fill(7);

      const declared = await declare(testApp, take.id, cookie, { durationMs: 214_000 });

      const put = await fetch(declared.url, {
        method: "PUT",
        headers: declared.headers,
        body: bytes,
      });
      expect(put.status).toBe(200);

      const verified = await testApp.app.request(`/assets/${declared.assetId}/verify`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: JSON.stringify({ durationMs: 214_000 }),
      });
      expect(verified.status).toBe(200);
      const body = await verified.json();
      expect(body.status).toBe("ready");
      expect(body.takeDurationMs).toBe(214_000);

      const asset = await assetsRepo.getById(testApp.db, declared.assetId);
      expect(asset?.status).toBe("ready");
      expect(asset?.durationMs).toBe(214_000);
      // The first code in the app that ever writes this column.
      expect((await takesRepo.getById(testApp.db, take.id))?.durationMs).toBe(214_000);
    });

    it("does not move a duration the take already has", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      await takesRepo.update(testApp.db, take.id, { durationMs: 111_000, updatedAt: 1 });

      const declared = await declare(testApp, take.id, cookie);
      await fetch(declared.url, {
        method: "PUT",
        headers: declared.headers,
        body: new Uint8Array(12).fill(7),
      });
      const verified = await testApp.app.request(`/assets/${declared.assetId}/verify`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: JSON.stringify({ durationMs: 214_000 }),
      });

      expect((await verified.json()).takeDurationMs).toBeNull();
      expect((await takesRepo.getById(testApp.db, take.id))?.durationMs).toBe(111_000);
    });

    it("leaves the take's duration alone for a STEM — a stem may be an overdub", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      const bass = await instrumentsRepo.create(testApp.db, { slug: "bass", label: "Bass" });

      const declared = await declare(testApp, take.id, cookie, {
        kind: "stem",
        instrumentId: bass.id,
        format: "flac",
        tier: "lossless",
      });
      await fetch(declared.url, {
        method: "PUT",
        headers: declared.headers,
        body: new Uint8Array(12).fill(7),
      });
      await testApp.app.request(`/assets/${declared.assetId}/verify`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: JSON.stringify({ durationMs: 12_000 }),
      });

      expect((await takesRepo.getById(testApp.db, take.id))?.durationMs).toBeNull();
    });

    it("the bucket refuses a body of the wrong length — the signature covers it", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      const declared = await declare(testApp, take.id, cookie);

      const put = await fetch(declared.url, {
        method: "PUT",
        headers: declared.headers,
        body: new Uint8Array(5).fill(7),
      });

      expect(put.status).toBe(403);
    });

    it("the bucket refuses the wrong content type", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      const declared = await declare(testApp, take.id, cookie);

      const put = await fetch(declared.url, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: new Uint8Array(12).fill(7),
      });

      expect(put.status).toBe(403);
    });

    it("verify 409s when nothing arrived, and the row stays pending for a retry", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      const declared = await declare(testApp, take.id, cookie);

      // The failed-at-90% case, for real: the PUT never happened.
      const verified = await testApp.app.request(`/assets/${declared.assetId}/verify`, {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: JSON.stringify({}),
      });

      expect(verified.status).toBe(409);
      expect((await verified.json()).error.code).toBe("asset_missing");
      expect((await assetsRepo.getById(testApp.db, declared.assetId))?.status).toBe("pending");
    });

    it("verify is idempotent on an already-ready asset", async () => {
      const testApp = await build();
      const take = await seedTake(testApp);
      const cookie = await memberCookie(testApp);
      const declared = await declare(testApp, take.id, cookie);
      await fetch(declared.url, {
        method: "PUT",
        headers: declared.headers,
        body: new Uint8Array(12).fill(7),
      });
      const url = `/assets/${declared.assetId}/verify`;
      const opts = {
        method: "POST",
        headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
        body: JSON.stringify({}),
      };
      await testApp.app.request(url, opts);

      const again = await testApp.app.request(url, opts);

      expect(again.status).toBe(200);
      expect((await again.json()).alreadyReady).toBe(true);
    });
  });

  it("404s verify for an asset that isn't there", async () => {
    const testApp = await build();
    const cookie = await memberCookie(testApp);
    const res = await testApp.app.request("/assets/nope/verify", {
      method: "POST",
      headers: { ...jsonHeaders, cookie, origin: TEST_APP_ORIGIN },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});
