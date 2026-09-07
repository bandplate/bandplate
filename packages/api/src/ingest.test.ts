// Ingest API — contract v1 (`docs/ingest-contract-v1.md`). Exercises the
// full three-phase flow end to end against `InMemoryStorage` (a real HTTP
// server behind the presigned URLs, not a mock — see
// `@bandlib/storage/testing`'s own header comment), plus every documented
// error path and — the actual point of this file, per the ingest brief —
// idempotency proved by DIFFING DATABASE STATE across a repeated run, not
// by asserting a status code twice.
import { createHash } from "node:crypto";
import { createServiceToken } from "@bandlib/core";
import {
  assetsRepo,
  eventsRepo,
  instrumentsRepo,
  membersRepo,
  songsRepo,
  takesRepo,
} from "@bandlib/db";
import { describe, expect, it } from "vitest";
import {
  TEST_APP_ORIGIN,
  type TestApp,
  buildTestApp,
  extractLoginToken,
  extractSessionCookieValue,
} from "./test-helpers.js";

async function ingestToken(testApp: TestApp, scopes: string[] = ["ingest:write"]) {
  const created = await createServiceToken(
    { db: testApp.db, mailer: testApp.mailer, clock: testApp.clock },
    // biome-ignore lint/suspicious/noExplicitAny: test-only, scopes come from the caller
    { label: "reaper bridge", scopes: scopes as any },
  );
  return { authorization: `Bearer ${created.rawToken}` };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function seedInstruments(testApp: TestApp): Promise<void> {
  await instrumentsRepo.create(testApp.db, { slug: "bass", label: "Bass" });
  await instrumentsRepo.create(testApp.db, { slug: "drums", label: "Drums" });
}

const jsonHeaders = { "content-type": "application/json" };

describe("ingest API", () => {
  describe("authentication (contract v1 §2/§9)", () => {
    it("401s with no token", async () => {
      const testApp = await buildTestApp();
      const res = await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("unauthorized");
    });

    it("401s with a malformed bearer token", async () => {
      const testApp = await buildTestApp();
      const res = await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, authorization: "Bearer not-a-real-token" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it("401s with a revoked token", async () => {
      const testApp = await buildTestApp();
      const created = await createServiceToken(
        { db: testApp.db, mailer: testApp.mailer, clock: testApp.clock },
        { label: "revoked", scopes: ["ingest:write"] },
      );
      const { serviceTokensRepo } = await import("@bandlib/db");
      await serviceTokensRepo.revoke(testApp.db, created.id, testApp.clock.now());

      const res = await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, authorization: `Bearer ${created.rawToken}` },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it("403s (not 401) a real service token missing ingest:write, and names the missing scope", async () => {
      const testApp = await buildTestApp();
      const auth = await ingestToken(testApp, ["songs:read"]);
      const res = await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
      expect(body.error.message).toContain("ingest:write");
    });

    it("401s a member session (bearer-only surface, not the cookie one), even an admin's", async () => {
      // The ingest surface is machine-to-machine only — no member session
      // should ever satisfy `requireServiceScopes`, even an admin's
      // (`scopesForRole("admin")` includes every scope in the vocabulary,
      // `ingest:write` included — this proves the guard checks the
      // PRINCIPAL KIND, not just scope membership).
      const testApp = await buildTestApp();
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
        headers: { "content-type": "application/json", origin: TEST_APP_ORIGIN },
        body: JSON.stringify({ email: "admin@example.com" }),
      });
      const token = extractLoginToken(testApp.mailer);
      const loginRes = await testApp.app.request(`/auth/login/${token}`, {
        method: "POST",
        headers: { origin: TEST_APP_ORIGIN },
      });
      const cookie = extractSessionCookieValue(loginRes.headers.get("set-cookie"));

      const res = await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, origin: TEST_APP_ORIGIN, cookie: `bl_session=${cookie}` },
        body: JSON.stringify({
          clientRef: "x",
          kind: "rehearsal",
          heldAt: "2026-09-05T19:30:00+02:00",
        }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /ingest/v1/instruments", () => {
    it("lists the live vocabulary", async () => {
      const testApp = await buildTestApp();
      await seedInstruments(testApp);
      const auth = await ingestToken(testApp);
      const res = await testApp.app.request("/ingest/v1/instruments", { headers: auth });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.instruments.map((i: { slug: string }) => i.slug).sort()).toEqual([
        "bass",
        "drums",
      ]);
    });
  });

  describe("GET /ingest/v1/openapi.json", () => {
    it("is public and describes every ingest route with a security requirement", async () => {
      const testApp = await buildTestApp();
      const res = await testApp.app.request("/ingest/v1/openapi.json");
      expect(res.status).toBe(200);
      const doc = await res.json();
      expect(doc.openapi).toBe("3.1.0");
      expect(doc.paths["/ingest/v1/events"].post.security).toEqual([
        { serviceToken: ["ingest:write"] },
      ]);
      expect(
        doc.paths["/ingest/v1/takes"].post.requestBody.content["application/json"].schema.type,
      ).toBe("object");
      expect(doc.components.securitySchemes.serviceToken.scheme).toBe("bearer");
    });
  });

  describe("POST /ingest/v1/events", () => {
    it("creates an event and is idempotent on clientRef", async () => {
      const testApp = await buildTestApp();
      const auth = await ingestToken(testApp);
      const body = {
        clientRef: "proj-1",
        kind: "rehearsal",
        heldAt: "2026-09-05T19:30:00+02:00",
        venue: "Zkušebna Vysočany",
        notes: "new tune runthroughs",
      };

      const first = await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify(body),
      });
      expect(first.status).toBe(200);
      const firstJson = await first.json();
      expect(firstJson.created).toBe(true);

      const second = await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify(body),
      });
      const secondJson = await second.json();
      expect(secondJson.created).toBe(false);
      expect(secondJson.eventId).toBe(firstJson.eventId);

      const all = await eventsRepo.listRecent(testApp.db);
      expect(all).toHaveLength(1);
    });

    it("422s on a bad heldAt (no offset)", async () => {
      const testApp = await buildTestApp();
      const auth = await ingestToken(testApp);
      const res = await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({ clientRef: "x", kind: "rehearsal", heldAt: "2026-09-05T19:30:00" }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("validation_failed");
    });
  });

  describe("full three-phase flow (contract v1 §4/§10)", () => {
    async function declareEvent(testApp: TestApp, auth: HeadersInit, clientRef: string) {
      const res = await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef,
          kind: "rehearsal",
          heldAt: "2026-09-05T19:30:00+02:00",
        }),
      });
      return res.json();
    }

    it("declares a take, uploads real bytes, and commits to published", async () => {
      const testApp = await buildTestApp();
      await seedInstruments(testApp);
      const auth = await ingestToken(testApp);

      const event = await declareEvent(testApp, auth, "proj-flow");

      const masterBytes = new TextEncoder().encode("fake opus master bytes");
      const stemBytes = new TextEncoder().encode("fake opus bass stem bytes");
      const peaksBytes = new TextEncoder().encode(JSON.stringify(Array(1000).fill(0)));

      const takeBody = {
        clientRef: "reaper:region-guid:AAA",
        eventClientRef: "proj-flow",
        song: { externalRef: "reaper:region-guid:AAA", title: "Dub Corner", createIfMissing: true },
        recordedAt: "2026-09-05T20:14:33+02:00",
        durationMs: 254300,
        label: "take 3",
        instruments: ["bass", "drums"],
        assets: [
          {
            kind: "master",
            tier: "lossy",
            format: "opus",
            bytes: masterBytes.length,
            sha256: sha256Hex(masterBytes),
            durationMs: 254300,
          },
          {
            kind: "stem",
            instrument: "bass",
            tier: "lossy",
            format: "opus",
            bytes: stemBytes.length,
            sha256: sha256Hex(stemBytes),
          },
          { kind: "peaks", tier: "lossy", format: "json", bytes: peaksBytes.length },
        ],
      };

      const takeRes = await testApp.app.request("/ingest/v1/takes", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify(takeBody),
      });
      expect(takeRes.status).toBe(200);
      const takeJson = await takeRes.json();
      expect(takeJson.songCreated).toBe(true);
      expect(takeJson.songMatch).toBe("created-stub");
      expect(takeJson.state).toBe("uploading");
      expect(takeJson.uploads).toHaveLength(3);
      for (const upload of takeJson.uploads) {
        expect(upload.status).toBe("pending");
        expect(upload.method).toBe("PUT");
        expect(upload.url).toBeTruthy();
      }

      // Stub song got the externalRef recorded as an alias.
      const song = await songsRepo.getById(testApp.db, takeJson.songId);
      expect(song?.isStub).toBe(true);
      const aliases = await songsRepo.listAliases(testApp.db, takeJson.songId);
      expect(aliases.some((a) => a.aliasNorm.includes("aaa"))).toBe(true);

      // Real PUT uploads against the presigned URLs.
      const byKind: Record<string, { url: string; headers: Record<string, string> }> = {};
      for (const u of takeJson.uploads) {
        byKind[u.instrument ? `${u.kind}:${u.instrument}` : u.kind] = u;
      }
      const putBytes = { master: masterBytes, "stem:bass": stemBytes, peaks: peaksBytes };
      for (const [key, bytes] of Object.entries(putBytes)) {
        const upload = byKind[key];
        if (!upload) {
          throw new Error(`no upload entry for ${key}`);
        }
        const putRes = await fetch(upload.url, {
          method: "PUT",
          headers: upload.headers,
          body: bytes,
        });
        if (putRes.status >= 300) {
          throw new Error(`upload of ${key} failed (${putRes.status}): ${await putRes.text()}`);
        }
      }

      // Commit before upload would 409; now it should publish.
      const commitRes = await testApp.app.request(`/ingest/v1/takes/${takeJson.takeId}/commit`, {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({ publish: true }),
      });
      const commitJson = await commitRes.json();
      expect(commitRes.status, JSON.stringify(commitJson)).toBe(200);
      expect(commitJson.state).toBe("published");
      expect(commitJson.assets.every((a: { status: string }) => a.status === "ready")).toBe(true);

      const take = await takesRepo.getById(testApp.db, takeJson.takeId);
      expect(take?.state).toBe("published");
      expect(take?.publishedAt).not.toBeNull();
    });

    it("409s assets_incomplete when committing before any upload", async () => {
      const testApp = await buildTestApp();
      await seedInstruments(testApp);
      const auth = await ingestToken(testApp);
      await declareEvent(testApp, auth, "proj-incomplete");

      const takeRes = await testApp.app.request("/ingest/v1/takes", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "take-incomplete",
          eventClientRef: "proj-incomplete",
          song: { title: "Some Song", createIfMissing: true },
          recordedAt: "2026-09-05T20:14:33+02:00",
          instruments: [],
          assets: [
            {
              kind: "master",
              tier: "lossy",
              format: "opus",
              bytes: 100,
              sha256: sha256Hex(new Uint8Array(1)),
            },
          ],
        }),
      });
      const takeJson = await takeRes.json();

      const commitRes = await testApp.app.request(`/ingest/v1/takes/${takeJson.takeId}/commit`, {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({ publish: true }),
      });
      expect(commitRes.status).toBe(409);
      const commitJson = await commitRes.json();
      expect(commitJson.error.code).toBe("assets_incomplete");
      expect(commitJson.missing).toHaveLength(1);

      const take = await takesRepo.getById(testApp.db, takeJson.takeId);
      expect(take?.state).toBe("uploading");
    });

    it("committing an already-published take is a no-op (safe to retry)", async () => {
      const testApp = await buildTestApp();
      await seedInstruments(testApp);
      const auth = await ingestToken(testApp);
      await declareEvent(testApp, auth, "proj-recommit");

      const bytes = new TextEncoder().encode("audio");
      const takeRes = await testApp.app.request("/ingest/v1/takes", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "take-recommit",
          eventClientRef: "proj-recommit",
          song: { title: "Recommit Song", createIfMissing: true },
          recordedAt: "2026-09-05T20:14:33+02:00",
          instruments: [],
          assets: [
            {
              kind: "master",
              tier: "lossy",
              format: "opus",
              bytes: bytes.length,
              sha256: sha256Hex(bytes),
            },
          ],
        }),
      });
      const takeJson = await takeRes.json();
      const upload = takeJson.uploads[0];
      await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes });

      const first = await testApp.app.request(`/ingest/v1/takes/${takeJson.takeId}/commit`, {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({ publish: true }),
      });
      expect(first.status).toBe(200);

      // A second commit — even asking NOT to publish — must not un-publish.
      const second = await testApp.app.request(`/ingest/v1/takes/${takeJson.takeId}/commit`, {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({ publish: false }),
      });
      expect(second.status).toBe(200);
      const secondJson = await second.json();
      expect(secondJson.state).toBe("published");

      const take = await takesRepo.getById(testApp.db, takeJson.takeId);
      expect(take?.state).toBe("published");
    });
  });

  describe("song identity (contract v1 §6)", () => {
    it("409s song_not_found with candidates when createIfMissing is false and nothing matches", async () => {
      const testApp = await buildTestApp();
      const auth = await ingestToken(testApp);
      await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "proj-nf",
          kind: "rehearsal",
          heldAt: "2026-09-05T19:30:00+02:00",
        }),
      });

      const res = await testApp.app.request("/ingest/v1/takes", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "take-nf",
          eventClientRef: "proj-nf",
          song: { title: "Totally Unknown Song", createIfMissing: false },
          recordedAt: "2026-09-05T20:14:33+02:00",
          instruments: [],
          assets: [{ kind: "master", tier: "lossy", format: "opus", bytes: 10 }],
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("song_not_found");
      expect(Array.isArray(body.candidates)).toBe(true);
    });

    it("matches an existing song by normalized title and records the externalRef as a new alias", async () => {
      const testApp = await buildTestApp();
      const auth = await ingestToken(testApp);
      const now = testApp.clock.now();
      const song = await songsRepo.create(testApp.db, {
        title: "Přítel",
        slug: "pritel",
        createdAt: now,
        updatedAt: now,
      });
      await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "proj-title",
          kind: "rehearsal",
          heldAt: "2026-09-05T19:30:00+02:00",
        }),
      });

      const res = await testApp.app.request("/ingest/v1/takes", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "take-title",
          eventClientRef: "proj-title",
          // Diacritics-insensitive title match — "pritel" (no diacritics) must match "Přítel".
          song: {
            externalRef: "reaper:region-guid:TITLE1",
            title: "pritel",
            createIfMissing: false,
          },
          recordedAt: "2026-09-05T20:14:33+02:00",
          instruments: [],
          assets: [{ kind: "master", tier: "lossy", format: "opus", bytes: 10 }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.songId).toBe(song.id);
      expect(body.songMatch).toBe("title");

      const aliases = await songsRepo.listAliases(testApp.db, song.id);
      expect(aliases.some((a) => a.aliasNorm.includes("title1"))).toBe(true);
    });
  });

  describe("instrument vocabulary (contract v1 §7)", () => {
    it("422s unknown_instrument and lists the valid slugs", async () => {
      const testApp = await buildTestApp();
      await seedInstruments(testApp);
      const auth = await ingestToken(testApp);
      await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "proj-vocab",
          kind: "rehearsal",
          heldAt: "2026-09-05T19:30:00+02:00",
        }),
      });

      const res = await testApp.app.request("/ingest/v1/takes", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "take-vocab",
          eventClientRef: "proj-vocab",
          song: { title: "Vocab Song", createIfMissing: true },
          recordedAt: "2026-09-05T20:14:33+02:00",
          instruments: ["BASS DI 2"],
          assets: [{ kind: "master", tier: "lossy", format: "opus", bytes: 10 }],
        }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("unknown_instrument");
      expect(body.validSlugs.sort()).toEqual(["bass", "drums"]);

      // Never silently created.
      const instruments = await instrumentsRepo.list(testApp.db);
      expect(instruments.map((i) => i.slug).sort()).toEqual(["bass", "drums"]);
    });
  });

  describe("idempotency — repeated runs converge, never duplicate", () => {
    it("re-running the exact same event+take+asset sequence twice leaves the database unchanged", async () => {
      const testApp = await buildTestApp();
      await seedInstruments(testApp);
      const auth = await ingestToken(testApp);
      const bytes = new TextEncoder().encode("idempotent audio bytes");

      async function runOnce() {
        await testApp.app.request("/ingest/v1/events", {
          method: "POST",
          headers: { ...jsonHeaders, ...auth },
          body: JSON.stringify({
            clientRef: "proj-idem",
            kind: "rehearsal",
            heldAt: "2026-09-05T19:30:00+02:00",
          }),
        });
        const takeRes = await testApp.app.request("/ingest/v1/takes", {
          method: "POST",
          headers: { ...jsonHeaders, ...auth },
          body: JSON.stringify({
            clientRef: "take-idem",
            eventClientRef: "proj-idem",
            song: {
              externalRef: "reaper:region-guid:IDEM",
              title: "Idempotent Song",
              createIfMissing: true,
            },
            recordedAt: "2026-09-05T20:14:33+02:00",
            instruments: ["bass"],
            assets: [
              {
                kind: "master",
                tier: "lossy",
                format: "opus",
                bytes: bytes.length,
                sha256: sha256Hex(bytes),
              },
            ],
          }),
        });
        const takeJson = await takeRes.json();
        for (const upload of takeJson.uploads) {
          if (upload.status === "pending") {
            await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes });
          }
        }
        await testApp.app.request(`/ingest/v1/takes/${takeJson.takeId}/commit`, {
          method: "POST",
          headers: { ...jsonHeaders, ...auth },
          body: JSON.stringify({ publish: true }),
        });
        return takeJson;
      }

      const first = await runOnce();

      const eventsBefore = await eventsRepo.listRecent(testApp.db);
      const takesBefore = await takesRepo.getByClientRef(testApp.db, "take-idem");
      const assetsBefore = await assetsRepo.listByTake(testApp.db, first.takeId);
      const songsBeforeCount = (await songsRepo.list(testApp.db)).length;

      const second = await runOnce();

      const eventsAfter = await eventsRepo.listRecent(testApp.db);
      const takesAfter = await takesRepo.getByClientRef(testApp.db, "take-idem");
      const assetsAfter = await assetsRepo.listByTake(testApp.db, first.takeId);
      const songsAfterCount = (await songsRepo.list(testApp.db)).length;

      expect(second.takeId).toBe(first.takeId);
      expect(eventsAfter).toHaveLength(eventsBefore.length);
      expect(eventsAfter.length).toBe(1);
      expect(assetsAfter).toHaveLength(assetsBefore.length);
      expect(assetsAfter.length).toBe(1);
      expect(assetsAfter[0]?.id).toBe(assetsBefore[0]?.id);
      expect(assetsAfter[0]?.status).toBe("ready");
      expect(takesAfter?.id).toBe(takesBefore?.id);
      expect(songsAfterCount).toBe(songsBeforeCount);
      expect(songsAfterCount).toBe(1);
    });

    it("a changed sha256 on retry resets that asset's slot to pending and re-uploads to the SAME storage key", async () => {
      const testApp = await buildTestApp();
      const auth = await ingestToken(testApp);
      await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "proj-reup",
          kind: "rehearsal",
          heldAt: "2026-09-05T19:30:00+02:00",
        }),
      });

      const v1 = new TextEncoder().encode("version one");
      const v2 = new TextEncoder().encode("version two, longer content");

      async function declare(bytes: Uint8Array) {
        const res = await testApp.app.request("/ingest/v1/takes", {
          method: "POST",
          headers: { ...jsonHeaders, ...auth },
          body: JSON.stringify({
            clientRef: "take-reup",
            eventClientRef: "proj-reup",
            song: { title: "Reupload Song", createIfMissing: true },
            recordedAt: "2026-09-05T20:14:33+02:00",
            instruments: [],
            assets: [
              {
                kind: "master",
                tier: "lossy",
                format: "opus",
                bytes: bytes.length,
                sha256: sha256Hex(bytes),
              },
            ],
          }),
        });
        return res.json();
      }

      const first = await declare(v1);
      const upload1 = first.uploads[0];
      await fetch(upload1.url, { method: "PUT", headers: upload1.headers, body: v1 });
      await testApp.app.request(`/ingest/v1/takes/${first.takeId}/commit`, {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({ publish: true }),
      });

      const assetsAfterFirst = await assetsRepo.listByTake(testApp.db, first.takeId);
      expect(assetsAfterFirst[0]?.status).toBe("ready");
      const storageKey = assetsAfterFirst[0]?.storageKey;

      // Re-declare with a DIFFERENT hash/size for the same slot.
      const second = await declare(v2);
      const asset2 = second.uploads[0];
      expect(asset2.status).toBe("pending");
      expect(asset2.storageKey).toBe(storageKey); // same key — overwrite, not orphan
      expect(asset2.assetId).toBe(assetsAfterFirst[0]?.id); // same row, reset in place

      const assetsAfterReDeclare = await assetsRepo.listByTake(testApp.db, first.takeId);
      expect(assetsAfterReDeclare).toHaveLength(1);
      expect(assetsAfterReDeclare[0]?.status).toBe("pending");
    });

    it("a matching sha256+bytes on retry returns status ready with no url, and skips it", async () => {
      const testApp = await buildTestApp();
      const auth = await ingestToken(testApp);
      await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "proj-skip",
          kind: "rehearsal",
          heldAt: "2026-09-05T19:30:00+02:00",
        }),
      });
      const bytes = new TextEncoder().encode("stable content");

      async function declare() {
        const res = await testApp.app.request("/ingest/v1/takes", {
          method: "POST",
          headers: { ...jsonHeaders, ...auth },
          body: JSON.stringify({
            clientRef: "take-skip",
            eventClientRef: "proj-skip",
            song: { title: "Skip Song", createIfMissing: true },
            recordedAt: "2026-09-05T20:14:33+02:00",
            instruments: [],
            assets: [
              {
                kind: "master",
                tier: "lossy",
                format: "opus",
                bytes: bytes.length,
                sha256: sha256Hex(bytes),
              },
            ],
          }),
        });
        return res.json();
      }

      const first = await declare();
      const upload = first.uploads[0];
      await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes });
      await testApp.app.request(`/ingest/v1/takes/${first.takeId}/commit`, {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({ publish: true }),
      });

      const second = await declare();
      expect(second.uploads[0].status).toBe("ready");
      expect(second.uploads[0].url).toBeUndefined();
    });
  });

  describe("GET /ingest/v1/takes/:id/uploads", () => {
    it("returns fresh URLs for pending assets without re-declaring the take", async () => {
      const testApp = await buildTestApp();
      const auth = await ingestToken(testApp);
      await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "proj-refresh",
          kind: "rehearsal",
          heldAt: "2026-09-05T19:30:00+02:00",
        }),
      });
      const takeRes = await testApp.app.request("/ingest/v1/takes", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "take-refresh",
          eventClientRef: "proj-refresh",
          song: { title: "Refresh Song", createIfMissing: true },
          recordedAt: "2026-09-05T20:14:33+02:00",
          instruments: [],
          assets: [{ kind: "master", tier: "lossy", format: "opus", bytes: 10 }],
        }),
      });
      const takeJson = await takeRes.json();

      const res = await testApp.app.request(`/ingest/v1/takes/${takeJson.takeId}/uploads`, {
        headers: auth,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.uploads).toHaveLength(1);
      expect(body.uploads[0].status).toBe("pending");
      expect(body.uploads[0].url).toBeTruthy();
    });

    it("404s for an unknown take id", async () => {
      const testApp = await buildTestApp();
      const auth = await ingestToken(testApp);
      const res = await testApp.app.request("/ingest/v1/takes/does-not-exist/uploads", {
        headers: auth,
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /ingest/v1/takes/:id (contract v1 §8)", () => {
    it("deletes a take while uploading, including its assets", async () => {
      const testApp = await buildTestApp();
      const auth = await ingestToken(testApp);
      await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "proj-del",
          kind: "rehearsal",
          heldAt: "2026-09-05T19:30:00+02:00",
        }),
      });
      const takeRes = await testApp.app.request("/ingest/v1/takes", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "take-del",
          eventClientRef: "proj-del",
          song: { title: "Delete Me", createIfMissing: true },
          recordedAt: "2026-09-05T20:14:33+02:00",
          instruments: [],
          assets: [{ kind: "master", tier: "lossy", format: "opus", bytes: 10 }],
        }),
      });
      const takeJson = await takeRes.json();

      const delRes = await testApp.app.request(`/ingest/v1/takes/${takeJson.takeId}`, {
        method: "DELETE",
        headers: auth,
      });
      expect(delRes.status).toBe(200);

      expect(await takesRepo.getById(testApp.db, takeJson.takeId)).toBeUndefined();
      expect(await assetsRepo.listByTake(testApp.db, takeJson.takeId)).toHaveLength(0);
    });

    it("refuses to delete a published take", async () => {
      const testApp = await buildTestApp();
      const auth = await ingestToken(testApp);
      await testApp.app.request("/ingest/v1/events", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "proj-nodel",
          kind: "rehearsal",
          heldAt: "2026-09-05T19:30:00+02:00",
        }),
      });
      const bytes = new TextEncoder().encode("x");
      const takeRes = await testApp.app.request("/ingest/v1/takes", {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({
          clientRef: "take-nodel",
          eventClientRef: "proj-nodel",
          song: { title: "No Delete", createIfMissing: true },
          recordedAt: "2026-09-05T20:14:33+02:00",
          instruments: [],
          assets: [
            {
              kind: "master",
              tier: "lossy",
              format: "opus",
              bytes: bytes.length,
              sha256: sha256Hex(bytes),
            },
          ],
        }),
      });
      const takeJson = await takeRes.json();
      const upload = takeJson.uploads[0];
      await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes });
      await testApp.app.request(`/ingest/v1/takes/${takeJson.takeId}/commit`, {
        method: "POST",
        headers: { ...jsonHeaders, ...auth },
        body: JSON.stringify({ publish: true }),
      });

      const delRes = await testApp.app.request(`/ingest/v1/takes/${takeJson.takeId}`, {
        method: "DELETE",
        headers: auth,
      });
      expect(delRes.status).toBe(409);
      expect(await takesRepo.getById(testApp.db, takeJson.takeId)).toBeDefined();
    });
  });
});
