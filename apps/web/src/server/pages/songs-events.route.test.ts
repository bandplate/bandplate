// `/songs`, `/songs/[slug]`, `/events`, `/events/[id]` over real HTTP —
// same rationale as `login-token.route.test.ts`: guard.test.ts and
// middleware.test.ts already prove the redirect/allow decision logic in
// isolation, but nothing before this exercised the actual routes wired
// through Astro's router and this session middleware together. One shared
// server for the whole suite, since each spawn costs several seconds.
//
// Drives the BUILT server (`pnpm build` then `node dist/start.mjs`), never
// `astro dev` — the project's own constraint (see the brief and
// `astro.config.mjs`'s `security.checkOrigin` comment): the dev server and
// the Node adapter resolve request origin differently, a divergence that's
// invisible to typecheck/lint/unit-tests/build and already shipped one
// Critical here. A route test that only ever boots `astro dev` cannot catch
// that class of bug, which defeats the point of a route-level test in this
// codebase specifically.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { generateToken, hashToken } from "@bandplate/core";
import {
  assetsRepo,
  createDb,
  eventsRepo,
  instrumentsRepo,
  loginTokensRepo,
  membersRepo,
  songsRepo,
  takesRepo,
} from "@bandplate/db";
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
let eventIdPlayable: string;
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
  await execFileAsync("pnpm", ["--filter", "@bandplate/db", "run", "migrate"], {
    cwd: REPO_ROOT,
    env: { ...process.env, BANDPLATE_DATABASE_URL: `file:${dbPath}` },
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

  // Two more on the same CONCERT, for the note-suppression pair below. One is
  // labelled with the word that event's kind renders as ("live"), the other
  // with something a page cannot know.
  await takesRepo.create(db, {
    songId: songWithTakes.id,
    eventId: eventWithTakes.id,
    label: "live",
    recordedAt: now - 1,
    createdAt: now - 1,
    updatedAt: now - 1,
    instrumentIds: [bass.id],
  });
  await takesRepo.create(db, {
    songId: songWithTakes.id,
    eventId: eventWithTakes.id,
    label: "second pass",
    recordedAt: now - 2,
    createdAt: now - 2,
    updatedAt: now - 2,
    instrumentIds: [bass.id],
  });

  // A separate event whose one take has a ready master — this is the event
  // "Play all" is allowed to render on. `eventWithTakes` above deliberately
  // stays asset-less, so it doubles as the "no playable takes" case.
  const eventPlayable = await eventsRepo.create(db, {
    kind: "rehearsal",
    heldAt: now - 2000,
    venue: "Route Test Playable Venue",
    createdAt: now - 2000,
    updatedAt: now - 2000,
  });
  eventIdPlayable = eventPlayable.id;
  const playableTake = await takesRepo.create(db, {
    songId: songWithTakes.id,
    eventId: eventPlayable.id,
    recordedAt: now - 2000,
    createdAt: now - 2000,
    updatedAt: now - 2000,
    instrumentIds: [bass.id],
  });
  await assetsRepo.createMany(db, [
    {
      takeId: playableTake.id,
      kind: "master",
      tier: "lossless",
      format: "flac",
      storageKey: `route-test/${playableTake.id}/master.flac`,
      contentType: "audio/flac",
      bytes: 42_000_000,
      status: "ready",
      createdAt: now - 2000,
      readyAt: now - 2000,
    },
  ]);

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

/** `pnpm build` (astro build + the `dist/start.mjs` bundling step) — see `package.json`. */
async function buildApp(): Promise<void> {
  await execFileAsync("pnpm", ["run", "build"], { cwd: process.cwd() });
}

/** The real production entry point (`node dist/start.mjs`), never `astro dev`. */
function startBuiltServer(): ChildProcess {
  return spawn(process.execPath, [join(process.cwd(), "dist", "start.mjs")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      BANDPLATE_DATABASE_URL: `file:${dbPath}`,
      BANDPLATE_BOOTSTRAP_TOKEN: "route-test-bootstrap-token",
      BANDPLATE_APP_ORIGIN: ORIGIN,
      BANDPLATE_ALLOW_DEV_MAILER: "true",
      BANDPLATE_COOKIE_SECURE: "false",
      // Dummy S3 config — none of these route tests exercise the audio
      // endpoint, so this never needs to actually reach a bucket. It only
      // has to be PRESENT (config validation requires it) and internally
      // consistent enough that `createS3Storage` can be constructed.
      S3_ENDPOINT: "http://127.0.0.1:1",
      S3_PUBLIC_ENDPOINT: "http://127.0.0.1:1",
      S3_BUCKET: "unused-in-this-test",
      S3_REGION: "auto",
      S3_ACCESS_KEY_ID: "unused",
      S3_SECRET_ACCESS_KEY: "unused",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });
}

describe("member browsing routes over real HTTP", () => {
  beforeAll(async () => {
    dbDir = await mkdtemp(join(tmpdir(), "bandplate-songs-events-route-"));
    dbPath = join(dbDir, "db.sqlite");

    await buildApp();
    child = startBuiltServer();
    await waitForServer(`${ORIGIN}/login`, 30_000);

    sessionCookie = await seedAndGetSessionCookie();
  }, 90_000);

  afterAll(async () => {
    if (child && !child.killed) {
      // WAIT for it to actually exit, don't just signal it. Every route test
      // file builds into the same `dist/` and spawns `node dist/start.mjs`, so
      // a server still running from the previous file can be reading a bundle
      // the next file's `pnpm build` is midway through rewriting. That
      // surfaces, confusingly, as the NEXT file's server never becoming ready
      // — a different file each run, which is the signature of a race rather
      // than of a broken assertion.
      const exited = new Promise<void>((resolve) => {
        child?.once("exit", () => resolve());
      });
      child.kill("SIGTERM");
      // Bounded: a server that ignores SIGTERM must not hang the whole suite.
      await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 5_000))]);
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

  it("never ships the take-transition retarget script (a song page can't repeat a take, Fix round 3)", async () => {
    const res = await fetch(`${ORIGIN}/songs/${songSlug}`, { headers: { cookie: sessionCookie } });
    const body = await res.text();
    // See `home-search-me-takes.route.test.ts`'s own definition of this
    // marker for why it's a reliable, minification-proof way to detect
    // `TakeTransitionRetarget.astro`'s inline script specifically.
    expect(body).not.toContain("astroTransitionScope");
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

  it("never ships the take-transition retarget script (an event page can't repeat a take, Fix round 3)", async () => {
    const res = await fetch(`${ORIGIN}/events/${eventId}`, { headers: { cookie: sessionCookie } });
    const body = await res.text();
    expect(body).not.toContain("astroTransitionScope");
  });

  it("renders a real empty state for an event with no takes, not an error", async () => {
    const res = await fetch(`${ORIGIN}/events/${eventIdNoTakes}`, {
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("No takes logged for this one yet");
  });

  it("drops a take label that only repeats its event's kind, on the event's own page", async () => {
    const res = await fetch(`${ORIGIN}/events/${eventId}`, { headers: { cookie: sessionCookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    // A label the page cannot already be showing survives...
    expect(body).toContain('class="bp-take-note bp-take-elastic">second pass');
    // ...and one that only repeats the heading's own word does not. The event
    // is a concert, which renders as "live", and one of its takes is labelled
    // "live". That word legitimately appears elsewhere on the page — in the
    // event's own kind label — so this asserts on the take row's NOTE slot
    // rather than on the whole document.
    expect(body).not.toContain('class="bp-take-note bp-take-elastic">live');
  });

  it("renders Play all for an event with a playable take", async () => {
    const res = await fetch(`${ORIGIN}/events/${eventIdPlayable}`, {
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    // The attribute is unique on the page — no jsdom/DOMParser equivalent in
    // this repo's route tests, so presence/absence rides on that uniqueness
    // (see `docs/frontend-traps.md` on why a bare string match is otherwise
    // weak, and the task brief's own allowance for this file).
    expect(html).toContain('data-play-queue-start="event-takes"');
    expect(html).toContain("Play all");
  });

  it("renders no Play all button for an event whose takes have no playable asset", async () => {
    const res = await fetch(`${ORIGIN}/events/${eventId}`, {
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('data-play-queue-start="event-takes"');
    expect(html).not.toContain("Play all");
  });

  it("404s for an unknown event id", async () => {
    const res = await fetch(`${ORIGIN}/events/00000000-0000-0000-0000-000000000000`, {
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(404);
  });

  it("filters /songs by a plain GET query string — the JS-off path for search", async () => {
    const matching = await fetch(`${ORIGIN}/songs?q=Route`, { headers: { cookie: sessionCookie } });
    expect(matching.status).toBe(200);
    expect(await matching.text()).toContain("Route Test Song");

    const noMatch = await fetch(`${ORIGIN}/songs?q=zzzznothing`, {
      headers: { cookie: sessionCookie },
    });
    expect(noMatch.status).toBe(200);
    expect(await noMatch.text()).toContain("No songs match that search");
  });

  it("ignores an instrument param on /songs — that filter moved to /search", async () => {
    // A stale bookmark must not silently restrict the library to a filter the
    // page no longer shows. Bass matches one seeded song and drums matches
    // none, so a surviving filter would be visible in the result either way.
    const res = await fetch(
      `${ORIGIN}/songs?instrument=${bassInstrumentId}&instrument=${drumsInstrumentId}`,
      { headers: { cookie: sessionCookie } },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Route Test Song");
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

  // --- M8: the manual write surface, over real HTTP -----------------------
  //
  // These ride the server this file already boots rather than opening a fifth
  // one: each route test costs a full `pnpm build`, and these exercise exactly
  // the routes it is already serving. The seeded member has role `member`, so
  // this file proves BOTH halves of the M8 authorization split in one place —
  // a member can create and edit, and cannot archive.

  it("creates a song from a plain form POST and redirects to it", async () => {
    const body = new URLSearchParams({
      intent: "create",
      title: "Route Test Addition",
      musicalKey: "Gm",
      tempoBpm: "104",
    });
    const res = await fetch(`${ORIGIN}/songs`, {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin: ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/songs/route-test-addition?created=1");

    const page = await fetch(`${ORIGIN}/songs/route-test-addition`, {
      headers: { cookie: sessionCookie },
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Route Test Addition");
    expect(html).toContain("Gm");
  });

  it("re-renders with a field error instead of 500ing on a duplicate title", async () => {
    const body = new URLSearchParams({ intent: "create", title: "route test song" });
    const res = await fetch(`${ORIGIN}/songs`, {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin: ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });

    // `songs.title_norm` is UNIQUE and "route test song" normalizes onto the
    // seeded "Route Test Song" — the member gets told, not a stack trace.
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Route Test Song is already in the library.");
    expect(html).toContain('class="bp-field-error"');
  });

  it("saves an edit from the song's own page", async () => {
    const body = new URLSearchParams({
      intent: "update",
      songId: "",
      title: "Route Test Addition",
      musicalKey: "Bm",
      tempoBpm: "104",
      chordProgression: "",
      lyrics: "",
      notes: "played twice as fast the second time",
    });
    // The form carries the id; read it off the rendered page rather than
    // threading it out of the seed, so this exercises the real round trip.
    const page = await fetch(`${ORIGIN}/songs/route-test-addition`, {
      headers: { cookie: sessionCookie },
    });
    const html = await page.text();
    const id = /name="songId" value="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    body.set("songId", id as string);

    const res = await fetch(`${ORIGIN}/songs/route-test-addition`, {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin: ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/songs/route-test-addition?saved=1");

    const after = await fetch(`${ORIGIN}/songs/route-test-addition`, {
      headers: { cookie: sessionCookie },
    });
    expect(await after.text()).toContain("Bm");
  });

  it("creates an event from a plain form POST", async () => {
    const body = new URLSearchParams({
      intent: "create",
      kind: "session",
      heldAt: "2026-03-04",
      venue: "Route Test Studio",
      title: "",
      notes: "",
    });
    const res = await fetch(`${ORIGIN}/events`, {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin: ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/events\/[0-9a-f-]+\?created=1$/);
  });

  it("rejects a write whose Origin doesn't match", async () => {
    const res = await fetch(`${ORIGIN}/songs`, {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin: "https://evil.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ intent: "create", title: "Should Not Exist" }),
    });

    expect(res.status).toBe(403);

    const page = await fetch(`${ORIGIN}/songs`, { headers: { cookie: sessionCookie } });
    expect(await page.text()).not.toContain("Should Not Exist");
  });

  it("keeps archiving away from a member — it is admin-only, enforced by the path", async () => {
    const page = await fetch(`${ORIGIN}/songs/route-test-addition`, {
      headers: { cookie: sessionCookie },
    });
    const html = await page.text();
    const id = /name="songId" value="([^"]+)"/.exec(html)?.[1] as string;

    // The affordance is not rendered for a member...
    expect(html).not.toContain("Archive this song");

    // ...and the page behind it refuses them anyway, because `/admin/*` is
    // guarded in middleware rather than by each page remembering to check.
    const res = await fetch(`${ORIGIN}/admin/songs/${id}/archive`, {
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(403);
  });
});
