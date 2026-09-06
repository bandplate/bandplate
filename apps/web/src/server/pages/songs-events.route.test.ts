// `/songs`, `/songs/[slug]`, `/events`, `/events/[id]` over real HTTP —
// same rationale as `login-token.route.test.ts`: guard.test.ts and
// middleware.test.ts already prove the redirect/allow decision logic in
// isolation, but nothing before this exercised the actual routes wired
// through Astro's router and this session middleware together. One shared
// dev server for the whole suite, since each spawn costs several seconds.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { generateToken, hashToken } from "@bandlib/core";
import {
  createDb,
  eventsRepo,
  instrumentsRepo,
  loginTokensRepo,
  membersRepo,
  songsRepo,
  takesRepo,
} from "@bandlib/db";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const PORT = 43219;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = join(process.cwd(), "..", "..");

let dbDir: string;
let dbPath: string;
let child: ChildProcess | undefined;
let sessionCookie: string;
let songSlug: string;
let songSlugNoTakes: string;
let eventId: string;
let eventIdNoTakes: string;
let bassInstrumentId: string;
let drumsInstrumentId: string;

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
    displayName: "Robin Route-Test",
    slug: "robin-route-test",
    email: "robin@example.com",
    status: "active",
    createdAt: now,
  });

  const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
  const drums = await instrumentsRepo.create(db, { slug: "drums", label: "Drums" });
  bassInstrumentId = bass.id;
  drumsInstrumentId = drums.id;

  const songWithTakes = await songsRepo.create(db, {
    title: "Route Test Song",
    slug: "route-test-song",
    createdAt: now,
    updatedAt: now,
  });
  songSlug = songWithTakes.slug;

  const songWithoutTakes = await songsRepo.create(db, {
    title: "Route Test Stub",
    slug: "route-test-stub",
    isStub: true,
    createdAt: now,
    updatedAt: now,
  });
  songSlugNoTakes = songWithoutTakes.slug;

  const eventWithTakes = await eventsRepo.create(db, {
    kind: "concert",
    heldAt: now,
    venue: "Route Test Venue",
    createdAt: now,
    updatedAt: now,
  });
  eventId = eventWithTakes.id;

  const eventWithoutTakes = await eventsRepo.create(db, {
    kind: "rehearsal",
    heldAt: now - 1000,
    createdAt: now - 1000,
    updatedAt: now - 1000,
  });
  eventIdNoTakes = eventWithoutTakes.id;

  await takesRepo.create(db, {
    songId: songWithTakes.id,
    eventId: eventWithTakes.id,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
    instrumentIds: [bass.id],
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
  // Only the cookie's own name=value pair, not the Path/HttpOnly/etc attributes.
  return setCookie.split(";")[0] ?? "";
}

function startDevServer(): ChildProcess {
  return spawn(
    process.execPath,
    [
      join(process.cwd(), "node_modules", "astro", "astro.js"),
      "dev",
      "--port",
      String(PORT),
      "--host",
      "127.0.0.1",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BANDLIB_DATABASE_URL: `file:${dbPath}`,
        BANDLIB_BOOTSTRAP_TOKEN: "route-test-bootstrap-token",
        BANDLIB_APP_ORIGIN: ORIGIN,
        BANDLIB_ALLOW_DEV_MAILER: "true",
        BANDLIB_COOKIE_SECURE: "false",
        NODE_ENV: "test",
      },
      stdio: "ignore",
    },
  );
}

describe("member browsing routes over real HTTP", () => {
  beforeAll(async () => {
    dbDir = await mkdtemp(join(tmpdir(), "bandlib-songs-events-route-"));
    dbPath = join(dbDir, "db.sqlite");

    child = startDevServer();
    await waitForServer(`${ORIGIN}/login`, 30_000);

    sessionCookie = await seedAndGetSessionCookie();
  }, 45_000);

  afterAll(async () => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
    await rm(dbDir, { recursive: true, force: true });
  });

  it("redirects an anonymous visitor away from /songs to /login", async () => {
    const res = await fetch(`${ORIGIN}/songs`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("redirects an anonymous visitor away from /events to /login", async () => {
    const res = await fetch(`${ORIGIN}/events`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("renders /songs for a signed-in member", async () => {
    const res = await fetch(`${ORIGIN}/songs`, { headers: { cookie: sessionCookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Route Test Song");
  });

  it("renders /songs/[slug] for a signed-in member, with its take", async () => {
    const res = await fetch(`${ORIGIN}/songs/${songSlug}`, { headers: { cookie: sessionCookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Route Test Song");
  });

  it("renders a real empty state for a song with no takes, not an error", async () => {
    const res = await fetch(`${ORIGIN}/songs/${songSlugNoTakes}`, {
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("No takes of this one yet");
  });

  it("404s for an unknown song slug", async () => {
    const res = await fetch(`${ORIGIN}/songs/not-a-real-slug`, {
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(404);
  });

  it("renders /events for a signed-in member", async () => {
    const res = await fetch(`${ORIGIN}/events`, { headers: { cookie: sessionCookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Route Test Venue");
  });

  it("renders /events/[id] for a signed-in member, with its take", async () => {
    const res = await fetch(`${ORIGIN}/events/${eventId}`, { headers: { cookie: sessionCookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Route Test Song");
  });

  it("renders a real empty state for an event with no takes, not an error", async () => {
    const res = await fetch(`${ORIGIN}/events/${eventIdNoTakes}`, {
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("No takes logged for this one yet");
  });

  it("404s for an unknown event id", async () => {
    const res = await fetch(`${ORIGIN}/events/00000000-0000-0000-0000-000000000000`, {
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(404);
  });

  it("filters /songs by a plain GET query string — the JS-off path for the instrument checkboxes", async () => {
    const matching = await fetch(`${ORIGIN}/songs?instrument=${bassInstrumentId}`, {
      headers: { cookie: sessionCookie },
    });
    expect(matching.status).toBe(200);
    const matchingBody = await matching.text();
    expect(matchingBody).toContain("Route Test Song");

    // bass AND drums together match no take (AND semantics) — a plain GET
    // with both checkboxes checked must return the real empty state.
    const noMatch = await fetch(
      `${ORIGIN}/songs?instrument=${bassInstrumentId}&instrument=${drumsInstrumentId}`,
      { headers: { cookie: sessionCookie } },
    );
    expect(noMatch.status).toBe(200);
    const noMatchBody = await noMatch.text();
    expect(noMatchBody).not.toContain("Route Test Song");
  });

  it("filters /events by a plain GET query string — the JS-off path for the kind checkboxes", async () => {
    const concertsOnly = await fetch(`${ORIGIN}/events?kind=concert`, {
      headers: { cookie: sessionCookie },
    });
    const body = await concertsOnly.text();
    expect(body).toContain("Route Test Venue");

    const rehearsalsOnly = await fetch(`${ORIGIN}/events?kind=rehearsal`, {
      headers: { cookie: sessionCookie },
    });
    const rehearsalsBody = await rehearsalsOnly.text();
    expect(rehearsalsBody).not.toContain("Route Test Venue");
  });
});
