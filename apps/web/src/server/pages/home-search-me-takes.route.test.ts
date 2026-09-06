// `/`, `/takes/[id]`, `/search`, `/me` — same rationale and pattern as
// `songs-events.route.test.ts`: drives the BUILT server
// (`pnpm build` then `node dist/start.mjs`), never `astro dev`, since that
// divergence has already shipped real defects in this project (see the
// brief and `astro.config.mjs`'s `security.checkOrigin` comment).
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { generateToken, hashToken } from "@bandlib/core";
import {
  assetsRepo,
  createDb,
  eventsRepo,
  favoritesRepo,
  instrumentsRepo,
  loginTokensRepo,
  membersRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandlib/db";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const PORT = 43221;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = join(process.cwd(), "..", "..");

let dbDir: string;
let dbPath: string;
let child: ChildProcess | undefined;
let sessionCookie: string;

let favoriteSongSlug: string;
let favoriteTakeId: string;
let publishedUnvotedTakeId: string;
let takeWithAssetsId: string;
let takeWithNoAssetsId: string;
let bassInstrumentId: string;

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) {
        return;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${url} did not become ready in time: ${String(lastErr)}`);
}

async function seedAndGetSessionCookie(): Promise<string> {
  await execFileAsync("pnpm", ["--filter", "@bandlib/db", "run", "migrate"], {
    cwd: REPO_ROOT,
    env: { ...process.env, BANDLIB_DATABASE_URL: `file:${dbPath}` },
  });

  const client = createClient({ url: `file:${dbPath}` });
  const db = createDb(client);
  const now = Date.now();

  const member = await membersRepo.create(db, {
    displayName: "Robin Home-Test",
    slug: "robin-home-test",
    email: "robin-home@example.com",
    status: "active",
    createdAt: now,
  });

  const bass = await instrumentsRepo.create(db, { slug: "bass-home", label: "Bass" });
  bassInstrumentId = bass.id;

  const favoriteSong = await songsRepo.create(db, {
    title: "Home Favorite Song",
    slug: "home-favorite-song",
    createdAt: now,
    updatedAt: now,
  });
  favoriteSongSlug = favoriteSong.slug;

  const searchableSong = await songsRepo.create(db, {
    title: "Neon Skyline Searchable",
    slug: "neon-skyline-searchable",
    createdAt: now,
    updatedAt: now,
  });

  const event = await eventsRepo.create(db, {
    kind: "rehearsal",
    heldAt: now,
    venue: "Home Test Venue",
    createdAt: now,
    updatedAt: now,
  });

  const favoriteTake = await takesRepo.create(db, {
    songId: favoriteSong.id,
    eventId: event.id,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
    instrumentIds: [bass.id],
  });
  favoriteTakeId = favoriteTake.id;

  const publishedUnvoted = await takesRepo.create(db, {
    songId: searchableSong.id,
    eventId: event.id,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
    state: "published",
  });
  publishedUnvotedTakeId = publishedUnvoted.id;

  const takeWithAssets = await takesRepo.create(db, {
    songId: searchableSong.id,
    eventId: event.id,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
    instrumentIds: [bass.id],
  });
  takeWithAssetsId = takeWithAssets.id;
  await assetsRepo.createMany(db, [
    {
      takeId: takeWithAssets.id,
      kind: "master",
      tier: "lossless",
      format: "flac",
      storageKey: `home-test/${takeWithAssets.id}/master.flac`,
      contentType: "audio/flac",
      bytes: 42_000_000,
      status: "ready",
      createdAt: now,
      readyAt: now,
    },
    {
      takeId: takeWithAssets.id,
      kind: "stem",
      instrumentId: bass.id,
      tier: "lossy",
      format: "opus",
      storageKey: `home-test/${takeWithAssets.id}/bass.opus`,
      contentType: "audio/opus",
      bytes: 3_200_000,
      status: "ready",
      createdAt: now,
      readyAt: now,
    },
  ]);

  const takeWithNoAssets = await takesRepo.create(db, {
    songId: searchableSong.id,
    eventId: event.id,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  takeWithNoAssetsId = takeWithNoAssets.id;

  await votesRepo.castVote(db, {
    takeId: takeWithAssets.id,
    memberId: member.id,
    keeper: true,
    now,
  });

  await favoritesRepo.add(db, {
    memberId: member.id,
    targetType: "song",
    targetId: favoriteSong.id,
    createdAt: now,
  });
  await favoritesRepo.add(db, {
    memberId: member.id,
    targetType: "take",
    targetId: favoriteTake.id,
    createdAt: now,
  });

  const token = generateToken();
  await loginTokensRepo.create(db, {
    memberId: member.id,
    tokenHash: await hashToken(token),
    expiresAt: now + 15 * 60 * 1000,
    requestedIp: null,
    createdAt: now,
  });
  client.close();

  const consumeResponse = await fetch(`${ORIGIN}/login/${token}`, {
    method: "POST",
    headers: { origin: ORIGIN },
    redirect: "manual",
  });
  const setCookie = consumeResponse.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("expected a Set-Cookie header from consuming the login token");
  }
  return setCookie.split(";")[0] ?? "";
}

async function buildApp(): Promise<void> {
  await execFileAsync("pnpm", ["run", "build"], { cwd: process.cwd() });
}

function startBuiltServer(): ChildProcess {
  return spawn(process.execPath, [join(process.cwd(), "dist", "start.mjs")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      BANDLIB_DATABASE_URL: `file:${dbPath}`,
      BANDLIB_BOOTSTRAP_TOKEN: "home-route-test-bootstrap-token",
      BANDLIB_APP_ORIGIN: ORIGIN,
      BANDLIB_ALLOW_DEV_MAILER: "true",
      BANDLIB_COOKIE_SECURE: "false",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });
}

describe("home / search / me / take-detail routes over real HTTP", () => {
  beforeAll(async () => {
    dbDir = await mkdtemp(join(tmpdir(), "bandlib-home-route-"));
    dbPath = join(dbDir, "db.sqlite");

    await buildApp();
    child = startBuiltServer();
    await waitForServer(`${ORIGIN}/login`, 30_000);

    sessionCookie = await seedAndGetSessionCookie();
  }, 120_000);

  afterAll(async () => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
    await rm(dbDir, { recursive: true, force: true });
  });

  describe("/", () => {
    it("redirects an anonymous visitor to /login", async () => {
      const res = await fetch(`${ORIGIN}/`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it("renders favorites, recent events, and needs-your-vote for a signed-in member", async () => {
      const res = await fetch(`${ORIGIN}/`, { headers: { cookie: sessionCookie } });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(`/songs/${favoriteSongSlug}`); // favorite song, linked
      expect(body).toContain(`/takes/${favoriteTakeId}`); // favorite take, linked
      expect(body).toContain("Home Test Venue"); // recent event
      expect(body).toContain(`/takes/${publishedUnvotedTakeId}`); // needs-your-vote, linked
    });
  });

  describe("/takes/[id]", () => {
    it("redirects an anonymous visitor to /login", async () => {
      const res = await fetch(`${ORIGIN}/takes/${takeWithAssetsId}`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it("renders the take's song, assets, and lossless availability for a signed-in member", async () => {
      const res = await fetch(`${ORIGIN}/takes/${takeWithAssetsId}`, {
        headers: { cookie: sessionCookie },
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Neon Skyline Searchable");
      expect(body).toContain("Master");
      expect(body).toContain("Bass");
      expect(body).toContain("A lossless master is available.");
      // No playback affordance yet (increment 4) — no <audio> element and
      // no play-button markup, not just an absent "play" substring (which
      // "display" itself would trip).
      expect(body).not.toContain("<audio");
      expect(body).not.toContain("bl-btn-play");
    });

    it("renders a real empty state for a take with no assets, not an error", async () => {
      const res = await fetch(`${ORIGIN}/takes/${takeWithNoAssetsId}`, {
        headers: { cookie: sessionCookie },
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("No assets uploaded for this take yet.");
    });

    it("404s for an unknown take id", async () => {
      const res = await fetch(`${ORIGIN}/takes/00000000-0000-0000-0000-000000000000`, {
        headers: { cookie: sessionCookie },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("/search", () => {
    it("redirects an anonymous visitor to /login", async () => {
      const res = await fetch(`${ORIGIN}/search`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it("a plain GET with no filters renders every take", async () => {
      const res = await fetch(`${ORIGIN}/search`, { headers: { cookie: sessionCookie } });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Neon Skyline Searchable");
      expect(body).toContain("Home Favorite Song");
    });

    it("filters by free text (song title) via a plain GET query string", async () => {
      const res = await fetch(`${ORIGIN}/search?q=skyline`, { headers: { cookie: sessionCookie } });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Neon Skyline Searchable");
      expect(body).not.toContain("Home Favorite Song");
    });

    it("filters by instrument via a plain GET query string", async () => {
      const res = await fetch(`${ORIGIN}/search?instrument=${bassInstrumentId}`, {
        headers: { cookie: sessionCookie },
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Home Favorite Song");
    });

    it("filters by state via a plain GET query string", async () => {
      const res = await fetch(`${ORIGIN}/search?state=published`, {
        headers: { cookie: sessionCookie },
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Neon Skyline Searchable");
      expect(body).not.toContain("Home Favorite Song");
    });

    it("the URL round-trips — the same query string yields the same result set", async () => {
      const url = `${ORIGIN}/search?q=skyline&state=published`;
      const first = await fetch(url, { headers: { cookie: sessionCookie } });
      const second = await fetch(url, { headers: { cookie: sessionCookie } });
      expect(await first.text()).toEqual(await second.text());
    });

    it("returns a real empty state, not an error, when nothing matches", async () => {
      const res = await fetch(`${ORIGIN}/search?q=no-such-song-title-anywhere`, {
        headers: { cookie: sessionCookie },
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("No takes match those filters");
    });
  });

  describe("/me", () => {
    it("redirects an anonymous visitor to /login", async () => {
      const res = await fetch(`${ORIGIN}/me`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it("renders the member's name, sessions, favorites, and votes", async () => {
      const res = await fetch(`${ORIGIN}/me`, { headers: { cookie: sessionCookie } });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Robin Home-Test");
      expect(body).toContain("this device");
      expect(body).toContain("Home Favorite Song");
      expect(body).toContain("Neon Skyline Searchable"); // the take voted on
      expect(body).toContain("keeper");
    });
  });
});
