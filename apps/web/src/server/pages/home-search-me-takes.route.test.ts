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
import { generateToken, hashToken } from "@bandplate/core";
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
} from "@bandplate/db";
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
let searchableSongId: string;
let memberId: string;

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
  searchableSongId = searchableSong.id;

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

  memberId = member.id;

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
      BANDPLATE_DATABASE_URL: `file:${dbPath}`,
      BANDPLATE_BOOTSTRAP_TOKEN: "home-route-test-bootstrap-token",
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

describe("home / search / me / take-detail routes over real HTTP", () => {
  beforeAll(async () => {
    dbDir = await mkdtemp(join(tmpdir(), "bandplate-home-route-"));
    dbPath = join(dbDir, "db.sqlite");

    await buildApp();
    child = startBuiltServer();
    await waitForServer(`${ORIGIN}/login`, 30_000);

    sessionCookie = await seedAndGetSessionCookie();
  }, 120_000);

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

  describe("/", () => {
    it("redirects an anonymous visitor to /login", async () => {
      const res = await fetch(`${ORIGIN}/`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it("renders the pinned things and the event ledger for a signed-in member", async () => {
      const res = await fetch(`${ORIGIN}/`, { headers: { cookie: sessionCookie } });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(`/songs/${favoriteSongSlug}`); // pinned song, linked
      expect(body).toContain(`/takes/${favoriteTakeId}`); // pinned take, linked
      expect(body).toContain("Home Test Venue"); // the ledger's newest entry
    });

    it("no longer renders the needs-your-vote queue", async () => {
      // The queue is gone from the page everyone opens; its count lives on
      // `/me` now (asserted below). This take is published and unvoted by this
      // member, so it WOULD have been listed here before — which is what makes
      // the absence meaningful rather than vacuous.
      const res = await fetch(`${ORIGIN}/`, { headers: { cookie: sessionCookie } });
      const body = await res.text();
      expect(body).not.toContain(`/takes/${publishedUnvotedTakeId}`);
      expect(body).not.toContain("Needs your vote");
    });

    it("emits no duplicate view-transition-name — structurally, not by accident", async () => {
      // Home used to render one take in up to three sections at once, which
      // assigns the same name twice and (per the spec) aborts the transition
      // for the WHOLE page; `claimTakeTransition` existed to prevent it. With
      // one pinned list there is nowhere for a take to appear twice, so this
      // now guards the structure rather than the workaround.
      const res = await fetch(`${ORIGIN}/`, { headers: { cookie: sessionCookie } });
      const names = extractViewTransitionNames(await res.text());
      expect(new Set(names).size).toBe(names.length);
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
      // This take HAS a ready master (lossless-only here —
      // `listPlayableMastersByTakeIds` falls back to it when there's no
      // lossy tier), so it gets a real play control wired to that asset. The
      // persistent player's own `<audio>` element is a global, once-per-page
      // thing (rendered by `AppLayout.astro`), not per-take — its presence
      // here is expected on every member-facing page, not evidence specific
      // to this take.
      expect(body).toContain("bp-play-toggle");
      expect(body).toContain('data-role="toggle"');
      expect(body).toMatch(/data-audio-source[^>]*data-take-id="[^"]*"[^>]*data-asset-id="[^"]*"/);
      // And NO per-stem solo drawer. It used to render one chip per ready
      // stem here; a take's page now offers the master and the mixer, and
      // solo lives in the shell player's own source switcher. Asserted as an
      // absence because that is the whole change — a passing "Solo: Bass"
      // would mean the drawer came back.
      expect(body).not.toContain("bp-solo-chip");
      expect(body).toContain("<audio");
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

    it("renders NO play control for a take with no playable asset — not a disabled one", async () => {
      const res = await fetch(`${ORIGIN}/takes/${takeWithNoAssetsId}`, {
        headers: { cookie: sessionCookie },
      });
      const body = await res.text();
      // Absent entirely, not present-and-disabled: no `bp-play-toggle`
      // markup and no `data-audio-source` referencing this take's id
      // anywhere on the page (the persistent player's own always-present
      // `<audio>` element is fine — see the previous test's comment — but
      // nothing should point AT this take). `data-take-id` alone is no
      // longer a reliable proxy for "has a play control" — Task 8's
      // `VoteToggle`/the take-label link legitimately carry it too, for an
      // unrelated purpose (which take a vote/favorite is about), so a take
      // with no playable asset still has plenty of `data-take-id`
      // attributes on its own detail page; the play-control-specific
      // `data-audio-source` pairing is the real signal.
      expect(body).not.toContain("bp-play-toggle");
      expect(body).not.toMatch(
        new RegExp(`data-audio-source[^>]*data-take-id="${takeWithNoAssetsId}"`),
      );
    });

    it("404s for an unknown take id", async () => {
      const res = await fetch(`${ORIGIN}/takes/00000000-0000-0000-0000-000000000000`, {
        headers: { cookie: sessionCookie },
      });
      expect(res.status).toBe(404);
    });
  });

  /**
   * Just the results region of `/takes`. The song filter is a `<select>` now, so
   * EVERY song title is in the page as an `<option>` whether or not it matched —
   * a whole-body `not.toContain("Some Song")` would be asserting against the
   * control rather than the results, and would fail even when the filter works
   * perfectly. Slicing to the results container is what keeps these assertions
   * about what they claim to be about.
   */
  function resultsRegion(html: string): string {
    const start = html.indexOf('class="bp-search-results"');
    return start === -1 ? html : html.slice(start);
  }

  describe("/takes (the archive)", () => {
    it("redirects an anonymous visitor to /login", async () => {
      const res = await fetch(`${ORIGIN}/takes`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it("a plain GET with no filters renders every take", async () => {
      const res = await fetch(`${ORIGIN}/takes`, { headers: { cookie: sessionCookie } });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Neon Skyline Searchable");
      expect(body).toContain("Home Favorite Song");
    });

    it("filters by song via a plain GET query string", async () => {
      const res = await fetch(`${ORIGIN}/takes?song=${searchableSongId}`, {
        headers: { cookie: sessionCookie },
      });
      expect(res.status).toBe(200);
      const body = resultsRegion(await res.text());
      expect(body).toContain("Neon Skyline Searchable");
      expect(body).not.toContain("Home Favorite Song");
    });

    it("/search redirects permanently to /takes, carrying the query string", async () => {
      // `/me`'s unvoted count shipped pointing at the old path, and a member
      // may have bookmarked a filtered search — a saved filter has to land on
      // the same results rather than on the whole archive.
      const res = await fetch(`${ORIGIN}/search?unvoted=1`, {
        headers: { cookie: sessionCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/takes?unvoted=1");
    });

    it("filters by instrument via a plain GET query string", async () => {
      const res = await fetch(`${ORIGIN}/takes?instrument=${bassInstrumentId}`, {
        headers: { cookie: sessionCookie },
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Home Favorite Song");
    });

    it("ignores a state param — the archive has no state filter", () => {
      // Kept as a route-level check, not just a parser one: a stale bookmark
      // has to come back with the whole archive rather than a silently
      // narrowed slice of it.
      return fetch(`${ORIGIN}/takes?state=published`, { headers: { cookie: sessionCookie } })
        .then((res) => {
          expect(res.status).toBe(200);
          return res.text();
        })
        .then((body) => {
          expect(resultsRegion(body)).toContain("Neon Skyline Searchable");
          expect(resultsRegion(body)).toContain("Home Favorite Song");
        });
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
      const formPage = await fetch(`${ORIGIN}/takes`, { headers: { cookie: sessionCookie } });
      const formBody = await formPage.text();
      expect(formBody).toContain('id="search-song"');
      expect(formBody).toContain(`id="search-instrument-${bassInstrumentId}"`);

      const submitted = new URLSearchParams();
      submitted.set("song", searchableSongId);
      submitted.set("unvoted", "1");
      const url = `${ORIGIN}/takes?${submitted.toString()}`;

      const first = await fetch(url, { headers: { cookie: sessionCookie } });
      expect(first.status).toBe(200);
      const firstBody = await first.text();

      // The result set is actually filtered — not just "some HTML came
      // back". A search-parsing regression that dropped every filter would
      // still show the favorite song here; a regression that broke the
      // free-text match specifically would drop the searchable one.
      expect(resultsRegion(firstBody)).toContain("Neon Skyline Searchable");
      expect(resultsRegion(firstBody)).not.toContain("Home Favorite Song");

      // The controls are re-populated from the URL's own query string, not
      // from anything server-side/session-held — this is what "works with
      // JS off" and "a search is shareable/bookmarkable" actually require:
      // pasting this exact URL in a fresh tab must reproduce the same
      // filled-in form, not just the same results.
      expect(firstBody).toMatch(
        new RegExp(
          `value="${searchableSongId}"[^>]*selected|selected[^>]*value="${searchableSongId}"`,
        ),
      );
      expect(firstBody).toMatch(/id="search-unvoted"[^>]*checked|checked[^>]*id="search-unvoted"/);
      // A DIFFERENT checkbox must NOT be checked — proves this is real
      // per-field re-population, not every checkbox rendering checked
      // regardless of the query string.
      expect(firstBody).not.toMatch(
        new RegExp(`id="search-instrument-${bassInstrumentId}"[^>]*checked`),
      );

      // Pasting the identical URL again reproduces the identical page —
      // the actual "round-trip" claim, now checked alongside (not instead
      // of) the filtering/re-population it's supposed to be a property of.
      const second = await fetch(url, { headers: { cookie: sessionCookie } });
      expect(await second.text()).toEqual(firstBody);
    });

    it("returns a real empty state, not an error, when nothing matches", async () => {
      const res = await fetch(`${ORIGIN}/takes?song=00000000-0000-0000-0000-000000000000`, {
        headers: { cookie: sessionCookie },
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("No takes match those filters");
    });

    it("never ships the take-transition retarget script (its results list can't repeat a take)", async () => {
      const res = await fetch(`${ORIGIN}/takes`, { headers: { cookie: sessionCookie } });
      const body = await res.text();
      expect(body).not.toContain(TAKE_TRANSITION_RETARGET_MARKER);
    });

    it("TakeRow itself renders a play control only for a take WITH a ready master, not a disabled one for a take without (fix round 1, item 4)", async () => {
      // The pre-existing "no play control" coverage was only on
      // `/takes/[id]`, which has its OWN `playableMaster &&` conditional
      // around a bare `<PlayToggleButton>` — a mutation that made TakeRow
      // itself always render a play control (regardless of
      // `playableAssetId`) survived every test in the suite because
      // nothing exercised a TakeRow-rendered LIST, which is what every
      // other page (this one included) actually uses. `/search` with no
      // filters lists both `takeWithAssetsId` (a ready master) and
      // `takeWithNoAssetsId` (no assets at all) side by side via TakeRow.
      const res = await fetch(`${ORIGIN}/takes`, { headers: { cookie: sessionCookie } });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(new RegExp(`data-audio-source[^>]*data-take-id="${takeWithAssetsId}"`));
      expect(body).not.toMatch(
        new RegExp(`data-audio-source[^>]*data-take-id="${takeWithNoAssetsId}"`),
      );
    });
  });

  describe("/me", () => {
    it("redirects an anonymous visitor to /login", async () => {
      const res = await fetch(`${ORIGIN}/me`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it("renders the member's name, instruments and votes", async () => {
      const res = await fetch(`${ORIGIN}/me`, { headers: { cookie: sessionCookie } });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Robin Home-Test");
      expect(body).toContain("Neon Skyline Searchable"); // the take voted on
      expect(body).toContain("keeper");
      // Instruments are icons now, so the LABELS live in the run's
      // accessible name rather than in visible text — including the archived
      // one, which is the data-model gap's own verification requirement.
      expect(body).toContain("Plays: Bass, Trombone");
    });

    // Both settings sit above the votes: the votes list grows without end, and
    // a setting under it is a setting nobody finds.
    it("puts appearance and language above the votes", async () => {
      const res = await fetch(`${ORIGIN}/me`, { headers: { cookie: sessionCookie } });
      const body = await res.text();
      const appearance = body.indexOf('id="me-theme"');
      const language = body.indexOf('id="me-locale"');
      const votes = body.indexOf("Recent votes");
      expect(appearance).toBeGreaterThan(-1);
      expect(language).toBeGreaterThan(appearance);
      expect(votes).toBeGreaterThan(language);
    });

    it("renders the theme from the cookie, before any script runs", async () => {
      const plain = await (
        await fetch(`${ORIGIN}/me`, { headers: { cookie: sessionCookie } })
      ).text();
      // No choice: no attribute, so the media query decides, and both chrome colours.
      expect(plain).not.toMatch(/<html[^>]*data-theme=/);
      expect(plain.match(/<meta name="theme-color"/g)).toHaveLength(2);
      expect(plain).toMatch(/value="system"[^>]*aria-pressed="true"/);

      const dark = await (
        await fetch(`${ORIGIN}/me`, { headers: { cookie: `${sessionCookie}; bp_theme=dark` } })
      ).text();
      expect(dark).toMatch(/<html[^>]*data-theme="dark"/);
      expect(dark.match(/<meta name="theme-color"/g)).toHaveLength(1);
      expect(dark).toMatch(/value="dark"[^>]*aria-pressed="true"/);
    });

    it("saves a theme posted without JS, and redirects back", async () => {
      const res = await fetch(`${ORIGIN}/me`, {
        method: "POST",
        headers: { cookie: sessionCookie, origin: ORIGIN },
        body: new URLSearchParams({ intent: "theme", theme: "light" }),
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/me");
      expect(res.headers.get("set-cookie")).toContain("bp_theme=light");
    });

    it("no longer renders sessions or a second copy of the pinned list", async () => {
      // Both came off this page deliberately (see `me.ts`): home is the shelf,
      // and a device list answered a question nobody in a five-piece band asks.
      // The fixture has both a favorited song and a live session, so their
      // absence is meaningful rather than vacuous.
      //
      // Probing the SECTION rather than a song title: the member also voted on
      // a take of the favorited song, so its title legitimately appears in the
      // votes list below and asserting on it would fail for the wrong reason.
      const res = await fetch(`${ORIGIN}/me`, { headers: { cookie: sessionCookie } });
      const body = await res.text();
      expect(body).not.toContain("Favorites");
      expect(body).not.toContain("this device");
    });

    it("has no Notifications section when push isn't configured", async () => {
      // This suite's server is built with no VAPID env at all (see this
      // file's own setup) — `getWebConfig().push` is `undefined`, so
      // `NotificationSettings` must not even be mounted. No fake affordance
      // for a feature that isn't configured.
      const res = await fetch(`${ORIGIN}/me`, { headers: { cookie: sessionCookie } });
      const body = await res.text();
      expect(body).not.toContain("Notifications");
      expect(body).not.toMatch(/NotificationSettings/);
    });

    it("ships no transition-retarget script anywhere any more", async () => {
      // `TakeTransitionRetarget.astro` is deleted. It existed because one take
      // could appear twice on a page, which assigns the same
      // `view-transition-name` twice and aborts the transition for the whole
      // page. Home has one pinned list now and `/me` has one vote per take per
      // member, so no page can repeat a take and the machinery has nothing to
      // fix. A vote row still carries `data-take-id` for the morph itself.
      const res = await fetch(`${ORIGIN}/me`, { headers: { cookie: sessionCookie } });
      const body = await res.text();
      expect(body).toContain(`data-take-id="${favoriteTakeId}"`);
      expect(body).not.toContain(TAKE_TRANSITION_RETARGET_MARKER);
    });
  });

  // -------------------------------------------------------------------------
  // Czech
  // -------------------------------------------------------------------------

  describe("rendering in Czech", () => {
    // Against the BUILT server, like everything else in this file — which is
    // the point. Locale resolution runs in middleware, `<html lang>` is set in
    // the layout, and the islands render server-side before they hydrate;
    // none of that is exercised by a unit test of the catalog.
    //
    // Each assertion is a PAIR: something Czech is present, and a distinctive
    // English string is absent. Positive alone would pass a page that renders
    // both; negative alone would pass a blank page. The absent strings are
    // chosen to be distinctive — a sentinel like " of " appears in URLs and
    // attributes and would false-positive forever.
    // Built per request, not once at describe time: `sessionCookie` is
    // assigned in `beforeAll`, which runs AFTER the describe body.
    const signedIn = () => ({ cookie: sessionCookie });

    // A signed-in member's OWN setting outranks the cookie — that is the
    // documented precedence — so a `bp_locale` header would be ignored here.
    // The row is what has to change.
    beforeAll(async () => {
      const client = createClient({ url: `file:${dbPath}` });
      await membersRepo.update(createDb(client), memberId, { locale: "cs" });
      client.close();
    });

    afterAll(async () => {
      const client = createClient({ url: `file:${dbPath}` });
      await membersRepo.update(createDb(client), memberId, { locale: "en" });
      client.close();
    });

    it("negotiates from Accept-Language when nothing else is known", async () => {
      const res = await fetch(`${ORIGIN}/login`, {
        headers: { "accept-language": "cs-CZ,cs;q=0.9,en;q=0.8" },
      });
      const body = await res.text();
      expect(body).toContain('<html lang="cs"');
      expect(body).toContain("Zadej e-mail.");
      expect(body).not.toContain("Enter your email.");
    });

    it("lets a bp_locale cookie outrank the browser's preference", async () => {
      const res = await fetch(`${ORIGIN}/login`, {
        headers: { "accept-language": "en-US,en;q=0.9", cookie: "bp_locale=cs" },
      });
      expect(await res.text()).toContain('<html lang="cs"');
    });

    it("ignores a bp_locale naming a language we do not speak", async () => {
      const res = await fetch(`${ORIGIN}/login`, { headers: { cookie: "bp_locale=sk" } });
      expect(await res.text()).toContain('<html lang="en"');
    });

    it("renders home in Czech", async () => {
      const res = await fetch(`${ORIGIN}/`, { headers: signedIn() });
      const body = await res.text();
      expect(body).toContain('<html lang="cs"');
      expect(body).toContain("Oblíbené");
      expect(body).toContain("Poslední akce");
      expect(body).not.toContain("Recent events");
      expect(body).not.toContain("Nothing pinned yet.");
    });

    it("renders the shell nav in Czech, on both layouts", async () => {
      const body = await (await fetch(`${ORIGIN}/songs`, { headers: signedIn() })).text();
      for (const label of ["Domů", "Skladby", "Akce", "Nahrávky", "Já"]) {
        expect(body).toContain(label);
      }
      // "Taky" was the first draft of the Takes label and is unusable — it
      // reads as Czech *taky*, "also". This is the regression guard.
      expect(body).not.toContain(">Taky<");
      expect(body).not.toContain(">Songs<");
    });

    it("renders /takes and its filter sheet in Czech", async () => {
      const body = await (await fetch(`${ORIGIN}/takes`, { headers: signedIn() })).text();
      expect(body).toContain("Filtry");
      expect(body).toContain("Poslední týden");
      expect(body).toContain("Nejnovější");
      expect(body).not.toContain("Past week");
      expect(body).not.toContain("Most recent");
    });

    it("renders /me and its language picker in Czech", async () => {
      const body = await (await fetch(`${ORIGIN}/me`, { headers: signedIn() })).text();
      expect(body).toContain("Poslední hlasy");
      expect(body).toContain("Jazyk");
      // Autonyms: whoever set Czech by accident has to be able to read their
      // way back out, so the language NAMES stay in their own language.
      expect(body).toContain("English");
      expect(body).toContain("Čeština");
      expect(body).not.toContain("Recent votes");
      expect(body).not.toContain("Sign out");
    });

    it("shows the profile ledger, and a dash where nothing is settled yet", async () => {
      const body = await (await fetch(`${ORIGIN}/me`, { headers: signedIn() })).text();
      // The seeded member has votes but nothing the band has promoted or
      // rejected, so agreement has no answer — and a dash is not 0%.
      expect(body).toContain("Shoda s kapelou");
      // The dash element itself is the assertion. NOT `not.toContain("0%")`:
      // the player's rail ships `style="width:0%"` on every page.
      expect(body).toContain("bp-profile-figure-none");
    });

    it("declines the take count rather than bolting an s on", async () => {
      const body = await (await fetch(`${ORIGIN}/takes`, { headers: signedIn() })).text();
      // 1 nahrávka · 2–4 nahrávky · 5+ nahrávek — whichever the seed produces,
      // it must be one of those and never the English form.
      expect(body).toMatch(/\d+ nahráv(ka|ky|ek)/);
      expect(body).not.toMatch(/\d+ takes?\b/);
    });
  });
});
