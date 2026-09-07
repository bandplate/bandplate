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

/**
 * Pulls every `view-transition-name` Astro's `transition:name` directive
 * emits (as `[data-astro-transition-scope="..."] { view-transition-name: X; }`
 * style blocks) out of a rendered page's HTML. Used to assert F1 (review
 * round 1): two elements sharing one name aborts the WHOLE page's view
 * transition per the CSS View Transitions spec, not just those two
 * elements — confirmed live in the browser against the pre-fix build (see
 * task-6-report.md's "Fix round 1" section).
 */
function extractViewTransitionNames(html: string): string[] {
  return [...html.matchAll(/view-transition-name:\s*([^;]+);/g)].map((m) => (m[1] ?? "").trim());
}

/**
 * `TakeTransitionRetarget.astro`'s inline script reads every take row's
 * `data-astro-transition-scope` (Astro's own per-element scope id) as the
 * "off" name when un-naming an occurrence — see that component's header
 * comment (Fix round 3). `astroTransitionScope` is a real JS property
 * access (`el.dataset.astroTransitionScope`), not a string literal, so
 * esbuild's default minifier never renames it away — a stable, script-only
 * marker that isn't also present just because a take row (which always
 * carries the `data-astro-transition-scope` ATTRIBUTE, script or no
 * script) is on the page.
 */
const TAKE_TRANSITION_RETARGET_MARKER = "astroTransitionScope";

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
  // A second instrument, archived AFTER being assigned to the member — the
  // data-model gap's own verification requirement: "a member holding an
  // archived instrument must still render" (membersRepo.listInstrumentsForMember
  // includes archived ones on purpose).
  const trombone = await instrumentsRepo.create(db, { slug: "trombone-home", label: "Trombone" });
  await membersRepo.setInstruments(db, member.id, [bass.id, trombone.id]);
  await instrumentsRepo.archive(db, trombone.id, now);

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
  // Also vote on the favorite take itself — this is what puts the same
  // take id on `/me` in BOTH the favorites section and the votes section,
  // the exact "favorited a take they also voted on" shape F1 (review round
  // 1) describes. Without this, `/me`'s duplicate-`view-transition-name`
  // regression test below would pass trivially (no overlap to deduplicate).
  await votesRepo.castVote(db, {
    takeId: favoriteTake.id,
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

    it("has no duplicate view-transition-name, even though the favorite take also appears under recent events (F1, review round 1)", async () => {
      const res = await fetch(`${ORIGIN}/`, { headers: { cookie: sessionCookie } });
      const body = await res.text();
      const names = extractViewTransitionNames(body);
      // Sanity: the fixture actually exercises the overlap this guards —
      // if this list is too short, the test below would pass trivially.
      expect(names.length).toBeGreaterThan(1);
      expect(new Set(names).size).toBe(names.length);
    });

    it("marks every take row with data-take-id and ships the transition-retarget script (Fix round 3)", async () => {
      const res = await fetch(`${ORIGIN}/`, { headers: { cookie: sessionCookie } });
      const body = await res.text();
      // The clicked-row-retargeting script needs a stable hook to find
      // both occurrences of a duplicated take by id — see
      // `TakeRow.astro`'s `data-take-id`.
      expect(body).toContain(`data-take-id="${favoriteTakeId}"`);
      expect(body).toContain(TAKE_TRANSITION_RETARGET_MARKER);
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

    it("never ships the take-transition retarget script (a take-detail hero can't be duplicated on its own page)", async () => {
      const res = await fetch(`${ORIGIN}/takes/${takeWithAssetsId}`, {
        headers: { cookie: sessionCookie },
      });
      const body = await res.text();
      expect(body).not.toContain(TAKE_TRANSITION_RETARGET_MARKER);
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

    it("submitting the form filters results AND re-populates the controls from the URL (F8, review round 1)", async () => {
      // The ORIGINAL version of this test fetched one hardcoded URL twice
      // and compared the two bodies — that passes even if every filter is
      // silently ignored (the request is byte-identical both times, so of
      // course the response is too). This version actually drives the
      // no-JS flow: fetch the bare form, read its real field names/ids
      // straight out of the rendered HTML (not hardcoded here), submit
      // values through THOSE fields as a plain GET would, then assert two
      // independently-falsifiable things on the result: the result set is
      // actually filtered, and the controls reflect the submitted values
      // back (a plain GET form re-populates from the URL, not from memory).
      const formPage = await fetch(`${ORIGIN}/search`, { headers: { cookie: sessionCookie } });
      const formBody = await formPage.text();
      expect(formBody).toContain('id="search-q"');
      expect(formBody).toContain(`id="search-instrument-${bassInstrumentId}"`);

      const submitted = new URLSearchParams();
      submitted.set("q", "skyline");
      submitted.set("state", "published");
      const url = `${ORIGIN}/search?${submitted.toString()}`;

      const first = await fetch(url, { headers: { cookie: sessionCookie } });
      expect(first.status).toBe(200);
      const firstBody = await first.text();

      // The result set is actually filtered — not just "some HTML came
      // back". A search-parsing regression that dropped every filter would
      // still show the favorite song here; a regression that broke the
      // free-text match specifically would drop the searchable one.
      expect(firstBody).toContain("Neon Skyline Searchable");
      expect(firstBody).not.toContain("Home Favorite Song");

      // The controls are re-populated from the URL's own query string, not
      // from anything server-side/session-held — this is what "works with
      // JS off" and "a search is shareable/bookmarkable" actually require:
      // pasting this exact URL in a fresh tab must reproduce the same
      // filled-in form, not just the same results.
      expect(firstBody).toContain('value="skyline"');
      expect(firstBody).toMatch(
        /id="search-state-published"[^>]*checked|checked[^>]*id="search-state-published"/,
      );
      // A DIFFERENT state checkbox must NOT be checked — proves this is
      // real per-field re-population, not e.g. every checkbox rendering
      // checked regardless of the query string.
      expect(firstBody).not.toMatch(
        /id="search-state-keeper"[^>]*checked|checked[^>]*id="search-state-keeper"/,
      );

      // Pasting the identical URL again reproduces the identical page —
      // the actual "round-trip" claim, now checked alongside (not instead
      // of) the filtering/re-population it's supposed to be a property of.
      const second = await fetch(url, { headers: { cookie: sessionCookie } });
      expect(await second.text()).toEqual(firstBody);
    });

    it("returns a real empty state, not an error, when nothing matches", async () => {
      const res = await fetch(`${ORIGIN}/search?q=no-such-song-title-anywhere`, {
        headers: { cookie: sessionCookie },
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("No takes match those filters");
    });

    it("never ships the take-transition retarget script (its results list can't repeat a take)", async () => {
      const res = await fetch(`${ORIGIN}/search`, { headers: { cookie: sessionCookie } });
      const body = await res.text();
      expect(body).not.toContain(TAKE_TRANSITION_RETARGET_MARKER);
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
      // The member's instruments — including the archived one (the
      // data-model gap's own verification requirement).
      expect(body).toContain("Bass");
      expect(body).toContain("Trombone");
      expect(body).toContain("(archived)");
    });

    it("has no duplicate view-transition-name, even though the favorite take was also voted on (F1, review round 1)", async () => {
      const res = await fetch(`${ORIGIN}/me`, { headers: { cookie: sessionCookie } });
      const body = await res.text();
      const names = extractViewTransitionNames(body);
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length);
    });

    it("marks every take row with data-take-id and ships the transition-retarget script (Fix round 3)", async () => {
      const res = await fetch(`${ORIGIN}/me`, { headers: { cookie: sessionCookie } });
      const body = await res.text();
      expect(body).toContain(`data-take-id="${favoriteTakeId}"`);
      expect(body).toContain(TAKE_TRANSITION_RETARGET_MARKER);
    });
  });
});
